// SOMENTE LEITURA — monta a proposta de recalculo do CR008 (nao grava nada).
// Uso: node proposta-cr008-recalculo.mjs
import 'dotenv/config';
import { configureSdkMitra, runQueryMitra } from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});
const projectId = parseInt(process.env.MITRA_PROJECT_ID);
const q = async (sql) => (await runQueryMitra({ projectId, sql })).result?.rows || [];
const brl = (n) => Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

const CR_ID = 8, CICLO = 133, CONTA = 21;

const orc = await q(`SELECT MES, VALOR FROM ORCAMENTO WHERE CICLO_ID=${CICLO} AND CR_ID=${CR_ID} AND CONTA_ID=${CONTA} ORDER BY MES`);
const r25 = await q(`SELECT MES, VALOR FROM REALIZADO_CONTABIL WHERE ANO=2025 AND CR_ID=${CR_ID} AND CONTA_ID=${CONTA} ORDER BY MES`);
const r26 = await q(`SELECT MES, VALOR FROM REALIZADO_CONTABIL WHERE ANO=2026 AND CR_ID=${CR_ID} AND CONTA_ID=${CONTA} ORDER BY MES`);

const m25 = {}; for (const r of r25) m25[r.MES] = Number(r.VALOR);
const m26 = {}; for (const r of r26) m26[r.MES] = Number(r.VALOR);
const atual = {}; for (const r of orc) atual[r.MES] = Number(r.VALOR);

// Fator de crescimento YTD jan-abr (exclui mai/2026, outlier de 7.788 = 2,2x a media)
const ytd25 = [1, 2, 3, 4].reduce((s, m) => s + m25[m], 0);
const ytd26 = [1, 2, 3, 4].reduce((s, m) => s + m26[m], 0);
const fator = ytd26 / ytd25;

console.log('CR008 - Consultoria Estrategia | Ciclo 133 "Forecast 2026 (5+7)" | Conta 5.4.01 Viagens e Hospedagem\n');
console.log(`Base historica 2025 (12m):        R$ ${brl(Object.values(m25).reduce((a, b) => a + b, 0))}`);
console.log(`Realizado 2026 jan-abr:           R$ ${brl(ytd26)}  (2025 mesmo periodo: R$ ${brl(ytd25)})`);
console.log(`Fator de crescimento aplicado:    ${fator.toFixed(4)}  (+${((fator - 1) * 100).toFixed(1)}%)`);
console.log(`Obs: mai/2026 (R$ ${brl(m26[5])}) excluido do fator — outlier de 2,2x a media historica\n`);

console.log('mes │    ANTES   │   DEPOIS   │   delta    │ base 2025  │ realizado 2026');
console.log('────┼────────────┼────────────┼────────────┼────────────┼───────────────');
let totA = 0, totD = 0;
const novos = {};
for (let m = 1; m <= 12; m++) {
  const antes = atual[m];
  const depois = Math.round(m25[m] * fator);
  novos[m] = depois;
  totA += antes; totD += depois;
  const d = depois - antes;
  console.log(
    `${String(m).padStart(3)} │ ${brl(antes).padStart(10)} │ ${brl(depois).padStart(10)} │ ${(d >= 0 ? '+' : '') + brl(d).padStart(9)} │ ${brl(m25[m]).padStart(10)} │ ${(m26[m] !== undefined ? brl(m26[m]) : '-').padStart(14)}`
  );
}
console.log('────┼────────────┼────────────┼────────────┼────────────┼───────────────');
console.log(`TOT │ ${brl(totA).padStart(10)} │ ${brl(totD).padStart(10)} │ ${((totD - totA) >= 0 ? '+' : '') + brl(totD - totA).padStart(9)} │`);
console.log(`\nVariacao: ${(((totD - totA) / totA) * 100).toFixed(1)}%`);
console.log(`Meses com valor repetido: ANTES 3.710 x10  ->  DEPOIS 12 valores distintos`);

console.log('\n\n--- SQL que seria executado (NAO executado agora) ---');
for (let m = 1; m <= 12; m++) {
  console.log(`UPDATE ORCAMENTO SET VALOR = ${novos[m]} WHERE CICLO_ID=${CICLO} AND CR_ID=${CR_ID} AND CONTA_ID=${CONTA} AND MES=${m};`);
}
