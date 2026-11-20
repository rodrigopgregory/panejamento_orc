import 'dotenv/config';
import { configureSdkMitra, runDdlMitra } from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS
});

const projectId = parseInt(process.env.MITRA_PROJECT_ID);

async function migrate() {
  console.log('=== CONTA_DRIVER agora global (sem CR_ID) ===\n');

  try {
    await runDdlMitra({ projectId, sql: `DROP TABLE CONTA_DRIVER` });
    console.log('OK: CONTA_DRIVER (antiga) dropped');
  } catch (e) {
    console.log('Skip drop CONTA_DRIVER:', String(e.message || e).substring(0, 100));
  }

  try {
    await runDdlMitra({
      projectId,
      sql: `CREATE TABLE CONTA_DRIVER (
        ID INT AUTO_INCREMENT PRIMARY KEY,
        CONTA_ID INT NOT NULL UNIQUE,
        DRIVER_ID INT NOT NULL,
        CRIADO_EM VARCHAR(19),
        FOREIGN KEY (CONTA_ID) REFERENCES CONTA_CONTABIL(ID),
        FOREIGN KEY (DRIVER_ID) REFERENCES DRIVERS(ID)
      )`
    });
    console.log('OK: CONTA_DRIVER recriada com CONTA_ID UNIQUE (1 driver por conta, global)');
  } catch (e) {
    console.log('Skip create CONTA_DRIVER:', String(e.message || e).substring(0, 100));
  }

  console.log('\n=== Done ===');
}

migrate().catch(e => { console.error('Migration failed:', e); process.exit(1); });
