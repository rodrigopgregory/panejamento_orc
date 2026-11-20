import 'dotenv/config';
import { configureSdkMitra, runDmlMitra, runQueryMitra } from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});

const projectId = parseInt(process.env.MITRA_PROJECT_ID);

// teste 3 (versao atual, PENDENTE) sai; "Orcamento 2026: 0+12" (121) vira atual.
const DELETE_ID = 131;
const NEW_ATUAL_ID = 121;

const CHILD_TABLES = [
  'AUMENTO_SALARIAL', 'BENEFICIO', 'CONTRATACAO_PROJETADA', 'DESLIGAMENTO_PROJETADO', 'DRIVER_CONFIG',
  'DRIVER_FORMULA_VALOR', 'ENCARGO', 'HIST_PREMISSA', 'ORCAMENTO',
  'ORCAMENTO_PACOTE', 'ORCAMENTO_PESSOAL', 'ORCAMENTO_STATUS', 'PACOTE_STATUS',
  'PREENCHIMENTO_TOKEN', 'PREMISSA_DISSIDIO', 'PREMISSA_IMPOSTO', 'PREMISSA_LINHA',
  'PREMISSA_TURNOVER', 'PROJECAO_HEADCOUNT', 'WORKFLOW_AUDITORIA',
];

async function run() {
  console.log(`Excluindo CICLO ${DELETE_ID} (teste 3) e dependencias...`);
  for (const table of CHILD_TABLES) {
    try {
      await runDmlMitra({ projectId, sql: `DELETE FROM ${table} WHERE CICLO_ID = ${DELETE_ID}` });
      console.log(`  ok: ${table}`);
    } catch (e) {
      console.warn(`  skip ${table}: ${e?.message || e}`);
    }
  }
  await runDmlMitra({ projectId, sql: `DELETE FROM CICLO WHERE ID = ${DELETE_ID}` });
  console.log('  ok: CICLO (teste 3 removida)');

  // Garante versao atual unica: zera todas e marca a 121.
  await runDmlMitra({ projectId, sql: `UPDATE CICLO SET VERSAO_ATUAL = 'false' WHERE VERSAO_ATUAL = 'true'` });
  await runDmlMitra({ projectId, sql: `UPDATE CICLO SET VERSAO_ATUAL = 'true' WHERE ID = ${NEW_ATUAL_ID}` });
  console.log(`  ok: CICLO ${NEW_ATUAL_ID} agora e a versao atual`);

  const r = await runQueryMitra({ projectId, sql: `SELECT ID, NOME, ANO, STATUS, VERSAO_ATUAL, VERSAO_CONTROLE FROM CICLO ORDER BY ANO DESC, ID DESC` });
  console.log('Versoes restantes:', JSON.stringify(r?.result?.rows ?? r, null, 2));
}

run().catch((e) => { console.error(e); process.exit(1); });
