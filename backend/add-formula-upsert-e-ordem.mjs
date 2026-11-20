// Duas adicoes aditivas (nao toca em nada existente):
//
// TASK 1 — corrige "erro ao salvar linha personalizada" no preenchimento INTERNO.
//   Causa: doSaveCustomLineCell usava CRUD REST direto em DRIVER_FORMULA_VALOR,
//   que retorna 403 para usuario business (gestor). Solucao: SF SQL de upsert
//   (executeServerFunction e permitido para business). Upsert real via UNIQUE KEY
//   + ON DUPLICATE KEY UPDATE (MySQL 8.3). Verificado: 0 duplicatas hoje.
//
// TASK 2 — permite escolher a ORDEM em que os modelos (drivers) aparecem.
//   Coluna DRIVERS.ORDEM (aditiva, default 0, backfill = ID) + SFs de leitura e
//   persistencia. O frontend le a ordem, ordena e reordena por drag.
import 'dotenv/config';
import { configureSdkMitra, runDdlMitra, runDmlMitra, createServerFunctionMitra, listServerFunctionsMitra } from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});
const projectId = parseInt(process.env.MITRA_PROJECT_ID);

async function ddl(sql, label) {
  try { await runDdlMitra({ projectId, sql }); console.log('OK  DDL', label); }
  catch (e) { console.log('SKIP DDL', label, '->', String(e.message || e).slice(0, 90)); }
}
async function dml(sql, label) {
  try { const r = await runDmlMitra({ projectId, sql }); console.log('OK  DML', label, JSON.stringify(r?.result ?? r).slice(0, 80)); }
  catch (e) { console.log('SKIP DML', label, '->', String(e.message || e).slice(0, 90)); }
}

// ---------------- TASK 1: upsert de valor de linha custom ----------------
await ddl(
  "ALTER TABLE DRIVER_FORMULA_VALOR ADD UNIQUE INDEX uq_dfv (FORMULA_ID, CICLO_ID, CR_ID, MES)",
  'unique uq_dfv em DRIVER_FORMULA_VALOR'
);

// ---------------- TASK 2: coluna ORDEM em DRIVERS ------------------------
await ddl("ALTER TABLE DRIVERS ADD COLUMN ORDEM INT DEFAULT 0", 'DRIVERS.ORDEM');
await dml("UPDATE DRIVERS SET ORDEM = ID WHERE ORDEM IS NULL OR ORDEM = 0", 'backfill ORDEM = ID');

// ---------------- SFs novas ---------------------------------------------
const defs = [
  {
    name: 'upsertFormulaValor',
    type: 'SQL',
    code: "INSERT INTO DRIVER_FORMULA_VALOR (FORMULA_ID, CICLO_ID, CR_ID, MES, VALOR) VALUES ({{formulaId}}, {{cicloId}}, {{crId}}, {{mes}}, {{valor}}) ON DUPLICATE KEY UPDATE VALOR = {{valor}}",
    description: 'Upsert de um valor de linha custom de formula (DRIVER_FORMULA_VALOR). Params: formulaId, cicloId, crId, mes, valor. Usada pelo preenchimento interno (evita 403 do CRUD REST para business).',
  },
  {
    name: 'driversOrdem',
    type: 'SQL',
    code: "SELECT ID, ORDEM FROM DRIVERS ORDER BY ORDEM, ID",
    description: 'Ordem atual dos modelos/drivers (ID -> ORDEM). Sem params.',
  },
  {
    name: 'setDriverOrdem',
    type: 'SQL',
    code: "UPDATE DRIVERS SET ORDEM = {{ordem}} WHERE ID = {{driverId}}",
    description: 'Persiste a ordem de um modelo/driver. Params: driverId, ordem.',
  },
];

for (const d of defs) {
  try {
    const r = await createServerFunctionMitra({ projectId, name: d.name, type: d.type, code: d.code, description: d.description });
    console.log(`OK  SF ${d.name} -> ID ${r?.result?.serverFunctionId ?? JSON.stringify(r?.result)}`);
  } catch (e) {
    console.log(`SKIP SF ${d.name} ->`, String(e.message || e).slice(0, 90));
  }
}

// Descobrir IDs finais (para hardcode no frontend)
const list = await listServerFunctionsMitra({ projectId });
const arr = Array.isArray(list) ? list : (list?.result || list?.content || []);
const wanted = ['upsertFormulaValor', 'driversOrdem', 'setDriverOrdem'];
console.log('\n=== IDs das SFs (use no frontend) ===');
for (const name of wanted) {
  const hits = arr.filter(s => s.name === name).map(s => s.id);
  console.log(`${name}: ${JSON.stringify(hits)}`);
}
console.log('done');
