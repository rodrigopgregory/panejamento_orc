// SOMENTE LEITURA — inspeciona o que falta no CR005 antes de ajustar.
import 'dotenv/config';
import { configureSdkMitra, runQueryMitra } from 'mitra-sdk';
configureSdkMitra({ baseURL: process.env.MITRA_BASE_URL, token: process.env.MITRA_TOKEN, integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS });
const projectId = parseInt(process.env.MITRA_PROJECT_ID);
const q = async (sql) => (await runQueryMitra({ projectId, sql })).result?.rows || [];

console.log('--- CONTA_DRIVER global das contas 5.1 ---');
console.table(await q(`SELECT cc.CODIGO, cc.ID AS CONTA, cd.DRIVER_ID, d.NOME AS DRIVER
  FROM CONTA_CONTABIL cc LEFT JOIN CONTA_DRIVER cd ON cd.CONTA_ID = cc.ID
  LEFT JOIN DRIVERS d ON d.ID = cd.DRIVER_ID WHERE cc.CODIGO LIKE '5.1%' ORDER BY cc.CODIGO`));

console.log('--- CR_CONTA do CR005 para contas 5.1 (inclusive inativas) ---');
console.table(await q(`SELECT cc.CODIGO, rc.ID AS CR_CONTA_ID, rc.CR_ID, rc.CONTA_ID, rc.ATIVO
  FROM CR_CONTA rc JOIN CONTA_CONTABIL cc ON cc.ID = rc.CONTA_ID
  WHERE rc.CR_ID = 5 AND cc.CODIGO LIKE '5.1%' ORDER BY cc.CODIGO`));

console.log('--- CR_CONTA do CR001 (referencia) para 5.1.01.01 e 5.1.03 ---');
console.table(await q(`SELECT cc.CODIGO, rc.ID AS CR_CONTA_ID, rc.CR_ID, rc.CONTA_ID, rc.ATIVO
  FROM CR_CONTA rc JOIN CONTA_CONTABIL cc ON cc.ID = rc.CONTA_ID
  JOIN CENTRO_RESULTADO cr ON cr.ID = rc.CR_ID
  WHERE cr.CODIGO = 'CR001' AND cc.CODIGO IN ('5.1.01.01','5.1.03') ORDER BY cc.CODIGO`));

console.log('--- colunas reais de CR_CONTA ---');
console.table(await q(`SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT
  FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'CR_CONTA' ORDER BY ORDINAL_POSITION`));

console.log('--- CONTA_DRIVER_EXCECAO do CR005 em contas 5.1 ---');
console.table(await q(`SELECT cc.CODIGO, cde.ID, cde.CR_ID, cde.CONTA_ID, cde.DRIVER_ID, cde.ATIVO, d.NOME AS DRIVER
  FROM CONTA_DRIVER_EXCECAO cde JOIN CONTA_CONTABIL cc ON cc.ID = cde.CONTA_ID
  LEFT JOIN DRIVERS d ON d.ID = cde.DRIVER_ID
  WHERE cde.CR_ID = 5 AND cc.CODIGO LIKE '5.1%'`));
