import 'dotenv/config';
import {
  configureSdkMitra,
  listServerFunctionsMitra,
  readServerFunctionMitra,
  updateServerFunctionMitra,
} from 'mitra-sdk';

function backUrlFromToken(token) {
  try {
    const raw = (token || '').replace(/^Bearer\s+/i, '');
    const payload = JSON.parse(Buffer.from(raw.split('.')[1], 'base64').toString('utf8'));
    return payload.backURL || payload.backUrl;
  } catch { return null; }
}

const token = process.env.MITRA_TOKEN;
const baseURL = process.env.MITRA_BASE_URL || backUrlFromToken(token) || process.env.MITRA_BASE_URL_SPACE;
configureSdkMitra({
  baseURL,
  token,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS || baseURL,
});

const projectId = Number(process.env.MITRA_PROJECT_ID);
const listed = await listServerFunctionsMitra({ projectId });
const functions = listed?.result || listed?.content || listed || [];
const target = Array.isArray(functions) ? functions.find((item) => item.name === 'publicOrcWrite') : null;

if (!target) throw new Error('Funcao publicOrcWrite nao encontrada');

const detail = await readServerFunctionMitra({ projectId, serverFunctionId: target.id });
const current = detail?.result?.code || detail?.code || '';
const auditStart = current.indexOf('  // Trilha de auditoria: registra qual modelo foi confirmado/desfeito');
const returnStart = current.indexOf('  return { ok: true };', auditStart);

if (auditStart === -1) {
  console.log('Auditoria de confirmacao de modelo ja removida.');
  process.exit(0);
}
if (returnStart === -1) throw new Error('Fim do bloco de auditoria nao encontrado');

const code = current.slice(0, auditStart) + current.slice(returnStart);
await updateServerFunctionMitra({
  projectId,
  serverFunctionId: target.id,
  code,
  description: target.description,
});

console.log(`Auditoria de confirmacao de modelo removida da funcao ${target.id}.`);
