// SOMENTE LEITURA — fecha o diagnostico: status do pacote, padrao dos CRs pares, sazonalidade
import 'dotenv/config';
import { configureSdkMitra, runQueryMitra } from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});
const projectId = parseInt(process.env.MITRA_PROJECT_ID);
const q = async (sql) => (await runQueryMitra({ projectId, sql })).result?.rows || [];

console.log('=== PACOTE_STATUS driver 24 (Custos de Software) ciclo 133 ===');
console.table(await q(`SELECT * FROM PACOTE_STATUS WHERE CICLO_ID=133 AND DRIVER_ID=24`));

console.log('\n=== Conta 21: orcado ciclo 133 x realizado 2026, mes a mes, por CR ===');
const orc = await q(`SELECT CR_ID, MES, ROUND(VALOR) AS VALOR FROM ORCAMENTO
  WHERE CICLO_ID=133 AND CONTA_ID=21 ORDER BY CR_ID, MES`);
const real26 = await q(`SELECT CR_ID, MES, ROUND(VALOR) AS VALOR FROM REALIZADO_CONTABIL
  WHERE ANO=2026 AND CONTA_ID=21 ORDER BY CR_ID, MES`);
const rmap = {};
for (const r of real26) rmap[`${r.CR_ID}:${r.MES}`] = Number(r.VALOR);
const byCr = {};
for (const o of orc) (byCr[o.CR_ID] ??= []).push(o);
for (const [cr, rows] of Object.entries(byCr)) {
  console.log(`\nCR ${cr}:`);
  console.log('  mes   orcado    realizado  bate?');
  for (const r of rows) {
    const rv = rmap[`${cr}:${r.MES}`];
    const bate = rv !== undefined ? (Math.abs(rv - Number(r.VALOR)) < 1 ? 'SIM' : 'nao') : '-';
    console.log(`  ${String(r.MES).padStart(2)}  ${String(Number(r.VALOR).toLocaleString('pt-BR')).padStart(9)}  ${String(rv !== undefined ? rv.toLocaleString('pt-BR') : '-').padStart(10)}  ${bate}`);
  }
}

console.log('\n=== Conta 21 CR008: realizado 2025 (sazonalidade) e 2026 YTD ===');
console.table(await q(`SELECT ANO, MES, ROUND(VALOR) AS VALOR FROM REALIZADO_CONTABIL
  WHERE CR_ID=8 AND CONTA_ID=21 ORDER BY ANO, MES`));

console.log('\n=== Conta 33: ORCAMENTO (CR008) x ORCAMENTO_PACOTE (CR008) por mes ===');
const a = await q(`SELECT MES, ROUND(VALOR) AS ORC FROM ORCAMENTO WHERE CICLO_ID=133 AND CR_ID=8 AND CONTA_ID=33 ORDER BY MES`);
const b = await q(`SELECT MES, ROUND(SUM(VALOR)) AS PKG FROM ORCAMENTO_PACOTE WHERE CICLO_ID=133 AND CR_ID=8 AND CONTA_ID=33 GROUP BY MES ORDER BY MES`);
const bm = {}; for (const r of b) bm[r.MES] = Number(r.PKG);
console.log('mes   ORCAMENTO   ORCAMENTO_PACOTE   soma no DRE');
for (const r of a) {
  const p = bm[r.MES] || 0;
  console.log(`${String(r.MES).padStart(3)}  ${String(Number(r.ORC).toLocaleString('pt-BR')).padStart(10)}  ${String(p.toLocaleString('pt-BR')).padStart(17)}  ${String((Number(r.ORC) + p).toLocaleString('pt-BR')).padStart(11)}`);
}
console.log(`TOTAL ORCAMENTO=${a.reduce((s, r) => s + Number(r.ORC), 0).toLocaleString('pt-BR')}  PACOTE=${Object.values(bm).reduce((s, v) => s + v, 0).toLocaleString('pt-BR')}`);
