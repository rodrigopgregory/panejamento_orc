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
  console.log('Creating PREMISSA_LINHA table...');
  try {
    await runDdlMitra({
      projectId,
      sql: `CREATE TABLE PREMISSA_LINHA (
        ID INT AUTO_INCREMENT PRIMARY KEY,
        CICLO_ID INT NOT NULL,
        NOME VARCHAR(200) NOT NULL,
        ORDEM INT DEFAULT 0,
        CRIADO_EM VARCHAR(19)
      )`
    });
    console.log('PREMISSA_LINHA created');
  } catch (e) { console.log('PREMISSA_LINHA may already exist:', e.message || e); }

  console.log('Creating PREMISSA_VALOR table...');
  try {
    await runDdlMitra({
      projectId,
      sql: `CREATE TABLE PREMISSA_VALOR (
        ID INT AUTO_INCREMENT PRIMARY KEY,
        LINHA_ID INT NOT NULL,
        MES INT NOT NULL,
        VALOR DECIMAL(15,4) DEFAULT 0
      )`
    });
    console.log('PREMISSA_VALOR created');
  } catch (e) { console.log('PREMISSA_VALOR may already exist:', e.message || e); }

  console.log('Migration complete!');
}

migrate().catch(console.error);
