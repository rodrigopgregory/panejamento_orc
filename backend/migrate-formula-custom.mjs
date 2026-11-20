import 'dotenv/config';
import { configureSdkMitra, runDdlMitra } from 'mitra-sdk';

const token = process.env.MITRA_TOKEN || '';
const payload = JSON.parse(Buffer.from(token.replace('Bearer ', '').split('.')[1], 'base64').toString());

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL || payload.backURL,
  token,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});

const projectId = parseInt(process.env.MITRA_PROJECT_ID);

async function migrate() {
  console.log('Making CONTA_ID nullable...');
  try {
    await runDdlMitra({ projectId, sql: "ALTER TABLE DRIVER_FORMULA MODIFY COLUMN CONTA_ID INT NULL" });
    console.log('CONTA_ID is now nullable');
  } catch (e) { console.log('CONTA_ID modify:', e.message || e); }

  console.log('Adding NOME_CUSTOM column...');
  try {
    await runDdlMitra({ projectId, sql: "ALTER TABLE DRIVER_FORMULA ADD COLUMN NOME_CUSTOM VARCHAR(200)" });
    console.log('NOME_CUSTOM column added');
  } catch (e) { console.log('NOME_CUSTOM may already exist:', e.message || e); }

  console.log('Migration complete!');
}

migrate().catch(console.error);
