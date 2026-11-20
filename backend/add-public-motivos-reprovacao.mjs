import 'dotenv/config';
import { configureSdkMitra, createServerFunctionMitra, listServerFunctionsMitra, togglePublicExecutionMitra, updateServerFunctionMitra } from 'mitra-sdk';

function backUrlFromToken(token) {
  try {
    const raw = (token || '').replace(/^Bearer\s+/i, '');
    const payload = JSON.parse(Buffer.from(raw.split('.')[1], 'base64').toString('utf8'));
    return payload.backURL || payload.backUrl;
  } catch { return null; }
}

const token = process.env.MITRA_TOKEN;
const baseURL = process.env.MITRA_BASE_URL || backUrlFromToken(token) || process.env.MITRA_BASE_URL_SPACE;
const projectId = Number(process.env.MITRA_PROJECT_ID);
configureSdkMitra({ baseURL, token, integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS || baseURL });

const code = `SELECT a.EVENTO, a.COMENTARIO, a.AUTOR, a.CRIADO_EM
FROM WORKFLOW_AUDITORIA a
JOIN PREENCHIMENTO_TOKEN t ON t.TOKEN = '{{token}}' AND t.ATIVO = 'true'
WHERE a.EVENTO = 'REPROVADO'
  AND a.CICLO_ID = t.CICLO_ID
  AND (t.EXPIRA_EM IS NULL OR t.EXPIRA_EM >= '{{agora}}')
  AND (
    ('{{tipo}}' = 'CR' AND a.TIPO = 'CR' AND a.CR_ID = {{refId}}
      AND EXISTS (SELECT 1 FROM GESTOR_CR gc WHERE gc.GESTOR_ID = t.GESTOR_ID AND gc.CR_ID = a.CR_ID))
    OR
    ('{{tipo}}' = 'PACOTE' AND a.TIPO = 'PACOTE' AND a.DRIVER_ID = {{refId}}
      AND EXISTS (SELECT 1 FROM PACOTE_STATUS ps WHERE ps.CICLO_ID = t.CICLO_ID AND ps.GESTOR_ID = t.GESTOR_ID AND ps.DRIVER_ID = a.DRIVER_ID))
  )
ORDER BY a.CRIADO_EM DESC, a.ID DESC`;
const description = 'Lista motivos de reprovação do CR ou pacote do gestor, delimitado pelo token ativo (params: token, tipo, refId, agora).';
const listed = await listServerFunctionsMitra({ projectId });
const functions = listed?.result || listed?.content || listed || [];
const existing = Array.isArray(functions) ? functions.find((item) => item.name === 'publicMotivosReprovacao') : null;
let id;
if (existing) {
  id = existing.id;
  await updateServerFunctionMitra({ projectId, serverFunctionId: id, code, description });
} else {
  const created = await createServerFunctionMitra({ projectId, name: 'publicMotivosReprovacao', type: 'SQL', code, description });
  id = created?.result?.serverFunctionId || created?.serverFunctionId || created?.id;
}
await togglePublicExecutionMitra({ projectId, serverFunctionId: id, publicExecution: true });
console.log(`publicMotivosReprovacao=${id}`);
