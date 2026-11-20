import 'dotenv/config';
import {
  configureSdkMitra,
  runDdlMitra,
  runDmlMitra,
  createServerFunctionMitra,
  listServerFunctionsMitra
} from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS
});

const projectId = parseInt(process.env.MITRA_PROJECT_ID);

async function migrate() {
  console.log('=== Migration V2: Pacote + Rateio + Waterfall ===\n');

  // 1. ALTER TABLE DRIVERS - add TIPO_DRIVER column
  try {
    await runDdlMitra({
      projectId,
      sql: `ALTER TABLE DRIVERS ADD COLUMN TIPO_DRIVER VARCHAR(20) DEFAULT 'NORMAL'`
    });
    console.log('OK: DRIVERS.TIPO_DRIVER column added');
  } catch (e) {
    console.log('Skip DRIVERS ALTER:', String(e.message || e).substring(0, 80));
  }

  // 2. Create RATEIO_CONFIG table
  try {
    await runDdlMitra({
      projectId,
      sql: `CREATE TABLE RATEIO_CONFIG (
        ID INT AUTO_INCREMENT PRIMARY KEY,
        DRIVER_ID INT NOT NULL,
        TIPO_RATEIO VARCHAR(20) NOT NULL,
        BASE_PROPORCIONAL VARCHAR(50),
        CRIADO_EM VARCHAR(19),
        FOREIGN KEY (DRIVER_ID) REFERENCES DRIVERS(ID)
      )`
    });
    console.log('OK: RATEIO_CONFIG table created');
  } catch (e) {
    console.log('Skip RATEIO_CONFIG:', String(e.message || e).substring(0, 80));
  }

  // 3. Create RATEIO_CR table
  try {
    await runDdlMitra({
      projectId,
      sql: `CREATE TABLE RATEIO_CR (
        ID INT AUTO_INCREMENT PRIMARY KEY,
        RATEIO_CONFIG_ID INT NOT NULL,
        CR_ID INT NOT NULL,
        PERCENTUAL DECIMAL(10,4) DEFAULT 0,
        FOREIGN KEY (RATEIO_CONFIG_ID) REFERENCES RATEIO_CONFIG(ID),
        FOREIGN KEY (CR_ID) REFERENCES CENTRO_RESULTADO(ID)
      )`
    });
    console.log('OK: RATEIO_CR table created');
  } catch (e) {
    console.log('Skip RATEIO_CR:', String(e.message || e).substring(0, 80));
  }

  // 4. Create ORCAMENTO_PACOTE table
  try {
    await runDdlMitra({
      projectId,
      sql: `CREATE TABLE ORCAMENTO_PACOTE (
        ID INT AUTO_INCREMENT PRIMARY KEY,
        CICLO_ID INT NOT NULL,
        DRIVER_ID INT NOT NULL,
        CONTA_ID INT NOT NULL,
        MES INT NOT NULL,
        VALOR DECIMAL(15,2) DEFAULT 0,
        FOREIGN KEY (CICLO_ID) REFERENCES CICLO(ID),
        FOREIGN KEY (DRIVER_ID) REFERENCES DRIVERS(ID),
        FOREIGN KEY (CONTA_ID) REFERENCES CONTA_CONTABIL(ID)
      )`
    });
    console.log('OK: ORCAMENTO_PACOTE table created');
  } catch (e) {
    console.log('Skip ORCAMENTO_PACOTE:', String(e.message || e).substring(0, 80));
  }

  // 5. Create GESTOR_PACOTE table
  try {
    await runDdlMitra({
      projectId,
      sql: `CREATE TABLE GESTOR_PACOTE (
        ID INT AUTO_INCREMENT PRIMARY KEY,
        GESTOR_ID INT NOT NULL,
        DRIVER_ID INT NOT NULL,
        FOREIGN KEY (GESTOR_ID) REFERENCES GESTOR(ID),
        FOREIGN KEY (DRIVER_ID) REFERENCES DRIVERS(ID)
      )`
    });
    console.log('OK: GESTOR_PACOTE table created');
  } catch (e) {
    console.log('Skip GESTOR_PACOTE:', String(e.message || e).substring(0, 80));
  }

  // 6. Set existing drivers to NORMAL type
  try {
    await runDmlMitra({
      projectId,
      sql: `UPDATE DRIVERS SET TIPO_DRIVER = 'NORMAL' WHERE TIPO_DRIVER IS NULL`
    });
    console.log('OK: Existing drivers set to NORMAL');
  } catch (e) {
    console.log('Skip update existing drivers:', String(e.message || e).substring(0, 80));
  }

  // 7. List all Server Functions
  const sfs = await listServerFunctionsMitra({ projectId });
  console.log('\nServer Functions:');
  sfs.result?.forEach(sf => console.log(`  ID: ${sf.id}, Name: ${sf.name}, Type: ${sf.type}`));

  console.log('\n=== Migration V2 complete! ===');
}

migrate().catch(e => { console.error('Migration failed:', e); process.exit(1); });
