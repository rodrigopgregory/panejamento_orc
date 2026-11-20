import 'dotenv/config';
import { configureSdkMitra, createServerFunctionMitra, listServerFunctionsMitra } from 'mitra-sdk';
configureSdkMitra({ baseURL: process.env.MITRA_BASE_URL, token: process.env.MITRA_TOKEN, integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS });
const projectId = parseInt(process.env.MITRA_PROJECT_ID);

// Filtros comuns (ano obrigatorio, crIds opcional CSV numerico)
const CR = `('{{crIds}}' = '' OR FIND_IN_SET(rc.CR_ID, '{{crIds}}'))`;
// Filtros extra da visao lancamentos (meses CSV, tipos CSV de string, busca texto ja escapada)
const EXTRA = `AND ('{{meses}}' = '' OR FIND_IN_SET(rc.MES, '{{meses}}'))
  AND ('{{tipos}}' = '' OR FIND_IN_SET(cc.TIPO, '{{tipos}}'))
  AND ('{{busca}}' = '' OR cc.CODIGO LIKE '%{{busca}}%' OR cc.NOME LIKE '%{{busca}}%'
       OR cr.CODIGO LIKE '%{{busca}}%' OR cr.NOME LIKE '%{{busca}}%')`;

// 1) Agregado por (conta, CR, mes) — alimenta visoes conta/tipo/DRE/summary. SUM no banco.
await createServerFunctionMitra({ projectId, name: 'realizadoAgregado', type: 'SQL',
  code: `SELECT rc.CONTA_ID, rc.CR_ID, rc.MES, SUM(rc.VALOR) AS VALOR,
       cc.CODIGO AS CONTA_CODIGO, cc.NOME AS CONTA_NOME, cc.TIPO AS CONTA_TIPO,
       cr.CODIGO AS CR_CODIGO, cr.NOME AS CR_NOME
     FROM REALIZADO_CONTABIL rc
     JOIN CONTA_CONTABIL cc ON cc.ID = rc.CONTA_ID
     JOIN CENTRO_RESULTADO cr ON cr.ID = rc.CR_ID
     WHERE rc.ANO = {{ano}} AND ${CR}
     GROUP BY rc.CONTA_ID, rc.CR_ID, rc.MES, cc.CODIGO, cc.NOME, cc.TIPO, cr.CODIGO, cr.NOME
     ORDER BY cc.CODIGO, rc.MES`,
  description: 'Realizado agregado por conta/CR/mes (SUM no banco). Params: ano, crIds (CSV opcional).' });

// 2) Lancamentos crus paginados + filtrados (mes/tipo/busca no WHERE)
await createServerFunctionMitra({ projectId, name: 'realizadoLancamentos', type: 'SQL',
  code: `SELECT rc.ID, rc.CR_ID, rc.CONTA_ID, rc.ANO, rc.MES, rc.VALOR,
       cc.CODIGO AS CONTA_CODIGO, cc.NOME AS CONTA_NOME, cc.TIPO AS CONTA_TIPO,
       cr.CODIGO AS CR_CODIGO, cr.NOME AS CR_NOME
     FROM REALIZADO_CONTABIL rc
     JOIN CONTA_CONTABIL cc ON cc.ID = rc.CONTA_ID
     JOIN CENTRO_RESULTADO cr ON cr.ID = rc.CR_ID
     WHERE rc.ANO = {{ano}} AND ${CR} ${EXTRA}
     ORDER BY rc.MES DESC, cc.CODIGO, cr.CODIGO
     LIMIT {{limit}} OFFSET {{offset}}`,
  description: 'Lancamentos realizados paginados+filtrados. Params: ano, crIds, meses, tipos, busca, limit, offset.' });

// 3) Resumo da visao lancamentos: total de linhas + soma (para paginacao e rodape) sobre TODO o filtro
await createServerFunctionMitra({ projectId, name: 'realizadoLancamentosResumo', type: 'SQL',
  code: `SELECT COUNT(*) AS TOTAL, COALESCE(SUM(rc.VALOR),0) AS SOMA
     FROM REALIZADO_CONTABIL rc
     JOIN CONTA_CONTABIL cc ON cc.ID = rc.CONTA_ID
     JOIN CENTRO_RESULTADO cr ON cr.ID = rc.CR_ID
     WHERE rc.ANO = {{ano}} AND ${CR} ${EXTRA}`,
  description: 'Resumo lancamentos (COUNT + SUM) sobre todo o filtro. Params: ano, crIds, meses, tipos, busca.' });

const list = await listServerFunctionsMitra({ projectId });
const fns = (list.result || list);
for (const n of ['realizadoAgregado','realizadoLancamentos','realizadoLancamentosResumo']) console.log(n, '=>', fns.find(x=>x.name===n)?.id);
