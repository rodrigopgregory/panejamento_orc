// SOMENTE LEITURA — contexto: qual ciclo vale, origem das contas, base historica disponivel
import 'dotenv/config';
import { configureSdkMitra, runQueryMitra } from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});
const projectId = parseInt(process.env.MITRA_PROJECT_ID);
const q = async (sql) => (await runQueryMitra({ projectId, sql })).result?.rows || [];

console.log('=== Tabelas do projeto ===');
const tabs = await q(`SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME NOT LIKE 'INT_%' ORDER BY TABLE_NAME`);
console.log(tabs.map(t => t.TABLE_NAME).join(', '));

console.log('\n=== Ciclos / versoes ===');
console.table(await q(`SELECT * FROM CICLO ORDER BY ID`));

console.log('\n=== Status do CR008 por ciclo ===');
console.table(await q(`SELECT * FROM ORCAMENTO_STATUS WHERE CR_ID = 8 ORDER BY CICLO_ID`));

console.log('\n=== Contas 10/11/12 tem realizado historico em ALGUM CR? ===');
console.table(await q(`SELECT CONTA_ID, ANO, COUNT(*) AS LINHAS, COUNT(DISTINCT CR_ID) AS CRS, ROUND(SUM(VALOR)) AS TOTAL
  FROM REALIZADO_CONTABIL WHERE CONTA_ID IN (10,11,12,21,33) GROUP BY CONTA_ID, ANO ORDER BY CONTA_ID, ANO`));

console.log('\n=== Realizado do CR008 para contas 10/11/12 especificamente ===');
console.table(await q(`SELECT CONTA_ID, ANO, COUNT(*) AS LINHAS, ROUND(SUM(VALOR)) AS TOTAL
  FROM REALIZADO_CONTABIL WHERE CR_ID = 8 AND CONTA_ID IN (10,11,12) GROUP BY CONTA_ID, ANO`));

console.log('\n=== Contas de folha/pessoal (origem) — CONTA_DRIVER do CR008 ===');
const cols = await q(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='CONTA_DRIVER'`);
console.log('colunas CONTA_DRIVER:', cols.map(c => c.COLUMN_NAME).join(', '));
console.table(await q(`SELECT cd.*, cc.CODIGO, cc.NOME FROM CONTA_DRIVER cd
  JOIN CONTA_CONTABIL cc ON cc.ID = cd.CONTA_ID
  WHERE cd.CONTA_ID IN (10,11,12,21,33)`));

console.log('\n=== Realizado mes a mes: conta 21 (Viagens) e 33 (Software) do CR008 ===');
console.table(await q(`SELECT CONTA_ID, ANO, MES, ROUND(VALOR) AS VALOR FROM REALIZADO_CONTABIL
  WHERE CR_ID = 8 AND CONTA_ID IN (21,33) ORDER BY CONTA_ID, ANO, MES`));
