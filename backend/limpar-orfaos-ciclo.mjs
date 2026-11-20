// Limpeza retroativa: linhas cujo CICLO_ID aponta para um ciclo que nao existe
// mais. Sao restos da cascata incompleta de exclusao de versao (a tela apagava 7
// das 21 tabelas com CICLO_ID). Toda leitura do app filtra por CICLO_ID de um
// ciclo vivo, entao essas linhas ja estavam inalcancaveis — apagar nao muda nada
// do que o usuario ve, so para de carregar peso morto.
//
// CICLO_ID NULL NAO e orfao e fica intocado (ex.: DRIVER_CONFIG 252, config sem ciclo).
import 'dotenv/config';
import { configureSdkMitra, runDmlMitra } from 'mitra-sdk';
import { q } from './q.mjs';

configureSdkMitra({ baseURL: process.env.MITRA_BASE_URL, token: process.env.MITRA_TOKEN, integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS });
const projectId = parseInt(process.env.MITRA_PROJECT_ID);

const TABELAS = [
  'AUMENTO_SALARIAL', 'BENEFICIO', 'CONTRATACAO_PROJETADA', 'DESLIGAMENTO_PROJETADO',
  'DRIVER_CONFIG', 'DRIVER_FORMULA_VALOR', 'ENCARGO', 'HIST_PREMISSA', 'ORCAMENTO',
  'ORCAMENTO_PACOTE', 'ORCAMENTO_PESSOAL', 'ORCAMENTO_STATUS', 'PACOTE_STATUS',
  'PREENCHIMENTO_TOKEN', 'PREMISSA_DISSIDIO', 'PREMISSA_IMPOSTO', 'PREMISSA_LINHA',
  'PREMISSA_TURNOVER', 'PROJECAO_HEADCOUNT', 'RECEITA_PREMISSA', 'WORKFLOW_AUDITORIA',
];
const ORFA = "CICLO_ID IS NOT NULL AND CICLO_ID NOT IN (SELECT ID FROM CICLO)";

const antes = {};
for (const t of TABELAS) {
  const r = await q(`SELECT COUNT(*) N FROM ${t} WHERE ${ORFA}`);
  antes[t] = Number(r[0]?.N || 0);
}
const alvo = TABELAS.filter((t) => antes[t] > 0);
console.log('orfaos encontrados:', alvo.map((t) => `${t}=${antes[t]}`).join(' '));
console.log('total:', alvo.reduce((s, t) => s + antes[t], 0));

for (const t of alvo) {
  await runDmlMitra({ projectId, sql: `DELETE FROM ${t} WHERE ${ORFA}` });
  const r = await q(`SELECT COUNT(*) N FROM ${t} WHERE ${ORFA}`);
  console.log(`  ${t}: ${antes[t]} -> restam ${r[0]?.N ?? '?'}`);
}
console.log('limpeza concluida');
