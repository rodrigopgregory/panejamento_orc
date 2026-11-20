import 'dotenv/config';
import { configureSdkMitra, executeServerFunctionMitra } from 'mitra-sdk';

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

async function main() {
  // 1. All contas contábeis
  console.log('=== CONTAS CONTÁBEIS (ordered by CODIGO) ===');
  const contas = await query("SELECT ID, CODIGO, NOME FROM CONTA_CONTABIL ORDER BY CODIGO");
  contas.forEach(c => console.log(`  [ID=${c.ID}] ${c.CODIGO} - ${c.NOME}`));
  console.log(`Total: ${contas.length}\n`);

  // 2. Active drivers
  console.log('=== DRIVERS ATIVOS ===');
  const drivers = await query("SELECT ID, NOME, TIPO_DRIVER FROM DRIVERS WHERE ATIVO = 'true' ORDER BY NOME");
  drivers.forEach(d => console.log(`  [ID=${d.ID}] ${d.NOME} (${d.TIPO_DRIVER})`));
  console.log(`Total: ${drivers.length}\n`);

  // 3. Active ciclo
  console.log('=== CICLO ATIVO (VERSAO_ATUAL = true) ===');
  const ciclos = await query("SELECT ID, NOME, VERSAO_ATUAL FROM CICLO WHERE VERSAO_ATUAL = 'true'");
  ciclos.forEach(c => console.log(`  [ID=${c.ID}] ${c.NOME}`));
  console.log('');

  // 4. Mappings for active ciclo, grouped by DRIVER_TIPO
  const cicloId = ciclos.length > 0 ? ciclos[0].ID : null;
  const cicloFilter = cicloId ? `WHERE dc.CICLO_ID = ${cicloId}` : '';

  console.log('=== DRIVER_CONFIG MAPPINGS (grouped by DRIVER_TIPO) ===');
  const mappings = await query(`
    SELECT dc.ID, dc.DRIVER_TIPO, dc.CONTA_ID, dc.DRIVER_ID, dc.CR_ID,
           cc.CODIGO, cc.NOME AS CONTA_NOME,
           d.NOME AS DRIVER_NOME
    FROM DRIVER_CONFIG dc
    LEFT JOIN CONTA_CONTABIL cc ON cc.ID = dc.CONTA_ID
    LEFT JOIN DRIVERS d ON d.ID = dc.DRIVER_ID
    ${cicloFilter}
    ORDER BY dc.DRIVER_TIPO, cc.CODIGO
  `);

  // Group by DRIVER_TIPO
  const grouped = {};
  for (const m of mappings) {
    const key = m.DRIVER_TIPO || '(null)';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(m);
  }

  for (const [tipo, items] of Object.entries(grouped)) {
    console.log(`\n  DRIVER_TIPO: ${tipo} (${items.length} contas)`);
    console.log(`  Driver: ${items[0].DRIVER_NOME || '(unknown)'} [ID=${items[0].DRIVER_ID}]`);
    for (const m of items) {
      console.log(`    - [${m.CODIGO}] ${m.CONTA_NOME} (config_id=${m.ID}, cr_id=${m.CR_ID})`);
    }
  }
  console.log(`\nTotal mappings: ${mappings.length}`);

  // 5. Check for CRs
  console.log('\n=== CENTRO DE RESULTADO (CRs) ===');
  const crs = await query("SELECT ID, NOME FROM CENTRO_RESULTADO ORDER BY ID LIMIT 20");
  crs.forEach(cr => console.log(`  [ID=${cr.ID}] ${cr.NOME}`));
  console.log(`Total: ${crs.length}`);
}

main().catch(e => { console.error(e); process.exit(1); });
