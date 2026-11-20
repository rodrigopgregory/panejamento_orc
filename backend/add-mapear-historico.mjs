import 'dotenv/config';
import {
  configureSdkMitra,
  createServerFunctionMitra,
  executeServerFunctionMitra,
  listServerFunctionsMitra,
  updateServerFunctionMitra,
} from 'mitra-sdk';

function backUrlFromToken(token) {
  try {
    const raw = (token || '').replace(/^Bearer\s+/i, '');
    const payload = JSON.parse(Buffer.from(raw.split('.')[1], 'base64').toString('utf8'));
    return payload.backURL || payload.backUrl;
  } catch {
    return null;
  }
}

const token = process.env.MITRA_TOKEN;
const baseURL = process.env.MITRA_BASE_URL || backUrlFromToken(token);
configureSdkMitra({
  baseURL,
  token,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS || process.env.MITRA_BASE_URL_SPACE || baseURL,
});

const projectId = Number(process.env.MITRA_PROJECT_ID);

const definitions = [
  {
    name: 'mapearHistoricoPrevia',
    type: 'SQL',
    description: 'Sugere vínculos entre setores e contas a partir dos lançamentos contábeis do ano anterior ao ciclo aberto.',
    code: `WITH REF AS (
      SELECT COALESCE(
        (SELECT ANO - 1 FROM CICLO WHERE STATUS = 'ABERTO' ORDER BY ID DESC LIMIT 1),
        (SELECT MAX(ANO) FROM REALIZADO_CONTABIL)
      ) AS ANO_REFERENCIA
    )
    SELECT
      R.CR_ID,
      CR.CODIGO AS CR_CODIGO,
      CR.NOME AS CR_NOME,
      R.CONTA_ID,
      CC.CODIGO AS CONTA_CODIGO,
      CC.NOME AS CONTA_NOME,
      CC.TIPO AS CONTA_TIPO,
      REF.ANO_REFERENCIA,
      COUNT(*) AS LANCAMENTOS,
      COUNT(DISTINCT R.MES) AS MESES_COM_MOVIMENTO,
      SUM(ABS(R.VALOR)) AS VALOR_MOVIMENTADO
    FROM REALIZADO_CONTABIL R
    JOIN REF ON R.ANO = REF.ANO_REFERENCIA
    JOIN CENTRO_RESULTADO CR ON CR.ID = R.CR_ID AND CR.ATIVO = true
    JOIN CONTA_CONTABIL CC ON CC.ID = R.CONTA_ID AND CC.ATIVO = true
    LEFT JOIN CR_CONTA M ON M.CR_ID = R.CR_ID AND M.CONTA_ID = R.CONTA_ID AND M.ATIVO = true
    WHERE COALESCE(R.VALOR, 0) <> 0
      AND M.ID IS NULL
    GROUP BY R.CR_ID, CR.CODIGO, CR.NOME, R.CONTA_ID, CC.CODIGO, CC.NOME, CC.TIPO, REF.ANO_REFERENCIA
    ORDER BY CR.CODIGO, CC.CODIGO`,
  },
  {
    name: 'mapearHistoricoConfirmar',
    type: 'SQL',
    description: 'Confirma vínculos selecionados na prévia histórica, validando sua existência no ano informado e evitando duplicidades.',
    code: `INSERT INTO CR_CONTA (CR_ID, CONTA_ID, ATIVO, CRIADO_EM)
    SELECT DISTINCT
      R.CR_ID,
      R.CONTA_ID,
      true,
      DATE_FORMAT(NOW(), '%Y-%m-%dT%H:%i:%s')
    FROM REALIZADO_CONTABIL R
    JOIN CENTRO_RESULTADO CR ON CR.ID = R.CR_ID AND CR.ATIVO = true
    JOIN CONTA_CONTABIL CC ON CC.ID = R.CONTA_ID AND CC.ATIVO = true
    WHERE R.ANO = {{ano}}
      AND COALESCE(R.VALOR, 0) <> 0
      AND FIND_IN_SET(CONCAT(R.CR_ID, ':', R.CONTA_ID), '{{paresCsv}}') > 0
    ON DUPLICATE KEY UPDATE ATIVO = true`,
  },
];

async function upsert(definition) {
  const response = await listServerFunctionsMitra({ projectId });
  const functions = response?.result || response?.content || response || [];
  const existing = Array.isArray(functions) ? functions.find((item) => item.name === definition.name) : null;
  if (existing) {
    await updateServerFunctionMitra({
      projectId,
      serverFunctionId: existing.id,
      code: definition.code,
      description: definition.description,
    });
    console.log(`Atualizada ${definition.name} (id ${existing.id})`);
    return existing.id;
  }

  const created = await createServerFunctionMitra({ projectId, ...definition });
  const id = created?.result?.serverFunctionId || created?.serverFunctionId || created?.id;
  console.log(`Criada ${definition.name} (id ${id})`);
  return id;
}

const ids = {};
for (const definition of definitions) ids[definition.name] = await upsert(definition);

const preview = await executeServerFunctionMitra({
  projectId,
  serverFunctionId: ids.mapearHistoricoPrevia,
  input: {},
});
let output = preview?.result?.output;
if (typeof output === 'string') output = JSON.parse(output);
console.log(`Prévia validada: ${output?.rowCount ?? output?.rows?.length ?? 0} sugestão(ões).`);
console.log(JSON.stringify(ids));
