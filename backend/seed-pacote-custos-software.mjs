import 'dotenv/config';
import { configureSdkMitra, runDmlMitra, runQueryMitra } from 'mitra-sdk';
function backUrlFromToken(token) { try { const raw = (token || '').replace(/^Bearer\s+/i, ''); const payload = JSON.parse(Buffer.from(raw.split('.')[1], 'base64').toString('utf8')); return payload.backURL || payload.backUrl; } catch { return null; } }
const baseURL = process.env.MITRA_BASE_URL || backUrlFromToken(process.env.MITRA_TOKEN);
configureSdkMitra({ baseURL, token: process.env.MITRA_TOKEN, integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS || baseURL });
const projectId = parseInt(process.env.MITRA_PROJECT_ID);
async function q(sql) { const r = await runQueryMitra({ projectId, sql }); return r.result?.rows || r; }

const PID = 5;     // Custos Software
const CICLO = 120; // Versão 2 - 2026
const CONTA = 33;  // Despesas com Software
const VALID_CRS = [2, 4, 6, 7, 8]; // CRs configurados

// Valores totais mensais Jan-Dez (realista, crescente, com sazonalidade leve)
const totaisMensais = [51106, 54340, 57673, 60500, 51612, 54340, 57134, 58328, 58916, 59439, 59895, 54648];

// Rateio igualitário: 20% por CR (5 CRs)
const PCT_CR = 0.20;

console.log('Limpando ORCAMENTO_PACOTE existente...');
await runDmlMitra({ projectId, sql: `DELETE FROM ORCAMENTO_PACOTE WHERE DRIVER_ID = ${PID} AND CICLO_ID = ${CICLO}` });

console.log('Limpando RATEIO existente...');
const rcExist = await q(`SELECT ID FROM RATEIO_CONFIG WHERE DRIVER_ID = ${PID}`);
for (const r of rcExist) {
  await runDmlMitra({ projectId, sql: `DELETE FROM RATEIO_CR WHERE RATEIO_CONFIG_ID = ${r.ID}` });
  await runDmlMitra({ projectId, sql: `DELETE FROM RATEIO_CONFIG WHERE ID = ${r.ID}` });
}

console.log(`Inserindo ${totaisMensais.length} meses x ${VALID_CRS.length} CRs em ORCAMENTO_PACOTE...`);
for (let mes = 1; mes <= 12; mes++) {
  const total = totaisMensais[mes - 1];
  const valorPorCR = Math.round((total * PCT_CR) * 100) / 100;
  for (const crId of VALID_CRS) {
    await runDmlMitra({ projectId, sql: `INSERT INTO ORCAMENTO_PACOTE (DRIVER_ID, CICLO_ID, CONTA_ID, CR_ID, MES, VALOR) VALUES (${PID}, ${CICLO}, ${CONTA}, ${crId}, ${mes}, ${valorPorCR})` });
  }
}

console.log('Criando RATEIO_CONFIG (Percentual Fixo, 20% por CR)...');
const ts = new Date().toISOString().slice(0, 19);
const rcRes = await runDmlMitra({ projectId, sql: `INSERT INTO RATEIO_CONFIG (DRIVER_ID, TIPO_RATEIO, BASE_PROPORCIONAL, CRIADO_EM) VALUES (${PID}, 'PERCENTUAL_FIXO', 'RECEITA', '${ts}')` });
const rcId = (await q(`SELECT ID FROM RATEIO_CONFIG WHERE DRIVER_ID = ${PID} ORDER BY ID DESC LIMIT 1`))[0].ID;
for (const crId of VALID_CRS) {
  await runDmlMitra({ projectId, sql: `INSERT INTO RATEIO_CR (RATEIO_CONFIG_ID, CR_ID, PERCENTUAL) VALUES (${rcId}, ${crId}, 20)` });
}

console.log('Pacote 5 (Custos Software) preparado para CICLO 120.');
console.log(`Total anual: R$ ${totaisMensais.reduce((a, b) => a + b, 0).toLocaleString('pt-BR')}`);
