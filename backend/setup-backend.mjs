import 'dotenv/config';
import { configureSdkMitra, runDdlMitra, runDmlMitra, listServerFunctionsMitra } from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS
});

const projectId = parseInt(process.env.MITRA_PROJECT_ID);

async function migrate() {
  // 1. Create DRIVERS table (catalog of available drivers)
  try {
    await runDdlMitra({
      projectId,
      sql: `CREATE TABLE DRIVERS (
        ID INT AUTO_INCREMENT PRIMARY KEY,
        NOME VARCHAR(100) NOT NULL,
        DESCRICAO VARCHAR(500),
        COR VARCHAR(20) DEFAULT 'info',
        ATIVO VARCHAR(5) DEFAULT 'true',
        CRIADO_EM VARCHAR(19)
      )`
    });
    console.log('OK: Table DRIVERS created');
  } catch (e) {
    console.log('Skip DRIVERS table (may exist):', String(e.message || e).substring(0, 80));
  }

  // 2. Seed default drivers based on existing DRIVER_TIPO values
  const defaultDrivers = [
    { NOME: 'BASE_ZERO', DESCRICAO: 'Orcamento construido do zero, sem base historica', COR: 'warning', CRIADO_EM: new Date().toISOString().slice(0, 19) },
    { NOME: 'BASE_HISTORICO', DESCRICAO: 'Projecao baseada em dados historicos com variacao percentual', COR: 'info', CRIADO_EM: new Date().toISOString().slice(0, 19) },
    { NOME: 'RECEITA', DESCRICAO: 'Contas vinculadas a receita e faturamento', COR: 'success', CRIADO_EM: new Date().toISOString().slice(0, 19) },
    { NOME: 'PESSOAL', DESCRICAO: 'Contas de folha de pagamento, beneficios e encargos', COR: 'neutral', CRIADO_EM: new Date().toISOString().slice(0, 19) },
  ];

  for (const d of defaultDrivers) {
    try {
      await runDmlMitra({
        projectId,
        sql: `INSERT INTO DRIVERS (NOME, DESCRICAO, COR, CRIADO_EM)
              SELECT '${d.NOME}', '${d.DESCRICAO}', '${d.COR}', '${d.CRIADO_EM}'
              FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM DRIVERS WHERE NOME = '${d.NOME}')`
      });
      console.log('OK: Driver', d.NOME);
    } catch (e) {
      console.log('Skip driver', d.NOME, ':', String(e.message || e).substring(0, 80));
    }
  }

  // === NEW TABLES: Premissas de Folha ===

  // Dissidio por empresa (percentual + mes de aplicacao)
  try {
    await runDdlMitra({
      projectId,
      sql: `CREATE TABLE PREMISSA_DISSIDIO (
        ID INT AUTO_INCREMENT PRIMARY KEY,
        CICLO_ID INT NOT NULL,
        EMPRESA_ID INT NOT NULL,
        PERCENTUAL DECIMAL(6,2) NOT NULL DEFAULT 0,
        MES_APLICACAO INT NOT NULL DEFAULT 1,
        CRIADO_EM VARCHAR(19),
        FOREIGN KEY (EMPRESA_ID) REFERENCES EMPRESA(ID)
      )`
    });
    console.log('OK: Table PREMISSA_DISSIDIO created');
  } catch (e) {
    console.log('Skip PREMISSA_DISSIDIO:', String(e.message || e).substring(0, 80));
  }

  // Turnover anual por empresa
  try {
    await runDdlMitra({
      projectId,
      sql: `CREATE TABLE PREMISSA_TURNOVER (
        ID INT AUTO_INCREMENT PRIMARY KEY,
        CICLO_ID INT NOT NULL,
        EMPRESA_ID INT NOT NULL,
        PERCENTUAL DECIMAL(6,2) NOT NULL DEFAULT 0,
        CRIADO_EM VARCHAR(19),
        FOREIGN KEY (EMPRESA_ID) REFERENCES EMPRESA(ID)
      )`
    });
    console.log('OK: Table PREMISSA_TURNOVER created');
  } catch (e) {
    console.log('Skip PREMISSA_TURNOVER:', String(e.message || e).substring(0, 80));
  }

  // Aumento salarial programado por colaborador
  try {
    await runDdlMitra({
      projectId,
      sql: `CREATE TABLE AUMENTO_SALARIAL (
        ID INT AUTO_INCREMENT PRIMARY KEY,
        CICLO_ID INT NOT NULL,
        COLABORADOR_ID INT NOT NULL,
        PERCENTUAL DECIMAL(6,2) NOT NULL DEFAULT 0,
        MES_APLICACAO INT NOT NULL DEFAULT 1,
        MOTIVO VARCHAR(200),
        CRIADO_EM VARCHAR(19),
        FOREIGN KEY (COLABORADOR_ID) REFERENCES COLABORADOR(ID)
      )`
    });
    console.log('OK: Table AUMENTO_SALARIAL created');
  } catch (e) {
    console.log('Skip AUMENTO_SALARIAL:', String(e.message || e).substring(0, 80));
  }

  // Contratacao projetada (substitui grid de headcount simples)
  try {
    await runDdlMitra({
      projectId,
      sql: `CREATE TABLE CONTRATACAO_PROJETADA (
        ID INT AUTO_INCREMENT PRIMARY KEY,
        CICLO_ID INT NOT NULL,
        CR_ID INT NOT NULL,
        CARGO_ID INT NOT NULL,
        MES_ENTRADA INT NOT NULL DEFAULT 1,
        MOTIVO VARCHAR(50) DEFAULT 'AUMENTO_QUADRO',
        CRIADO_EM VARCHAR(19),
        FOREIGN KEY (CR_ID) REFERENCES CENTRO_RESULTADO(ID),
        FOREIGN KEY (CARGO_ID) REFERENCES CARGO(ID)
      )`
    });
    console.log('OK: Table CONTRATACAO_PROJETADA created');
  } catch (e) {
    console.log('Skip CONTRATACAO_PROJETADA:', String(e.message || e).substring(0, 80));
  }

  // List SFs
  const sfs = await listServerFunctionsMitra({ projectId });
  console.log('Server Functions:');
  sfs.result?.forEach(sf => console.log(`  ID: ${sf.id}, Name: ${sf.name}`));

  console.log('Migration done!');
}

migrate();
