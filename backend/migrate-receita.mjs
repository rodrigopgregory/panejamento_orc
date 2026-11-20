import 'dotenv/config';
import { configureSdkMitra, runDdlMitra } from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS
});

const projectId = parseInt(process.env.MITRA_PROJECT_ID);

async function migrate() {
  // RECEITA_PREMISSA foi removida: a aba Receita passou a gravar direto em
  // ORCAMENTO pelo padrao de grade de modelo (commit a506b14), e o percentual de
  // imposto migrou para PREMISSA_IMPOSTO. O DDL antigo saiu daqui junto.

  // RECEITA_CONFIG: stores which contas are SERVICO vs PRODUTO and product names
  try {
    await runDdlMitra({
      projectId,
      sql: `CREATE TABLE RECEITA_CONFIG (
        ID INT AUTO_INCREMENT PRIMARY KEY,
        CONTA_ID INT NOT NULL,
        TIPO_RECEITA VARCHAR(20) NOT NULL DEFAULT 'SERVICO',
        CRIADO_EM VARCHAR(19),
        FOREIGN KEY (CONTA_ID) REFERENCES CONTA_CONTABIL(ID)
      )`
    });
    console.log('OK: Table RECEITA_CONFIG created');
  } catch (e) {
    console.log('Skip RECEITA_CONFIG:', String(e.message || e).substring(0, 80));
  }

  // RECEITA_PRODUTO: stores product names per conta
  try {
    await runDdlMitra({
      projectId,
      sql: `CREATE TABLE RECEITA_PRODUTO (
        ID INT AUTO_INCREMENT PRIMARY KEY,
        CONTA_ID INT NOT NULL,
        NOME VARCHAR(200) NOT NULL,
        ORDEM INT DEFAULT 0,
        CRIADO_EM VARCHAR(19),
        FOREIGN KEY (CONTA_ID) REFERENCES CONTA_CONTABIL(ID)
      )`
    });
    console.log('OK: Table RECEITA_PRODUTO created');
  } catch (e) {
    console.log('Skip RECEITA_PRODUTO:', String(e.message || e).substring(0, 80));
  }

  console.log('Receita migration done!');
}

migrate();
