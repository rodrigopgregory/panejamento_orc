import 'dotenv/config';
import { configureSdkMitra, runDmlMitra, runQueryMitra } from 'mitra-sdk';
function backUrlFromToken(token) { try { const raw = (token || '').replace(/^Bearer\s+/i, ''); const payload = JSON.parse(Buffer.from(raw.split('.')[1], 'base64').toString('utf8')); return payload.backURL || payload.backUrl; } catch { return null; } }
const baseURL = process.env.MITRA_BASE_URL || backUrlFromToken(process.env.MITRA_TOKEN);
configureSdkMitra({ baseURL, token: process.env.MITRA_TOKEN, integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS || baseURL });
const projectId = parseInt(process.env.MITRA_PROJECT_ID);
async function q(sql) { const r = await runQueryMitra({ projectId, sql }); return r.result?.rows || r; }

// Para cada pacote, descobre CRs validos pela configuracao atual
// (CR_CONTA das contas vinculadas via CONTA_DRIVER ou CONTA_DRIVER_EXCECAO)
// e DELETA do ORCAMENTO_PACOTE qualquer linha com CR fora dessa lista.

const pacotes = await q(`SELECT ID, NOME FROM DRIVERS WHERE TIPO_DRIVER = 'PACOTE' AND ATIVO = 'true'`);
console.log(`Pacotes ativos: ${pacotes.length}`);

let totalRemoved = 0;
for (const pkg of pacotes) {
  // CRs validos pra esse pacote (mesma logica da pkgRegras query)
  const validCRs = await q(`
    SELECT DISTINCT crc.CR_ID
    FROM CR_CONTA crc
    LEFT JOIN CONTA_DRIVER cd ON cd.CONTA_ID = crc.CONTA_ID
    LEFT JOIN CONTA_DRIVER_EXCECAO ex ON ex.CR_ID = crc.CR_ID AND ex.CONTA_ID = crc.CONTA_ID AND ex.ATIVO = true
    WHERE crc.ATIVO = true
      AND COALESCE(ex.DRIVER_ID, cd.DRIVER_ID) = ${pkg.ID}
  `);
  const validIds = validCRs.map(r => r.CR_ID);

  // CRs ORFAOS no ORCAMENTO_PACOTE
  const orphansQuery = validIds.length > 0
    ? `SELECT DISTINCT CR_ID FROM ORCAMENTO_PACOTE WHERE DRIVER_ID = ${pkg.ID} AND CR_ID NOT IN (${validIds.join(',')})`
    : `SELECT DISTINCT CR_ID FROM ORCAMENTO_PACOTE WHERE DRIVER_ID = ${pkg.ID}`;
  const orphans = await q(orphansQuery);

  if (orphans.length === 0) {
    console.log(`Pacote ${pkg.ID} (${pkg.NOME}): OK - sem orfaos (${validIds.length} CRs validos)`);
    continue;
  }

  console.log(`\nPacote ${pkg.ID} (${pkg.NOME}): ${validIds.length} CRs validos, ${orphans.length} CRs orfaos -> ${orphans.map(o => o.CR_ID).join(',')}`);

  const delSql = validIds.length > 0
    ? `DELETE FROM ORCAMENTO_PACOTE WHERE DRIVER_ID = ${pkg.ID} AND CR_ID NOT IN (${validIds.join(',')})`
    : `DELETE FROM ORCAMENTO_PACOTE WHERE DRIVER_ID = ${pkg.ID}`;
  const r = await runDmlMitra({ projectId, sql: delSql });
  console.log(`  -> Removidas: ${r.rowsAffected || JSON.stringify(r)}`);
  totalRemoved += (r.rowsAffected || 0);
}
console.log(`\nTotal removido: ${totalRemoved} linhas`);
