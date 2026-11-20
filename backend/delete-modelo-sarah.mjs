import 'dotenv/config';
import { configureSdkMitra, executeServerFunctionMitra, deleteRecordMitra } from 'mitra-sdk';

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

async function run() {
  const matches = await query("SELECT ID, NOME, TIPO_DRIVER, ATIVO FROM DRIVERS WHERE UPPER(NOME) LIKE '%SARAH%' AND TIPO_DRIVER != 'PACOTE'");
  console.log(`Modelos com 'sarah' encontrados: ${matches.length}`);
  matches.forEach(m => console.log(`  - ID ${m.ID} | ${m.NOME} | ATIVO=${m.ATIVO}`));

  if (matches.length === 0) { console.log('Nada a fazer.'); return; }

  for (const m of matches) {
    console.log(`\nExcluindo: ${m.NOME} (ID ${m.ID})`);

    const formulas = await query(`SELECT ID FROM DRIVER_FORMULA WHERE DRIVER_ID = ${m.ID}`);
    for (const f of formulas) {
      await deleteRecordMitra({ projectId, tableName: 'DRIVER_FORMULA', id: f.ID });
    }
    console.log(`  ${formulas.length} fórmulas removidas`);

    const configsById = await query(`SELECT ID FROM DRIVER_CONFIG WHERE DRIVER_ID = ${m.ID}`);
    for (const dc of configsById) {
      await deleteRecordMitra({ projectId, tableName: 'DRIVER_CONFIG', id: dc.ID });
    }
    const configsByName = await query(`SELECT ID FROM DRIVER_CONFIG WHERE DRIVER_TIPO = '${m.NOME}'`);
    for (const dc of configsByName) {
      await deleteRecordMitra({ projectId, tableName: 'DRIVER_CONFIG', id: dc.ID });
    }
    console.log(`  ${configsById.length + configsByName.length} configs removidas`);

    await deleteRecordMitra({ projectId, tableName: 'DRIVERS', id: m.ID });
    console.log('  driver removido');
  }

  console.log(`\n=== ${matches.length} modelo(s) 'sarah' excluído(s) ===`);
}

run().catch(console.error);
