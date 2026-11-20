-- tipo: JAVASCRIPT | Grava valores de orcamento para uma conta (12 meses). Suporta BASE_ZERO, BASE_HISTORICO (valor) e RECEITA (quantidade + valorUnitario)
module.exports = async function(params, context) {
  var pid = parseInt(context.tenantId);
  var q = async function(sql) { var r = await mitra.runQueryMitra({ projectId: pid, sql: sql }); return (r && r.result && r.result.rows) || []; };
  var dml = async function(sql) { return await mitra.runDmlMitra({ projectId: pid, sql: sql }); };
  var pf = function(v) { return parseFloat(v) || 0; };
  var pi = function(v) { return parseInt(v) || 0; };
  var esc = function(s) { return s ? String(s).replace(/'/g, "''") : ""; };
  var cicloId = pi(params.cicloId); var crId = pi(params.crId); var contaId = pi(params.contaId);
  var valores = params.valores;
  if (!cicloId || !crId || !contaId || !valores) return { success: false, erro: "cicloId, crId, contaId e valores obrigatorios" };

  await dml("DELETE FROM ORCAMENTO WHERE CICLO_ID = " + cicloId + " AND CR_ID = " + crId + " AND CONTA_ID = " + contaId);

  var totalAno = 0;
  for (var i = 0; i < valores.length; i++) {
    var v = valores[i];
    var mes = pi(v.mes);
    var qtd = pf(v.quantidade);
    var vu = pf(v.valorUnitario);
    var val = v.valor !== undefined && v.valor !== null ? pf(v.valor) : (qtd * vu);
    totalAno += val;
    await dml("INSERT INTO ORCAMENTO (CICLO_ID, CR_ID, CONTA_ID, MES, VALOR, QUANTIDADE, VALOR_UNITARIO) VALUES (" + cicloId + ", " + crId + ", " + contaId + ", " + mes + ", " + val + ", " + qtd + ", " + vu + ")");
  }

  return { success: true, totalAno: Math.round(totalAno * 100) / 100, valoresSalvos: valores.length };
};