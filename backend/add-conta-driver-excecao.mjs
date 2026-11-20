import 'dotenv/config';
import { configureSdkMitra, runDdlMitra, runQueryMitra } from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});

const projectId = parseInt(process.env.MITRA_PROJECT_ID);

// Tabela de exceções: override por (CR, conta) sobre a regra global em CONTA_DRIVER
await runDdlMitra({
  projectId,
  sql: `CREATE TABLE IF NOT EXISTS CONTA_DRIVER_EXCECAO (
    ID INT AUTO_INCREMENT PRIMARY KEY,
    CR_ID INT NOT NULL,
    CONTA_ID INT NOT NULL,
    DRIVER_ID INT NOT NULL,
    ATIVO BOOLEAN DEFAULT TRUE,
    CRIADO_EM VARCHAR(19),
    UNIQUE KEY UQ_CR_CONTA (CR_ID, CONTA_ID),
    FOREIGN KEY (CR_ID) REFERENCES CENTRO_RESULTADO(ID),
    FOREIGN KEY (CONTA_ID) REFERENCES CONTA_CONTABIL(ID),
    FOREIGN KEY (DRIVER_ID) REFERENCES DRIVERS(ID)
  )`,
});

console.log('CONTA_DRIVER_EXCECAO criada.');

const check = await runQueryMitra({ projectId, sql: 'SELECT COUNT(*) AS C FROM CONTA_DRIVER_EXCECAO' });
console.log('Linhas existentes:', check.result?.rows?.[0]?.C ?? 0);
