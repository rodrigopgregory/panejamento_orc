/**
 * Corrige a consolidacao da folha no ORCAMENTO (o "lancar projetado final").
 *
 * PROBLEMA 1 — tabela legada. As SFs 60 (pessoalLimparOrcamento) e 61
 * (pessoalGravarOrcamento) resolviam "quais contas sao de pessoal" pela tabela
 * legada DRIVER_CONFIG. O sistema migrou para CR_CONTA + CONTA_DRIVER(+EXCECAO)
 * e hoje DRIVER_CONFIG nao tem NENHUMA linha com DRIVER_TIPO='PESSOAL'. Como a
 * SF 61 e um INSERT..SELECT com JOIN nessa tabela, ela inseria ZERO linhas sem
 * lancar erro: a tela dizia "cálculo concluído", ORCAMENTO_PESSOAL era gravada
 * (a Projecao Mensal aparecia certa) e nada chegava ao ORCAMENTO — que e a fonte
 * do grafico de Pessoal e do DRE por setor. Falha silenciosa.
 *
 * PROBLEMA 2 — contas hardcoded desalinhadas do plano de contas. As SFs lancavam
 * em '5.1.01','5.1.02','5.1.03'. Mas 5.1.01 NAO tem driver PESSOAL em nenhum CR
 * (quem tem e 5.1.01.01), e o grafico so soma contas com driver PESSOAL. Logo os
 * salarios — a maior parcela — ficariam invisiveis mesmo com o insert rodando.
 *
 * CORRECAO: as contas de destino passam a ser resolvidas pelo mapeamento vivo
 * (CR_CONTA x CONTA_DRIVER x CONTA_DRIVER_EXCECAO x DRIVERS, driver 'PESSOAL'),
 * restrito ao CR, nos destinos confirmados pelo usuario:
 *     SALARIO    -> 5.1.01.01 (Salarios e Ordenados)
 *     ENCARGOS   -> 5.1.02    (Encargos Sociais)
 *     BENEFICIOS -> 5.1.03    (Beneficios)
 * Assim tudo cai em conta que o grafico e o DRE enxergam.
 *
 * A limpeza (SF 60) apaga os destinos novos E as contas legadas ('5.1.01',
 * '5.1.02','5.1.03') no mesmo ciclo+CR — senao o valor antigo de 5.1.01 ficaria
 * para tras e duplicaria com o novo lancamento em 5.1.01.01 no DRE.
 *
 * Alcance: SF 60, SF 61 (rota interna) e o op 'pessoalRecalc' da SF 147 (rota
 * publica do link do gestor), que replica as mesmas SQLs token-escopadas.
 */
import 'dotenv/config';
import { configureSdkMitra, readServerFunctionMitra, updateServerFunctionMitra, executeServerFunctionMitra } from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});
const projectId = parseInt(process.env.MITRA_PROJECT_ID);

// Destinos confirmados com o usuario. Mantidos explicitos (e nao por prefixo)
// para o lancamento ser previsivel e auditavel: uma mudanca de plano de contas
// deve ser uma alteracao consciente aqui, nao um efeito colateral silencioso.
const DESTINOS = "'5.1.01.01','5.1.02','5.1.03'";
const LEGADAS = "'5.1.01','5.1.02','5.1.03'";

// Resolve CONTA_ID + bloco da folha pelo mapeamento vivo, no escopo do CR.
// {CR} e trocado pelo placeholder do CR conforme a rota (SQL ou JS).
const contasVivas = (CR) => `
  SELECT cc.ID AS CONTA_ID,
         CASE cc.CODIGO WHEN '5.1.01.01' THEN 'SAL' WHEN '5.1.02' THEN 'ENC' WHEN '5.1.03' THEN 'BEN' END AS BLOCO
  FROM CR_CONTA rc
  JOIN CONTA_CONTABIL cc ON cc.ID = rc.CONTA_ID
  LEFT JOIN CONTA_DRIVER_EXCECAO cde ON cde.CR_ID = rc.CR_ID AND cde.CONTA_ID = rc.CONTA_ID AND cde.ATIVO = true
  LEFT JOIN CONTA_DRIVER cd ON cd.CONTA_ID = rc.CONTA_ID
  LEFT JOIN DRIVERS d ON d.ID = COALESCE(cde.DRIVER_ID, cd.DRIVER_ID)
  WHERE rc.CR_ID = ${CR} AND rc.ATIVO = true AND d.NOME = 'PESSOAL'
    AND cc.CODIGO IN (${DESTINOS})`.trim();

// ─────────────────────────── SF 60 — limpar ORCAMENTO ───────────────────────────
const SQL_60 = `DELETE FROM ORCAMENTO
WHERE CICLO_ID = {{cicloId}} AND CR_ID = {{crId}}
  AND CONTA_ID IN (
    SELECT CONTA_ID FROM (
      ${contasVivas('{{crId}}')}
      UNION
      SELECT cl.ID AS CONTA_ID, 'LEGADA' AS BLOCO FROM CONTA_CONTABIL cl WHERE cl.CODIGO IN (${LEGADAS})
    ) alvo
  )`;

// ────────────────────────── SF 61 — gravar no ORCAMENTO ─────────────────────────
const SQL_61 = `INSERT INTO ORCAMENTO (CICLO_ID, CR_ID, CONTA_ID, MES, VALOR)
SELECT op.CICLO_ID, op.CR_ID, pc.CONTA_ID, op.MES,
  ROUND(SUM(CASE pc.BLOCO WHEN 'SAL' THEN op.SALARIO WHEN 'ENC' THEN op.ENCARGOS WHEN 'BEN' THEN op.BENEFICIOS ELSE 0 END), 2)
FROM ORCAMENTO_PESSOAL op
JOIN (
  ${contasVivas('{{crId}}')}
) pc ON 1 = 1
WHERE op.CICLO_ID = {{cicloId}} AND op.CR_ID = {{crId}}
GROUP BY op.CICLO_ID, op.CR_ID, pc.CONTA_ID, pc.BLOCO, op.MES`;

async function main() {
  // ── rota interna ──
  await updateServerFunctionMitra({
    projectId, serverFunctionId: 60, code: SQL_60,
    description: 'Limpa contas de pessoal do ORCAMENTO (ciclo+CR) antes de regravar a folha. Contas pelo mapeamento vivo (CR_CONTA x CONTA_DRIVER, driver PESSOAL) + contas legadas 5.1.01/02/03 p/ nao deixar residuo. Params: cicloId, crId.',
  });
  console.log('SF 60 atualizada.');

  await updateServerFunctionMitra({
    projectId, serverFunctionId: 61, code: SQL_61,
    description: 'Lanca a folha projetada no ORCAMENTO agregando ORCAMENTO_PESSOAL. Destinos pelo mapeamento vivo (driver PESSOAL): SALARIO->5.1.01.01, ENCARGOS->5.1.02, BENEFICIOS->5.1.03. Params: cicloId, crId.',
  });
  console.log('SF 61 atualizada.');

  // ── rota publica (SF 147, JAVASCRIPT) ──
  const cur = await readServerFunctionMitra({ projectId, serverFunctionId: 147 });
  let code = cur?.result?.code || '';
  if (!code) throw new Error('SF 147 sem codigo — abortando');

  const OLD_CONTAS = `const CONTAS_PESSOAL = "SELECT DISTINCT dck.CONTA_ID FROM DRIVER_CONFIG dck JOIN CONTA_CONTABIL cck ON cck.ID = dck.CONTA_ID" +\n    " WHERE dck.CR_ID = " + crId + " AND dck.DRIVER_TIPO = 'PESSOAL' AND cck.CODIGO IN ('5.1.01','5.1.02','5.1.03')";`;
  const NEW_CONTAS = `const CONTAS_VIVAS = "SELECT cck.ID AS CONTA_ID, CASE cck.CODIGO WHEN '5.1.01.01' THEN 'SAL' WHEN '5.1.02' THEN 'ENC' WHEN '5.1.03' THEN 'BEN' END AS BLOCO" +
    " FROM CR_CONTA rck JOIN CONTA_CONTABIL cck ON cck.ID = rck.CONTA_ID" +
    " LEFT JOIN CONTA_DRIVER_EXCECAO cdek ON cdek.CR_ID = rck.CR_ID AND cdek.CONTA_ID = rck.CONTA_ID AND cdek.ATIVO = true" +
    " LEFT JOIN CONTA_DRIVER cdk ON cdk.CONTA_ID = rck.CONTA_ID" +
    " LEFT JOIN DRIVERS dk ON dk.ID = COALESCE(cdek.DRIVER_ID, cdk.DRIVER_ID)" +
    " WHERE rck.CR_ID = " + crId + " AND rck.ATIVO = true AND dk.NOME = 'PESSOAL'" +
    " AND cck.CODIGO IN (${DESTINOS})";
  const CONTAS_PESSOAL = "SELECT CONTA_ID FROM (" + CONTAS_VIVAS +
    " UNION SELECT clk.ID AS CONTA_ID, 'LEGADA' AS BLOCO FROM CONTA_CONTABIL clk WHERE clk.CODIGO IN (${LEGADAS})) alvok";`;

  const OLD_JOIN = `" JOIN (SELECT DISTINCT dck.CONTA_ID, cck.CODIGO FROM DRIVER_CONFIG dck JOIN CONTA_CONTABIL cck ON cck.ID = dck.CONTA_ID" +\n    " WHERE dck.CR_ID = " + crId + " AND dck.DRIVER_TIPO = 'PESSOAL' AND cck.CODIGO IN ('5.1.01','5.1.02','5.1.03')) pc ON 1 = 1" +`;
  const NEW_JOIN = `" JOIN (" + CONTAS_VIVAS + ") pc ON 1 = 1" +`;

  const OLD_CASE = `" ROUND(SUM(CASE pc.CODIGO WHEN '5.1.01' THEN opk.SALARIO WHEN '5.1.02' THEN opk.ENCARGOS WHEN '5.1.03' THEN opk.BENEFICIOS ELSE 0 END), 2)" +`;
  const NEW_CASE = `" ROUND(SUM(CASE pc.BLOCO WHEN 'SAL' THEN opk.SALARIO WHEN 'ENC' THEN opk.ENCARGOS WHEN 'BEN' THEN opk.BENEFICIOS ELSE 0 END), 2)" +`;

  const OLD_GROUP = `" GROUP BY opk.CICLO_ID, opk.CR_ID, pc.CONTA_ID, pc.CODIGO, opk.MES"`;
  const NEW_GROUP = `" GROUP BY opk.CICLO_ID, opk.CR_ID, pc.CONTA_ID, pc.BLOCO, opk.MES"`;

  for (const [old, nw, label] of [[OLD_CONTAS, NEW_CONTAS, 'CONTAS_PESSOAL'], [OLD_JOIN, NEW_JOIN, 'JOIN'], [OLD_CASE, NEW_CASE, 'CASE'], [OLD_GROUP, NEW_GROUP, 'GROUP BY']]) {
    if (!code.includes(old)) throw new Error(`SF 147: trecho "${label}" nao encontrado — abortando sem alterar`);
    code = code.replace(old, nw);
  }
  if (code.includes('DRIVER_CONFIG')) throw new Error('SF 147 ainda referencia DRIVER_CONFIG — abortando');

  await updateServerFunctionMitra({ projectId, serverFunctionId: 147, code });
  console.log('SF 147 (op pessoalRecalc) atualizada.');

  // ── smoke: params inertes; valida sintaxe sem tocar em dado real ──
  for (const id of [60, 61]) {
    const r = await executeServerFunctionMitra({ projectId, serverFunctionId: id, input: { cicloId: 0, crId: 0 } });
    if (r?.result?.executionStatus !== 'COMPLETED') throw new Error(`Smoke SF ${id} falhou: ${r?.result?.error}`);
    console.log(`Smoke SF ${id}: OK (ciclo/CR 0 — nenhuma linha afetada).`);
  }
}

main().catch(e => { console.error('ERRO:', e?.message || e); process.exit(1); });
