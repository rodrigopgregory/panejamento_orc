// Reformulacao da tela de Auditoria (/auditoria).
//
// A tela deixa de ser um feed continuo e vira ferramenta de investigacao:
// filtro por periodo/origem/responsavel, busca que alcanca o comentario,
// contagem total do resultado (pro cabecalho e pra paginacao saber o fim) e
// painel de detalhes com o fluxo relacionado do mesmo objeto.
//
// Tres mudancas no backend, todas aditivas e idempotentes (upsert por nome):
//  1. listarAuditoriaGeral   — novos filtros + CR_ID/DRIVER_ID + total da busca
//  2. listarAuditoriaFluxo   — trilha completa de um objeto dentro de um ciclo
//  3. listarAuditoriaAutores — responsaveis distintos, pra popular o filtro
//
// CRIADO_EM e VARCHAR(19) no formato 'YYYY-MM-DDTHH:mm:ss', entao o recorte de
// periodo compara so os 10 primeiros caracteres (a data) — comparacao lexical
// funciona porque o formato e ordenavel.
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

// COUNT(*) OVER () roda antes do LIMIT, entao devolve o total do filtro inteiro
// e nao o da pagina — e o numero que o cabecalho mostra ("128 eventos").
//
// As colunas de texto sao utf8mb3_bin, colacao binaria: sem tratamento, buscar
// "paula" nao acha "Paula" e "beneficios" nao acha "Benefícios". Numa tela de
// investigacao isso e falha de usabilidade, entao cada comparacao da busca leva
// COLLATE utf8mb4_general_ci, que ignora caixa e acento.
const SQL_GERAL = `SELECT a.ID, a.CICLO_ID, c.NOME AS CICLO_NOME, a.TIPO, a.EVENTO,
  a.STATUS_DE, a.STATUS_PARA, a.COMENTARIO, a.AUTOR, a.ORIGEM, a.CRIADO_EM,
  a.CR_ID, a.DRIVER_ID,
  CASE WHEN a.TIPO = 'CR' THEN CONCAT(cr.CODIGO, ' - ', cr.NOME) ELSE CONCAT('Pacote ', COALESCE(d.NOME, '?')) END AS ALVO,
  COUNT(*) OVER () AS TOTAL_FILTRADO
FROM WORKFLOW_AUDITORIA a
JOIN CICLO c ON c.ID = a.CICLO_ID
LEFT JOIN CENTRO_RESULTADO cr ON cr.ID = a.CR_ID
LEFT JOIN DRIVERS d ON d.ID = a.DRIVER_ID
WHERE ({{cicloId}} = 0 OR a.CICLO_ID = {{cicloId}})
  AND ('{{evento}}' = '' OR a.EVENTO = '{{evento}}')
  AND ('{{tipo}}' = '' OR a.TIPO = '{{tipo}}')
  AND ('{{origem}}' = '' OR a.ORIGEM = '{{origem}}')
  AND ('{{autor}}' = '' OR a.AUTOR = '{{autor}}')
  AND ('{{dataDe}}' = '' OR SUBSTRING(a.CRIADO_EM, 1, 10) >= '{{dataDe}}')
  AND ('{{dataAte}}' = '' OR SUBSTRING(a.CRIADO_EM, 1, 10) <= '{{dataAte}}')
  AND ('{{busca}}' = ''
       OR a.AUTOR      LIKE '%{{busca}}%' COLLATE utf8mb4_general_ci
       OR cr.NOME      LIKE '%{{busca}}%' COLLATE utf8mb4_general_ci
       OR cr.CODIGO    LIKE '%{{busca}}%' COLLATE utf8mb4_general_ci
       OR d.NOME       LIKE '%{{busca}}%' COLLATE utf8mb4_general_ci
       OR a.COMENTARIO LIKE '%{{busca}}%' COLLATE utf8mb4_general_ci)
ORDER BY a.CRIADO_EM DESC, a.ID DESC
LIMIT {{limit}} OFFSET {{offset}}`;

const DESCR_GERAL = 'Trilha de auditoria do workflow com filtros opcionais e total do resultado. '
  + 'Params: cicloId (0=todos), evento (\'\'=todos), tipo (\'\'=todos, CR|PACOTE), origem (\'\'=todas, APP|LINK), '
  + 'autor (\'\'=todos), dataDe/dataAte (\'\'=sem recorte, YYYY-MM-DD), busca (\'\'=sem busca), limit, offset. '
  + 'Retorna TOTAL_FILTRADO com a contagem do filtro inteiro (ignora a paginacao).';

// Fluxo relacionado: todos os eventos do mesmo objeto (um CR ou um pacote)
// dentro do mesmo ciclo, em ordem cronologica. E assim que a tela liga
// submissao -> reprovacao -> reabertura -> reenvio -> aprovacao. Nao ha
// correlationId na tabela; ciclo + objeto identifica o fluxo sem ambiguidade
// porque cada objeto so tem uma trilha por ciclo.
const SQL_FLUXO = `SELECT a.ID, a.EVENTO, a.STATUS_DE, a.STATUS_PARA, a.COMENTARIO,
  a.AUTOR, a.ORIGEM, a.CRIADO_EM
FROM WORKFLOW_AUDITORIA a
WHERE a.CICLO_ID = {{cicloId}}
  AND a.TIPO = '{{tipo}}'
  AND (({{crId}} = 0 AND a.CR_ID IS NULL) OR a.CR_ID = {{crId}})
  AND (({{driverId}} = 0 AND a.DRIVER_ID IS NULL) OR a.DRIVER_ID = {{driverId}})
ORDER BY a.CRIADO_EM ASC, a.ID ASC`;

const DESCR_FLUXO = 'Trilha cronologica completa de um objeto (CR ou pacote) dentro de um ciclo, '
  + 'usada no painel de detalhes da tela de Auditoria. Params: cicloId, tipo (CR|PACOTE), crId (0 se pacote), driverId (0 se CR).';

const SQL_AUTORES = `SELECT DISTINCT AUTOR
FROM WORKFLOW_AUDITORIA
WHERE AUTOR IS NOT NULL AND AUTOR <> ''
ORDER BY AUTOR`;

const DESCR_AUTORES = 'Responsaveis distintos presentes na trilha de auditoria. Sem params. Popula o filtro Responsavel da tela de Auditoria.';

const list = await listServerFunctionsMitra({ projectId });
const fns = Array.isArray(list?.result) ? list.result : Array.isArray(list) ? list : [];

async function upsert(name, code, description) {
  const existing = fns.find((f) => f.name === name);
  if (existing) {
    await updateServerFunctionMitra({ projectId, serverFunctionId: existing.id, code, description });
    console.log(`~ atualizada ${name} id=${existing.id}`);
    return existing.id;
  }
  const r = await createServerFunctionMitra({ projectId, name, type: 'SQL', code, description });
  const id = r?.result?.serverFunctionId ?? r?.result?.id;
  console.log(`+ criada ${name} id=${id}`);
  return id;
}

const idGeral = await upsert('listarAuditoriaGeral', SQL_GERAL, DESCR_GERAL);
const idFluxo = await upsert('listarAuditoriaFluxo', SQL_FLUXO, DESCR_FLUXO);
const idAutores = await upsert('listarAuditoriaAutores', SQL_AUTORES, DESCR_AUTORES);

// ── Smoke tests ─────────────────────────────────────────────────────
async function run(id, input) {
  const r = await executeServerFunctionMitra({ projectId, serverFunctionId: id, input });
  let o = r?.result?.output;
  if (typeof o === 'string') o = JSON.parse(o);
  if (r?.result?.executionStatus !== 'COMPLETED') throw new Error(`SF ${id} falhou: ${r?.result?.error}`);
  return o?.rows || [];
}

const semFiltro = { cicloId: 0, evento: '', tipo: '', origem: '', autor: '', dataDe: '', dataAte: '', busca: '', limit: 5, offset: 0 };

const r1 = await run(idGeral, semFiltro);
console.log('geral sem filtro:', r1.length, 'linhas, TOTAL_FILTRADO =', r1[0]?.TOTAL_FILTRADO);

const r2 = await run(idGeral, { ...semFiltro, evento: 'REPROVADO' });
console.log('filtro evento=REPROVADO:', r2.length, 'linhas, TOTAL_FILTRADO =', r2[0]?.TOTAL_FILTRADO);

const r3 = await run(idGeral, { ...semFiltro, origem: 'LINK' });
console.log('filtro origem=LINK:', r3.length, 'linhas, TOTAL_FILTRADO =', r3[0]?.TOTAL_FILTRADO);

// Sem acento e em caixa trocada de proposito: valida o COLLATE da busca.
const r4 = await run(idGeral, { ...semFiltro, busca: 'BENEFICIOS' });
console.log('busca em comentario (sem acento, maiuscula):', r4.length, 'linhas');
const r4b = await run(idGeral, { ...semFiltro, busca: 'paula' });
console.log('busca por autor (minuscula):', r4b.length, 'linhas, TOTAL_FILTRADO =', r4b[0]?.TOTAL_FILTRADO);

const r5 = await run(idGeral, { ...semFiltro, dataDe: '2026-07-15', dataAte: '2026-07-15' });
console.log('recorte de periodo (15/07):', r5.length, 'linhas, TOTAL_FILTRADO =', r5[0]?.TOTAL_FILTRADO);

const alvo = r1.find((x) => x.TIPO === 'CR' && x.CR_ID);
if (alvo) {
  const r6 = await run(idFluxo, { cicloId: alvo.CICLO_ID, tipo: 'CR', crId: alvo.CR_ID, driverId: 0 });
  console.log(`fluxo do CR ${alvo.CR_ID} no ciclo ${alvo.CICLO_ID}:`, r6.length, 'eventos ->', r6.map((e) => e.EVENTO).join(' > '));
}

const r7 = await run(idAutores, {});
console.log('autores:', r7.map((a) => a.AUTOR).join(', '));

console.log('\nIDs -> geral:', idGeral, '| fluxo:', idFluxo, '| autores:', idAutores);
