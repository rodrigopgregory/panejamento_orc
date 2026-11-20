import 'dotenv/config';
import { configureSdkMitra, runDmlMitra, runQueryMitra } from 'mitra-sdk';

function backUrlFromToken(token) {
  try { const raw = (token || '').replace(/^Bearer\s+/i, ''); const payload = JSON.parse(Buffer.from(raw.split('.')[1], 'base64').toString('utf8')); return payload.backURL || payload.backUrl; } catch { return null; }
}
const baseURL = process.env.MITRA_BASE_URL || backUrlFromToken(process.env.MITRA_TOKEN);
configureSdkMitra({ baseURL, token: process.env.MITRA_TOKEN, integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS || baseURL });
const projectId = parseInt(process.env.MITRA_PROJECT_ID);

const CICLO_ID = 120;

const beneficios = [
  { NOME: 'Vale Refeição',    TIPO: 'FIXO',        VALOR: 880, PERCENTUAL: 0, APLICA_CLT: 'true', APLICA_PJ: 'false' },
  { NOME: 'Vale Transporte',  TIPO: 'PERCENTUAL',  VALOR: 0,   PERCENTUAL: 6, APLICA_CLT: 'true', APLICA_PJ: 'false' },
  { NOME: 'Plano de Saúde',   TIPO: 'FIXO',        VALOR: 650, PERCENTUAL: 0, APLICA_CLT: 'true', APLICA_PJ: 'true'  },
  { NOME: 'Plano Odontológico', TIPO: 'FIXO',      VALOR: 85,  PERCENTUAL: 0, APLICA_CLT: 'true', APLICA_PJ: 'false' },
  { NOME: 'Seguro de Vida',   TIPO: 'FIXO',        VALOR: 45,  PERCENTUAL: 0, APLICA_CLT: 'true', APLICA_PJ: 'false' },
  { NOME: 'Vale Alimentação', TIPO: 'FIXO',        VALOR: 450, PERCENTUAL: 0, APLICA_CLT: 'true', APLICA_PJ: 'false' },
];

const encargos = [
  { NOME: 'INSS Patronal', PERCENTUAL: 20,   APLICA_CLT: 'true', APLICA_PJ: 'false' },
  { NOME: 'FGTS',          PERCENTUAL: 8,    APLICA_CLT: 'true', APLICA_PJ: 'false' },
  { NOME: 'RAT/SAT',       PERCENTUAL: 3,    APLICA_CLT: 'true', APLICA_PJ: 'false' },
  { NOME: 'Sistema S',     PERCENTUAL: 5.8,  APLICA_CLT: 'true', APLICA_PJ: 'false' },
  { NOME: '13º Salário',   PERCENTUAL: 8.33, APLICA_CLT: 'true', APLICA_PJ: 'false' },
  { NOME: 'Férias + 1/3',  PERCENTUAL: 11.1, APLICA_CLT: 'true', APLICA_PJ: 'false' },
];

const dissidios = [
  { EMPRESA_ID: 1, PERCENTUAL: 5.5, MES_APLICACAO: 4 },
  { EMPRESA_ID: 2, PERCENTUAL: 6.0, MES_APLICACAO: 5 },
  { EMPRESA_ID: 3, PERCENTUAL: 5.0, MES_APLICACAO: 3 },
];

console.log(`Limpando dados existentes da CICLO ${CICLO_ID}...`);
await runDmlMitra({ projectId, sql: `DELETE FROM BENEFICIO WHERE CICLO_ID = ${CICLO_ID}` });
await runDmlMitra({ projectId, sql: `DELETE FROM ENCARGO WHERE CICLO_ID = ${CICLO_ID}` });
await runDmlMitra({ projectId, sql: `DELETE FROM PREMISSA_DISSIDIO WHERE CICLO_ID = ${CICLO_ID}` });

console.log('Inserindo BENEFICIOS...');
for (const b of beneficios) {
  await runDmlMitra({
    projectId,
    sql: `INSERT INTO BENEFICIO (NOME, TIPO, VALOR, PERCENTUAL, APLICA_CLT, APLICA_PJ, CICLO_ID) VALUES ('${b.NOME.replace(/'/g, "''")}', '${b.TIPO}', ${b.VALOR}, ${b.PERCENTUAL}, '${b.APLICA_CLT}', '${b.APLICA_PJ}', ${CICLO_ID})`,
  });
  console.log(`  + ${b.NOME}`);
}

console.log('Inserindo ENCARGOS...');
for (const e of encargos) {
  await runDmlMitra({
    projectId,
    sql: `INSERT INTO ENCARGO (NOME, PERCENTUAL, APLICA_CLT, APLICA_PJ, CICLO_ID) VALUES ('${e.NOME.replace(/'/g, "''")}', ${e.PERCENTUAL}, '${e.APLICA_CLT}', '${e.APLICA_PJ}', ${CICLO_ID})`,
  });
  console.log(`  + ${e.NOME}`);
}

console.log('Inserindo DISSIDIOS...');
for (const d of dissidios) {
  await runDmlMitra({
    projectId,
    sql: `INSERT INTO PREMISSA_DISSIDIO (CICLO_ID, EMPRESA_ID, PERCENTUAL, MES_APLICACAO) VALUES (${CICLO_ID}, ${d.EMPRESA_ID}, ${d.PERCENTUAL}, ${d.MES_APLICACAO})`,
  });
  console.log(`  + Empresa ${d.EMPRESA_ID} = ${d.PERCENTUAL}% mês ${d.MES_APLICACAO}`);
}

const bRes = await runQueryMitra({ projectId, sql: `SELECT COUNT(*) AS QTD FROM BENEFICIO WHERE CICLO_ID = ${CICLO_ID}` });
const eRes = await runQueryMitra({ projectId, sql: `SELECT COUNT(*) AS QTD FROM ENCARGO WHERE CICLO_ID = ${CICLO_ID}` });
const dRes = await runQueryMitra({ projectId, sql: `SELECT COUNT(*) AS QTD FROM PREMISSA_DISSIDIO WHERE CICLO_ID = ${CICLO_ID}` });

console.log(`\nResumo CICLO ${CICLO_ID}:`);
console.log(`  BENEFICIOS: ${(bRes.result?.rows || bRes)[0].QTD}`);
console.log(`  ENCARGOS:   ${(eRes.result?.rows || eRes)[0].QTD}`);
console.log(`  DISSIDIOS:  ${(dRes.result?.rows || dRes)[0].QTD}`);
