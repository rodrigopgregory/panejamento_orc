import 'dotenv/config';
import { configureSdkMitra, executeServerFunctionMitra } from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});

const projectId = parseInt(process.env.MITRA_PROJECT_ID);
const SF_QUERY = 76;

async function query(sql) {
  const res = await executeServerFunctionMitra({ projectId, serverFunctionId: SF_QUERY, input: { sql } });
  let output = res?.result?.output;
  if (typeof output === 'string') try { output = JSON.parse(output); } catch {}
  if (output && Array.isArray(output.rows)) return output.rows;
  if (Array.isArray(output)) return output;
  return [];
}

const cols = await query("SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'DRIVER_FORMULA' ORDER BY ORDINAL_POSITION");
console.log('=== SCHEMA DRIVER_FORMULA ===');
cols.forEach(c => console.log(`  ${c.COLUMN_NAME} ${c.DATA_TYPE} nullable=${c.IS_NULLABLE} default=${c.COLUMN_DEFAULT}`));

console.log('\n=== ULTIMAS 15 LINHAS DRIVER_FORMULA (mais recentes) ===');
const rows = await query("SELECT ID, DRIVER_ID, CONTA_ID, NOME_CUSTOM, TIPO, FORMULA, ORDEM, ESCONDER, NEGRITO, FORMATO FROM DRIVER_FORMULA ORDER BY ID DESC LIMIT 15");
rows.forEach(r => console.log(` `, JSON.stringify(r)));

console.log('\n=== DRIVERS personalizados (autoraveis) ===');
const drivers = await query("SELECT ID, NOME, ORIGEM, TIPO_DRIVER FROM DRIVER WHERE (ORIGEM IS NULL OR ORIGEM NOT IN ('NATIVO','IA')) ORDER BY ID DESC LIMIT 10");
drivers.forEach(d => console.log(` `, JSON.stringify(d)));
