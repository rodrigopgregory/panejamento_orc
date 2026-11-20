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
  console.log('Creating DRIVER_FORMULA_VALOR table...');
  try {
    await runDdlMitra({
      projectId,
      sql: `CREATE TABLE DRIVER_FORMULA_VALOR (
        ID INT AUTO_INCREMENT PRIMARY KEY,
        FORMULA_ID INT NOT NULL,
        CICLO_ID INT NOT NULL,
        CR_ID INT NOT NULL,
        MES INT NOT NULL,
        VALOR DECIMAL(15,4) DEFAULT 0
      )`
    });
    console.log('DRIVER_FORMULA_VALOR created');
  } catch (e) { console.log('DRIVER_FORMULA_VALOR may already exist:', e.message || e); }

  console.log('Migration complete!');
}

migrate().catch(console.error);
