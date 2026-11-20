-- tipo: JAVASCRIPT | Submete CR para aprovacao. Requer todos os drivers confirmados.
module.exports = async function(params, context) {
  var pid = parseInt(context.tenantId);
  var q = async function(sql) { var r = await mitra.runQueryMitra({ projectId: pid, sql: sql }); return (r && r.result && r.result.rows) || []; };
  var dml = async function(sql) { return await mitra.runDmlMitra({ projectId: pid, sql: sql }); };
  var pf = function(v) { return parseFloat(v) || 0; };
  var pi = function(v) { return parseInt(v) || 0; };
  var esc = function(s) { return s ? String(s).replace(/'/g, "''") : ""; };
  var cicloId = pi(params.cicloId); var crId = pi(params.crId);
  if (!cicloId || !crId) return { success: false, erro: "cicloId e crId obrigatorios" };

  var sts = await q("SELECT * FROM ORCAMENTO_STATUS WHERE CICLO_ID = " + cicloId + " AND CR_ID = " + crId);
  var st = sts[0];
  if (!st) return { success: false, erro: "ORCAMENTO_STATUS nao encontrado" };
  if (st.STATUS !== "PENDENTE" && st.STATUS !== "CONFIRMADO") return { success: false, erro: "CR ja esta em status " + st.STATUS };

  var drvTypes = await q("SELECT DISTINCT DRIVER_TIPO FROM DRIVER_CONFIG WHERE CR_ID = " + crId);
  var esperados = drvTypes.map(function(d) { return d.DRIVER_TIPO; });
  var confirmados = (st.DRIVERS_CONFIRMADOS || "").split(",").filter(function(x) { return x.trim(); });
  var pendentes = esperados.filter(function(e) { return confirmados.indexOf(e) === -1; });
  if (pendentes.length > 0) return { success: false, erro: "Drivers pendentes: " + pendentes.join(", "), driversConfirmados: confirmados, driversPendentes: pendentes };

  var orcTotal = await q("SELECT SUM(VALOR) AS TOTAL FROM ORCAMENTO WHERE CICLO_ID = " + cicloId + " AND CR_ID = " + crId);
  var contasP = await q("SELECT COUNT(DISTINCT CONTA_ID) AS N FROM ORCAMENTO WHERE CICLO_ID = " + cicloId + " AND CR_ID = " + crId + " AND VALOR > 0");

  var agora = new Date().toISOString().slice(0, 19);
  await dml("UPDATE ORCAMENTO_STATUS SET STATUS = 'SUBMETIDO', ATUALIZADO_EM = '" + agora + "' WHERE ID = " + st.ID);

  return { success: true, novoStatus: "SUBMETIDO", resumo: { totalOrcado: pf(orcTotal[0] && orcTotal[0].TOTAL), contasPreenchidas: pi(contasP[0] && contasP[0].N), contasTotal: esperados.length } };
};