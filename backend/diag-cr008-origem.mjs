// SOMENTE LEITURA — origem dos valores das contas suspeitas no ciclo 133
import 'dotenv/config';
import { configureSdkMitra, runQueryMitra } from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});
const projectId = parseInt(process.env.MITRA_PROJECT_ID);
const q = async (sql) => (await runQueryMitra({ projectId, sql })).result?.rows || [];
const cols = async (t) => (await q(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='${t}' ORDER BY ORDINAL_POSITION`)).map(c => c.COLUMN_NAME).join(', ');

for (const t of ['ORCAMENTO', 'ORCAMENTO_PESSOAL', 'DESLIGAMENTO_PROJETADO', 'DRIVERS', 'DRIVER_FORMULA_CR']) {
  console.log(`\ncolunas ${t}: ${await cols(t)}`);
}

console.log('\n=== DRIVERS (catalogo) ===');
console.table(await q(`SELECT * FROM DRIVERS WHERE ID IN (1,4,24)`));

console.log('\n=== ORCAMENTO_PESSOAL do CR008 no ciclo 133 (agregado) ===');
console.table(await q(`SELECT MES, COUNT(*) AS LINHAS, ROUND(SUM(SALARIO)) AS SALARIO,
  ROUND(SUM(ENCARGOS)) AS ENCARGOS, ROUND(SUM(BENEFICIOS)) AS BENEFICIOS
  FROM ORCAMENTO_PESSOAL WHERE CR_ID=8 AND CICLO_ID=133 GROUP BY MES ORDER BY MES`).catch(e => [{ erro: String(e).slice(0, 200) }]));

console.log('\n=== DESLIGAMENTO_PROJETADO do CR008 ===');
console.table(await q(`SELECT * FROM DESLIGAMENTO_PROJETADO WHERE CICLO_ID=133 LIMIT 20`));

console.log('\n=== COLABORADOR do CR008 ===');
console.table(await q(`SELECT ID, NOME, CARGO_ID, CR_ID, SALARIO, ATIVO FROM COLABORADOR WHERE CR_ID=8`));

console.log('\n=== ORCAMENTO ciclo 133 CR008: todas as contas, mes a mes ===');
const rows = await q(`SELECT o.CONTA_ID, cc.CODIGO, cc.NOME, o.MES, ROUND(o.VALOR,2) AS VALOR
  FROM ORCAMENTO o JOIN CONTA_CONTABIL cc ON cc.ID=o.CONTA_ID
  WHERE o.CR_ID=8 AND o.CICLO_ID=133 ORDER BY o.CONTA_ID, o.MES`);
const byConta = {};
for (const r of rows) {
  (byConta[r.CONTA_ID] ??= { cod: r.CODIGO, nome: r.NOME, v: [] }).v.push(Number(r.VALOR));
}
for (const [id, c] of Object.entries(byConta)) {
  const freq = {};
  for (const v of c.v) freq[v] = (freq[v] || 0) + 1;
  const maxRep = Math.max(...Object.values(freq));
  console.log(`[${id}] ${c.cod} ${c.nome} — maxRepeticao=${maxRep} total=${Math.round(c.v.reduce((a, b) => a + b, 0)).toLocaleString('pt-BR')}`);
  console.log(`     ${c.v.map(v => v.toLocaleString('pt-BR')).join(' | ')}`);
}
