// Backfill pos-fusao: vincula o pacote TESTE (24) a gestora Aliny Ferreira
// (gestor 1, sarah@mitralab.io) e cria o PACOTE_STATUS dos ciclos abertos —
// mesmo efeito do novo fluxo de vinculo (Governanca/criacao de pacote).
import 'dotenv/config';
import { configureSdkMitra, runQueryMitra, runDmlMitra } from 'mitra-sdk';
function backUrlFromToken(token) { try { const raw = (token || '').replace(/^Bearer\s+/i, ''); const payload = JSON.parse(Buffer.from(raw.split('.')[1], 'base64').toString('utf8')); return payload.backURL || payload.backUrl; } catch { return null; } }
const baseURL = process.env.MITRA_BASE_URL || backUrlFromToken(process.env.MITRA_TOKEN);
configureSdkMitra({ baseURL, token: process.env.MITRA_TOKEN, integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS || baseURL });
const projectId = parseInt(process.env.MITRA_PROJECT_ID);
async function q(sql) { const r = await runQueryMitra({ projectId, sql }); return r.result?.rows || r; }

const DRIVER_ID = 24; // TESTE (ESCOPO='PACOTE')
const GESTOR_ID = 1;  // Aliny Ferreira (sarah@mitralab.io)
const agora = new Date().toISOString().slice(0, 19);

const pkg = await q(`SELECT ID, NOME FROM DRIVERS WHERE ID = ${DRIVER_ID} AND ESCOPO = 'PACOTE' AND ATIVO = 'true'`);
if (pkg.length === 0) throw new Error('pacote 24 nao encontrado');

const linkExists = await q(`SELECT ID FROM GESTOR_PACOTE WHERE DRIVER_ID = ${DRIVER_ID}`);
if (linkExists.length === 0) {
  await runDmlMitra({ projectId, sql: `INSERT INTO GESTOR_PACOTE (GESTOR_ID, DRIVER_ID) VALUES (${GESTOR_ID}, ${DRIVER_ID})` });
  console.log('GESTOR_PACOTE criado (gestor 1 <- pacote TESTE)');
} else console.log('vinculo ja existe, pulando');

const ciclos = await q(`SELECT ID, NOME FROM CICLO WHERE STATUS <> 'FECHADO'`);
for (const c of ciclos) {
  const st = await q(`SELECT ID FROM PACOTE_STATUS WHERE CICLO_ID = ${c.ID} AND DRIVER_ID = ${DRIVER_ID} LIMIT 1`);
  if (st.length === 0) {
    await runDmlMitra({ projectId, sql:
      `INSERT INTO PACOTE_STATUS (CICLO_ID, DRIVER_ID, GESTOR_ID, STATUS, ATUALIZADO_EM)
       VALUES (${c.ID}, ${DRIVER_ID}, ${GESTOR_ID}, 'PENDENTE', '${agora}')` });
    console.log(`PACOTE_STATUS criado no ciclo ${c.ID} (${c.NOME})`);
  } else console.log(`status ja existe no ciclo ${c.ID}`);
}
console.log('Backfill concluido.');
