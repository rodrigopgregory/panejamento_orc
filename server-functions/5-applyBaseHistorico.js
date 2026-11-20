-- tipo: JAVASCRIPT | Aplica crescimento % sobre realizado do ano anterior para uma conta
module.exports = async function(params, context) {
  var pid = parseInt(context.tenantId);
  var q = async function(sql) { var r = await mitra.runQueryMitra({ projectId: pid, sql: sql }); return (r && r.result && r.result.rows) || []; };
  var dml = async function(sql) { return await mitra.runDmlMitra({ projectId: pid, sql: sql }); };
  var pf = function(v) { return parseFloat(v) || 0; };
  var pi = function(v) { return parseInt(v) || 0; };
  var esc = function(s) { return s ? String(s).replace(/'/g, "''") : ""; };
  var cicloId = pi(params.cicloId); var crId = pi(params.crId); var contaId = pi(params.contaId);
  var pct = pf(params.percentualCrescimento);
  if (!cicloId || !crId || !contaId) return { success: false, erro: "cicloId, crId, contaId obrigatorios" };

  var ciclos = await q("SELECT * FROM CICLO WHERE ID = " + cicloId);
  var anoAnt = pi(ciclos[0].ANO) - 1;
  var contas = await q("SELECT NOME FROM CONTA_CONTABIL WHERE ID = " + contaId);
  var contaNome = contas[0] ? contas[0].NOME : "";

  var real = await q("SELECT MES, VALOR FROM REALIZADO_CONTABIL WHERE CR_ID = " + crId + " AND CONTA_ID = " + contaId + " AND ANO = " + anoAnt + " ORDER BY MES");
  var realArr = [0,0,0,0,0,0,0,0,0,0,0,0];
  for (var i = 0; i < real.length; i++) { realArr[pi(real[i].MES) - 1] = pf(real[i].VALOR); }

  var fator = 1 + (pct / 100);
  var orcArr = []; var totalReal = 0; var totalOrc = 0;
  for (var m = 0; m < 12; m++) {
    var novo = Math.round(realArr[m] * fator * 100) / 100;
    orcArr.push(novo); totalReal += realArr[m]; totalOrc += novo;
  }

  await dml("DELETE FROM ORCAMENTO WHERE CICLO_ID = " + cicloId + " AND CR_ID = " + crId + " AND CONTA_ID = " + contaId);
  for (var m = 0; m < 12; m++) {
    await dml("INSERT INTO ORCAMENTO (CICLO_ID, CR_ID, CONTA_ID, MES, VALOR, QUANTIDADE, VALOR_UNITARIO) VALUES (" + cicloId + ", " + crId + ", " + contaId + ", " + (m+1) + ", " + orcArr[m] + ", 0, 0)");
  }

  return { success: true, contaNome: contaNome, realizadoBase: realArr, orcadoCalculado: orcArr, totalRealizadoAno: Math.round(totalReal*100)/100, totalOrcadoAno: Math.round(totalOrc*100)/100, crescimentoEfetivo: pct + "%" };
};