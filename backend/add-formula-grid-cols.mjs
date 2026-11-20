// Migracao ADITIVA — colunas de apresentacao das linhas de formula (grid full-screen)
// Nao altera nem remove nada existente; apenas ADD COLUMN com defaults seguros.
import 'dotenv/config';
import { configureSdkMitra, runDdlMitra, runDmlMitra } from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});

const projectId = parseInt(process.env.MITRA_PROJECT_ID);

async function addColumn(sql, label) {
  try {
    await runDdlMitra({ projectId, sql });
    console.log(`OK: ${label}`);
  } catch (e) {
    console.log(`Skip ${label}:`, String(e.message || e).substring(0, 120));
  }
}

async function migrate() {
  await addColumn("ALTER TABLE DRIVER_FORMULA ADD COLUMN ESCONDER BOOLEAN DEFAULT FALSE", 'DRIVER_FORMULA.ESCONDER');
  await addColumn("ALTER TABLE DRIVER_FORMULA ADD COLUMN NEGRITO BOOLEAN DEFAULT FALSE", 'DRIVER_FORMULA.NEGRITO');
  await addColumn("ALTER TABLE DRIVER_FORMULA ADD COLUMN FORMATO VARCHAR(20) DEFAULT 'MONETARIO'", 'DRIVER_FORMULA.FORMATO');

  // Defaults para linhas pre-existentes (ADD COLUMN pode deixar NULL em registros antigos)
  try {
    await runDmlMitra({ projectId, sql: "UPDATE DRIVER_FORMULA SET ESCONDER = FALSE WHERE ESCONDER IS NULL" });
    await runDmlMitra({ projectId, sql: "UPDATE DRIVER_FORMULA SET NEGRITO = FALSE WHERE NEGRITO IS NULL" });
    await runDmlMitra({ projectId, sql: "UPDATE DRIVER_FORMULA SET FORMATO = 'MONETARIO' WHERE FORMATO IS NULL OR FORMATO = ''" });
    console.log('OK: defaults aplicados nas linhas existentes');
  } catch (e) {
    console.log('Skip defaults:', String(e.message || e).substring(0, 120));
  }

  console.log('Migration complete!');
}

migrate().catch(console.error);
