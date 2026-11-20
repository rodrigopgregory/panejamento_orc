-- tipo: JAVASCRIPT | Retorna DRE consolidada. Modos: ORCADO, REALIZADO, COMPARATIVO. crId null = todos os CRs.
module.exports = async function(params, context) {
  var pid = parseInt(context.tenantId);
  var q = async function(sql) { var r = await mitra.runQueryMitra({ projectId: pid, sql: sql }); return (r && r.result && r.result.rows) || []; };
  var dml = async function(sql) { return await mitra.runDmlMitra({ projectId: pid, sql: sql }); };
  var pf = function(v) { return parseFloat(v) || 0; };
  var pi = function(v) { return parseInt(v) || 0; };
  var esc = function(s) { return s ? String(s).replace(/'/g, "''") : ""; };
  var cicloId = pi(params.cicloId); var crId = params.crId ? pi(params.crId) : null; var modo = params.modo || "COMPARATIVO";
  if (!cicloId) return { success: false, erro: "cicloId obrigatorio" };

  var ciclos = await q("SELECT * FROM CICLO WHERE ID = " + cicloId);
  var anoAnt = pi(ciclos[0].ANO) - 1;
  var dreConfig = await q("SELECT * FROM DRE_CONFIG ORDER BY ORDEM");
  var contas = await q("SELECT * FROM CONTA_CONTABIL");

  var orcSql = "SELECT CONTA_ID, MES, SUM(VALOR) AS VALOR FROM ORCAMENTO WHERE CICLO_ID = " + cicloId;
  if (crId) orcSql += " AND CR_ID = " + crId;
  orcSql += " GROUP BY CONTA_ID, MES";
  var orcRows = await q(orcSql);
  var orcMap = {};
  for (var i = 0; i < orcRows.length; i++) { var r = orcRows[i]; orcMap[r.CONTA_ID + "_" + r.MES] = pf(r.VALOR); }

  var realSql = "SELECT CONTA_ID, MES, SUM(VALOR) AS VALOR FROM REALIZADO_CONTABIL WHERE ANO = " + anoAnt;
  if (crId) realSql += " AND CR_ID = " + crId;
  realSql += " GROUP BY CONTA_ID, MES";
  var realRows = await q(realSql);
  var realMap = {};
  for (var i = 0; i < realRows.length; i++) { var r = realRows[i]; realMap[r.CONTA_ID + "_" + r.MES] = pf(r.VALOR); }

  var linhas = [];
  var subtotalOrc = [0,0,0,0,0,0,0,0,0,0,0,0];
  var subtotalReal = [0,0,0,0,0,0,0,0,0,0,0,0];

  for (var i = 0; i < dreConfig.length; i++) {
    var cfg = dreConfig[i]; var isSubtotal = cfg.IS_SUBTOTAL === "true"; var sinal = pi(cfg.SINAL) || 1;
    var orcMeses = [0,0,0,0,0,0,0,0,0,0,0,0]; var realMeses = [0,0,0,0,0,0,0,0,0,0,0,0];
    if (isSubtotal) { orcMeses = subtotalOrc.slice(); realMeses = subtotalReal.slice(); }
    else {
      var prefixo = cfg.PREFIXO_CONTA || "";
      var match = contas.filter(function(c) { return c.CODIGO && c.CODIGO.indexOf(prefixo) === 0; });
      for (var c = 0; c < match.length; c++) {
        for (var m = 1; m <= 12; m++) {
          orcMeses[m-1] += (orcMap[match[c].ID + "_" + m] || 0) * sinal;
          realMeses[m-1] += (realMap[match[c].ID + "_" + m] || 0) * sinal;
        }
      }
      for (var m = 0; m < 12; m++) { subtotalOrc[m] += orcMeses[m]; subtotalReal[m] += realMeses[m]; }
    }
    var tO = orcMeses.reduce(function(a,b){return a+b},0);
    var tR = realMeses.reduce(function(a,b){return a+b},0);
    var vari = tR !== 0 ? ((tO-tR)/Math.abs(tR)*100).toFixed(1)+"%" : "N/A";
    if (tO >= tR && vari !== "N/A") vari = "+" + vari;
    linhas.push({ ordem: pi(cfg.ORDEM), nome: cfg.NOME_LINHA, isSubtotal: isSubtotal, orcado: orcMeses.map(function(v){return Math.round(v*100)/100}), realizado: realMeses.map(function(v){return Math.round(v*100)/100}), totalOrcado: Math.round(tO*100)/100, totalRealizado: Math.round(tR*100)/100, variacao: vari });
  }

  return { success: true, modo: modo, linhas: linhas };
};