import 'dotenv/config';
import {
  configureSdkMitra,
  createServerFunctionMitra,
  listServerFunctionsMitra,
  togglePublicExecutionMitra,
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
const projectId = Number(process.env.MITRA_PROJECT_ID);

configureSdkMitra({
  baseURL,
  token,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS || baseURL,
});

const code = `SELECT
  COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('CICLO_ID', x.CICLO_ID, 'CICLO_NOME', x.CICLO_NOME, 'ANO', x.ANO))
    FROM (
      SELECT t.CICLO_ID, c.NOME AS CICLO_NOME, c.ANO
      FROM PREENCHIMENTO_TOKEN t
      JOIN CICLO c ON c.ID = t.CICLO_ID
      WHERE t.TOKEN = '{{token}}' AND t.ATIVO = 'true'
        AND (t.EXPIRA_EM IS NULL OR t.EXPIRA_EM >= '{{agora}}')
      ORDER BY t.ID DESC LIMIT 1
    ) x), JSON_ARRAY()) AS CTX,
  COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('NOME_LINHA', x.NOME_LINHA, 'PREFIXO_CONTA', x.PREFIXO_CONTA, 'SINAL', x.SINAL, 'IS_SUBTOTAL', x.IS_SUBTOTAL))
    FROM (SELECT NOME_LINHA, PREFIXO_CONTA, SINAL, IS_SUBTOTAL FROM DRE_CONFIG ORDER BY ORDEM, ID) x), JSON_ARRAY()) AS CONFIG,
  COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('ID', x.ID, 'CODIGO', x.CODIGO, 'NOME', x.NOME))
    FROM (
      SELECT DISTINCT cc.ID, cc.CODIGO, cc.NOME
      FROM PREENCHIMENTO_TOKEN t
      JOIN GESTOR_CR gc ON gc.GESTOR_ID = t.GESTOR_ID
      JOIN CR_CONTA crc ON crc.CR_ID = gc.CR_ID AND crc.ATIVO = true
      JOIN CONTA_CONTABIL cc ON cc.ID = crc.CONTA_ID
      WHERE t.TOKEN = '{{token}}' AND t.ATIVO = 'true'
        AND (t.EXPIRA_EM IS NULL OR t.EXPIRA_EM >= '{{agora}}')
    ) x), JSON_ARRAY()) AS CONTAS,
  COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('CONTA_ID', x.CONTA_ID, 'MES', x.MES, 'VALOR', x.VALOR))
    FROM (
      SELECT o.CONTA_ID, o.MES, SUM(o.VALOR) AS VALOR
      FROM PREENCHIMENTO_TOKEN t
      JOIN GESTOR_CR gc ON gc.GESTOR_ID = t.GESTOR_ID
      JOIN ORCAMENTO o ON o.CICLO_ID = t.CICLO_ID AND o.CR_ID = gc.CR_ID
      WHERE t.TOKEN = '{{token}}' AND t.ATIVO = 'true'
        AND (t.EXPIRA_EM IS NULL OR t.EXPIRA_EM >= '{{agora}}')
      GROUP BY o.CONTA_ID, o.MES
    ) x), JSON_ARRAY()) AS ORCADO,
  COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('CONTA_ID', x.CONTA_ID, 'MES', x.MES, 'VALOR', x.VALOR))
    FROM (
      SELECT rc.CONTA_ID, rc.MES, SUM(rc.VALOR) AS VALOR
      FROM PREENCHIMENTO_TOKEN t
      JOIN CICLO c ON c.ID = t.CICLO_ID
      JOIN GESTOR_CR gc ON gc.GESTOR_ID = t.GESTOR_ID
      JOIN REALIZADO_CONTABIL rc ON rc.CR_ID = gc.CR_ID AND rc.ANO = c.ANO - 1
      WHERE t.TOKEN = '{{token}}' AND t.ATIVO = 'true'
        AND (t.EXPIRA_EM IS NULL OR t.EXPIRA_EM >= '{{agora}}')
      GROUP BY rc.CONTA_ID, rc.MES
    ) x), JSON_ARRAY()) AS REALIZADO_AA,
  COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('CONTA_ID', x.CONTA_ID, 'MES', x.MES, 'VALOR', x.VALOR))
    FROM (
      SELECT rc.CONTA_ID, rc.MES, SUM(rc.VALOR) AS VALOR
      FROM PREENCHIMENTO_TOKEN t
      JOIN CICLO c ON c.ID = t.CICLO_ID
      JOIN GESTOR_CR gc ON gc.GESTOR_ID = t.GESTOR_ID
      JOIN REALIZADO_CONTABIL rc ON rc.CR_ID = gc.CR_ID AND rc.ANO = c.ANO
      WHERE t.TOKEN = '{{token}}' AND t.ATIVO = 'true'
        AND (t.EXPIRA_EM IS NULL OR t.EXPIRA_EM >= '{{agora}}')
      GROUP BY rc.CONTA_ID, rc.MES
    ) x), JSON_ARRAY()) AS REALIZADO_ATUAL`;

const description = 'DRE consolidado publico do gestor, delimitado pelo token ativo. Retorna contexto, configuracao, contas, orcado e realizados (params: token, agora).';
const listed = await listServerFunctionsMitra({ projectId });
const functions = listed?.result || listed?.content || listed || [];
const existing = Array.isArray(functions) ? functions.find((item) => item.name === 'publicDreGestor') : null;

let id;
if (existing) {
  id = existing.id;
  await updateServerFunctionMitra({ projectId, serverFunctionId: id, code, description });
} else {
  const created = await createServerFunctionMitra({ projectId, name: 'publicDreGestor', type: 'SQL', code, description });
  id = created?.result?.serverFunctionId || created?.serverFunctionId || created?.id;
}

await togglePublicExecutionMitra({ projectId, serverFunctionId: id, publicExecution: true });
console.log(`publicDreGestor=${id}`);
