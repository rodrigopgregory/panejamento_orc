// Teste SOMENTE LEITURA: valida se o calculo de pessoal (ORCAMENTO_PESSOAL)
// esta consolidado corretamente nas contas de pessoal do ORCAMENTO (base do forecast).
// Espelha a regra vigente das SFs 60/61: contas do CR (CR_CONTA ativo) com driver
// PESSOAL via CONTA_DRIVER (+ excecao por CR), codigos 5.1.01.01=SAL, 5.1.02=ENC, 5.1.03=BEN.
// Usa a SF 79 (executarConsultasSeguras) — lote de SELECTs validados server-side.
import 'dotenv/config';
import { configureSdkMitra, executeServerFunctionMitra } from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS
});

const projectId = parseInt(process.env.MITRA_PROJECT_ID);
const SF_BATCH = 79;

const qBatch = async (sqls) => {
  const r = await executeServerFunctionMitra({ projectId, serverFunctionId: SF_BATCH, input: { sqls } });
  if (r?.result?.executionStatus === 'FAILED') throw new Error(r.result.error || 'lote falhou');
  let out = r?.result?.output;
  if (typeof out === 'string') { try { out = JSON.parse(out); } catch { /* noop */ } }
  return out?.results || [];
};

const fmt = (n) => Number(n ?? 0).toFixed(2);

// Mesma subquery da SF 61 (pessoalGravarOrcamento)
const contasPessoalSql = (crId) => `
  SELECT cc.ID AS CONTA_ID, cc.CODIGO,
         CASE cc.CODIGO WHEN '5.1.01.01' THEN 'SAL' WHEN '5.1.02' THEN 'ENC' WHEN '5.1.03' THEN 'BEN' END AS BLOCO
  FROM CR_CONTA rc
  JOIN CONTA_CONTABIL cc ON cc.ID = rc.CONTA_ID
  LEFT JOIN CONTA_DRIVER_EXCECAO cde ON cde.CR_ID = rc.CR_ID AND cde.CONTA_ID = rc.CONTA_ID AND cde.ATIVO = true
  LEFT JOIN CONTA_DRIVER cd ON cd.CONTA_ID = rc.CONTA_ID
  LEFT JOIN DRIVERS d ON d.ID = COALESCE(cde.DRIVER_ID, cd.DRIVER_ID)
  WHERE rc.CR_ID = ${crId} AND rc.ATIVO = true AND d.NOME = 'PESSOAL'
    AND cc.CODIGO IN ('5.1.01.01','5.1.02','5.1.03')`;

async function main() {
  const [folhaPorCicloCr] = await qBatch([
    `SELECT op.CICLO_ID, op.CR_ID, ci.NOME AS CICLO_NOME, ci.STATUS AS CICLO_STATUS, ci.VERSAO_ATUAL,
            cr.NOME AS CR_NOME, COUNT(*) AS LINHAS, ROUND(SUM(op.SALARIO),2) AS SAL,
            ROUND(SUM(op.ENCARGOS),2) AS ENC, ROUND(SUM(op.BENEFICIOS),2) AS BEN, ROUND(SUM(op.TOTAL),2) AS TOT
     FROM ORCAMENTO_PESSOAL op
     JOIN CICLO ci ON ci.ID = op.CICLO_ID
     JOIN CENTRO_RESULTADO cr ON cr.ID = op.CR_ID
     GROUP BY op.CICLO_ID, op.CR_ID, ci.NOME, ci.STATUS, ci.VERSAO_ATUAL, cr.NOME
     ORDER BY op.CICLO_ID, op.CR_ID`
  ]);

  if (!folhaPorCicloCr.length) {
    console.log('NENHUMA folha calculada em ORCAMENTO_PESSOAL — nada a validar.');
    return;
  }
  console.log(`Combinacoes ciclo/CR com folha calculada: ${folhaPorCicloCr.length}\n`);

  let falhas = 0, avisos = 0;
  for (const f of folhaPorCicloCr) {
    const { CICLO_ID, CR_ID } = f;

    const [contas, orcado, legado, duplicadas, integridade, mesAmes] = await qBatch([
      contasPessoalSql(CR_ID),
      // total gravado no ORCAMENTO por bloco (conta de pessoal)
      `SELECT pc.BLOCO, pc.CODIGO, ROUND(SUM(o.VALOR),2) AS VALOR, COUNT(*) AS LINHAS
       FROM ORCAMENTO o JOIN (${contasPessoalSql(CR_ID)}) pc ON pc.CONTA_ID = o.CONTA_ID
       WHERE o.CICLO_ID = ${CICLO_ID} AND o.CR_ID = ${CR_ID}
       GROUP BY pc.BLOCO, pc.CODIGO ORDER BY pc.BLOCO`,
      // residuo nas contas legadas (5.1.01/5.1.02/5.1.03 fora do mapeamento atual) → risco de dupla contagem
      `SELECT cc.CODIGO, ROUND(SUM(o.VALOR),2) AS VALOR, COUNT(*) AS LINHAS
       FROM ORCAMENTO o JOIN CONTA_CONTABIL cc ON cc.ID = o.CONTA_ID
       WHERE o.CICLO_ID = ${CICLO_ID} AND o.CR_ID = ${CR_ID}
         AND cc.CODIGO IN ('5.1.01','5.1.02','5.1.03')
         AND o.CONTA_ID NOT IN (SELECT CONTA_ID FROM (${contasPessoalSql(CR_ID)}) x)
       GROUP BY cc.CODIGO`,
      // duplicidade: mais de 1 linha por conta+mes no ORCAMENTO
      `SELECT COUNT(*) AS N FROM (
         SELECT o.CONTA_ID, o.MES FROM ORCAMENTO o
         JOIN (${contasPessoalSql(CR_ID)}) pc ON pc.CONTA_ID = o.CONTA_ID
         WHERE o.CICLO_ID = ${CICLO_ID} AND o.CR_ID = ${CR_ID}
         GROUP BY o.CONTA_ID, o.MES HAVING COUNT(*) > 1
       ) dup`,
      // integridade interna da folha: TOTAL = SAL + BEN + ENC
      `SELECT COUNT(*) AS DIVERGENTES FROM ORCAMENTO_PESSOAL
       WHERE CICLO_ID = ${CICLO_ID} AND CR_ID = ${CR_ID}
         AND ABS(TOTAL - ROUND(SALARIO + BENEFICIOS + ENCARGOS, 2)) > 0.01`,
      // comparacao mes a mes (soma dos 3 blocos)
      `SELECT m.MES, m.FOLHA, COALESCE(o.ORC, 0) AS ORC FROM
        (SELECT MES, ROUND(SUM(TOTAL),2) AS FOLHA FROM ORCAMENTO_PESSOAL
         WHERE CICLO_ID = ${CICLO_ID} AND CR_ID = ${CR_ID} GROUP BY MES) m
       LEFT JOIN
        (SELECT o.MES, ROUND(SUM(o.VALOR),2) AS ORC FROM ORCAMENTO o
         JOIN (${contasPessoalSql(CR_ID)}) pc ON pc.CONTA_ID = o.CONTA_ID
         WHERE o.CICLO_ID = ${CICLO_ID} AND o.CR_ID = ${CR_ID} GROUP BY o.MES) o ON o.MES = m.MES
       ORDER BY m.MES`
    ]);

    const erros = [];
    const warns = [];

    if (!contas.length) {
      warns.push('CR sem contas de pessoal mapeadas (driver PESSOAL) — folha existe mas nao ha onde consolidar');
    } else {
      const blocosMapeados = new Set(contas.map((c) => c.BLOCO));
      const orcByBloco = Object.fromEntries(orcado.map((o) => [o.BLOCO, o]));
      const esperado = { SAL: Number(f.SAL), ENC: Number(f.ENC), BEN: Number(f.BEN) };
      const rotulo = { SAL: 'salarios (5.1.01.01)', ENC: 'encargos (5.1.02)', BEN: 'beneficios (5.1.03)' };

      for (const bloco of ['SAL', 'ENC', 'BEN']) {
        const exp = esperado[bloco];
        if (!blocosMapeados.has(bloco)) {
          if (exp > 0.005) erros.push(`${rotulo[bloco]}: folha tem ${fmt(exp)} mas a conta nao esta mapeada no CR — valor fica de fora do forecast`);
          continue;
        }
        const got = Number(orcByBloco[bloco]?.VALOR ?? 0);
        if (Math.abs(got - exp) > 0.05) erros.push(`${rotulo[bloco]}: ORCAMENTO=${fmt(got)} vs folha=${fmt(exp)} (dif ${fmt(got - exp)})`);
      }
      for (const m of mesAmes) {
        if (Math.abs(Number(m.FOLHA) - Number(m.ORC)) > 0.05) erros.push(`mes ${m.MES}: folha=${fmt(m.FOLHA)} vs orcamento=${fmt(m.ORC)}`);
      }
      if (Number(duplicadas[0]?.N ?? 0) > 0) erros.push(`${duplicadas[0].N} combinacoes conta+mes duplicadas no ORCAMENTO`);
    }

    for (const l of legado) {
      erros.push(`residuo na conta legada ${l.CODIGO}: ${fmt(l.VALOR)} em ${l.LINHAS} linhas (risco de dupla contagem no forecast)`);
    }
    if (Number(integridade[0]?.DIVERGENTES ?? 0) > 0) {
      erros.push(`${integridade[0].DIVERGENTES} linhas da folha com TOTAL != SAL+BEN+ENC`);
    }

    // Versao fechada = snapshot congelado: divergencia e informativa, nao bloqueia.
    const fechado = f.CICLO_STATUS === 'FECHADO';
    const status = erros.length ? (fechado ? 'HISTORICO' : 'FALHOU') : warns.length ? 'AVISO' : 'OK';
    if (erros.length && !fechado) falhas++; else if (erros.length || warns.length) avisos++;
    console.log(`[${status}] ciclo ${CICLO_ID} "${f.CICLO_NOME}" (${f.CICLO_STATUS}${f.VERSAO_ATUAL === 'true' ? ', vigente' : ''}) / CR ${CR_ID} ${f.CR_NOME} — folha: ${f.LINHAS} linhas, SAL ${fmt(f.SAL)} + ENC ${fmt(f.ENC)} + BEN ${fmt(f.BEN)} = ${fmt(f.TOT)}`);
    for (const e of erros) console.log(`    ${fechado ? '·' : '✗'} ${e}`);
    for (const w of warns) console.log(`    ! ${w}`);
  }

  console.log(`\nResultado: ${folhaPorCicloCr.length - falhas - avisos} OK, ${avisos} avisos/historico, ${falhas} falhas em ciclo aberto (de ${folhaPorCicloCr.length} combinacoes).`);
  if (falhas) process.exit(2);
}

main().catch((e) => { console.error(e?.message || JSON.stringify(e)); process.exit(1); });
