// Adiciona a SF listarAuditoriaGeral — listagem completa da trilha de auditoria
// do workflow (todos os CRs e pacotes, todos os ciclos), com filtros opcionais
// e paginacao. Alimenta a nova tela /auditoria (secao Governanca, admin only).
// Aditivo e idempotente (upsert por nome).
import 'dotenv/config';
import {
  configureSdkMitra,
  createServerFunctionMitra,
  updateServerFunctionMitra,
  listServerFunctionsMitra,
  executeServerFunctionMitra,
} from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});
const projectId = parseInt(process.env.MITRA_PROJECT_ID);

const CODE = `SELECT a.ID, a.CICLO_ID, c.NOME AS CICLO_NOME, a.TIPO, a.EVENTO,
  a.STATUS_DE, a.STATUS_PARA, a.COMENTARIO, a.AUTOR, a.ORIGEM, a.CRIADO_EM,
  CASE WHEN a.TIPO = 'CR' THEN CONCAT(cr.CODIGO, ' - ', cr.NOME) ELSE CONCAT('Pacote ', COALESCE(d.NOME, '?')) END AS ALVO
FROM WORKFLOW_AUDITORIA a
JOIN CICLO c ON c.ID = a.CICLO_ID
LEFT JOIN CENTRO_RESULTADO cr ON cr.ID = a.CR_ID
LEFT JOIN DRIVERS d ON d.ID = a.DRIVER_ID
WHERE ({{cicloId}} = 0 OR a.CICLO_ID = {{cicloId}})
  AND ('{{evento}}' = '' OR a.EVENTO = '{{evento}}')
  AND ('{{tipo}}' = '' OR a.TIPO = '{{tipo}}')
  AND ('{{busca}}' = '' OR a.AUTOR LIKE '%{{busca}}%' OR cr.NOME LIKE '%{{busca}}%' OR cr.CODIGO LIKE '%{{busca}}%' OR d.NOME LIKE '%{{busca}}%')
ORDER BY a.ID DESC
LIMIT {{limit}} OFFSET {{offset}}`;

const DESCR = 'Trilha de auditoria completa do workflow com filtros opcionais. Params: cicloId (0=todos), evento (\'\'=todos), tipo (\'\'=todos, CR|PACOTE), busca (\'\'=sem busca), limit, offset';

const list = await listServerFunctionsMitra({ projectId });
const fns = list?.result || list || [];
const existing = (Array.isArray(fns) ? fns : []).find((f) => f.name === 'listarAuditoriaGeral');

let sfId;
if (existing) {
  await updateServerFunctionMitra({ projectId, serverFunctionId: existing.id, code: CODE, description: DESCR });
  sfId = existing.id;
  console.log('~ atualizada listarAuditoriaGeral id=' + sfId);
} else {
  const r = await createServerFunctionMitra({ projectId, name: 'listarAuditoriaGeral', type: 'SQL', code: CODE, description: DESCR });
  sfId = r?.result?.serverFunctionId ?? r?.result?.id;
  console.log('+ criada listarAuditoriaGeral id=' + sfId);
}

// smoke test
const t = await executeServerFunctionMitra({ projectId, serverFunctionId: sfId, input: { cicloId: 0, evento: '', tipo: '', busca: '', limit: 5, offset: 0 } });
let o = t?.result?.output; if (typeof o === 'string') o = JSON.parse(o);
console.log('teste rows:', (o?.rows || []).length, 'status:', t?.result?.executionStatus);
if (o?.rows?.[0]) console.log('exemplo:', JSON.stringify(o.rows[0]));
