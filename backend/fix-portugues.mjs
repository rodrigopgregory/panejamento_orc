// Script de correcao de portugues — atualiza textos persistidos no banco
// que estavam sem acento. Roda APENAS UPDATE (nao recria nem apaga nada).
import 'dotenv/config';
import { configureSdkMitra, runDmlMitra } from 'mitra-sdk';

function backUrlFromToken(token) {
  try {
    const raw = (token || '').replace(/^Bearer\s+/i, '');
    const payload = JSON.parse(Buffer.from(raw.split('.')[1], 'base64').toString('utf8'));
    return payload.backURL || payload.backUrl;
  } catch { return null; }
}

function tokenTni(token) {
  try {
    const raw = (token || '').replace(/^Bearer\s+/i, '');
    const payload = JSON.parse(Buffer.from(raw.split('.')[1], 'base64').toString('utf8'));
    return payload.tni;
  } catch { return null; }
}

const targetProjectId = parseInt(process.env.MITRA_PROJECT_ID);
const candidates = [
  { name: 'MITRA_SERVICE_TOKEN', token: process.env.MITRA_SERVICE_TOKEN },
  { name: 'MITRA_TOKEN', token: process.env.MITRA_TOKEN },
].filter((c) => c.token);

const matching = candidates.find((c) => tokenTni(c.token) === targetProjectId) || candidates[0];
const TOKEN = matching?.token;
const BACK_URL = process.env.MITRA_BASE_URL || backUrlFromToken(TOKEN) || process.env.MITRA_BASE_URL_SPACE;

configureSdkMitra({
  baseURL: BACK_URL,
  token: TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS || BACK_URL,
});

const projectId = parseInt(process.env.MITRA_PROJECT_ID);

async function main() {
  console.log('Atualizando descricoes dos drivers com acentos corretos...');

  const updates = [
    {
      where: "NOME = 'BASE_ZERO'",
      desc: "Orçamento construído do zero, sem base histórica",
    },
    {
      where: "NOME = 'BASE_HISTORICO'",
      desc: "Projeção baseada em dados históricos com variação percentual",
    },
    {
      where: "NOME = 'RECEITA'",
      desc: "Contas vinculadas a receita e faturamento",
    },
    {
      where: "NOME = 'PESSOAL'",
      desc: "Contas de folha de pagamento, benefícios e encargos",
    },
  ];

  for (const u of updates) {
    const safe = u.desc.replace(/'/g, "''");
    await runDmlMitra({
      projectId,
      sql: `UPDATE DRIVERS SET DESCRICAO = '${safe}' WHERE ${u.where}`,
    });
    console.log(`  OK: ${u.where} -> ${u.desc}`);
  }

  console.log('Pronto.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
