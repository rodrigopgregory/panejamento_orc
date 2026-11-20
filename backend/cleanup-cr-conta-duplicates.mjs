// Limpa duplicatas em CR_CONTA e adiciona UNIQUE KEY para prevenir reincidencia.
// Mantem a linha mais antiga (menor ID) de cada (CR_ID, CONTA_ID) e apaga as outras.
import 'dotenv/config';
import { configureSdkMitra, runQueryMitra, runDdlMitra, runDmlMitra } from 'mitra-sdk';
configureSdkMitra({ baseURL: process.env.MITRA_BASE_URL, token: process.env.MITRA_TOKEN, integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS });
const projectId = parseInt(process.env.MITRA_PROJECT_ID);

const dups = await runQueryMitra({
  projectId,
  sql: `SELECT CR_ID, CONTA_ID, MIN(ID) AS KEEP_ID, GROUP_CONCAT(ID ORDER BY ID) AS ALL_IDS
        FROM CR_CONTA WHERE ATIVO = true
        GROUP BY CR_ID, CONTA_ID HAVING COUNT(*) > 1`,
});
const rows = dups.result?.rows || [];
console.log(`Encontradas ${rows.length} (CR, conta) com duplicata.`);
for (const r of rows) {
  const ids = String(r.ALL_IDS).split(',').map(Number);
  const toDelete = ids.filter((id) => id !== r.KEEP_ID);
  console.log(`  CR=${r.CR_ID} CONTA=${r.CONTA_ID} -> mantem ${r.KEEP_ID}, apaga [${toDelete.join(',')}]`);
  if (toDelete.length > 0) {
    await runDmlMitra({ projectId, sql: `DELETE FROM CR_CONTA WHERE ID IN (${toDelete.join(',')})` });
  }
}

// Verifica se ja existe UNIQUE
const hasUnique = await runQueryMitra({
  projectId,
  sql: `SELECT COUNT(*) AS C FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'CR_CONTA' AND INDEX_NAME = 'UQ_CR_CONTA'`,
});
if (Number(hasUnique.result?.rows?.[0]?.C || 0) > 0) {
  console.log('UQ_CR_CONTA ja existe');
} else {
  await runDdlMitra({ projectId, sql: `ALTER TABLE CR_CONTA ADD UNIQUE KEY UQ_CR_CONTA (CR_ID, CONTA_ID)` });
  console.log('UQ_CR_CONTA(CR_ID, CONTA_ID) adicionada');
}

const after = await runQueryMitra({
  projectId,
  sql: `SELECT COUNT(*) AS TOTAL, COUNT(DISTINCT CR_ID, CONTA_ID) AS DISTINCT_PAIRS FROM CR_CONTA WHERE ATIVO = true`,
});
console.log('Estado final:', after.result?.rows?.[0]);
