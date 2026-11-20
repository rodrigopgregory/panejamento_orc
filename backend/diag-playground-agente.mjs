// ──────────────────────────────────────────────────────────────────────
// SOMENTE LEITURA — diagnostico do analista do Playground.
//
// Responde a pergunta que cinco correcoes de credencial nao responderam:
// quando o analista diz "acesso revogado", a plataforma REALMENTE recusou
// alguma coisa, ou ele so nao enxergou as ferramentas e chutou a causa?
//
// A prova esta no cruzamento de tres fontes:
//   1. INT_SERVERFUNCTIONEXECUTION — o que a plataforma REALMENTE executou.
//      Se nao ha linha nenhuma no horario do turno, o agente nunca chegou
//      ate aqui: o problema esta no canal MCP, nao na credencial.
//   2. PLAYGROUND.CONVERSA — o texto que o usuario viu. "Acesso revogado"
//      e prosa do proprio modelo, nao existe string dessas no app.
//   3. Perfis/SFs e APP_CONFIG — a configuracao que sustenta (ou nao) o acesso.
//
// Nao escreve nada. Rodar com: cd backend && node diag-playground-agente.mjs
// ──────────────────────────────────────────────────────────────────────
import 'dotenv/config';
import {
  configureSdkMitra, runQueryMitra, listProfilesMitra,
  getProfileDetailsMitra, executeServerFunctionMitra,
} from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});
const projectId = parseInt(process.env.MITRA_PROJECT_ID);
const q = async (sql) => (await runQueryMitra({ projectId, sql })).result.rows;

// SFs que o agente analista chama via mcp__mitra-business__executeServerFunction
const SFS_AGENTE = [176, 177, 187, 189];
const lista = SFS_AGENTE.join(',');

console.log('=== 1. ESTUDOS (TAM_HTML 0 = canvas nunca publicado) ===');
for (const r of await q(
  `SELECT ID, USUARIO_ID, LENGTH(HTML) AS TAM_HTML, TASK_ID, CRIADO_EM, ATUALIZADO_EM, NOME
   FROM PLAYGROUND WHERE ATIVO = 'true' ORDER BY ID DESC LIMIT 15`,
)) console.log(`#${r.ID} | html=${r.TAM_HTML} | task=${r.TASK_ID} | ${r.ATUALIZADO_EM} | ${r.NOME}`);

console.log('\n=== 2. EXECUCOES DAS SFs DO AGENTE (ultimas 25) ===');
console.log('    Turno sem linha aqui = o agente nunca alcancou a plataforma.');
for (const r of await q(
  `SELECT ID, FUNCTION_ID, STATUS, TRIGGERED_BY, DURATION_MS, CREATED_AT
   FROM INT_SERVERFUNCTIONEXECUTION WHERE FUNCTION_ID IN (${lista})
   ORDER BY ID DESC LIMIT 25`,
)) console.log(`${r.CREATED_AT} | SF ${r.FUNCTION_ID} | ${r.STATUS} | ${r.DURATION_MS}ms | user ${r.TRIGGERED_BY}`);

console.log('\n=== 3. FALHAS REAIS DESSAS SFs ===');
console.log('    Erro de SQL do agente = normal. Erro de auth/permissao = credencial de verdade.');
const falhas = await q(
  `SELECT ID, FUNCTION_ID, STATUS, CREATED_AT, LEFT(COALESCE(ERROR, ''), 220) AS ERRO
   FROM INT_SERVERFUNCTIONEXECUTION WHERE FUNCTION_ID IN (${lista})
     AND STATUS <> 'COMPLETED' ORDER BY ID DESC LIMIT 15`,
);
console.log(falhas.length
  ? falhas.map((r) => `${r.CREATED_AT} | SF ${r.FUNCTION_ID} | ${r.ERRO}`).join('\n')
  : '(nenhuma — a plataforma nunca recusou o agente)');

console.log('\n=== 4. PERFIS x SFs DO PLAYGROUND ===');
for (const p of ((await listProfilesMitra({ projectId })).result || [])) {
  if (p.id < 0) continue;
  const det = (await getProfileDetailsMitra({ projectId, profileId: p.id })).result || {};
  const ids = (det.serverFunctions || []).map((f) => f.serverFunctionId);
  const faltando = SFS_AGENTE.filter((id) => !ids.includes(id));
  console.log(`Perfil ${p.id} (${p.name}): usuarios=${(det.users || []).length} | `
    + `playground=${faltando.length ? 'FALTA ' + faltando.join(',') : 'ok'}`);
}

console.log('\n=== 5. CONFIG DO AGENTE (APP_CONFIG) ===');
console.log('    AGENT_CONNECTION_ID vazio = sem credencial compartilhada; todos caem na propria.');
try {
  const out = (await executeServerFunctionMitra({ projectId, serverFunctionId: 237, input: {} })).result?.output;
  for (const r of (out?.rows || [])) console.log(`${r.CHAVE} = ${JSON.stringify(r.VALOR)}`);
} catch (e) {
  console.log('ERRO ao ler SF 237:', String(e?.message || e));
}
