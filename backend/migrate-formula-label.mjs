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
  console.log('Adding LABEL column to DRIVER_FORMULA...');
  try {
    await runDdlMitra({ projectId, sql: "ALTER TABLE DRIVER_FORMULA ADD COLUMN LABEL VARCHAR(200)" });
    console.log('LABEL column added');
  } catch (e) { console.log('LABEL column may already exist:', e.message || e); }

  console.log('Migration complete!');
}

migrate().catch(console.error);
