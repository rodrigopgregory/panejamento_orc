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
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  });
  const j = await res.json();
  let o = j?.result?.output ?? j?.output; if (typeof o === 'string') o = JSON.parse(o);
  return o;
};
// CR nao-aprovado com token
const tks = await q(`SELECT t.TOKEN, t.CICLO_ID, gc.CR_ID,
  (SELECT COALESCE(os.STATUS,'PENDENTE') FROM ORCAMENTO_STATUS os WHERE os.CICLO_ID=t.CICLO_ID AND os.CR_ID=gc.CR_ID LIMIT 1) AS ST
  FROM PREENCHIMENTO_TOKEN t JOIN GESTOR_CR gc ON gc.GESTOR_ID=t.GESTOR_ID
  WHERE t.ATIVO='true' HAVING ST != 'APROVADO' ORDER BY t.ID DESC LIMIT 1`);
const { TOKEN, CICLO_ID, CR_ID } = tks[0];
const contas = await q(`SELECT CONTA_ID FROM CR_CONTA WHERE CR_ID=${CR_ID} AND ATIVO=true LIMIT 1`);
const contaId = Number(contas[0].CONTA_ID);
const before = await q(`SELECT VALOR, QUANTIDADE, VALOR_UNITARIO FROM ORCAMENTO WHERE CICLO_ID=${CICLO_ID} AND CR_ID=${CR_ID} AND CONTA_ID=${contaId} AND MES=11`);
console.log('antes:', JSON.stringify(before));
const w = await pub(147, { token: TOKEN, op: 'orcCells', crId: Number(CR_ID), cells: [{ contaId, mes: 11, valor: 424242, qtd: 3, vu: 141414 }] });
console.log('write via endpoint publico:', JSON.stringify(w));
const after = await q(`SELECT VALOR, QUANTIDADE, VALOR_UNITARIO FROM ORCAMENTO WHERE CICLO_ID=${CICLO_ID} AND CR_ID=${CR_ID} AND CONTA_ID=${contaId} AND MES=11`);
console.log('depois:', JSON.stringify(after), Number(after?.[0]?.VALOR) === 424242 ? 'OK' : '!!!');
// restaura
if (before.length) {
  await pub(147, { token: TOKEN, op: 'orcCells', crId: Number(CR_ID), cells: [{ contaId, mes: 11, valor: Number(before[0].VALOR), qtd: Number(before[0].QUANTIDADE) || 0, vu: Number(before[0].VALOR_UNITARIO) || 0 }] });
} else {
  const { runDmlMitra } = await import('mitra-sdk');
  await runDmlMitra({ projectId, sql: `DELETE FROM ORCAMENTO WHERE CICLO_ID=${CICLO_ID} AND CR_ID=${CR_ID} AND CONTA_ID=${contaId} AND MES=11 AND VALOR=424242` });
}
const restored = await q(`SELECT VALOR FROM ORCAMENTO WHERE CICLO_ID=${CICLO_ID} AND CR_ID=${CR_ID} AND CONTA_ID=${contaId} AND MES=11`);
console.log('restaurado:', JSON.stringify(restored), '(original:', JSON.stringify(before), ')');
