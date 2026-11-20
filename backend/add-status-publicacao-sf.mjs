// Script pontual: cria a SF de status de publicação dos modelos (read-only).
// Retorna, por driver, as linhas atuais do desenho e o último snapshot publicado,
// para o Mapeamento detectar "alterações não publicadas" na lista de modelos.
import 'dotenv/config';
import { configureSdkMitra, createServerFunctionMitra, listServerFunctionsMitra } from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});

const projectId = parseInt(process.env.MITRA_PROJECT_ID);

const code = `SELECT
  d.ID AS DRIVER_ID,
  COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('CODIGO',f.CODIGO,'TIPO',f.TIPO,'FORMULA',f.FORMULA,'CONTA_ID',f.CONTA_ID,'ESCONDER',f.ESCONDER,'NEGRITO',f.NEGRITO,'FORMATO',f.FORMATO,'GRANULARIDADE',f.GRANULARIDADE,'RATEIO_ID',f.RATEIO_ID,'ORDEM',f.ORDEM)) FROM DRIVER_FORMULA f WHERE f.DRIVER_ID = d.ID), JSON_ARRAY()) AS LINHAS,
  (SELECT v.SNAPSHOT FROM DRIVER_VERSAO v WHERE v.DRIVER_ID = d.ID ORDER BY v.NUMERO DESC LIMIT 1) AS SNAPSHOT
FROM DRIVERS d
WHERE d.ATIVO = 'true'`;

const existing = await listServerFunctionsMitra({ projectId });
const already = (existing?.result || existing || []).find((s) => s.name === 'statusPublicacaoModelos');
if (already) {
  console.log('SF já existe: id', already.id);
} else {
  const res = await createServerFunctionMitra({
    projectId,
    name: 'statusPublicacaoModelos',
    type: 'SQL',
    code,
    description: 'Por driver: linhas atuais do desenho + último snapshot publicado, para detectar alterações não publicadas',
  });
  console.log('SF criada:', JSON.stringify(res?.result || res));
}

const after = await listServerFunctionsMitra({ projectId });
const sf = (after?.result || after || []).find((s) => s.name === 'statusPublicacaoModelos');
console.log('ID final da SF:', sf?.id);
