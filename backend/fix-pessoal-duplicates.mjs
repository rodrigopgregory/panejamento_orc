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

async function fix() {
  console.log('=== Limpeza de registros duplicados de pessoal na ORCAMENTO ===\n');

  const subcontas = await query(`
    SELECT ID, CODIGO FROM CONTA_CONTABIL
    WHERE CODIGO IN ('5.1.01.01', '5.1.02.01', '5.1.02.02', '5.1.03.01', '5.1.03.02')
  `);

  if (subcontas.length === 0) {
    console.log('Nenhuma sub-conta de pessoal encontrada. Nada a fazer.');
    return;
  }

  console.log('Sub-contas encontradas:', subcontas.map(c => c.CODIGO).join(', '));

  const ids = subcontas.map(c => c.ID).join(',');
  const duplicates = await query(`
    SELECT o.ID, o.CONTA_ID, o.CR_ID, o.MES, o.VALOR, cc.CODIGO
    FROM ORCAMENTO o
    JOIN CONTA_CONTABIL cc ON cc.ID = o.CONTA_ID
    WHERE o.CONTA_ID IN (${ids})
    ORDER BY o.CR_ID, cc.CODIGO, o.MES
  `);

  console.log(`\nRegistros de sub-contas na ORCAMENTO: ${duplicates.length}`);

  if (duplicates.length === 0) {
    console.log('Nenhum registro duplicado. Tudo limpo!');
    return;
  }

  console.log('\nExemplos de registros a remover:');
  for (const d of duplicates.slice(0, 10)) {
    console.log(`  CR ${d.CR_ID} | ${d.CODIGO} | Mês ${d.MES} | Valor ${d.VALOR}`);
  }
  if (duplicates.length > 10) console.log(`  ... e mais ${duplicates.length - 10} registros`);

  console.log('\nRemovendo...');
  let removed = 0;
  for (const d of duplicates) {
    try {
      await deleteRecordMitra({ projectId, tableName: 'ORCAMENTO', id: d.ID });
      removed++;
    } catch (e) {
      console.log(`  Erro ao remover ID ${d.ID}: ${e.message}`);
    }
  }

  console.log(`\n=== Concluído! ${removed} registros duplicados removidos ===`);
}

fix().catch(console.error);
