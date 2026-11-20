// Sample seed: completa o REALIZADO_CONTABIL com valores realistas
// para preencher buracos em 2025 e estender 2026 ate maio.
import 'dotenv/config';
import { configureSdkMitra, runQueryMitra, runDmlMitra } from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});

const projectId = parseInt(process.env.MITRA_PROJECT_ID);
async function q(sql) {
  const r = await runQueryMitra({ projectId, sql });
  return r?.result?.rows || [];
}
async function dml(sql) { return await runDmlMitra({ projectId, sql }); }

const ULTIMO_MES_2026 = 5; // ate maio
const CICLO_ATUAL = 120;

// 1) Pares (CR, EMPRESA, CONTA) a partir de CR_CONTA ativos
const pares = await q(`
  SELECT cr.ID AS CR_ID, cr.EMPRESA_ID, crc.CONTA_ID, cc.CODIGO
  FROM CR_CONTA crc
  JOIN CENTRO_RESULTADO cr ON cr.ID = crc.CR_ID
  JOIN CONTA_CONTABIL cc ON cc.ID = crc.CONTA_ID
  WHERE crc.ATIVO = 1 AND cr.ATIVO = 'true'
`);
console.log(`Pares (CR, CONTA) ativos: ${pares.length}`);

// 2) O que ja existe
const existentes = await q(`
  SELECT CR_ID, CONTA_ID, ANO, MES FROM REALIZADO_CONTABIL
  WHERE ANO IN (2025, 2026)
`);
const chave = new Set(existentes.map(r => `${r.CR_ID}|${r.CONTA_ID}|${r.ANO}|${r.MES}`));
console.log(`Existentes em 2025/2026: ${existentes.length}`);

// 3) Sazonalidade e valor base por categoria de conta (heuristica pelo codigo)
const FATOR_MES = [0.92, 0.95, 0.98, 1.00, 1.02, 1.04, 1.06, 1.05, 1.03, 1.01, 0.99, 1.08];

function categoria(codigo) {
  // 3.* receita, 4.* CMV, 5.1.* pessoal, 5.2-5.4 despesas, 6.* financeiro
  if (codigo.startsWith('3.')) return 'RECEITA';
  if (codigo.startsWith('4.')) return 'CMV';
  if (codigo.startsWith('5.1.')) return 'PESSOAL';
  if (codigo.startsWith('5.')) return 'DESPESA';
  if (codigo.startsWith('6.1.01')) return 'RECEITA_FIN';
  if (codigo.startsWith('6.')) return 'DESPESA_FIN';
  return 'OUTROS';
}

function baseValor(cat) {
  switch (cat) {
    case 'RECEITA':      return 95000;
    case 'CMV':          return 32000;
    case 'PESSOAL':      return 38000;
    case 'DESPESA':      return 12000;
    case 'RECEITA_FIN':  return 4500;
    case 'DESPESA_FIN':  return 7000;
    default:             return 6000;
  }
}

function variacao(cr, conta, ano, mes) {
  // hash deterministico → -10% a +10%
  const h = ((cr * 17 + conta * 31 + ano * 7 + mes * 3) % 21) / 100;
  return 1 + (h - 0.10);
}

function calcValor(cr, conta, codigo, ano, mes) {
  const cat = categoria(codigo);
  const base = baseValor(cat);
  // 2026 cresce ~5% em relacao a 2025
  const fatorAno = ano === 2026 ? 1.05 : 1.0;
  // sinal negativo pra despesas? No banco do projeto, valores sao positivos
  // (a separacao receita/despesa vem do tipo da conta). Mantemos positivo.
  const v = base * FATOR_MES[mes - 1] * variacao(cr, conta, ano, mes) * fatorAno;
  return Math.round(v * 100) / 100;
}

// 4) Montar INSERTs
const VALUES = [];
for (const p of pares) {
  // 2025: ano completo
  for (let mes = 1; mes <= 12; mes++) {
    const k = `${p.CR_ID}|${p.CONTA_ID}|2025|${mes}`;
    if (chave.has(k)) continue;
    const v = calcValor(p.CR_ID, p.CONTA_ID, p.CODIGO, 2025, mes);
    VALUES.push(`(${p.EMPRESA_ID}, ${p.CR_ID}, ${p.CONTA_ID}, 2025, ${mes}, ${v})`);
  }
  // 2026: jan ate ULTIMO_MES_2026
  for (let mes = 1; mes <= ULTIMO_MES_2026; mes++) {
    const k = `${p.CR_ID}|${p.CONTA_ID}|2026|${mes}`;
    if (chave.has(k)) continue;
    const v = calcValor(p.CR_ID, p.CONTA_ID, p.CODIGO, 2026, mes);
    VALUES.push(`(${p.EMPRESA_ID}, ${p.CR_ID}, ${p.CONTA_ID}, 2026, ${mes}, ${v})`);
  }
}
console.log(`Lancamentos a inserir: ${VALUES.length}`);

// 5) Inserir em chunks
const CHUNK = 200;
for (let i = 0; i < VALUES.length; i += CHUNK) {
  const chunk = VALUES.slice(i, i + CHUNK);
  await dml(`INSERT INTO REALIZADO_CONTABIL (EMPRESA_ID, CR_ID, CONTA_ID, ANO, MES, VALOR) VALUES ${chunk.join(',')}`);
  console.log(`  Inseridos ${Math.min(i + CHUNK, VALUES.length)} / ${VALUES.length}`);
}

// 6) Atualizar ULTIMO_MES_REALIZADO do ciclo atual
await dml(`UPDATE CICLO SET ULTIMO_MES_REALIZADO = ${ULTIMO_MES_2026} WHERE ID = ${CICLO_ATUAL}`);
console.log(`\nCICLO ${CICLO_ATUAL}.ULTIMO_MES_REALIZADO = ${ULTIMO_MES_2026}`);

// 7) Verificacao
const final = await q(`SELECT ANO, COUNT(*) AS QTD, COUNT(DISTINCT CR_ID) AS CRS, COUNT(DISTINCT CONTA_ID) AS CONTAS FROM REALIZADO_CONTABIL WHERE ANO IN (2025, 2026) GROUP BY ANO ORDER BY ANO`);
console.log('\n--- Estado final ---');
console.table(final);

const porMes = await q(`SELECT ANO, MES, COUNT(*) AS QTD, ROUND(SUM(VALOR), 2) AS TOTAL FROM REALIZADO_CONTABIL WHERE ANO IN (2025, 2026) GROUP BY ANO, MES ORDER BY ANO, MES`);
console.table(porMes);

console.log('\nSeed de realizado concluida!');
