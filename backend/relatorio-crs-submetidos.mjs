// Relatorio de fragilidade dos CRs em SUBMETIDO
// Conta a conta: orcado X realizado 2025 + heuristicas de fragilidade economica
import 'dotenv/config';
import { configureSdkMitra, runQueryMitra } from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});
const projectId = parseInt(process.env.MITRA_PROJECT_ID);

const fmtBRL = (n) => 'R$ ' + Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const fmtPct = (p) => (p >= 0 ? '+' : '') + p.toFixed(1) + '%';

// Coeficiente de variacao (desvio padrao / media) — mede variabilidade
function cv(arr) {
  const vals = arr.filter((v) => Number.isFinite(v));
  if (vals.length === 0) return 0;
  const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
  if (mean === 0) return 0;
  const variance = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length;
  return Math.sqrt(variance) / Math.abs(mean);
}

// Conta meses com o MESMO valor (tolerancia R$ 1) — detecta copia-cola
function maxRepeats(arr) {
  const buckets = {};
  for (const v of arr) {
    if (!Number.isFinite(v) || v === 0) continue;
    const key = Math.round(v);
    buckets[key] = (buckets[key] || 0) + 1;
  }
  let max = 0;
  let valor = 0;
  for (const [k, c] of Object.entries(buckets)) {
    if (c > max) {
      max = c;
      valor = Number(k);
    }
  }
  return { meses: max, valor };
}

// 1) Lista CRs submetidos
const subs = await runQueryMitra({
  projectId,
  sql: `
    SELECT os.ID AS STATUS_ID, os.CR_ID, os.CICLO_ID,
           cr.CODIGO AS CR_CODIGO, cr.NOME AS CR_NOME,
           c.NOME AS CICLO, c.ANO AS CICLO_ANO,
           g.NOME AS GESTOR, os.ATUALIZADO_EM
    FROM ORCAMENTO_STATUS os
    JOIN CENTRO_RESULTADO cr ON cr.ID = os.CR_ID
    LEFT JOIN CICLO c ON c.ID = os.CICLO_ID
    LEFT JOIN GESTOR_CR gc ON gc.CR_ID = cr.ID
    LEFT JOIN GESTOR g ON g.ID = gc.GESTOR_ID
    WHERE os.STATUS = 'SUBMETIDO'
    ORDER BY os.ATUALIZADO_EM ASC
  `,
});
const cards = subs.result?.rows || [];
console.log(`\n## ${cards.length} CRs em SUBMETIDO\n`);

const ANO_BASE = 2025;
const todosAchados = [];

for (const card of cards) {
  console.log('\n========================================================');
  console.log(`# ${card.CR_CODIGO} — ${card.CR_NOME}`);
  console.log(`Ciclo: ${card.CICLO}  |  Gestor: ${card.GESTOR}  |  Submetido em: ${card.ATUALIZADO_EM}`);
  console.log('========================================================');

  // 2) Orcado por conta x mes
  const orc = await runQueryMitra({
    projectId,
    sql: `SELECT CONTA_ID, MES, SUM(VALOR) AS V
          FROM ORCAMENTO
          WHERE CR_ID=${card.CR_ID} AND CICLO_ID=${card.CICLO_ID}
          GROUP BY CONTA_ID, MES`,
  });
  // 3) Realizado por conta x mes (ano base)
  const rea = await runQueryMitra({
    projectId,
    sql: `SELECT CONTA_ID, MES, SUM(VALOR) AS V
          FROM REALIZADO_CONTABIL
          WHERE CR_ID=${card.CR_ID} AND ANO=${ANO_BASE}
          GROUP BY CONTA_ID, MES`,
  });
  const contas = await runQueryMitra({
    projectId,
    sql: `SELECT cc.ID, cc.CODIGO, cc.NOME, cc.TIPO, cc.NATUREZA
          FROM CR_CONTA crc
          JOIN CONTA_CONTABIL cc ON cc.ID = crc.CONTA_ID
          WHERE crc.CR_ID=${card.CR_ID}`,
  });

  // Mapas auxiliares
  const orcMap = {}; // contaId -> [12 valores]
  for (const r of orc.result?.rows || []) {
    if (!orcMap[r.CONTA_ID]) orcMap[r.CONTA_ID] = Array(12).fill(0);
    orcMap[r.CONTA_ID][Number(r.MES) - 1] = Number(r.V);
  }
  const reaMap = {};
  for (const r of rea.result?.rows || []) {
    if (!reaMap[r.CONTA_ID]) reaMap[r.CONTA_ID] = Array(12).fill(0);
    reaMap[r.CONTA_ID][Number(r.MES) - 1] = Number(r.V);
  }

  // 4) Para cada conta, calcular metricas e detectar fragilidades
  const linhas = [];
  for (const c of contas.result?.rows || []) {
    const arrOrc = orcMap[c.ID] || Array(12).fill(0);
    const arrRea = reaMap[c.ID] || Array(12).fill(0);
    const totOrc = arrOrc.reduce((s, v) => s + v, 0);
    const totRea = arrRea.reduce((s, v) => s + v, 0);
    if (totOrc === 0 && totRea === 0) continue;
    const variacao = totRea === 0 ? null : ((totOrc - totRea) / totRea) * 100;
    const cvRea = cv(arrRea);
    const cvOrc = cv(arrOrc);
    const rep = maxRepeats(arrOrc);

    const achados = [];
    // a) Crescimento incompativel: >+20% sem premissa
    if (variacao !== null && variacao >= 20) {
      const sev = Math.min(5, Math.round(variacao / 10)) + (totOrc > 1000000 ? 1 : 0);
      achados.push({
        tipo: 'CRESCIMENTO_INCOMPATIVEL',
        severidade: sev,
        descricao: `Orcado ${fmtBRL(totOrc)} vs Realizado ${ANO_BASE} ${fmtBRL(totRea)} → ${fmtPct(variacao)}`,
        questionamento: `${c.CODIGO} — ${c.NOME}: por que voce projetou crescimento de ${fmtPct(variacao)} em ${ANO_BASE + 1}? Qual premissa (contrato, headcount, expansao) sustenta esse salto sobre o realizado de ${ANO_BASE}?`,
      });
    }
    // b) Reducao pouco plausivel: <-25%
    if (variacao !== null && variacao <= -25) {
      const sev = Math.min(5, Math.round(Math.abs(variacao) / 10)) + (totRea > 500000 ? 1 : 0);
      achados.push({
        tipo: 'REDUCAO_POUCO_PLAUSIVEL',
        severidade: sev,
        descricao: `Orcado ${fmtBRL(totOrc)} vs Realizado ${ANO_BASE} ${fmtBRL(totRea)} → ${fmtPct(variacao)}`,
        questionamento: `${c.CODIGO} — ${c.NOME}: voce esta projetando uma queda de ${fmtPct(variacao)} contra o realizado de ${ANO_BASE}. Que iniciativa concreta (corte de contrato, troca de fornecedor, eficiencia operacional) sustenta essa reducao? Sem premissa, o risco e subir de novo no realizado.`,
      });
    }
    // c) Valores repetidos: mesmo valor em 4+ meses (copia-cola)
    if (rep.meses >= 4 && rep.valor > 0) {
      achados.push({
        tipo: 'VALORES_REPETIDOS',
        severidade: 3 + (rep.meses >= 6 ? 1 : 0) + (rep.valor * rep.meses > 200000 ? 1 : 0),
        descricao: `${fmtBRL(rep.valor)} repetido em ${rep.meses} dos 12 meses (impacto ${fmtBRL(rep.valor * rep.meses)})`,
        questionamento: `${c.CODIGO} — ${c.NOME}: o mesmo valor (${fmtBRL(rep.valor)}) aparece em ${rep.meses} meses do orcamento. Isso e um contrato com parcelas fixas (anexar contrato) ou e copia-cola do mes anterior? Se for variavel, o erro de previsao se compoe ao longo do ano.`,
      });
    }
    // d) Folga em conta variavel: realizado CV>0.25, orcado CV<0.10 e totOrc relevante
    if (cvRea > 0.25 && cvOrc < 0.10 && totOrc > 20000) {
      achados.push({
        tipo: 'FOLGA_EM_CONTA_VARIAVEL',
        severidade: 2 + (cvRea > 0.50 ? 1 : 0) + (totOrc > 100000 ? 1 : 0),
        descricao: `Realizado ${ANO_BASE} variou (CV=${(cvRea * 100).toFixed(0)}%) mas orcado quase plano (CV=${(cvOrc * 100).toFixed(0)}%). Total orcado ${fmtBRL(totOrc)}`,
        questionamento: `${c.CODIGO} — ${c.NOME}: historicamente a conta oscila mes a mes (CV de ${(cvRea * 100).toFixed(0)}%), mas voce orcou um valor praticamente constante. Sazonalidade real (ferias, fechamento de trimestre, eventos) foi considerada? Achatar a curva costuma esconder folga.`,
      });
    }

    if (achados.length > 0) {
      linhas.push({
        conta: `${c.CODIGO} — ${c.NOME}`,
        tipoNatureza: `${c.TIPO}/${c.NATUREZA}`,
        totOrc,
        totRea,
        variacao,
        achados,
      });
    }
  }

  // Resumo executivo do CR
  if (linhas.length === 0) {
    console.log('\nNenhuma fragilidade encontrada por essas heuristicas.\n');
  } else {
    // Ordenar achados por severidade
    const todos = [];
    for (const l of linhas) {
      for (const a of l.achados) todos.push({ ...a, conta: l.conta, totOrc: l.totOrc, totRea: l.totRea });
    }
    todos.sort((a, b) => b.severidade - a.severidade);

    console.log(`\nAchados (${todos.length}) em ordem de severidade:\n`);
    todos.forEach((a, i) => {
      console.log(`  [${i + 1}] (${a.tipo}, severidade ${a.severidade})`);
      console.log(`      Conta: ${a.conta}`);
      console.log(`      Numero: ${a.descricao}`);
      console.log(`      Pergunta: ${a.questionamento}`);
      console.log('');
      todosAchados.push({ crCodigo: card.CR_CODIGO, ciclo: card.CICLO, ...a });
    });
  }
}

// Ranking GLOBAL final
console.log('\n\n========================================================');
console.log('# RANKING GLOBAL — TODAS AS FRAGILIDADES POR SEVERIDADE');
console.log('========================================================\n');
todosAchados.sort((a, b) => b.severidade - a.severidade);
todosAchados.forEach((a, i) => {
  console.log(`[${i + 1}] ${a.crCodigo} (${a.ciclo})  |  ${a.tipo}  |  sev ${a.severidade}`);
  console.log(`    ${a.conta}`);
  console.log(`    ${a.descricao}`);
  console.log(`    >>> ${a.questionamento}\n`);
});
