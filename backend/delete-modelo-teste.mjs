// Deleta modelo personalizado com nome contendo "TESTE" (case-insensitive).
// Limpa DRIVER_FORMULA e DRIVER_CONFIG antes do DRIVERS pra nao deixar orfaos.
// PACOTES (TIPO_DRIVER='PACOTE') sao preservados.
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
  const matches = await query("SELECT ID, NOME, TIPO_DRIVER, ATIVO FROM DRIVERS WHERE UPPER(NOME) LIKE '%TESTE%' AND TIPO_DRIVER != 'PACOTE'");
  console.log(`Modelos com 'teste' encontrados: ${matches.length}`);
  matches.forEach(m => console.log(`  - ID ${m.ID} | ${m.NOME} | TIPO=${m.TIPO_DRIVER} | ATIVO=${m.ATIVO}`));

  if (matches.length === 0) { console.log('Nada a fazer.'); return; }

  for (const m of matches) {
    console.log(`\nExcluindo: ${m.NOME} (ID ${m.ID})`);

    const formulas = await query(`SELECT ID FROM DRIVER_FORMULA WHERE DRIVER_ID = ${m.ID}`);
    for (const f of formulas) {
      await deleteRecordMitra({ projectId, tableName: 'DRIVER_FORMULA', id: f.ID });
    }
    console.log(`  ${formulas.length} formulas removidas`);

    const configsById = await query(`SELECT ID FROM DRIVER_CONFIG WHERE DRIVER_ID = ${m.ID}`);
    for (const dc of configsById) {
      await deleteRecordMitra({ projectId, tableName: 'DRIVER_CONFIG', id: dc.ID });
    }
    const safeName = String(m.NOME).replace(/'/g, "''");
    const configsByName = await query(`SELECT ID FROM DRIVER_CONFIG WHERE DRIVER_TIPO = '${safeName}'`);
    for (const dc of configsByName) {
      await deleteRecordMitra({ projectId, tableName: 'DRIVER_CONFIG', id: dc.ID });
    }
    console.log(`  ${configsById.length + configsByName.length} configs removidas`);

    const contaDrivers = await query(`SELECT ID FROM CONTA_DRIVER WHERE DRIVER_ID = ${m.ID}`);
    for (const cd of contaDrivers) {
      await deleteRecordMitra({ projectId, tableName: 'CONTA_DRIVER', id: cd.ID });
    }
    console.log(`  ${contaDrivers.length} conta-driver removidos`);

    const contaExcs = await query(`SELECT ID FROM CONTA_DRIVER_EXCECAO WHERE DRIVER_ID = ${m.ID}`);
    for (const ce of contaExcs) {
      await deleteRecordMitra({ projectId, tableName: 'CONTA_DRIVER_EXCECAO', id: ce.ID });
    }
    console.log(`  ${contaExcs.length} excecoes removidas`);

    await deleteRecordMitra({ projectId, tableName: 'DRIVERS', id: m.ID });
    console.log('  driver removido');
  }

  console.log(`\n=== ${matches.length} modelo(s) 'teste' excluido(s) ===`);
}

run().catch(console.error);
