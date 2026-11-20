// Preenche CR008 - Consultoria Estrategia (Juliana Costa) com orcamento
// "quase realista" pro Budget Challenger ter o que analisar.
//
// 4 erros propositais (pra apitar na analise):
//  1. SERVICOS DE TERCEIROS (conta 18) — crescimento de +28% sem premissa
//  2. DESPESAS COM SOFTWARE (conta 33) — mesmo valor em 8 meses (copia-cola)
//  3. TREINAMENTO E CAPACITACAO (conta 22) — reducao de -45% (suspeita)
//  4. VIAGENS E HOSPEDAGEM (conta 21) — constante R$ 3.500/mes (conta historicamente variavel)
//
// Demais contas: orcado proximo ao realizado 2025 com fator 1.05-1.10 + variacao mensal pequena.
// No final: status = SUBMETIDO pra cair na fila de aprovacao.

import 'dotenv/config';
import { configureSdkMitra, runQueryMitra, runDmlMitra } from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});
const projectId = parseInt(process.env.MITRA_PROJECT_ID);

const CR_ID = 8;
const CICLO_ID = 120;
const GESTOR_ID = 4;

// Pequena variacao mensal pra nao ficar com 12 meses identicos
function withVariation(base, pct = 0.06) {
  const factor = 1 + (Math.random() * pct * 2 - pct);
  return Math.round(base * factor);
}

console.log('=== Limpando lancamentos atuais do CR008 no ciclo 120 ===');
const del = await runDmlMitra({ projectId, sql: `DELETE FROM ORCAMENTO WHERE CR_ID = ${CR_ID} AND CICLO_ID = ${CICLO_ID}` });
console.log(`Apagados: ${del.result?.affectedRows ?? 'ok'}`);

// Buscar realizado 2025 por conta pra ter base
const real = await runQueryMitra({
  projectId,
  sql: `SELECT cc.ID AS CONTA_ID, cc.CODIGO, cc.NOME,
               COALESCE(SUM(rc.VALOR), 0) AS TOTAL_2025
        FROM CR_CONTA crc
        JOIN CONTA_CONTABIL cc ON cc.ID = crc.CONTA_ID
        LEFT JOIN REALIZADO_CONTABIL rc ON rc.CONTA_ID = cc.ID AND rc.CR_ID = ${CR_ID} AND rc.ANO = 2025
        WHERE crc.CR_ID = ${CR_ID}
        GROUP BY cc.ID, cc.CODIGO, cc.NOME`,
});
const realByConta = {};
for (const r of real.result?.rows || []) realByConta[r.CONTA_ID] = { CODIGO: r.CODIGO, NOME: r.NOME, TOTAL: Number(r.TOTAL_2025) };

// Plano de preenchimento — fator por conta + override quando ha erro proposital
// (multiplica o realizado anual e divide nos 12 meses com pequena variacao)
const planos = [
  // Receitas: crescimento moderado
  { conta: 1,  fator: 1.06 },   // Receita de Servicos
  { conta: 4,  fator: 1.07 },   // Receita de Consultoria
  // Impostos sobre receita
  { conta: 5,  fator: 1.06 },   // ISS
  { conta: 6,  fator: 1.05 },   // PIS/COFINS
  // Custos
  { conta: 9,  fator: 1.05 },   // Custo de Servicos Prestados
  // Pessoal (dissidio ~7-10%)
  { conta: 28, fator: 1.08 },   // Salarios e Ordenados
  { conta: 29, fator: 1.08 },   // INSS
  { conta: 30, fator: 1.08 },   // Ferias
  { conta: 31, fator: 1.06 },   // Vale Alimentacao
  { conta: 32, fator: 1.05 },   // Seguro/Convenio
  { conta: 13, fator: 1.04 },   // PLR e Bonus
  // Outras despesas operacionais
  { conta: 16, fator: 1.05 },   // Telecom
  { conta: 17, fator: 1.05 },   // Material Escritorio

  // ── ERROS PROPOSITAIS ──
  // 1. Servicos de Terceiros: +28% sem premissa (gatilho "crescimento incompativel")
  { conta: 18, fator: 1.28, errLabel: 'crescimento de +28% (gatilho: incompativel com historico)' },

  // 2. Despesas com Software: mesmo valor em 8 meses (gatilho "valores repetidos")
  { conta: 33, modo: 'repetido', valorFixo: 32750, mesesFixos: 8, errLabel: 'mesmo R$ 32.750 em 8 meses (gatilho: copia-cola)' },

  // 3. Treinamento e Capacitacao: -45% (gatilho "reducao pouco plausivel")
  { conta: 22, fator: 0.55, errLabel: 'reducao de -45% (gatilho: pouco plausivel)' },

  // 4. Viagens: R$ 3.500 constante em conta historicamente variavel (gatilho "folga sobre tendencia")
  { conta: 21, modo: 'constante', valorMes: 3500, errLabel: 'R$ 3.500 constante (gatilho: folga em conta variavel)' },
];

console.log('\n=== Inserindo lancamentos ===');
const inserts = [];
for (const p of planos) {
  const base = realByConta[p.conta];
  if (!base || base.TOTAL === 0) {
    console.log(`  Conta ${p.conta}: sem realizado 2025 — pulando`);
    continue;
  }
  let valores = [];
  if (p.modo === 'constante') {
    valores = Array(12).fill(p.valorMes);
  } else if (p.modo === 'repetido') {
    valores = Array(p.mesesFixos).fill(p.valorFixo);
    // Resto dos meses: variar levemente ao redor de outro valor pra nao ficar 12 iguais
    const outroValor = Math.round(p.valorFixo * 1.18);
    for (let i = p.mesesFixos; i < 12; i++) valores.push(withVariation(outroValor, 0.05));
  } else {
    const mediaMes = (base.TOTAL * p.fator) / 12;
    valores = Array.from({ length: 12 }, () => withVariation(mediaMes, 0.06));
  }

  const total = valores.reduce((a, b) => a + b, 0);
  const errTag = p.errLabel ? `  ⚠ ${p.errLabel}` : '';
  console.log(`  ${base.CODIGO} - ${base.NOME}: real 2025 R$ ${base.TOTAL.toLocaleString('pt-BR')} → orcado R$ ${total.toLocaleString('pt-BR')}${errTag}`);

  for (let m = 0; m < 12; m++) {
    inserts.push(`(${CICLO_ID}, ${CR_ID}, ${p.conta}, ${m + 1}, ${valores[m]})`);
  }
}

// INSERT em chunks
const chunkSize = 100;
for (let i = 0; i < inserts.length; i += chunkSize) {
  const chunk = inserts.slice(i, i + chunkSize);
  await runDmlMitra({
    projectId,
    sql: `INSERT INTO ORCAMENTO (CICLO_ID, CR_ID, CONTA_ID, MES, VALOR) VALUES ${chunk.join(',')}`,
  });
}
console.log(`Inseridos: ${inserts.length} linhas`);

// Submeter
console.log('\n=== Submetendo CR008 ===');
const now = new Date().toISOString().slice(0, 19);
await runDmlMitra({
  projectId,
  sql: `UPDATE ORCAMENTO_STATUS
        SET STATUS = 'SUBMETIDO',
            ATUALIZADO_EM = '${now}',
            DRIVERS_CONFIRMADOS = 'RECEITA,BASE_ZERO,BASE_HISTORICO,PESSOAL',
            COMENTARIO = NULL
        WHERE CR_ID = ${CR_ID} AND CICLO_ID = ${CICLO_ID}`,
});

// Conferencia
const final = await runQueryMitra({
  projectId,
  sql: `SELECT STATUS, ATUALIZADO_EM,
               (SELECT COUNT(*) FROM ORCAMENTO WHERE CR_ID=${CR_ID} AND CICLO_ID=${CICLO_ID}) AS LANCAMENTOS,
               (SELECT ROUND(SUM(VALOR)) FROM ORCAMENTO WHERE CR_ID=${CR_ID} AND CICLO_ID=${CICLO_ID}) AS TOTAL
        FROM ORCAMENTO_STATUS WHERE CR_ID=${CR_ID} AND CICLO_ID=${CICLO_ID}`,
});
console.log('Estado final:'); console.table(final.result?.rows);
console.log('\nPronto. CR008 - Consultoria Estrategia submetido com 4 erros plantados pro Budget Challenger.');
