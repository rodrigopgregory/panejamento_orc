import 'dotenv/config';
import { configureSdkMitra, executeServerFunctionMitra } from 'mitra-sdk';
configureSdkMitra({ baseURL: process.env.MITRA_BASE_URL, token: process.env.MITRA_TOKEN, integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS });
const projectId = parseInt(process.env.MITRA_PROJECT_ID);
const q = async (sql) => {
  const r = await executeServerFunctionMitra({ projectId, serverFunctionId: 76, input: { sql } });
  let o = r?.result?.output; if (typeof o === 'string') o = JSON.parse(o);
  return o?.rows || [];
};
const ex = async (id, input) => {
  const r = await executeServerFunctionMitra({ projectId, serverFunctionId: id, input });
  if (r?.result?.executionStatus === 'FAILED') throw new Error(`SF ${id}: ${r?.result?.error}`);
  let o = r?.result?.output; if (typeof o === 'string') o = JSON.parse(o);
  return o;
};
const jb = (v) => { if (typeof v === 'string') { try { return JSON.parse(v) || []; } catch { return []; } } return Array.isArray(v) ? v : []; };
const sum = (rows) => rows.reduce((s, r) => s + (Number(r.VALOR) || 0), 0);

// token de gestor com orcamento lancado e nao aprovado
const tks = await q(`SELECT t.TOKEN, t.CICLO_ID, t.GESTOR_ID, c.ANO, gc.CR_ID,
  (SELECT COUNT(*) FROM ORCAMENTO o WHERE o.CICLO_ID = t.CICLO_ID AND o.CR_ID = gc.CR_ID) AS NORC,
  (SELECT COALESCE(os.STATUS,'PENDENTE') FROM ORCAMENTO_STATUS os WHERE os.CICLO_ID = t.CICLO_ID AND os.CR_ID = gc.CR_ID LIMIT 1) AS ST
  FROM PREENCHIMENTO_TOKEN t
  JOIN CICLO c ON c.ID = t.CICLO_ID
  JOIN GESTOR_CR gc ON gc.GESTOR_ID = t.GESTOR_ID
  WHERE t.ATIVO = 'true'
  HAVING NORC > 0 AND ST NOT IN ('APROVADO')
  ORDER BY NORC DESC LIMIT 1`);
if (!tks.length) { console.log('sem CR com orcamento e nao-aprovado — pulo teste de escrita rica'); process.exit(0); }
const { TOKEN, CICLO_ID, GESTOR_ID, ANO, CR_ID, NORC, ST } = tks[0];
const crId = Number(CR_ID), anoPrev = Number(ANO) - 1;
console.log(`teste: gestor ${GESTOR_ID}, ciclo ${CICLO_ID}, CR ${crId} (${NORC} lancamentos, status ${ST})`);

const inputCr = { crId, cicloId: CICLO_ID, ano: ANO, anoPrev, gestorId: GESTOR_ID, controlCicloId: 0 };
const pubCr = (await ex(143, { ...inputCr, token: TOKEN }))?.rows?.[0] || {};
const intCr = (await ex(125, inputCr))?.rows?.[0] || {};
console.log(`BUDGET soma: pub=${sum(jb(pubCr.BUDGET))} int=${sum(jb(intCr.BUDGET))} ${sum(jb(pubCr.BUDGET)) === sum(jb(intCr.BUDGET)) ? 'OK' : '!!!'}`);

// ── teste da SF 147 (write): orcCells em conta valida do CR ──
const contas = await q(`SELECT crc.CONTA_ID FROM CR_CONTA crc WHERE crc.CR_ID = ${crId} AND crc.ATIVO = true LIMIT 1`);
const contaId = Number(contas[0].CONTA_ID);
const before = await q(`SELECT VALOR FROM ORCAMENTO WHERE CICLO_ID = ${CICLO_ID} AND CR_ID = ${crId} AND CONTA_ID = ${contaId} AND MES = 12`);
console.log(`celula (conta ${contaId}, mes 12) antes: ${before.length ? before[0].VALOR : 'inexistente'}`);

// escrita com token INVALIDO — nao pode afetar nada
await ex(147, { token: '00000000-0000-0000-0000-000000000000', op: 'orcCells', crId, cells: [{ contaId, mes: 12, valor: 999999 }] });
const afterBad = await q(`SELECT VALOR FROM ORCAMENTO WHERE CICLO_ID = ${CICLO_ID} AND CR_ID = ${crId} AND CONTA_ID = ${contaId} AND MES = 12`);
const badVal = afterBad.length ? Number(afterBad[0].VALOR) : null;
console.log(`apos escrita com token invalido: ${badVal === (before.length ? Number(before[0].VALOR) : null) ? 'INALTERADO OK' : '!!! ESCREVEU'}`);

// escrita valida: 777123 -> verifica -> restaura
const w = await ex(147, { token: TOKEN, op: 'orcCells', crId, cells: [{ contaId, mes: 12, valor: 777123 }] });
console.log('write valido:', JSON.stringify(w));
const afterGood = await q(`SELECT VALOR FROM ORCAMENTO WHERE CICLO_ID = ${CICLO_ID} AND CR_ID = ${crId} AND CONTA_ID = ${contaId} AND MES = 12`);
console.log(`apos escrita valida: ${afterGood.length ? afterGood[0].VALOR : 'nada'} ${Number(afterGood?.[0]?.VALOR) === 777123 ? 'OK' : '!!!'}`);
// restaura estado original
if (before.length) {
  await ex(147, { token: TOKEN, op: 'orcCells', crId, cells: [{ contaId, mes: 12, valor: Number(before[0].VALOR) }] });
} else {
  await executeServerFunctionMitra({ projectId, serverFunctionId: 147, input: { token: TOKEN, op: 'orcCells', crId, cells: [] } });
  await q(`SELECT 1`); // noop
  const { runDmlMitra } = await import('mitra-sdk');
  await runDmlMitra({ projectId, sql: `DELETE FROM ORCAMENTO WHERE CICLO_ID = ${CICLO_ID} AND CR_ID = ${crId} AND CONTA_ID = ${contaId} AND MES = 12 AND VALOR = 777123` });
}
const restored = await q(`SELECT VALOR FROM ORCAMENTO WHERE CICLO_ID = ${CICLO_ID} AND CR_ID = ${crId} AND CONTA_ID = ${contaId} AND MES = 12`);
console.log(`restaurado: ${restored.length ? restored[0].VALOR : 'inexistente'} (original: ${before.length ? before[0].VALOR : 'inexistente'})`);

// confirmDriver com token invalido nao cria status
const stBefore = await q(`SELECT DRIVERS_CONFIRMADOS FROM ORCAMENTO_STATUS WHERE CICLO_ID = ${CICLO_ID} AND CR_ID = ${crId}`);
await ex(147, { token: '00000000-0000-0000-0000-000000000000', op: 'confirmDriver', crId, driversCsv: 'HACK', allConfirmed: false });
const stAfter = await q(`SELECT DRIVERS_CONFIRMADOS FROM ORCAMENTO_STATUS WHERE CICLO_ID = ${CICLO_ID} AND CR_ID = ${crId}`);
console.log(`confirmDriver token invalido: ${JSON.stringify(stBefore) === JSON.stringify(stAfter) ? 'INALTERADO OK' : '!!! ESCREVEU'}`);

// pacote de outro gestor nao pode ser lido com este token
const otherPkg = await q(`SELECT ps.DRIVER_ID FROM PACOTE_STATUS ps WHERE ps.CICLO_ID = ${CICLO_ID} AND (ps.GESTOR_ID IS NULL OR ps.GESTOR_ID != ${GESTOR_ID}) LIMIT 1`);
if (otherPkg.length) {
  const r = await ex(145, { token: TOKEN, pkgId: Number(otherPkg[0].DRIVER_ID), cicloId: CICLO_ID, ano: ANO, anoPrev, controlCicloId: 0 });
  console.log(`pacote de outro gestor rows: ${(r?.rows || []).length} ${(r?.rows || []).length === 0 ? 'BLOQUEADO OK' : '!!! VAZOU'}`);
}
