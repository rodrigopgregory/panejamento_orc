import 'dotenv/config';
import { configureSdkMitra, runDmlMitra, executeServerFunctionMitra } from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});

const projectId = parseInt(process.env.MITRA_PROJECT_ID);

async function query(sql) {
  const res = await executeServerFunctionMitra({ projectId, serverFunctionId: 18, input: { sql } });
  let output = res?.result?.output;
  if (typeof output === 'string') try { output = JSON.parse(output); } catch {}
  return (output && Array.isArray(output.rows)) ? output.rows : (Array.isArray(output) ? output : []);
}

const before = await query("SELECT ID, NOME FROM DRIVERS WHERE ATIVO IS NULL");
console.log(`Drivers com ATIVO=NULL: ${before.length}`);
before.forEach(d => console.log(`  - ID ${d.ID} | ${d.NOME}`));

if (before.length > 0) {
  await runDmlMitra({ projectId, sql: "UPDATE DRIVERS SET ATIVO = 'true' WHERE ATIVO IS NULL" });
  console.log('UPDATE aplicado.');
}

const after = await query("SELECT ID, NOME, ATIVO FROM DRIVERS WHERE ATIVO IS NULL");
console.log(`Drivers com ATIVO=NULL após fix: ${after.length}`);
