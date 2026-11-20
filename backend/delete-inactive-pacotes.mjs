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
  console.log('=== Excluindo pacotes inativos ===\n');

  const inativos = await query("SELECT ID, NOME FROM DRIVERS WHERE TIPO_DRIVER = 'PACOTE' AND ATIVO = 'false'");
  console.log(`Pacotes inativos encontrados: ${inativos.length}`);

  if (inativos.length === 0) { console.log('Nada a fazer.'); return; }

  for (const p of inativos) {
    console.log(`  Excluindo: ${p.NOME} (ID ${p.ID})`);

    // Remove related records first
    const regras = await query(`SELECT ID FROM CONTA_DRIVER WHERE DRIVER_ID = ${p.ID}`);
    for (const r of regras) {
      await deleteRecordMitra({ projectId, tableName: 'CONTA_DRIVER', id: r.ID });
    }

    const gps = await query(`SELECT ID FROM GESTOR_PACOTE WHERE DRIVER_ID = ${p.ID}`);
    for (const g of gps) {
      await deleteRecordMitra({ projectId, tableName: 'GESTOR_PACOTE', id: g.ID });
    }

    const dcs = await query(`SELECT ID FROM DRIVER_CONFIG WHERE DRIVER_TIPO = '${p.NOME}'`);
    for (const dc of dcs) {
      await deleteRecordMitra({ projectId, tableName: 'DRIVER_CONFIG', id: dc.ID });
    }

    const ps = await query(`SELECT ID FROM PACOTE_STATUS WHERE DRIVER_ID = ${p.ID}`);
    for (const s of ps) {
      await deleteRecordMitra({ projectId, tableName: 'PACOTE_STATUS', id: s.ID });
    }

    const ops = await query(`SELECT ID FROM ORCAMENTO_PACOTE WHERE DRIVER_ID = ${p.ID}`);
    for (const o of ops) {
      await deleteRecordMitra({ projectId, tableName: 'ORCAMENTO_PACOTE', id: o.ID });
    }

    const rcs = await query(`SELECT ID FROM RATEIO_CONFIG WHERE DRIVER_ID = ${p.ID}`);
    for (const r of rcs) {
      const rcrs = await query(`SELECT ID FROM RATEIO_CR WHERE RATEIO_CONFIG_ID = ${r.ID}`);
      for (const rcr of rcrs) {
        await deleteRecordMitra({ projectId, tableName: 'RATEIO_CR', id: rcr.ID });
      }
      await deleteRecordMitra({ projectId, tableName: 'RATEIO_CONFIG', id: r.ID });
    }

    await deleteRecordMitra({ projectId, tableName: 'DRIVERS', id: p.ID });
  }

  console.log(`\n=== ${inativos.length} pacotes inativos excluídos ===`);
}

run().catch(console.error);
