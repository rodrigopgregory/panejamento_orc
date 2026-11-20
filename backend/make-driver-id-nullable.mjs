// Permite DRIVER_ID nullable em CONTA_DRIVER e CONTA_DRIVER_EXCECAO.
// Necessario para o novo modelo: conta pode estar em pacote (PACOTE_ID preenchido)
// sem ter ainda um driver de calculo escolhido.
// Linhas existentes NAO sao afetadas (todas tem DRIVER_ID preenchido).
import 'dotenv/config';
import { configureSdkMitra, runDdlMitra, runQueryMitra } from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});

const projectId = parseInt(process.env.MITRA_PROJECT_ID);

await runDdlMitra({ projectId, sql: `ALTER TABLE CONTA_DRIVER MODIFY COLUMN DRIVER_ID INT NULL` });
console.log('[ok] CONTA_DRIVER.DRIVER_ID agora aceita NULL');

await runDdlMitra({ projectId, sql: `ALTER TABLE CONTA_DRIVER_EXCECAO MODIFY COLUMN DRIVER_ID INT NULL` });
console.log('[ok] CONTA_DRIVER_EXCECAO.DRIVER_ID agora aceita NULL');

const stats = await runQueryMitra({
  projectId,
  sql: `SELECT
          (SELECT COUNT(*) FROM CONTA_DRIVER WHERE DRIVER_ID IS NULL) AS CD_DRIVER_NULL,
          (SELECT COUNT(*) FROM CONTA_DRIVER WHERE PACOTE_ID IS NOT NULL) AS CD_PACOTE_SET,
          (SELECT COUNT(*) FROM CONTA_DRIVER_EXCECAO WHERE DRIVER_ID IS NULL) AS EXC_DRIVER_NULL,
          (SELECT COUNT(*) FROM CONTA_DRIVER_EXCECAO WHERE PACOTE_ID IS NOT NULL) AS EXC_PACOTE_SET`,
});
console.log('Estado pos-alter:', stats.result?.rows?.[0]);
