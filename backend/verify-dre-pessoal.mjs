import 'dotenv/config';
import { configureSdkMitra, executeServerFunctionMitra } from 'mitra-sdk';
configureSdkMitra({ baseURL: process.env.MITRA_BASE_URL, token: process.env.MITRA_TOKEN, integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS });
const projectId = parseInt(process.env.MITRA_PROJECT_ID);
async function sf(id, input) {
  const r = await executeServerFunctionMitra({ projectId, serverFunctionId: id, input });
  if (r?.result?.executionStatus !== 'COMPLETED') throw new Error(`SF ${id}: ${r?.result?.error}`);
  let o = r?.result?.output; if (typeof o === 'string') try { o = JSON.parse(o); } catch {}
  return o?.rows || o || [];
}
// contas com prefixo 5.1 (mesma regra da DREPage: CODIGO.startsWith('5.1'))
const contas = (await sf(76, { sql: "SELECT ID, CODIGO FROM CONTA_CONTABIL WHERE CODIGO LIKE '5.1%'" }));
const ids = contas.map(c => c.ID).join(',');
console.log(`Linha do DRE "(-) Despesas com Pessoal" (prefixo 5.1) -> ${contas.length} contas\n`);
const rows = await sf(88, { cicloId: 133, contaIds: ids, crIds: '1,2,3,4,5,6,7,8' });
const porCr = new Map();
for (const r of rows) porCr.set(Number(r.CR_ID), (porCr.get(Number(r.CR_ID)) || 0) + Number(r.VALOR || 0));
const crs = await sf(76, { sql: "SELECT ID, CODIGO FROM CENTRO_RESULTADO ORDER BY CODIGO" });
console.log('Orcado de Pessoal por setor no DRE (ciclo 133):');
for (const c of crs) {
  const v = porCr.get(c.ID) || 0;
  console.log(`  ${c.CODIGO}: ${v.toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2})}${v === 0 ? '   <- sem projetado' : ''}`);
}
