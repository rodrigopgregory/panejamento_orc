import 'dotenv/config';
import { configureSdkMitra, runDdlMitra, runDmlMitra } from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS
});
const projectId = parseInt(process.env.MITRA_PROJECT_ID);

async function migrate() {
  // 1. Create PACOTE_STATUS table
  try {
    await runDdlMitra({
      projectId,
      sql: `CREATE TABLE PACOTE_STATUS (
        ID INT AUTO_INCREMENT PRIMARY KEY,
        CICLO_ID INT NOT NULL,
        DRIVER_ID INT NOT NULL,
        GESTOR_ID INT NOT NULL,
        STATUS VARCHAR(20) DEFAULT 'PENDENTE',
        COMENTARIO VARCHAR(500),
        ATUALIZADO_EM VARCHAR(19),
        FOREIGN KEY (CICLO_ID) REFERENCES CICLO(ID),
        FOREIGN KEY (DRIVER_ID) REFERENCES DRIVERS(ID),
        FOREIGN KEY (GESTOR_ID) REFERENCES GESTOR(ID)
      )`
    });
    console.log('OK: PACOTE_STATUS table created');
  } catch (e) {
    console.log('Skip PACOTE_STATUS:', String(e.message || e).substring(0, 80));
  }

  // 2. Create PACOTE_STATUS entries for existing active cycles
  try {
    const result = await runDmlMitra({
      projectId,
      sql: `INSERT INTO PACOTE_STATUS (CICLO_ID, DRIVER_ID, GESTOR_ID, STATUS, ATUALIZADO_EM)
            SELECT c.ID, gp.DRIVER_ID, gp.GESTOR_ID, 'PENDENTE', '${new Date().toISOString().slice(0, 19)}'
            FROM CICLO c
            CROSS JOIN GESTOR_PACOTE gp
            JOIN DRIVERS d ON d.ID = gp.DRIVER_ID AND d.ATIVO = 'true' AND d.TIPO_DRIVER = 'PACOTE'
            WHERE c.STATUS IN ('INICIADA', 'REVISAO')
            AND NOT EXISTS (
              SELECT 1 FROM PACOTE_STATUS ps
              WHERE ps.CICLO_ID = c.ID AND ps.DRIVER_ID = gp.DRIVER_ID AND ps.GESTOR_ID = gp.GESTOR_ID
            )`
    });
    console.log('OK: Backfilled PACOTE_STATUS for active cycles');
  } catch (e) {
    console.log('Skip backfill:', String(e.message || e).substring(0, 80));
  }

  console.log('Migration complete!');
}

migrate();
