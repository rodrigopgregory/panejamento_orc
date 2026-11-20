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
  console.log('=== Migration V3: CRIADO_POR + PACOTE_REGRA_CONTABIL ===\n');

  // 1. Add CRIADO_POR column to CICLO table
  try {
    await runDdlMitra({
      projectId,
      sql: `ALTER TABLE CICLO ADD COLUMN CRIADO_POR VARCHAR(200)`
    });
    console.log('OK: CICLO.CRIADO_POR column added');
  } catch (e) {
    console.log('Skip CICLO.CRIADO_POR:', String(e.message || e).substring(0, 80));
  }

  // 2. Create PACOTE_REGRA_CONTABIL table
  // Maps: pacote (DRIVER_ID) x CR x conta contabil destino (defined by controladoria)
  try {
    await runDdlMitra({
      projectId,
      sql: `CREATE TABLE PACOTE_REGRA_CONTABIL (
        ID INT AUTO_INCREMENT PRIMARY KEY,
        DRIVER_ID INT NOT NULL,
        CR_ID INT NOT NULL,
        CONTA_ID INT NOT NULL,
        FOREIGN KEY (DRIVER_ID) REFERENCES DRIVERS(ID),
        FOREIGN KEY (CR_ID) REFERENCES CENTRO_RESULTADO(ID),
        FOREIGN KEY (CONTA_ID) REFERENCES CONTA_CONTABIL(ID)
      )`
    });
    console.log('OK: PACOTE_REGRA_CONTABIL table created');
  } catch (e) {
    console.log('Skip PACOTE_REGRA_CONTABIL:', String(e.message || e).substring(0, 80));
  }

  // 3. Add CR_ID to ORCAMENTO_PACOTE (for the new flow: value per CR, not per conta)
  try {
    await runDdlMitra({
      projectId,
      sql: `ALTER TABLE ORCAMENTO_PACOTE ADD COLUMN CR_ID INT`
    });
    console.log('OK: ORCAMENTO_PACOTE.CR_ID column added');
  } catch (e) {
    console.log('Skip ORCAMENTO_PACOTE.CR_ID:', String(e.message || e).substring(0, 80));
  }

  console.log('\n=== Migration V3 complete! ===');
}

migrate().catch(e => { console.error('Migration failed:', e); process.exit(1); });
