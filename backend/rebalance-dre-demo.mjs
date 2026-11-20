// Rebalanceia a DRE da demo para ficar com margens realistas.
//
// Origem do bug:
//   1) Contas-pai de Pessoal (5.1.01, 5.1.02, 5.1.03) têm lançamentos
//      em ORCAMENTO MESMO TENDO contas-filhas (5.1.01.01, 5.1.02.01, ...) —
//      dupla contagem porque o Dashboard agrega por prefixo "5.1".
//   2) Impostos sobre receita estavam absurdos (ISS 6M, total ~83% da
//      receita bruta).
//   3) Operacional e Administrativa estavam com itens inflados.
//
// Resultado alvo (ciclo 120, atual): EBITDA ~1.6M (margem ~16%),
// Resultado Líquido ~1.9M.
//
// Roda em TODOS os ciclos (49/114/119/120) e em REALIZADO_CONTABIL pra
// "vs Real A.A." também ficar coerente.
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
async function dml(sql) {
  return await runDmlMitra({ projectId, sql });
}

// ---------- Snapshot ANTES ----------
async function snapshot(label) {
  console.log(`\n=== ${label} (ciclo 120) ===`);
  const rows = await q(`
    SELECT dc.NOME_LINHA, dc.SINAL,
      (SELECT COALESCE(SUM(o.VALOR),0) FROM ORCAMENTO o JOIN CONTA_CONTABIL cc ON cc.ID=o.CONTA_ID
       WHERE o.CICLO_ID = 120 AND cc.CODIGO LIKE CONCAT(dc.PREFIXO_CONTA, '%')) AS TOTAL
    FROM DRE_CONFIG dc WHERE dc.IS_SUBTOTAL = 'false' AND dc.PREFIXO_CONTA <> '' ORDER BY dc.ORDEM
  `);
  let rb=0, imp=0, cmv=0, pes=0, op=0, mk=0, ad=0, rf=0;
  rows.forEach(r => {
    const v = Number(r.TOTAL) * r.SINAL;
    if (r.NOME_LINHA.includes('Receita Bruta')) rb = v;
    else if (r.NOME_LINHA.includes('Impostos')) imp = v;
    else if (r.NOME_LINHA.includes('CMV')) cmv = v;
    else if (r.NOME_LINHA.includes('Pessoal')) pes = v;
    else if (r.NOME_LINHA.includes('Operacionais')) op = v;
    else if (r.NOME_LINHA.includes('Marketing')) mk = v;
    else if (r.NOME_LINHA.includes('Administrativas')) ad = v;
    else if (r.NOME_LINHA.includes('Financeiro')) rf = v;
  });
  const rl = rb + imp;        // imp já é negativo
  const lb = rl + cmv;
  const ebitda = lb + pes + op + mk + ad;
  const result = ebitda + rf;
  const pct = (v) => rl !== 0 ? ` (${(v/rl*100).toFixed(1)}%)` : '';
  console.log(`  Receita Bruta : ${rb.toFixed(0).padStart(12)}`);
  console.log(`  (-) Impostos  : ${imp.toFixed(0).padStart(12)}${pct(imp)}`);
  console.log(`  = R. Líquida  : ${rl.toFixed(0).padStart(12)}`);
  console.log(`  (-) CMV       : ${cmv.toFixed(0).padStart(12)}${pct(cmv)}`);
  console.log(`  = Lucro Bruto : ${lb.toFixed(0).padStart(12)}${pct(lb)}`);
  console.log(`  (-) Pessoal   : ${pes.toFixed(0).padStart(12)}${pct(pes)}`);
  console.log(`  (-) Operacion.: ${op.toFixed(0).padStart(12)}${pct(op)}`);
  console.log(`  (-) Marketing : ${mk.toFixed(0).padStart(12)}${pct(mk)}`);
  console.log(`  (-) Administr.: ${ad.toFixed(0).padStart(12)}${pct(ad)}`);
  console.log(`  = EBITDA      : ${ebitda.toFixed(0).padStart(12)}${pct(ebitda)}`);
  console.log(`  + Res. Financ.: ${rf.toFixed(0).padStart(12)}`);
  console.log(`  = Res. Líquido: ${result.toFixed(0).padStart(12)}${pct(result)}`);
  return { rb, imp, rl, ebitda, result };
}

const before = await snapshot('ANTES');

// ---------- 1) Remover dupla contagem em Pessoal ----------
console.log('\n=== 1. Removendo dupla contagem em PESSOAL ===');
console.log('  Contas-pai 10/11/12 têm filhas (28-32) — apagar lançamentos dos pais');
for (const id of [10, 11, 12]) {
  const orc = await dml(`DELETE FROM ORCAMENTO WHERE CONTA_ID = ${id}`);
  const real = await dml(`DELETE FROM REALIZADO_CONTABIL WHERE CONTA_ID = ${id}`);
  const pac = await dml(`DELETE FROM ORCAMENTO_PACOTE WHERE CONTA_ID = ${id}`);
  console.log(`  CONTA ${id}: ORCAMENTO/REALIZADO/PACOTE limpos`);
}

// ---------- 2) Ajustar IMPOSTOS (~16% da Receita Bruta) ----------
console.log('\n=== 2. Reduzindo IMPOSTOS para ~16% da Receita Bruta ===');
const ajustes = [
  // [conta_id, descricao, multiplicador]
  [5, 'ISS sobre Serviços',  0.078],
  [6, 'PIS/COFINS',          0.504],
  [7, 'ICMS',                0.165],
  // Pessoal (filhas + PLR)
  [28, '5.1.01.01 Salários',     0.15],
  [29, '5.1.02.01 INSS',         0.15],
  [30, '5.1.02.02 Férias',       0.15],
  [31, '5.1.03.01 V. Alim',      0.15],
  [32, '5.1.03.02 Seguro/Conv',  0.15],
  [13, '5.1.04 PLR e Bônus',     0.15],
  // Operacionais
  [14, '5.2.01 Aluguel',        0.40],
  [15, '5.2.02 Energia',        0.40],
  [16, '5.2.03 Telecom',        0.40],
  [17, '5.2.04 Material',       0.40],
  [18, '5.2.05 Terceiros',      0.40],
  // Marketing
  [19, '5.3.01 Publicidade',    0.70],
  [20, '5.3.02 Eventos',        0.70],
  // Administrativa
  [21, '5.4.01 Viagens',        0.60],
  [22, '5.4.02 Treinamento',    0.60],
  [23, '5.4.03 Seguros',        0.60],
  [24, '5.4.04 Depreciação',    0.60],
];

console.log('\n=== 3. Aplicando multiplicadores em ORCAMENTO + REALIZADO_CONTABIL + ORCAMENTO_PACOTE ===');
for (const [id, label, mult] of ajustes) {
  await dml(`UPDATE ORCAMENTO          SET VALOR = VALOR * ${mult} WHERE CONTA_ID = ${id}`);
  await dml(`UPDATE REALIZADO_CONTABIL SET VALOR = VALOR * ${mult} WHERE CONTA_ID = ${id}`);
  await dml(`UPDATE ORCAMENTO_PACOTE   SET VALOR = VALOR * ${mult} WHERE CONTA_ID = ${id}`);
  console.log(`  CONTA ${id} (${label}) × ${mult}`);
}

// ---------- Snapshot DEPOIS ----------
const after = await snapshot('DEPOIS');

console.log('\n=== RESUMO ===');
const fmt = (v) => v.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
console.log(`  Receita Líquida : ${fmt(before.rl).padStart(12)} -> ${fmt(after.rl).padStart(12)}`);
console.log(`  EBITDA          : ${fmt(before.ebitda).padStart(12)} -> ${fmt(after.ebitda).padStart(12)}`);
console.log(`  Resultado Líq.  : ${fmt(before.result).padStart(12)} -> ${fmt(after.result).padStart(12)}`);
if (after.rl > 0) {
  console.log(`  Margem EBITDA   : ${(after.ebitda/after.rl*100).toFixed(1)}%`);
}
console.log('\nDone.');
