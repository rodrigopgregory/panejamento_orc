// SOMENTE LEITURA — o que esta gravado hoje na configuracao de IA (APP_CONFIG)
// e quais SFs de governanca existem. Nao escreve nada.
import 'dotenv/config';
import { configureSdkMitra, executeServerFunctionMitra, listServerFunctionsMitra } from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});
const projectId = parseInt(process.env.MITRA_PROJECT_ID);

const list = await listServerFunctionsMitra({ projectId });
const sfs = list.result || list;
const gov = sfs.filter((s) => /ConfigAgente/i.test(s.name));
console.log('=== SFs de governanca de IA ===');
for (const s of gov) console.log(`[${s.id}] ${s.name} (${s.type})`);

console.log('\n=== Valores atuais em APP_CONFIG (SF 237 lerConfigAgenteIA) ===');
try {
  const r = await executeServerFunctionMitra({ projectId, serverFunctionId: 237, input: {} });
  const out = r.result?.output;
  const rows = out?.rows || out?.result || out;
  console.log(JSON.stringify(rows, null, 2));
} catch (e) {
  console.log('ERRO ao ler SF 237:', String(e?.message || e));
}
