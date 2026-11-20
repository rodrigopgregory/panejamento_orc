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
  console.log('Creating DRIVER_FORMULA_CR table (formula overrides per CR)...');
  try {
    await runDdlMitra({
      projectId,
      sql: `CREATE TABLE DRIVER_FORMULA_CR (
        ID INT AUTO_INCREMENT PRIMARY KEY,
        FORMULA_ID INT NOT NULL,
        CR_ID INT NOT NULL,
        TIPO VARCHAR(20) DEFAULT 'FORMULA',
        FORMULA VARCHAR(500) NOT NULL,
        CRIADO_EM VARCHAR(19),
        FOREIGN KEY (FORMULA_ID) REFERENCES DRIVER_FORMULA(ID),
        FOREIGN KEY (CR_ID) REFERENCES CENTRO_RESULTADO(ID)
      )`
    });
    console.log('DRIVER_FORMULA_CR table created');
  } catch (e) {
    console.log('DRIVER_FORMULA_CR may already exist:', e.message || e);
  }

  console.log('Migration complete!');
}

migrate().catch(console.error);
