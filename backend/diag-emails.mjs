import 'dotenv/config';
import { configureSdkMitra, executeServerFunctionMitra, listServerFunctionsMitra } from 'mitra-sdk';

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

const p = (t, rows) => { console.log(`\n=== ${t} ===`); if (!rows.length) return console.log('  (vazio)'); rows.forEach(r => console.log('  ' + JSON.stringify(r))); };

async function main() {
  // SFs que enviam email
  const sfs = await listServerFunctionsMitra({ projectId });
  const list = sfs?.result || sfs || [];
  const emailSfs = [];
  for (const f of list) {
    const code = f.code || '';
    if (code.includes('sendEmailMitra')) emailSfs.push({ id: f.id, name: f.name, type: f.type });
  }
  console.log('SFs com sendEmailMitra:', JSON.stringify(emailSfs));

  const ids = emailSfs.map(f => f.id).join(',') || '0';
  p('Execucoes recentes das SFs de email', await query(
    `SELECT ID, FUNCTION_ID, STATUS, ERROR, DURATION_MS, TRIGGERED_BY, CREATED_AT FROM INT_SERVERFUNCTIONEXECUTION WHERE FUNCTION_ID IN (${ids}) ORDER BY ID DESC LIMIT 20`));

  p('Ultimas execucoes FAILED (qualquer SF, 7 dias)', await query(
    `SELECT ID, FUNCTION_ID, STATUS, SUBSTRING(ERROR,1,300) AS ERROR, CREATED_AT FROM INT_SERVERFUNCTIONEXECUTION WHERE STATUS='FAILED' ORDER BY ID DESC LIMIT 20`));

  // logs das ultimas execucoes das SFs de email (mesmo SUCCESS pode ter erro engolido em try/catch)
  const rows = await query(
    `SELECT ID, FUNCTION_ID, STATUS, SUBSTRING(LOGS,1,500) AS LOGS, SUBSTRING(OUTPUT_JSON,1,300) AS OUT FROM INT_SERVERFUNCTIONEXECUTION WHERE FUNCTION_ID IN (${ids}) ORDER BY ID DESC LIMIT 8`);
  p('Logs das ultimas execucoes de email', rows);
}

main().catch(e => { console.error('ERRO:', e?.message || e); process.exit(1); });
