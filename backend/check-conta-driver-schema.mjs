import 'dotenv/config';
import { configureSdkMitra, runQueryMitra } from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});

const projectId = parseInt(process.env.MITRA_PROJECT_ID);

const schema = await runQueryMitra({
  projectId,
  sql: `SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'CONTA_DRIVER'
        ORDER BY ORDINAL_POSITION`,
});
console.log('CONTA_DRIVER schema:');
console.table(schema.result?.rows || []);

const legacy = await runQueryMitra({
  projectId,
  sql: `SELECT cd.ID, cd.CONTA_ID, cd.DRIVER_ID, cd.PACOTE_ID, d.NOME AS DRIVER_NOME, d.TIPO_DRIVER, cc.CODIGO, cc.NOME AS CONTA_NOME
        FROM CONTA_DRIVER cd
        JOIN DRIVERS d ON d.ID = cd.DRIVER_ID
        JOIN CONTA_CONTABIL cc ON cc.ID = cd.CONTA_ID
        WHERE d.TIPO_DRIVER = 'PACOTE'`,
});
console.log('Legacy rows (DRIVER_ID aponta para pacote):');
console.table(legacy.result?.rows || []);
