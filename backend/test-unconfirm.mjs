import 'dotenv/config';
import { configureSdkMitra, executeServerFunctionMitra } from 'mitra-sdk';
configureSdkMitra({ baseURL: process.env.MITRA_BASE_URL, token: process.env.MITRA_TOKEN, integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS });
const projectId = parseInt(process.env.MITRA_PROJECT_ID);
const q = async (sql) => {
  const r = await executeServerFunctionMitra({ projectId, serverFunctionId: 76, input: { sql } });
  let o = r?.result?.output; if (typeof o === 'string') o = JSON.parse(o);
  return o?.rows || [];
};
const base = 'https://newmitra.mitrasheet.com:8080';
const pub = async (sfId, input) => {
  const res = await fetch(`${base}/public/serverFunction/${projectId}/${sfId}/execute`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  const j = await res.json();
  let o = j?.result?.output ?? j?.output; if (typeof o === 'string') o = JSON.parse(o);
  return o;
};
// token da versao INICIADA, CR nao aprovado/submetido
const tk = (await q(`SELECT t.TOKEN, t.CICLO_ID, gc.CR_ID,
  (SELECT COALESCE(os.STATUS,'PENDENTE') FROM ORCAMENTO_STATUS os WHERE os.CICLO_ID=t.CICLO_ID AND os.CR_ID=gc.CR_ID LIMIT 1) AS ST
  FROM PREENCHIMENTO_TOKEN t JOIN CICLO c ON c.ID=t.CICLO_ID AND c.STATUS='INICIADA'
  JOIN GESTOR_CR gc ON gc.GESTOR_ID=t.GESTOR_ID WHERE t.ATIVO='true'
  HAVING ST IN ('PENDENTE') LIMIT 1`))[0];
if (!tk) { console.log('sem CR PENDENTE disponivel pra teste'); process.exit(0); }
const crId = Number(tk.CR_ID);
const stq = `SELECT STATUS, DRIVERS_CONFIRMADOS FROM ORCAMENTO_STATUS WHERE CICLO_ID=${tk.CICLO_ID} AND CR_ID=${crId}`;
const orig = (await q(stq))[0] || null;
console.log('estado original:', JSON.stringify(orig));

// 1) confirma parcial (nao todos) — status deve permanecer PENDENTE
await pub(147, { token: tk.TOKEN, op: 'confirmDriver', crId, driversCsv: 'BASE_ZERO', allConfirmed: false });
console.log('apos confirmar 1 (parcial):', JSON.stringify((await q(stq))[0]));
// 2) confirma todos — PENDENTE -> CONFIRMADO
await pub(147, { token: tk.TOKEN, op: 'confirmDriver', crId, driversCsv: 'BASE_ZERO,BASE_HISTORICO,PESSOAL,RECEITA', allConfirmed: true });
console.log('apos confirmar todos:', JSON.stringify((await q(stq))[0]));
// 3) desfaz um — CONFIRMADO -> PENDENTE
await pub(147, { token: tk.TOKEN, op: 'confirmDriver', crId, driversCsv: 'BASE_ZERO,BASE_HISTORICO,PESSOAL', allConfirmed: false });
console.log('apos desfazer 1:', JSON.stringify((await q(stq))[0]));

// restaura estado original
const { runDmlMitra } = await import('mitra-sdk');
if (orig) {
  await runDmlMitra({ projectId, sql: `UPDATE ORCAMENTO_STATUS SET STATUS='${orig.STATUS}', DRIVERS_CONFIRMADOS=${orig.DRIVERS_CONFIRMADOS == null ? 'NULL' : `'${orig.DRIVERS_CONFIRMADOS}'`} WHERE CICLO_ID=${tk.CICLO_ID} AND CR_ID=${crId}` });
} else {
  await runDmlMitra({ projectId, sql: `DELETE FROM ORCAMENTO_STATUS WHERE CICLO_ID=${tk.CICLO_ID} AND CR_ID=${crId}` });
}
console.log('restaurado:', JSON.stringify((await q(stq))[0] ?? null), '(original:', JSON.stringify(orig), ')');
