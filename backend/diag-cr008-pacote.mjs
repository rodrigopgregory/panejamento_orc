// SOMENTE LEITURA — conta 33 vem de pacote/rateio? conta 21 e manual?
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

for (const t of ['ORCAMENTO_PACOTE', 'RATEIO_CR', 'PACOTE_STATUS', 'COLABORADOR']) {
  console.log(`colunas ${t}: ${await cols(t)}`);
}

console.log('\n=== Colaboradores do CR008 ===');
console.table(await q(`SELECT ID, NOME, CR_ID, ATIVO FROM COLABORADOR WHERE CR_ID=8`));

console.log('\n=== ORCAMENTO_PACOTE — conta 33 no ciclo 133 ===');
console.table(await q(`SELECT * FROM ORCAMENTO_PACOTE WHERE CICLO_ID=133 AND CONTA_ID=33 ORDER BY MES LIMIT 20`));

console.log('\n=== ORCAMENTO_PACOTE ciclo 133 (todas contas, agregado) ===');
console.table(await q(`SELECT CONTA_ID, DRIVER_ID, COUNT(*) AS LINHAS, ROUND(SUM(VALOR)) AS TOTAL
  FROM ORCAMENTO_PACOTE WHERE CICLO_ID=133 GROUP BY CONTA_ID, DRIVER_ID`));

console.log('\n=== Conta 33 no ciclo 133: TODOS os CRs (rateio) ===');
console.table(await q(`SELECT o.CR_ID, cr.CODIGO, cr.NOME, COUNT(*) AS MESES,
  COUNT(DISTINCT o.VALOR) AS DISTINTOS, ROUND(SUM(o.VALOR)) AS TOTAL
  FROM ORCAMENTO o JOIN CENTRO_RESULTADO cr ON cr.ID=o.CR_ID
  WHERE o.CICLO_ID=133 AND o.CONTA_ID=33 GROUP BY o.CR_ID, cr.CODIGO, cr.NOME ORDER BY o.CR_ID`));

console.log('\n=== Conta 21 no ciclo 133: TODOS os CRs (comparar padrao) ===');
console.table(await q(`SELECT o.CR_ID, cr.CODIGO, cr.NOME, COUNT(*) AS MESES,
  COUNT(DISTINCT o.VALOR) AS DISTINTOS, ROUND(SUM(o.VALOR)) AS TOTAL
  FROM ORCAMENTO o JOIN CENTRO_RESULTADO cr ON cr.ID=o.CR_ID
  WHERE o.CICLO_ID=133 AND o.CONTA_ID=21 GROUP BY o.CR_ID, cr.CODIGO, cr.NOME ORDER BY o.CR_ID`));

console.log('\n=== CONTA_DRIVER_EXCECAO do CR008 ===');
console.table(await q(`SELECT * FROM CONTA_DRIVER_EXCECAO WHERE CR_ID=8`));
