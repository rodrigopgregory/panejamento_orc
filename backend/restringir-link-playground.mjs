// ──────────────────────────────────────────────────────────────────────
// Restringe o link compartilhado do Playground a usuarios logados:
// revoga a execucao publica da SF playground_publico (185). A partir daqui
// a SF so executa com token de sessao valido — visitante anonimo recebe
// erro de autenticacao e o frontend exige login antes de renderizar.
// ──────────────────────────────────────────────────────────────────────
import 'dotenv/config';
import {
  configureSdkMitra, togglePublicExecutionMitra, executeServerFunctionMitra,
} from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});

const projectId = parseInt(process.env.MITRA_PROJECT_ID);
const SF_PUBLICO = 185;

const r = await togglePublicExecutionMitra({
  projectId, serverFunctionId: SF_PUBLICO, publicExecution: false,
});
console.log('toggle:', JSON.stringify(r?.result ?? r));

// sanity: execucao AUTENTICADA continua funcionando (token invalido de
// estudo devolve 0 linhas, mas a SF executa)
const t = await executeServerFunctionMitra({
  projectId, serverFunctionId: SF_PUBLICO, input: { token: 'sanity-check' },
});
console.log('exec autenticada:', t?.result?.executionStatus);
