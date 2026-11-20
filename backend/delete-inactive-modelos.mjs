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
  console.log('=== Excluindo modelos inativos ===\n');

  const inativos = await query("SELECT ID, NOME FROM DRIVERS WHERE TIPO_DRIVER != 'PACOTE' AND ATIVO = 'false'");
  console.log(`Modelos inativos encontrados: ${inativos.length}`);

  if (inativos.length === 0) { console.log('Nada a fazer.'); return; }

  for (const m of inativos) {
    console.log(`  Excluindo: ${m.NOME} (ID ${m.ID})`);

    const formulas = await query(`SELECT ID FROM DRIVER_FORMULA WHERE DRIVER_ID = ${m.ID}`);
    for (const f of formulas) {
      await deleteRecordMitra({ projectId, tableName: 'DRIVER_FORMULA', id: f.ID });
    }

    const configsById = await query(`SELECT ID FROM DRIVER_CONFIG WHERE DRIVER_ID = ${m.ID}`);
    for (const dc of configsById) {
      await deleteRecordMitra({ projectId, tableName: 'DRIVER_CONFIG', id: dc.ID });
    }

    const configsByName = await query(`SELECT ID FROM DRIVER_CONFIG WHERE DRIVER_TIPO = '${m.NOME}'`);
    for (const dc of configsByName) {
      await deleteRecordMitra({ projectId, tableName: 'DRIVER_CONFIG', id: dc.ID });
    }

    await deleteRecordMitra({ projectId, tableName: 'DRIVERS', id: m.ID });
  }

  console.log(`\n=== ${inativos.length} modelos inativos excluídos ===`);
}

run().catch(console.error);
