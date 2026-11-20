import 'dotenv/config';
import { configureSdkMitra, listServerFunctionsMitra, readServerFunctionMitra } from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS
});
const projectId = parseInt(process.env.MITRA_PROJECT_ID);

const all = await listServerFunctionsMitra({ projectId });
const list = all?.result || [];
console.log(`Total SFs: ${list.length}\n`);

for (const sf of list) {
  const det = await readServerFunctionMitra({ projectId, serverFunctionId: sf.id });
  const code = det?.result?.code || '';
  const refs = [];
  if (/PACOTE_REGRA_CONTABIL/i.test(code)) refs.push('PACOTE_REGRA_CONTABIL');
  if (/CONTA_DRIVER/i.test(code)) refs.push('CONTA_DRIVER');
  if (/CR_CONTA/i.test(code)) refs.push('CR_CONTA');
  if (/cd\.CR_ID/i.test(code)) refs.push('cd.CR_ID');
  if (refs.length) {
    console.log(`SF ${sf.id} (${sf.name}): ${refs.join(', ')}`);
    console.log(`  type: ${det?.result?.type}`);
    console.log(`  code preview: ${code.substring(0, 400).replace(/\s+/g, ' ')}`);
    console.log('---');
  }
}
console.log('done.');
