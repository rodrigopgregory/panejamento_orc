-- tipo: JAVASCRIPT | <p></p>

const { configureSdkMitra, runDmlMitra, runQueryMitra } = require('/opt/node_modules/mitra-sdk/dist/index.js');
configureSdkMitra({ baseURL: process.env.MITRA_BASE_URL, token: process.env.MITRA_TOKEN });
const projectId = parseInt(process.env.MITRA_PROJECT_ID);

module.exports = async function(params) {
  const { statusId, driversConfirmados, status, atualizadoEm } = params;
  const sqlSets = [];
  if (driversConfirmados !== undefined) sqlSets.push("DRIVERS_CONFIRMADOS = '" + String(driversConfirmados).replace(/'/g, "''") + "'");
  if (status !== undefined) sqlSets.push("STATUS = '" + String(status).replace(/'/g, "''") + "'");
  if (atualizadoEm !== undefined) sqlSets.push("ATUALIZADO_EM = '" + String(atualizadoEm).replace(/'/g, "''") + "'");
  if (sqlSets.length === 0) return { success: false, error: 'Nothing to update' };
  const sql = 'UPDATE ORCAMENTO_STATUS SET ' + sqlSets.join(', ') + ' WHERE ID = ' + parseInt(statusId);
  await runDmlMitra({ projectId, sql });
  const verify = await runQueryMitra({ projectId, sql: 'SELECT * FROM ORCAMENTO_STATUS WHERE ID = ' + parseInt(statusId) });
  return { success: true, record: verify.result && verify.result.rows ? verify.result.rows[0] : null };
};
