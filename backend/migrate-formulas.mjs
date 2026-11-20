import 'dotenv/config';
import { configureSdkMitra, runDdlMitra } from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS
});

const projectId = parseInt(process.env.MITRA_PROJECT_ID);

async function migrate() {
  try {
    await runDdlMitra({
      projectId,
      sql: `CREATE TABLE DRIVER_FORMULA (
        ID INT AUTO_INCREMENT PRIMARY KEY,
        DRIVER_ID INT NOT NULL,
        CONTA_ID INT NOT NULL,
        FORMULA VARCHAR(500) NOT NULL,
        DESCRICAO VARCHAR(200),
        FOREIGN KEY (DRIVER_ID) REFERENCES DRIVERS(ID),
        FOREIGN KEY (CONTA_ID) REFERENCES CONTA_CONTABIL(ID)
      )`
    });
    console.log('OK: Table DRIVER_FORMULA created');
  } catch (e) {
    console.log('Skip DRIVER_FORMULA:', String(e.message || e).substring(0, 100));
  }

  console.log('Migration complete!');
}

migrate();
