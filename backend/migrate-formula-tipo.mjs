import 'dotenv/config';
import { configureSdkMitra, runDdlMitra, runDmlMitra } from 'mitra-sdk';

const token = process.env.MITRA_TOKEN || '';
const payload = JSON.parse(Buffer.from(token.replace('Bearer ', '').split('.')[1], 'base64').toString());
const backURL = payload.backURL;

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL || backURL,
  token,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});

const projectId = parseInt(process.env.MITRA_PROJECT_ID);

async function migrate() {
  console.log('Adding TIPO column to DRIVER_FORMULA...');
  try {
    await runDdlMitra({ projectId, sql: "ALTER TABLE DRIVER_FORMULA ADD COLUMN TIPO VARCHAR(20) DEFAULT 'FORMULA'" });
    console.log('TIPO column added');
  } catch (e) { console.log('TIPO column may already exist:', e.message || e); }

  console.log('Adding ORDEM column to DRIVER_FORMULA...');
  try {
    await runDdlMitra({ projectId, sql: "ALTER TABLE DRIVER_FORMULA ADD COLUMN ORDEM INT DEFAULT 0" });
    console.log('ORDEM column added');
  } catch (e) { console.log('ORDEM column may already exist:', e.message || e); }

  console.log('Updating existing records...');
  try {
    await runDmlMitra({ projectId, sql: "UPDATE DRIVER_FORMULA SET TIPO = 'FORMULA' WHERE TIPO IS NULL OR TIPO = ''" });
    await runDmlMitra({ projectId, sql: "UPDATE DRIVER_FORMULA SET ORDEM = ID WHERE ORDEM IS NULL OR ORDEM = 0" });
    console.log('Records updated');
  } catch (e) { console.log('Update error:', e.message || e); }

  console.log('Migration complete!');
}

migrate().catch(console.error);
