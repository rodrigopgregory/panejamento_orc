import 'dotenv/config';
import { configureSdkMitra, listProfilesMitra, getProfileDetailsMitra, setProfileServerFunctionsMitra } from 'mitra-sdk';
configureSdkMitra({ baseURL: process.env.MITRA_BASE_URL, token: process.env.MITRA_TOKEN, integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS });
const projectId = parseInt(process.env.MITRA_PROJECT_ID);

// SFs que o agente analista do Playground chama via executeServerFunction
const PLAYGROUND_SFS = [176, 177, 187, 189]; // consulta_livre, schema_resumo, salvar_html, renomear

const perfis = (await listProfilesMitra({ projectId })).result || [];
for (const p of perfis) {
  if (p.id < 0) continue; // dummy
  const det = (await getProfileDetailsMitra({ projectId, profileId: p.id })).result || {};
  const atuais = (det.serverFunctions || []).map(f => f.serverFunctionId);
  const novos = [...new Set([...atuais, ...PLAYGROUND_SFS])];
  await setProfileServerFunctionsMitra({ projectId, profileId: p.id, serverFunctionIds: novos });
  console.log(`Perfil ${p.id} (${p.name}): ${atuais.length} -> ${novos.length} SFs`);
}

// Verificacao
for (const p of perfis) {
  if (p.id < 0) continue;
  const det = (await getProfileDetailsMitra({ projectId, profileId: p.id })).result || {};
  const ids = (det.serverFunctions || []).map(f => f.serverFunctionId);
  const ok = PLAYGROUND_SFS.every(id => ids.includes(id));
  console.log(`Perfil ${p.id}: playground liberado = ${ok}`);
}
