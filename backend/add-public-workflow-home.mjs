// Tela publica de preenchimento — replica visual do /workflow (visao gestor).
// Cria SFs PUBLICAS escopadas por token (mesmo modelo de seguranca do
// secure-public-preenchimento.mjs): a autorizacao e derivada do token no proprio
// SQL (JOIN em PREENCHIMENTO_TOKEN), nunca de IDs vindos do cliente.
// Padrao "1 ida so": blocos JSON numa unica SF SQL (como as SFs hot 120-138).
//
//   publicHome         (token, agora)   -> CTX + CRS (status/progresso) + PACOTES (status/progresso)
//   publicAbrirCR      (token, crId)    -> CONTAS (config) + VALORES numa ida
//   publicPacoteDetalhe(token, pacoteId)-> valores agregados do pacote (leitura)
//
// Aditivo e idempotente — nao toca nas SFs publicas existentes (69/70/72-75).
import 'dotenv/config';
import {
  configureSdkMitra,
  createServerFunctionMitra,
  updateServerFunctionMitra,
  listServerFunctionsMitra,
  togglePublicExecutionMitra,
  executeServerFunctionMitra,
} from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});
const projectId = parseInt(process.env.MITRA_PROJECT_ID);

async function upsertSF({ name, type, code, description, isPublic }) {
  const all = await listServerFunctionsMitra({ projectId });
  const list = all?.result || all?.content || all || [];
  const existing = Array.isArray(list) ? list.find((s) => s.name === name) : null;
  let id;
  if (existing) {
    await updateServerFunctionMitra({ projectId, serverFunctionId: existing.id, code, description });
    id = existing.id;
    console.log(`  ~ atualizada ${name} (id ${id})`);
  } else {
    const res = await createServerFunctionMitra({ projectId, name, type, code, description });
    id = res?.result?.serverFunctionId || res?.serverFunctionId || res?.id;
    console.log(`  + criada ${name} (id ${id})`);
  }
  if (isPublic) {
    await togglePublicExecutionMitra({ projectId, serverFunctionId: id, publicExecution: true });
    console.log(`    -> marcada PUBLICA`);
  }
  return id;
}

// Conta itens num CSV "1,2,3" (0 quando NULL/vazio) — mesmo calculo do WorkflowPage.
const csvCount = (col) =>
  `CASE WHEN ${col} IS NULL OR ${col} = '' THEN 0 ELSE LENGTH(${col}) - LENGTH(REPLACE(${col}, ',', '')) + 1 END`;

// Total de modelos vivos por CR — mesma logica da SF kanbanModelosPorCiclo.
// Pacotes ficam FORA do denominador do CR: conta delegada a pacote e submetida
// pelo gestor do pacote (card proprio) e nao trava a completude do CR.
const MODELOS_POR_CR = `SELECT crc.CR_ID, COUNT(DISTINCT d.NOME) AS TOTAL
  FROM CR_CONTA crc
  LEFT JOIN CONTA_DRIVER_EXCECAO cde ON cde.CR_ID = crc.CR_ID AND cde.CONTA_ID = crc.CONTA_ID AND cde.ATIVO = true
  LEFT JOIN CONTA_DRIVER cd ON cd.CONTA_ID = crc.CONTA_ID
  LEFT JOIN DRIVERS d ON d.ID = COALESCE(cde.PACOTE_ID, cd.PACOTE_ID, cde.DRIVER_ID, cd.DRIVER_ID)
  WHERE crc.ATIVO = true AND d.ID IS NOT NULL AND d.ATIVO = 'true' AND d.TIPO_DRIVER = 'NORMAL'
  GROUP BY crc.CR_ID`;

// Total de modelos NORMAL por pacote — mesma logica da SF kanbanPacoteTotais.
const MODELOS_POR_PACOTE = `SELECT COALESCE(cde.PACOTE_ID, cd.PACOTE_ID, cde.DRIVER_ID, cd.DRIVER_ID) AS PACOTE_ID,
       COUNT(DISTINCT modelo.ID) AS TOTAL
  FROM CR_CONTA crc
  LEFT JOIN CONTA_DRIVER_EXCECAO cde ON cde.CR_ID = crc.CR_ID AND cde.CONTA_ID = crc.CONTA_ID AND cde.ATIVO = true
  LEFT JOIN CONTA_DRIVER cd ON cd.CONTA_ID = crc.CONTA_ID
  LEFT JOIN DRIVERS modelo ON modelo.ID = COALESCE(cde.DRIVER_ID, cd.DRIVER_ID) AND modelo.TIPO_DRIVER = 'NORMAL'
  WHERE crc.ATIVO = true AND modelo.ID IS NOT NULL
  GROUP BY COALESCE(cde.PACOTE_ID, cd.PACOTE_ID, cde.DRIVER_ID, cd.DRIVER_ID)`;

const CODE_HOME = `SELECT
  COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT(
      'CICLO_ID', x.CICLO_ID, 'GESTOR_ID', x.GESTOR_ID, 'GESTOR_NOME', x.GESTOR_NOME,
      'CICLO_NOME', x.CICLO_NOME, 'CICLO_ANO', x.CICLO_ANO))
    FROM (
      SELECT t.CICLO_ID, t.GESTOR_ID, g.NOME AS GESTOR_NOME, c.NOME AS CICLO_NOME, c.ANO AS CICLO_ANO
      FROM PREENCHIMENTO_TOKEN t
      JOIN GESTOR g ON g.ID = t.GESTOR_ID
      JOIN CICLO c ON c.ID = t.CICLO_ID
      WHERE t.TOKEN = '{{token}}' AND t.ATIVO = 'true'
        AND (t.EXPIRA_EM IS NULL OR t.EXPIRA_EM >= '{{agora}}')
      ORDER BY t.ID DESC LIMIT 1
    ) x), JSON_ARRAY()) AS CTX,
  COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT(
      'CR_ID', x.CR_ID, 'CODIGO', x.CODIGO, 'NOME', x.NOME, 'STATUS', x.STATUS,
      'COMENTARIO', x.COMENTARIO, 'FILLED', x.FILLED, 'TOTAL', x.TOTAL))
    FROM (
      SELECT cr.ID AS CR_ID, cr.CODIGO, cr.NOME,
             COALESCE(os.STATUS, 'PENDENTE') AS STATUS, os.COMENTARIO,
             ${csvCount('os.DRIVERS_CONFIRMADOS')} AS FILLED,
             COALESCE(os.TOTAL_MODELOS, mt.TOTAL, 0) AS TOTAL
      FROM PREENCHIMENTO_TOKEN t
      JOIN GESTOR_CR gc ON gc.GESTOR_ID = t.GESTOR_ID
      JOIN CENTRO_RESULTADO cr ON cr.ID = gc.CR_ID AND cr.ATIVO = 'true'
      LEFT JOIN ORCAMENTO_STATUS os
        ON os.CICLO_ID = t.CICLO_ID AND os.GESTOR_ID = t.GESTOR_ID AND os.CR_ID = cr.ID
      LEFT JOIN (${MODELOS_POR_CR}) mt ON mt.CR_ID = cr.ID
      WHERE t.TOKEN = '{{token}}' AND t.ATIVO = 'true'
    ) x), JSON_ARRAY()) AS CRS,
  COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT(
      'STATUS_ID', x.STATUS_ID, 'DRIVER_ID', x.DRIVER_ID, 'NOME', x.NOME, 'DESCRICAO', x.DESCRICAO,
      'STATUS', x.STATUS, 'COMENTARIO', x.COMENTARIO, 'FILLED', x.FILLED, 'TOTAL', x.TOTAL))
    FROM (
      SELECT ps.ID AS STATUS_ID, ps.DRIVER_ID, d.NOME, d.DESCRICAO,
             COALESCE(ps.STATUS, 'PENDENTE') AS STATUS, ps.COMENTARIO,
             ${csvCount('ps.DRIVERS_CONFIRMADOS')} AS FILLED,
             COALESCE(ps.TOTAL_MODELOS, pt.TOTAL, 0) AS TOTAL
      FROM PREENCHIMENTO_TOKEN t
      JOIN PACOTE_STATUS ps ON ps.CICLO_ID = t.CICLO_ID AND ps.GESTOR_ID = t.GESTOR_ID
      JOIN DRIVERS d ON d.ID = ps.DRIVER_ID
      LEFT JOIN (${MODELOS_POR_PACOTE}) pt ON pt.PACOTE_ID = ps.DRIVER_ID
      WHERE t.TOKEN = '{{token}}' AND t.ATIVO = 'true'
    ) x), JSON_ARRAY()) AS PACOTES`;

const CODE_ABRIR_CR = `SELECT
  COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT(
      'CONTA_ID', x.CONTA_ID, 'CODIGO', x.CODIGO, 'CONTA_NOME', x.CONTA_NOME,
      'TIPO', x.TIPO, 'DRIVER_TIPO', x.DRIVER_TIPO))
    FROM (
      SELECT cc.ID AS CONTA_ID, cc.CODIGO, cc.NOME AS CONTA_NOME, cc.TIPO, d.NOME AS DRIVER_TIPO
      FROM PREENCHIMENTO_TOKEN t
      JOIN GESTOR_CR gc ON gc.GESTOR_ID = t.GESTOR_ID AND gc.CR_ID = {{crId}}
      JOIN CR_CONTA crc ON crc.CR_ID = gc.CR_ID AND crc.ATIVO = true
      JOIN CONTA_CONTABIL cc ON cc.ID = crc.CONTA_ID
      LEFT JOIN CONTA_DRIVER_EXCECAO cde
        ON cde.CR_ID = crc.CR_ID AND cde.CONTA_ID = crc.CONTA_ID AND cde.ATIVO = true
      LEFT JOIN CONTA_DRIVER cd ON cd.CONTA_ID = crc.CONTA_ID
      LEFT JOIN DRIVERS d ON d.ID = COALESCE(cde.DRIVER_ID, cd.DRIVER_ID)
      WHERE t.TOKEN = '{{token}}' AND t.ATIVO = 'true'
        AND d.ID IS NOT NULL AND d.ATIVO = 'true'
    ) x), JSON_ARRAY()) AS CONTAS,
  COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('CONTA_ID', x.CONTA_ID, 'MES', x.MES, 'VALOR', x.VALOR))
    FROM (
      SELECT o.CONTA_ID, o.MES, SUM(o.VALOR) AS VALOR
      FROM PREENCHIMENTO_TOKEN t
      JOIN GESTOR_CR gc ON gc.GESTOR_ID = t.GESTOR_ID AND gc.CR_ID = {{crId}}
      JOIN ORCAMENTO o ON o.CICLO_ID = t.CICLO_ID AND o.CR_ID = gc.CR_ID
      WHERE t.TOKEN = '{{token}}' AND t.ATIVO = 'true'
      GROUP BY o.CONTA_ID, o.MES
    ) x), JSON_ARRAY()) AS VALORES`;

const CODE_PACOTE = `SELECT cc.ID AS CONTA_ID, cc.CODIGO, cc.NOME AS CONTA_NOME, op.MES, SUM(op.VALOR) AS VALOR
FROM PREENCHIMENTO_TOKEN t
JOIN PACOTE_STATUS ps ON ps.CICLO_ID = t.CICLO_ID AND ps.GESTOR_ID = t.GESTOR_ID AND ps.DRIVER_ID = {{pacoteId}}
JOIN ORCAMENTO_PACOTE op ON op.CICLO_ID = t.CICLO_ID AND op.DRIVER_ID = ps.DRIVER_ID
JOIN CONTA_CONTABIL cc ON cc.ID = op.CONTA_ID
WHERE t.TOKEN = '{{token}}' AND t.ATIVO = 'true'
GROUP BY cc.ID, cc.CODIGO, cc.NOME, op.MES`;

async function run() {
  console.log('[1] SFs publicas da tela de preenchimento (visual workflow)...');
  const homeId = await upsertSF({
    name: 'publicHome', type: 'SQL', isPublic: true,
    description: 'Home publica: contexto + cards de CRs e pacotes com status/progresso, escopado por token (params: token, agora)',
    code: CODE_HOME,
  });
  const abrirId = await upsertSF({
    name: 'publicAbrirCR', type: 'SQL', isPublic: true,
    description: 'Abre um CR publico numa ida: config de contas + valores, escopado por token (params: token, crId)',
    code: CODE_ABRIR_CR,
  });
  const pacoteId = await upsertSF({
    name: 'publicPacoteDetalhe', type: 'SQL', isPublic: true,
    description: 'Valores agregados de um pacote do gestor (leitura), escopado por token (params: token, pacoteId)',
    code: CODE_PACOTE,
  });

  console.log('\n[2] Smoke test com token real...');
  const tokRes = await executeServerFunctionMitra({
    projectId, serverFunctionId: 76,
    input: { sql: "SELECT TOKEN, CICLO_ID, GESTOR_ID FROM PREENCHIMENTO_TOKEN WHERE ATIVO = 'true' ORDER BY ID DESC LIMIT 1" },
  });
  let tout = tokRes?.result?.output; if (typeof tout === 'string') tout = JSON.parse(tout);
  const tok = tout?.rows?.[0];
  if (!tok) { console.log('  (nenhum token ativo para testar)'); }
  else {
    const agora = new Date().toISOString().slice(0, 19);
    const h = await executeServerFunctionMitra({ projectId, serverFunctionId: homeId, input: { token: tok.TOKEN, agora } });
    let ho = h?.result?.output; if (typeof ho === 'string') ho = JSON.parse(ho);
    const row = ho?.rows?.[0] || {};
    const p = (v) => (typeof v === 'string' ? JSON.parse(v) : v) || [];
    const ctx = p(row.CTX), crs = p(row.CRS), pacotes = p(row.PACOTES);
    console.log(`  publicHome: ctx=${ctx.length} crs=${crs.length} pacotes=${pacotes.length}`);
    if (ctx.length !== 1) throw new Error('CTX deveria ter 1 linha');
    if (crs.length > 0) {
      const a = await executeServerFunctionMitra({ projectId, serverFunctionId: abrirId, input: { token: tok.TOKEN, crId: crs[0].CR_ID } });
      let ao = a?.result?.output; if (typeof ao === 'string') ao = JSON.parse(ao);
      const arow = ao?.rows?.[0] || {};
      console.log(`  publicAbrirCR(cr=${crs[0].CR_ID}): contas=${p(arow.CONTAS).length} valores=${p(arow.VALORES).length}`);
    }
    if (pacotes.length > 0) {
      const d = await executeServerFunctionMitra({ projectId, serverFunctionId: pacoteId, input: { token: tok.TOKEN, pacoteId: pacotes[0].DRIVER_ID } });
      let dout = d?.result?.output; if (typeof dout === 'string') dout = JSON.parse(dout);
      console.log(`  publicPacoteDetalhe(pkg=${pacotes[0].DRIVER_ID}): linhas=${dout?.rowCount ?? dout?.rows?.length}`);
    }
    // Token invalido => zero linhas em todos os blocos
    const bad = await executeServerFunctionMitra({ projectId, serverFunctionId: homeId, input: { token: '00000000-0000-0000-0000-000000000000', agora } });
    let bo = bad?.result?.output; if (typeof bo === 'string') bo = JSON.parse(bo);
    const brow = bo?.rows?.[0] || {};
    const bctx = p(brow.CTX), bcrs = p(brow.CRS), bpac = p(brow.PACOTES);
    if (bctx.length || bcrs.length || bpac.length) throw new Error('token invalido vazou dados!');
    console.log('  token invalido: 0 linhas em todos os blocos (OK)');
  }

  console.log(`\n=== IDs: publicHome=${homeId} publicAbrirCR=${abrirId} publicPacoteDetalhe=${pacoteId} ===`);
}

run().catch((e) => { console.error('ERRO:', e?.message || e); process.exit(1); });
