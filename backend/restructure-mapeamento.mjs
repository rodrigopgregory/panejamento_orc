import 'dotenv/config';
import {
  configureSdkMitra,
  runDdlMitra,
} from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS
});

const projectId = parseInt(process.env.MITRA_PROJECT_ID);

async function migrate() {
  console.log('=== Restructure mapeamento: CR_CONTA + CONTA_DRIVER ===\n');

  try {
    await runDdlMitra({
      projectId,
      sql: `DROP TABLE PACOTE_REGRA_CONTABIL`
    });
    console.log('OK: PACOTE_REGRA_CONTABIL dropped');
  } catch (e) {
    console.log('Skip drop PACOTE_REGRA_CONTABIL:', String(e.message || e).substring(0, 100));
  }

  try {
    await runDdlMitra({
      projectId,
      sql: `CREATE TABLE CR_CONTA (
        ID INT AUTO_INCREMENT PRIMARY KEY,
        CR_ID INT NOT NULL,
        CONTA_ID INT NOT NULL,
        ATIVO BOOLEAN DEFAULT TRUE,
        CRIADO_EM VARCHAR(19),
        FOREIGN KEY (CR_ID) REFERENCES CENTRO_RESULTADO(ID),
        FOREIGN KEY (CONTA_ID) REFERENCES CONTA_CONTABIL(ID)
      )`
    });
    console.log('OK: CR_CONTA created');
  } catch (e) {
    console.log('Skip create CR_CONTA:', String(e.message || e).substring(0, 100));
  }

  try {
    await runDdlMitra({
      projectId,
      sql: `CREATE TABLE CONTA_DRIVER (
        ID INT AUTO_INCREMENT PRIMARY KEY,
        CR_ID INT NOT NULL,
        CONTA_ID INT NOT NULL,
        DRIVER_ID INT NOT NULL,
        CRIADO_EM VARCHAR(19),
        FOREIGN KEY (CR_ID) REFERENCES CENTRO_RESULTADO(ID),
        FOREIGN KEY (CONTA_ID) REFERENCES CONTA_CONTABIL(ID),
        FOREIGN KEY (DRIVER_ID) REFERENCES DRIVERS(ID)
      )`
    });
    console.log('OK: CONTA_DRIVER created');
  } catch (e) {
    console.log('Skip create CONTA_DRIVER:', String(e.message || e).substring(0, 100));
  }

  console.log('\n=== Done ===');
}

migrate().catch(e => { console.error('Migration failed:', e); process.exit(1); });
