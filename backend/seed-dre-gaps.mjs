// Demo: (1) popula CICLO 114 (versao controle 2026) com ORCAMENTO completo
// pra coluna "Versao Controle" deixar de ser zero. (2) Preenche gaps do
// CICLO 120 (versao atual) — algumas linhas de DRE estavam zeradas em
// alguns CRs porque o CR_CONTA nao cobria aquela categoria.
//
// Versao Controle = ~5% menor que Versao Atual (cria variacao positiva
// no Impacto, deixa o dashboard mais visual).

import 'dotenv/config';
import { configureSdkMitra, runQueryMitra, runDmlMitra } from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});

const projectId = parseInt(process.env.MITRA_PROJECT_ID);
const CICLO_ATUAL = 120;
const CICLO_CONTROLE = 114;

async function q(sql) { const r = await runQueryMitra({ projectId, sql }); return r?.result?.rows || []; }
async function dml(sql) { return await runDmlMitra({ projectId, sql }); }

// ============================================================
// PARTE 1 — Preencher gaps de DRE no CICLO 120 (versao atual)
// ============================================================
console.log('=== PARTE 1: completando DRE do CICLO 120 (versao atual) ===\n');

const CRS_NAO_PENDENTES = [1, 2, 4, 5, 7];

const FATOR_MES = [0.92, 0.95, 0.98, 1.00, 1.02, 1.04, 1.06, 1.05, 1.03, 1.01, 0.99, 1.08];

function categoria(prefixo) {
  if (prefixo.startsWith('3.')) return 'RECEITA';
  if (prefixo.startsWith('4.')) return 'CMV';
  if (prefixo.startsWith('5.1')) return 'PESSOAL';
  if (prefixo.startsWith('5.')) return 'DESPESA';
  if (prefixo === '6.1') return 'FINANCEIRO';
  return 'OUTROS';
}
function baseValor(cat) {
  switch (cat) {
    case 'RECEITA':    return 110000;
    case 'CMV':        return 28000;
    case 'PESSOAL':    return 42000;
    case 'DESPESA':    return 14000;
    case 'FINANCEIRO': return 5500;
    default:           return 6000;
  }
}
function variacao(cr, conta, mes) {
  const h = ((cr * 17 + conta * 31 + mes * 3) % 21) / 100;
  return 1 + (h - 0.10);
}
function calcValor(cr, conta, prefixo, mes, multiplier = 1) {
  const v = baseValor(categoria(prefixo)) * FATOR_MES[mes - 1] * variacao(cr, conta, mes) * multiplier;
  return Math.round(v * 100) / 100;
}

const dreLines = await q("SELECT NOME_LINHA, PREFIXO_CONTA FROM DRE_CONFIG WHERE IS_SUBTOTAL = 'false' AND PREFIXO_CONTA != '' ORDER BY ORDEM");

const gapsValues120 = [];
let gaps120 = 0;
for (const cr of CRS_NAO_PENDENTES) {
  for (const line of dreLines) {
    const contas = await q(`SELECT ID, CODIGO FROM CONTA_CONTABIL WHERE CODIGO LIKE '${line.PREFIXO_CONTA}%' ORDER BY CODIGO`);
    if (!contas.length) continue;
    const ids = contas.map(c => c.ID).join(',');
    const cnt = await q(`SELECT COUNT(*) AS QTD FROM ORCAMENTO WHERE CICLO_ID = ${CICLO_ATUAL} AND CR_ID = ${cr} AND CONTA_ID IN (${ids})`);
    if ((cnt[0].QTD || 0) > 0) continue;
    const conta = contas[0];
    for (let m = 1; m <= 12; m++) {
      gapsValues120.push(`(${CICLO_ATUAL}, ${cr}, ${conta.ID}, ${m}, ${calcValor(cr, conta.ID, line.PREFIXO_CONTA, m)}, 0, 0)`);
    }
    gaps120++;
    console.log(`  CR ${cr} ${line.NOME_LINHA} -> usando conta ${conta.CODIGO}`);
  }
}

const CHUNK = 200;
for (let i = 0; i < gapsValues120.length; i += CHUNK) {
  const chunk = gapsValues120.slice(i, i + CHUNK);
  await dml(`INSERT INTO ORCAMENTO (CICLO_ID, CR_ID, CONTA_ID, MES, VALOR, QUANTIDADE, VALOR_UNITARIO) VALUES ${chunk.join(',')}`);
}
console.log(`Gaps 120 preenchidos: ${gaps120} linhas (${gapsValues120.length} lancamentos)`);

// ============================================================
// PARTE 2 — Popular CICLO 114 (versao controle)
// ============================================================
console.log('\n=== PARTE 2: populando CICLO 114 (versao controle) ===\n');

// Conferir se CICLO 114 existe e e versao controle 2026
const ctrlCiclo = await q(`SELECT ID, NOME, ANO, VERSAO_CONTROLE FROM CICLO WHERE ID = ${CICLO_CONTROLE}`);
console.log('CICLO controle:', JSON.stringify(ctrlCiclo[0]));

// Conferir count atual
const cnt114 = await q(`SELECT COUNT(*) AS QTD FROM ORCAMENTO WHERE CICLO_ID = ${CICLO_CONTROLE}`);
console.log(`Lancamentos atuais em CICLO ${CICLO_CONTROLE}: ${cnt114[0].QTD}`);

// Copiar a base do CICLO 120 (ja completo apos parte 1) com multiplicador 0.95
// (versao controle = ~5% menor que versao atual)
const base120 = await q(`SELECT CR_ID, CONTA_ID, MES, VALOR FROM ORCAMENTO WHERE CICLO_ID = ${CICLO_ATUAL}`);
console.log(`Base do CICLO ${CICLO_ATUAL}: ${base120.length} lancamentos`);

// Existing em CICLO 114
const exist114 = await q(`SELECT CR_ID, CONTA_ID, MES FROM ORCAMENTO WHERE CICLO_ID = ${CICLO_CONTROLE}`);
const existKeys = new Set(exist114.map(r => `${r.CR_ID}|${r.CONTA_ID}|${r.MES}`));

const ctrlValues = [];
for (const r of base120) {
  const k = `${r.CR_ID}|${r.CONTA_ID}|${r.MES}`;
  if (existKeys.has(k)) continue;
  // Variacao ate -10% / +5% por hash do par (cr, conta, mes)
  const h = ((r.CR_ID * 19 + r.CONTA_ID * 23 + r.MES * 11) % 16) / 100; // 0..0.15
  const multiplier = 0.95 - h + 0.05; // entre ~0.85 e 1.00
  const v = Math.round(Number(r.VALOR) * multiplier * 100) / 100;
  ctrlValues.push(`(${CICLO_CONTROLE}, ${r.CR_ID}, ${r.CONTA_ID}, ${r.MES}, ${v}, 0, 0)`);
}
console.log(`Lancamentos a inserir em CICLO ${CICLO_CONTROLE}: ${ctrlValues.length}`);

for (let i = 0; i < ctrlValues.length; i += CHUNK) {
  const chunk = ctrlValues.slice(i, i + CHUNK);
  await dml(`INSERT INTO ORCAMENTO (CICLO_ID, CR_ID, CONTA_ID, MES, VALOR, QUANTIDADE, VALOR_UNITARIO) VALUES ${chunk.join(',')}`);
  console.log(`  Inseridos ${Math.min(i + CHUNK, ctrlValues.length)} / ${ctrlValues.length}`);
}

// ============================================================
// Verificacao final
// ============================================================
console.log('\n=== Estado final ===');
const counts = await q(`SELECT CICLO_ID, COUNT(*) AS QTD, ROUND(SUM(VALOR),2) AS TOTAL FROM ORCAMENTO WHERE CICLO_ID IN (${CICLO_ATUAL}, ${CICLO_CONTROLE}) GROUP BY CICLO_ID ORDER BY CICLO_ID`);
console.table(counts);

console.log('\nDone!');
