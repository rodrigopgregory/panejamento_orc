import 'dotenv/config';
import { configureSdkMitra, runDdlMitra, runDmlMitra } from 'mitra-sdk';
import { executeServerFunctionMitra } from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});

const projectId = parseInt(process.env.MITRA_PROJECT_ID);
const SF_QUERY = 18;

async function query(sql) {
  const res = await executeServerFunctionMitra({ projectId, serverFunctionId: SF_QUERY, input: { sql } });
  let output = res?.result?.output;
  if (typeof output === 'string') try { output = JSON.parse(output); } catch {}
  if (output && Array.isArray(output.rows)) return output.rows;
  if (Array.isArray(output)) return output;
  return [];
}

async function migrate() {
  console.log('=== Migração: Versionamento de Premissas ===\n');

  // 1. Add CICLO_ID and DRIVER_ID to DRIVER_CONFIG
  console.log('1. Adicionando colunas a DRIVER_CONFIG...');
  try {
    await runDdlMitra({ projectId, sql: 'ALTER TABLE DRIVER_CONFIG ADD COLUMN CICLO_ID INT NULL' });
    console.log('   ✓ CICLO_ID adicionado');
  } catch (e) { console.log('   → CICLO_ID já existe ou erro:', e.message || e); }

  try {
    await runDdlMitra({ projectId, sql: 'ALTER TABLE DRIVER_CONFIG ADD COLUMN DRIVER_ID INT NULL' });
    console.log('   ✓ DRIVER_ID adicionado');
  } catch (e) { console.log('   → DRIVER_ID já existe ou erro:', e.message || e); }

  // 2. Add CICLO_ID to BENEFICIO
  console.log('2. Adicionando CICLO_ID a BENEFICIO...');
  try {
    await runDdlMitra({ projectId, sql: 'ALTER TABLE BENEFICIO ADD COLUMN CICLO_ID INT NULL' });
    console.log('   ✓ CICLO_ID adicionado');
  } catch (e) { console.log('   → CICLO_ID já existe ou erro:', e.message || e); }

  // 3. Add CICLO_ID to ENCARGO
  console.log('3. Adicionando CICLO_ID a ENCARGO...');
  try {
    await runDdlMitra({ projectId, sql: 'ALTER TABLE ENCARGO ADD COLUMN CICLO_ID INT NULL' });
    console.log('   ✓ CICLO_ID adicionado');
  } catch (e) { console.log('   → CICLO_ID já existe ou erro:', e.message || e); }

  // 4. Backfill DRIVER_ID from DRIVERS table
  console.log('4. Backfill DRIVER_ID...');
  try {
    await runDmlMitra({ projectId, sql: `
      UPDATE DRIVER_CONFIG dc
      JOIN DRIVERS d ON d.NOME = dc.DRIVER_TIPO AND d.ATIVO = 'true'
      SET dc.DRIVER_ID = d.ID
      WHERE dc.DRIVER_ID IS NULL
    `});
    console.log('   ✓ DRIVER_ID backfill concluído');
  } catch (e) { console.log('   → Erro no backfill DRIVER_ID:', e.message || e); }

  // 5. Find current active version
  console.log('5. Buscando versão ativa...');
  let currentCicloId = null;
  try {
    const ciclos = await query("SELECT * FROM CICLO ORDER BY ID DESC");
    const current = ciclos.find(c => c.VERSAO_ATUAL === 'true');
    if (current) {
      currentCicloId = current.ID;
      console.log(`   ✓ Versão ativa: ${current.NOME} (ID: ${current.ID})`);
    } else if (ciclos.length > 0) {
      currentCicloId = ciclos[0].ID;
      console.log(`   → Sem versão ativa, usando mais recente: ID ${currentCicloId}`);
    }
  } catch (e) { console.log('   → Erro ao buscar versão:', e.message || e); }

  // 6. Backfill CICLO_ID for existing records
  if (currentCicloId) {
    console.log(`6. Backfill CICLO_ID = ${currentCicloId} para registros existentes...`);

    try {
      await runDmlMitra({ projectId, sql: `UPDATE DRIVER_CONFIG SET CICLO_ID = ${currentCicloId} WHERE CICLO_ID IS NULL` });
      console.log('   ✓ DRIVER_CONFIG backfill concluído');
    } catch (e) { console.log('   → Erro:', e.message || e); }

    try {
      await runDmlMitra({ projectId, sql: `UPDATE BENEFICIO SET CICLO_ID = ${currentCicloId} WHERE CICLO_ID IS NULL` });
      console.log('   ✓ BENEFICIO backfill concluído');
    } catch (e) { console.log('   → Erro:', e.message || e); }

    try {
      await runDmlMitra({ projectId, sql: `UPDATE ENCARGO SET CICLO_ID = ${currentCicloId} WHERE CICLO_ID IS NULL` });
      console.log('   ✓ ENCARGO backfill concluído');
    } catch (e) { console.log('   → Erro:', e.message || e); }
  } else {
    console.log('6. Sem versão encontrada — backfill de CICLO_ID pulado.');
  }

  // 7. Verify
  console.log('\n7. Verificando...');
  try {
    const dcCount = await query("SELECT COUNT(*) as CNT FROM DRIVER_CONFIG WHERE CICLO_ID IS NOT NULL");
    console.log(`   DRIVER_CONFIG com CICLO_ID: ${dcCount[0]?.CNT || 0}`);
    const dcDriverId = await query("SELECT COUNT(*) as CNT FROM DRIVER_CONFIG WHERE DRIVER_ID IS NOT NULL");
    console.log(`   DRIVER_CONFIG com DRIVER_ID: ${dcDriverId[0]?.CNT || 0}`);
    const benCount = await query("SELECT COUNT(*) as CNT FROM BENEFICIO WHERE CICLO_ID IS NOT NULL");
    console.log(`   BENEFICIO com CICLO_ID: ${benCount[0]?.CNT || 0}`);
    const encCount = await query("SELECT COUNT(*) as CNT FROM ENCARGO WHERE CICLO_ID IS NOT NULL");
    console.log(`   ENCARGO com CICLO_ID: ${encCount[0]?.CNT || 0}`);
  } catch (e) { console.log('   → Erro na verificação:', e.message || e); }

  console.log('\n=== Migração concluída! ===');
}

migrate().catch(console.error);
