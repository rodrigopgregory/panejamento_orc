import 'dotenv/config';
import {
  configureSdkMitra,
  listServerFunctionsMitra,
  updateServerFunctionMitra,
} from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_SPACE || process.env.MITRA_BASE_URL_INTEGRATIONS,
});

const projectId = Number(process.env.MITRA_PROJECT_ID);

const empresaFilter = `('{{empresaId}}' = '' OR rc.EMPRESA_ID = NULLIF('{{empresaId}}', ''))`;
const crFilter = `('{{crIds}}' = '' OR FIND_IN_SET(rc.CR_ID, '{{crIds}}'))`;
const lancamentoFilters = `AND ('{{meses}}' = '' OR FIND_IN_SET(rc.MES, '{{meses}}'))
  AND ('{{tipos}}' = '' OR FIND_IN_SET(cc.TIPO, '{{tipos}}'))
  AND ('{{busca}}' = '' OR cc.CODIGO LIKE '%{{busca}}%' OR cc.NOME LIKE '%{{busca}}%'
       OR cr.CODIGO LIKE '%{{busca}}%' OR cr.NOME LIKE '%{{busca}}%' OR e.NOME LIKE '%{{busca}}%')`;

// Ordenacao da tabela de lancamentos. A tela e paginada no banco (LIMIT/OFFSET),
// entao ordenar no navegador ordenaria so as 100 linhas da pagina — "maior valor"
// devolveria o maior DA PAGINA, nao o maior de todos. Por isso o ORDER BY vem daqui.
//
// O par de CASE por coluna e o jeito seguro de ter ORDER BY dinamico numa SF SQL:
// o nome da coluna nunca vem do cliente, so um rotulo comparado por igualdade.
// A expressao que nao casa devolve NULL para todas as linhas e vira um no-op.
const ordenacao = ['periodo', 'empresa', 'setor', 'conta', 'tipo', 'valor']
  .map((campo) => {
    const expressao = {
      periodo: 'rc.ANO * 100 + rc.MES',
      empresa: 'e.NOME',
      setor: 'cr.CODIGO',
      conta: 'cc.CODIGO',
      tipo: 'cc.TIPO',
      valor: 'rc.VALOR',
    }[campo];
    return ['asc', 'desc']
      .map((dir) => `CASE WHEN '{{ordemCampo}}' = '${campo}' AND '{{ordemDir}}' = '${dir}' THEN ${expressao} END ${dir.toUpperCase()}`)
      .join(',\n       ');
  })
  .join(',\n       ');

// rc.ID fecha a ordenacao: sem um criterio unico, duas linhas empatadas podem
// trocar de lugar entre uma pagina e outra, fazendo registro sumir ou repetir.
const ordemLancamentos = `ORDER BY
       ${ordenacao},
       rc.MES DESC, cc.CODIGO, cr.CODIGO, rc.ID`;

const definitions = {
  hotResultadoBase: {
    code: `SELECT
      COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('ID',cr.ID,'CODIGO',cr.CODIGO,'NOME',cr.NOME,'EMPRESA_ID',cr.EMPRESA_ID,'ATIVO',cr.ATIVO)) FROM CENTRO_RESULTADO cr WHERE cr.ATIVO = 'true'),JSON_ARRAY()) AS CRS,
      COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('ID',e.ID,'NOME',e.NOME,'ATIVO',e.ATIVO)) FROM EMPRESA e),JSON_ARRAY()) AS EMPRESAS,
      COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('ANO',x.ANO)) FROM (SELECT DISTINCT ANO FROM REALIZADO_CONTABIL) x),JSON_ARRAY()) AS ANOS,
      COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('ID',d.ID,'NOME_LINHA',d.NOME_LINHA,'PREFIXO_CONTA',d.PREFIXO_CONTA,'ORDEM',d.ORDEM,'SINAL',d.SINAL,'IS_SUBTOTAL',d.IS_SUBTOTAL)) FROM DRE_CONFIG d),JSON_ARRAY()) AS DRE_CONFIG,
      COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('ID',c.ID,'CODIGO',c.CODIGO,'NOME',c.NOME,'TIPO',c.TIPO)) FROM CONTA_CONTABIL c),JSON_ARRAY()) AS CONTAS`,
    description: 'Base da tela Resultado Contabil em uma ida: CRs, empresas, anos, DRE e contas.',
  },
  realizadoAgregado: {
    code: `SELECT rc.EMPRESA_ID, e.NOME AS EMPRESA_NOME, rc.CONTA_ID, rc.CR_ID, rc.MES, SUM(rc.VALOR) AS VALOR,
       cc.CODIGO AS CONTA_CODIGO, cc.NOME AS CONTA_NOME, cc.TIPO AS CONTA_TIPO,
       cr.CODIGO AS CR_CODIGO, cr.NOME AS CR_NOME
     FROM REALIZADO_CONTABIL rc
     JOIN EMPRESA e ON e.ID = rc.EMPRESA_ID
     JOIN CONTA_CONTABIL cc ON cc.ID = rc.CONTA_ID
     JOIN CENTRO_RESULTADO cr ON cr.ID = rc.CR_ID
     WHERE rc.ANO = {{ano}} AND ${empresaFilter} AND ${crFilter}
     GROUP BY rc.EMPRESA_ID, e.NOME, rc.CONTA_ID, rc.CR_ID, rc.MES, cc.CODIGO, cc.NOME, cc.TIPO, cr.CODIGO, cr.NOME
     ORDER BY cc.CODIGO, rc.MES`,
    description: 'Realizado agregado por empresa/conta/CR/mes. Params: ano, empresaId e crIds (opcionais).',
  },
  realizadoLancamentos: {
    code: `SELECT rc.ID, rc.EMPRESA_ID, e.NOME AS EMPRESA_NOME, rc.CR_ID, rc.CONTA_ID, rc.ANO, rc.MES, rc.VALOR,
       cc.CODIGO AS CONTA_CODIGO, cc.NOME AS CONTA_NOME, cc.TIPO AS CONTA_TIPO,
       cr.CODIGO AS CR_CODIGO, cr.NOME AS CR_NOME
     FROM REALIZADO_CONTABIL rc
     JOIN EMPRESA e ON e.ID = rc.EMPRESA_ID
     JOIN CONTA_CONTABIL cc ON cc.ID = rc.CONTA_ID
     JOIN CENTRO_RESULTADO cr ON cr.ID = rc.CR_ID
     WHERE rc.ANO = {{ano}} AND ${empresaFilter} AND ${crFilter} ${lancamentoFilters}
     ${ordemLancamentos}
     LIMIT {{limit}} OFFSET {{offset}}`,
    description: 'Lancamentos contabeis paginados. Params: ano, empresaId, crIds, meses, tipos, busca, limit e offset. Ordenacao opcional via ordemCampo (periodo|empresa|setor|conta|tipo|valor) e ordemDir (asc|desc); vazio mantem a ordem padrao.',
  },
  realizadoLancamentosResumo: {
    code: `SELECT COUNT(*) AS TOTAL, COALESCE(SUM(rc.VALOR),0) AS SOMA
     FROM REALIZADO_CONTABIL rc
     JOIN EMPRESA e ON e.ID = rc.EMPRESA_ID
     JOIN CONTA_CONTABIL cc ON cc.ID = rc.CONTA_ID
     JOIN CENTRO_RESULTADO cr ON cr.ID = rc.CR_ID
     WHERE rc.ANO = {{ano}} AND ${empresaFilter} AND ${crFilter} ${lancamentoFilters}`,
    description: 'Contagem e soma dos lancamentos contabeis filtrados por empresa e demais dimensoes.',
  },
};

// --dry-run imprime o SQL final sem tocar no projeto. A SF roda em producao:
// vale conferir o texto gerado antes de publicar qualquer alteracao.
if (process.argv.includes('--dry-run')) {
  for (const [name, definition] of Object.entries(definitions)) {
    console.log(`\n===== ${name} =====\n${definition.code}`);
  }
  process.exit(0);
}

const response = await listServerFunctionsMitra({ projectId });
const functions = response?.result || response || [];

for (const [name, definition] of Object.entries(definitions)) {
  const fn = functions.find((item) => item.name === name);
  if (!fn) throw new Error(`Server Function nao encontrada: ${name}`);
  const serverFunctionId = fn.id ?? fn.serverFunctionId;
  await updateServerFunctionMitra({ projectId, serverFunctionId, ...definition });
  console.log(`Atualizada: ${name} (${serverFunctionId})`);
}
