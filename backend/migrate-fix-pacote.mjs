import 'dotenv/config';
import { configureSdkMitra, runDdlMitra } from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS
});
const projectId = parseInt(process.env.MITRA_PROJECT_ID);

async function migrate() {
  // Make CONTA_ID nullable in ORCAMENTO_PACOTE (needed for "valor total" mode)
  try {
    await runDdlMitra({
      projectId,
      sql: `ALTER TABLE ORCAMENTO_PACOTE MODIFY COLUMN CONTA_ID INT NULL`
    });
    console.log('OK: ORCAMENTO_PACOTE.CONTA_ID is now nullable');
  } catch (e) {
    console.log('Skip CONTA_ID modify:', String(e.message || e).substring(0, 80));
  }

  console.log('Migration complete!');
}

migrate();
