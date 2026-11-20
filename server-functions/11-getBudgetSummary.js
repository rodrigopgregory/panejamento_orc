-- tipo: JAVASCRIPT | KPIs de alto nivel do ciclo orcamentario
module.exports = async function(params, context) {
  var pid = parseInt(context.tenantId);
  var q = async function(sql) { var r = await mitra.runQueryMitra({ projectId: pid, sql: sql }); return (r && r.result && r.result.rows) || []; };
  var dml = async function(sql) { return await mitra.runDmlMitra({ projectId: pid, sql: sql }); };
  var pf = function(v) { return parseFloat(v) || 0; };
  var pi = function(v) { return parseInt(v) || 0; };
  var esc = function(s) { return s ? String(s).replace(/'/g, "''") : ""; };
  var cicloId = pi(params.cicloId);
  if (!cicloId) return { success: false, erro: "cicloId obrigatorio" };

  var ciclos = await q("SELECT * FROM CICLO WHERE ID = " + cicloId);
  var ciclo = ciclos[0]; var anoAnt = pi(ciclo.ANO) - 1;

  var orcTotal = await q("SELECT SUM(VALOR) AS TOTAL FROM ORCAMENTO WHERE CICLO_ID = " + cicloId);
  var totalOrc = pf(orcTotal[0] && orcTotal[0].TOTAL);
  var realTotal = await q("SELECT SUM(VALOR) AS TOTAL FROM REALIZADO_CONTABIL WHERE ANO = " + anoAnt);
  var totalReal = pf(realTotal[0] && realTotal[0].TOTAL);

  var porTipo = await q("SELECT cc.TIPO, SUM(o.VALOR) AS TOTAL FROM ORCAMENTO o JOIN CONTA_CONTABIL cc ON o.CONTA_ID = cc.ID WHERE o.CICLO_ID = " + cicloId + " GROUP BY cc.TIPO ORDER BY cc.TIPO");
  var categorias = {};
  for (var i = 0; i < porTipo.length; i++) { categorias[porTipo[i].TIPO] = pf(porTipo[i].TOTAL); }

  var statusCRs = await q("SELECT os.STATUS, os.CR_ID, cr.NOME FROM ORCAMENTO_STATUS os JOIN CENTRO_RESULTADO cr ON os.CR_ID = cr.ID WHERE os.CICLO_ID = " + cicloId + " ORDER BY cr.NOME");
  var crsResult = [];
  for (var i = 0; i < statusCRs.length; i++) {
    var s = statusCRs[i];
    var dc = await q("SELECT COUNT(*) AS N FROM DRIVER_CONFIG WHERE CR_ID = " + s.CR_ID);
    var fc = await q("SELECT COUNT(DISTINCT CONTA_ID) AS N FROM ORCAMENTO WHERE CICLO_ID = " + cicloId + " AND CR_ID = " + s.CR_ID + " AND VALOR > 0");
    var t = pi(dc[0] && dc[0].N); var f = pi(fc[0] && fc[0].N);
    crsResult.push({ cr: s.NOME, status: s.STATUS, progresso: t > 0 ? Math.round(f/t*100) : 0 });
  }

  var hcAtual = await q("SELECT COUNT(*) AS N FROM COLABORADOR WHERE ATIVO = 'true'");
  var hcProj = await q("SELECT COALESCE(SUM(QUANTIDADE),0) AS N FROM PROJECAO_HEADCOUNT WHERE CICLO_ID = " + cicloId);

  var cresc = totalReal > 0 ? ((totalOrc-totalReal)/totalReal*100).toFixed(1) : "N/A";
  if (totalOrc >= totalReal && cresc !== "N/A") cresc = "+" + cresc + "%"; else if (cresc !== "N/A") cresc = cresc + "%";

  return { success: true, ciclo: ciclo.NOME, totalOrcado: totalOrc, totalRealizado: totalReal, crescimentoPrevisto: cresc, porCategoria: categorias, statusCRs: crsResult, headcountTotal: { atual: pi(hcAtual[0]&&hcAtual[0].N), projetado: pi(hcProj[0]&&hcProj[0].N) } };
};