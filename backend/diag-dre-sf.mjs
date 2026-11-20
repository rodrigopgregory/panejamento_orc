// SOMENTE LEITURA — ler o SQL das SFs do DRE para saber se somam ORCAMENTO + ORCAMENTO_PACOTE
import 'dotenv/config';
import { configureSdkMitra, listServerFunctionsMitra, readServerFunctionMitra } from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});
const projectId = parseInt(process.env.MITRA_PROJECT_ID);

const list = await listServerFunctionsMitra({ projectId });
const sfs = list.result || list;
const alvo = sfs.filter(s => /dreOrcado|dreRealizado/i.test(s.name));
for (const s of alvo) {
  const fn = await readServerFunctionMitra({ projectId, serverFunctionId: s.id });
  console.log(`\n===== [${s.id}] ${s.name} (${s.type}) =====`);
  console.log(fn.result?.code);
}
