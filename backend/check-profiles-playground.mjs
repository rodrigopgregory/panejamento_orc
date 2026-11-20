import 'dotenv/config';
import { configureSdkMitra, listProfilesMitra, getProfileDetailsMitra, listServerFunctionsMitra } from 'mitra-sdk';
configureSdkMitra({ baseURL: process.env.MITRA_BASE_URL, token: process.env.MITRA_TOKEN, integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS });
const projectId = parseInt(process.env.MITRA_PROJECT_ID);
const sfs = await listServerFunctionsMitra({ projectId });
const pg = (sfs.result || sfs).filter(f => /playground|consulta_livre|schema_resumo/i.test(f.name));
console.log('SFs Playground:', pg.map(f => `${f.id}:${f.name}`).join(', '));
const perfis = await listProfilesMitra({ projectId });
console.log('Perfis:', JSON.stringify(perfis.result || perfis));
for (const p of (perfis.result || perfis)) {
  const d = await getProfileDetailsMitra({ projectId, profileId: p.id });
  const det = d.result || d;
  console.log(`\nPerfil ${p.id} (${p.name}):`);
  console.log('  SFs liberadas:', JSON.stringify(det.serverFunctions ?? det.serverFunctionIds ?? det));
}
