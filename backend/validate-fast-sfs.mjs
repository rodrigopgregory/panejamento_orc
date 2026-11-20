import 'dotenv/config';
import { configureSdkMitra, executeServerFunctionMitra } from 'mitra-sdk';
configureSdkMitra({ baseURL: process.env.MITRA_BASE_URL, token: process.env.MITRA_TOKEN, integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS });
const projectId = parseInt(process.env.MITRA_PROJECT_ID);

const sf = async (id, input) => {
  const r = await executeServerFunctionMitra({ projectId, serverFunctionId: id, input });
  let out = r?.result?.output; if (typeof out === 'string') out = JSON.parse(out);
  if (r?.result?.executionStatus === 'FAILED') throw new Error(`SF ${id}: ${r?.result?.error}`);
  return out?.rows || [];
};
const batch = async (sqls) => {
  const r = await executeServerFunctionMitra({ projectId, serverFunctionId: 79, input: { sqls } });
  let out = r?.result?.output; if (typeof out === 'string') out = JSON.parse(out);
  return out?.results || [];
};
const sum = rows => rows.reduce((a, r) => a + Number(r.VALOR ?? r.QTD ?? 0), 0);

// ciclo atual
const ciclos = await sf(80, {});
const c = ciclos.find(x => x.VERSAO_ATUAL === 'true') || ciclos[0];
console.log('ciclo:', c.ID, c.ANO);

// === equivalencia DRE ===
const [oldRes] = [await batch([
  `SELECT rc.CONTA_ID, rc.MES, SUM(rc.VALOR) as VALOR FROM REALIZADO_CONTABIL rc WHERE rc.ANO = ${c.ANO - 1} GROUP BY rc.CONTA_ID, rc.MES`,
  `SELECT o.CONTA_ID, o.MES, SUM(o.VALOR) as VALOR FROM ORCAMENTO o WHERE o.CICLO_ID = ${c.ID} GROUP BY o.CONTA_ID, o.MES`,
])];
const nReal = await sf(87, { ano: c.ANO - 1, crIds: '', contaIds: '', empresaId: '' });
const nOrc = await sf(86, { cicloId: c.ID, crIds: '', contaIds: '' });
console.log('DRE realizado: old', oldRes[0].length, 'rows /', sum(oldRes[0]).toFixed(0), '| new', nReal.length, 'rows /', sum(nReal).toFixed(0), sum(oldRes[0]) === sum(nReal) ? 'OK' : 'DIVERGE');
console.log('DRE orcado:    old', oldRes[1].length, 'rows /', sum(oldRes[1]).toFixed(0), '| new', nOrc.length, 'rows /', sum(nOrc).toFixed(0), sum(oldRes[1]) === sum(nOrc) ? 'OK' : 'DIVERGE');

// filtro por CR (gestor travado em CRs 1,2)
const oldF = await batch([`SELECT o.CONTA_ID, o.MES, SUM(o.VALOR) as VALOR FROM ORCAMENTO o WHERE o.CICLO_ID = ${c.ID} AND o.CR_ID IN (1,2) GROUP BY o.CONTA_ID, o.MES`]);
const newF = await sf(86, { cicloId: c.ID, crIds: '1,2', contaIds: '' });
console.log('DRE filtro CR: old', sum(oldF[0]).toFixed(0), '| new', sum(newF).toFixed(0), sum(oldF[0]) === sum(newF) ? 'OK' : 'DIVERGE');

// drill por CR (contas de prefixo 3)
const contas = await sf(82, {});
const ids = contas.filter(x => String(x.CODIGO).startsWith('3')).map(x => x.ID).join(',');
if (ids) {
  const oldD = await batch([`SELECT o.CR_ID, o.MES, SUM(o.VALOR) as VALOR FROM ORCAMENTO o WHERE o.CICLO_ID = ${c.ID} AND o.CONTA_ID IN (${ids}) GROUP BY o.CR_ID, o.MES`]);
  const newD = await sf(88, { cicloId: c.ID, contaIds: ids, crIds: '' });
  console.log('Drill por CR:  old', sum(oldD[0]).toFixed(0), '| new', sum(newD).toFixed(0), sum(oldD[0]) === sum(newD) ? 'OK' : 'DIVERGE');
}

// === timing das telas simuladas ===
console.log('\n=== TIMING (como o browser dispara) ===');
let t0 = Date.now();
await Promise.all([sf(80, {}), sf(81, {}), sf(82, {}), sf(83, {}), sf(84, {})]);
const tBase = Date.now() - t0;
t0 = Date.now();
await Promise.all([sf(87, { ano: c.ANO - 1, crIds: '', contaIds: '', empresaId: '' }), sf(86, { cicloId: c.ID, crIds: '', contaIds: '' })]);
const tDre = Date.now() - t0;
console.log(`DRE 1a visita: base ${tBase}ms + dre ${tDre}ms = ${tBase + tDre}ms (revisita com cache: ~${tDre}ms)`);

t0 = Date.now();
await Promise.all([sf(93, { cicloId: c.ID }), sf(94, { cicloId: c.ID }), sf(95, { cicloId: c.ID }), sf(96, { cicloId: c.ID })]);
console.log(`Kanban status (4 SFs paralelas): ${Date.now() - t0}ms`);

t0 = Date.now();
await Promise.all([sf(97, { cicloId: c.ID }), sf(87, { ano: c.ANO - 1, crIds: '', contaIds: '', empresaId: '' }), sf(86, { cicloId: c.ID, crIds: '', contaIds: '' })]);
console.log(`Dashboard (3 SFs paralelas): ${Date.now() - t0}ms`);

// referencia: caminho antigo (1 batch JS)
t0 = Date.now();
await batch([`SELECT 1 as A`, `SELECT 2 as B`]);
console.log(`(referencia: 1 lote SF 79 = ${Date.now() - t0}ms de sandbox)`);
