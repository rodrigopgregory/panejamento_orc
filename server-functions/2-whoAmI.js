-- tipo: JAVASCRIPT | Identifica gestor por email e retorna escopo completo (CRs, drivers, status)
module.exports = async function(params, context) {
  var pid = parseInt(context.tenantId);
  var q = async function(sql) { var r = await mitra.runQueryMitra({ projectId: pid, sql: sql }); return (r && r.result && r.result.rows) || []; };
  var dml = async function(sql) { return await mitra.runDmlMitra({ projectId: pid, sql: sql }); };
  var pf = function(v) { return parseFloat(v) || 0; };
  var pi = function(v) { return parseInt(v) || 0; };
  var esc = function(s) { return s ? String(s).replace(/'/g, "''") : ""; };
  var email = params.email;
  if (!email) return { success: false, erro: "Email obrigatorio" };

  var gestores = await q("SELECT * FROM GESTOR WHERE EMAIL = '" + esc(email) + "' AND ATIVO = 'true'");
  var g = gestores[0];
  if (!g) return { success: false, erro: "Gestor nao encontrado: " + email };

  var ciclos = await q("SELECT * FROM CICLO WHERE STATUS = 'ABERTO' ORDER BY ANO DESC");
  var ciclo = ciclos[0];
  if (!ciclo) return { success: false, erro: "Nenhum ciclo aberto" };

  var crs = await q("SELECT gc.CR_ID, cr.CODIGO, cr.NOME, e.NOME AS EMPRESA FROM GESTOR_CR gc JOIN CENTRO_RESULTADO cr ON gc.CR_ID = cr.ID JOIN EMPRESA e ON cr.EMPRESA_ID = e.ID WHERE gc.GESTOR_ID = " + g.ID);

  var resultado = [];
  for (var i = 0; i < crs.length; i++) {
    var cr = crs[i];
    var drivers = await q("SELECT dc.CONTA_ID, cc.CODIGO AS CONTA_CODIGO, cc.NOME AS CONTA_NOME, dc.DRIVER_TIPO FROM DRIVER_CONFIG dc JOIN CONTA_CONTABIL cc ON dc.CONTA_ID = cc.ID WHERE dc.CR_ID = " + cr.CR_ID + " ORDER BY cc.CODIGO");
    var sts = await q("SELECT * FROM ORCAMENTO_STATUS WHERE CICLO_ID = " + ciclo.ID + " AND CR_ID = " + cr.CR_ID);
    var st = sts[0];
    var prog = await q("SELECT COUNT(DISTINCT CONTA_ID) AS N FROM ORCAMENTO WHERE CICLO_ID = " + ciclo.ID + " AND CR_ID = " + cr.CR_ID + " AND VALOR > 0");
    resultado.push({
      crId: pi(cr.CR_ID), codigo: cr.CODIGO, nome: cr.NOME, empresa: cr.EMPRESA,
      statusOrcamento: st ? st.STATUS : "PENDENTE",
      driversConfirmados: (st && st.DRIVERS_CONFIRMADOS) ? st.DRIVERS_CONFIRMADOS : "",
      drivers: drivers,
      progresso: { preenchidas: pi(prog[0] && prog[0].N), total: drivers.length }
    });
  }

  return {
    success: true,
    gestor: { id: pi(g.ID), nome: g.NOME, email: g.EMAIL },
    cicloAtivo: { id: pi(ciclo.ID), nome: ciclo.NOME, ano: pi(ciclo.ANO), status: ciclo.STATUS },
    centrosResultado: resultado
  };
};