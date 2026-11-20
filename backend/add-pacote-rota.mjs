// Migracao aditiva — adiciona coluna PACOTE_ID a CONTA_DRIVER e CONTA_DRIVER_EXCECAO.
// Modelo conceitual:
//   - DRIVER_ID  = driver de calculo (sempre NORMAL: BH, BZ, Receita, custom, etc.)
//   - PACOTE_ID  = se NULL, conta eh bottom-up (lancada por CR);
//                  se preenchido, conta eh em pacote (lancada pelo gestor do pacote).
// A coluna eh nullable e nao tem default — nao afeta linhas existentes.
// Legacy: linhas onde DRIVER_ID aponta para um driver PACOTE continuam funcionando
// como "rota pacote" via fallback no frontend, ate o usuario reconfigurar.
import 'dotenv/config';
import { configureSdkMitra, runDdlMitra, runQueryMitra } from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});

const projectId = parseInt(process.env.MITRA_PROJECT_ID);

async function colExists(table, col) {
  const r = await runQueryMitra({
    projectId,
    sql: `SELECT COUNT(*) AS C FROM INFORMATION_SCHEMA.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${table}' AND COLUMN_NAME = '${col}'`,
  });
  return Number(r.result?.rows?.[0]?.C || 0) > 0;
}

async function addColumn(table) {
  if (await colExists(table, 'PACOTE_ID')) {
    console.log(`[skip] ${table}.PACOTE_ID ja existe`);
    return;
  }
  await runDdlMitra({
    projectId,
    sql: `ALTER TABLE ${table} ADD COLUMN PACOTE_ID INT NULL`,
  });
  console.log(`[ok] ${table}.PACOTE_ID adicionada`);
}

await addColumn('CONTA_DRIVER');
await addColumn('CONTA_DRIVER_EXCECAO');

// Stats
const stats = await runQueryMitra({
  projectId,
  sql: `SELECT
          (SELECT COUNT(*) FROM CONTA_DRIVER) AS CD_TOTAL,
          (SELECT COUNT(*) FROM CONTA_DRIVER cd JOIN DRIVERS d ON d.ID = cd.DRIVER_ID WHERE d.TIPO_DRIVER = 'PACOTE') AS CD_LEGACY_PACOTE,
          (SELECT COUNT(*) FROM CONTA_DRIVER_EXCECAO) AS EXC_TOTAL,
          (SELECT COUNT(*) FROM CONTA_DRIVER_EXCECAO e JOIN DRIVERS d ON d.ID = e.DRIVER_ID WHERE d.TIPO_DRIVER = 'PACOTE') AS EXC_LEGACY_PACOTE`,
});
console.log('Estado atual:', stats.result?.rows?.[0]);
