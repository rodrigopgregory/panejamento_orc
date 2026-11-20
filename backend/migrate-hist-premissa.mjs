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
  console.log('Creating HIST_PREMISSA table for Base Histórica percentages...');
  try {
    await runDdlMitra({
      projectId,
      sql: `CREATE TABLE HIST_PREMISSA (
        ID INT AUTO_INCREMENT PRIMARY KEY,
        CICLO_ID INT NOT NULL,
        CR_ID INT NOT NULL,
        CONTA_ID INT NOT NULL,
        PERCENTUAL DECIMAL(10,2) DEFAULT 0,
        MODO VARCHAR(20) DEFAULT 'sazonalidade',
        JUSTIFICATIVA VARCHAR(500),
        CRIADO_EM VARCHAR(19)
      )`
    });
    console.log('HIST_PREMISSA table created');
  } catch (e) { console.log('HIST_PREMISSA may already exist:', e.message || e); }

  console.log('Creating PREMISSA_IMPOSTO table for centralized tax rates...');
  try {
    await runDdlMitra({
      projectId,
      sql: `CREATE TABLE PREMISSA_IMPOSTO (
        ID INT AUTO_INCREMENT PRIMARY KEY,
        CICLO_ID INT NOT NULL,
        CONTA_ID INT NOT NULL,
        PERCENTUAL DECIMAL(10,4) DEFAULT 0,
        CRIADO_EM VARCHAR(19)
      )`
    });
    console.log('PREMISSA_IMPOSTO table created');
  } catch (e) { console.log('PREMISSA_IMPOSTO may already exist:', e.message || e); }

  console.log('Migration complete!');
}

migrate().catch(console.error);
