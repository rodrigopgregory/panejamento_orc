-- tipo: JAVASCRIPT | Confirma um driver especifico de um CR como concluido
module.exports = async function(params, context) {
  var pid = parseInt(context.tenantId);
  var q = async function(sql) { var r = await mitra.runQueryMitra({ projectId: pid, sql: sql }); return (r && r.result && r.result.rows) || []; };
  var dml = async function(sql) { return await mitra.runDmlMitra({ projectId: pid, sql: sql }); };
  var pf = function(v) { return parseFloat(v) || 0; };
  var pi = function(v) { return parseInt(v) || 0; };
  var esc = function(s) { return s ? String(s).replace(/'/g, "''") : ""; };
  var cicloId = pi(params.cicloId); var crId = pi(params.crId); var driverTipo = params.driverTipo;
  if (!cicloId || !crId || !driverTipo) return { success: false, erro: "cicloId, crId e driverTipo obrigatorios" };

  var sts = await q("SELECT * FROM ORCAMENTO_STATUS WHERE CICLO_ID = " + cicloId + " AND CR_ID = " + crId);
  var st = sts[0];
  if (!st) return { success: false, erro: "ORCAMENTO_STATUS nao encontrado para CR " + crId };

  var confirmados = (st.DRIVERS_CONFIRMADOS || "").split(",").filter(function(x) { return x.trim(); });
  if (confirmados.indexOf(driverTipo) === -1) confirmados.push(driverTipo);
  var novoCSV = confirmados.join(",");

  var drvTypes = await q("SELECT DISTINCT DRIVER_TIPO FROM DRIVER_CONFIG WHERE CR_ID = " + crId);
  var esperados = drvTypes.map(function(d) { return d.DRIVER_TIPO; });
  var pendentes = esperados.filter(function(e) { return confirmados.indexOf(e) === -1; });

  await dml("UPDATE ORCAMENTO_STATUS SET DRIVERS_CONFIRMADOS = '" + esc(novoCSV) + "' WHERE ID = " + st.ID);

  return { success: true, driversConfirmados: confirmados, driversPendentes: pendentes, podeSubmeter: pendentes.length === 0 };
};