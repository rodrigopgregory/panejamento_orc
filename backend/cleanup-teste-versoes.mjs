import 'dotenv/config';
import { configureSdkMitra, runDmlMitra, runQueryMitra } from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});

const projectId = parseInt(process.env.MITRA_PROJECT_ID);

// Versoes duplicadas "Teste Sarah" (todas FECHADO, nao-atual, nao-controle).
// teste 3 (131) NAO entra aqui: e a versao ATUAL do sistema.
const CICLO_IDS = [122, 123, 125, 127, 129, 130];

// Todas as tabelas com coluna CICLO_ID (descobertas via INFORMATION_SCHEMA).
const CHILD_TABLES = [
  'AUMENTO_SALARIAL', 'BENEFICIO', 'CONTRATACAO_PROJETADA', 'DESLIGAMENTO_PROJETADO', 'DRIVER_CONFIG',
  'DRIVER_FORMULA_VALOR', 'ENCARGO', 'HIST_PREMISSA', 'ORCAMENTO',
  'ORCAMENTO_PACOTE', 'ORCAMENTO_PESSOAL', 'ORCAMENTO_STATUS', 'PACOTE_STATUS',
  'PREENCHIMENTO_TOKEN', 'PREMISSA_DISSIDIO', 'PREMISSA_IMPOSTO', 'PREMISSA_LINHA',
  'PREMISSA_TURNOVER', 'PROJECAO_HEADCOUNT', 'WORKFLOW_AUDITORIA',
];

const idList = CICLO_IDS.join(',');

async function run() {
  console.log(`Limpando versoes CICLO ${idList} e dependencias...`);

  for (const table of CHILD_TABLES) {
    try {
      await runDmlMitra({ projectId, sql: `DELETE FROM ${table} WHERE CICLO_ID IN (${idList})` });
      console.log(`  ok: ${table}`);
    } catch (e) {
      console.warn(`  skip ${table}: ${e?.message || e}`);
    }
  }

  await runDmlMitra({ projectId, sql: `DELETE FROM CICLO WHERE ID IN (${idList})` });
  console.log('  ok: CICLO');

  const r = await runQueryMitra({ projectId, sql: `SELECT ID, NOME, STATUS, VERSAO_ATUAL FROM CICLO WHERE LOWER(NOME) LIKE '%teste%' ORDER BY ID` });
  console.log('Restante com "teste":', JSON.stringify(r?.result?.rows ?? r));
}

run().catch((e) => { console.error(e); process.exit(1); });
