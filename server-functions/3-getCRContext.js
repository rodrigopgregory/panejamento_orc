-- tipo: JAVASCRIPT | Contexto completo de um CR: drivers, valores atuais, realizado, colaboradores, beneficios, encargos
module.exports = async function(params, context) {
  var pid = parseInt(context.tenantId);
  var q = async function(sql) { var r = await mitra.runQueryMitra({ projectId: pid, sql: sql }); return (r && r.result && r.result.rows) || []; };
  var dml = async function(sql) { return await mitra.runDmlMitra({ projectId: pid, sql: sql }); };
  var pf = function(v) { return parseFloat(v) || 0; };
  var pi = function(v) { return parseInt(v) || 0; };
  var esc = function(s) { return s ? String(s).replace(/'/g, "''") : ""; };
  var crId = pi(params.crId); var cicloId = pi(params.cicloId);
  if (!crId || !cicloId) return { success: false, erro: "crId e cicloId obrigatorios" };

  var crInfo = await q("SELECT cr.*, e.NOME AS EMPRESA FROM CENTRO_RESULTADO cr JOIN EMPRESA e ON cr.EMPRESA_ID = e.ID WHERE cr.ID = " + crId);
  if (!crInfo[0]) return { success: false, erro: "CR nao encontrado" };
  var cr = crInfo[0];

  var cicloInfo = await q("SELECT * FROM CICLO WHERE ID = " + cicloId);
  var ciclo = cicloInfo[0];
  var anoAnt = pi(ciclo.ANO) - 1;

  var sts = await q("SELECT * FROM ORCAMENTO_STATUS WHERE CICLO_ID = " + cicloId + " AND CR_ID = " + crId);
  var st = sts[0];

  var drvs = await q("SELECT dc.ID, dc.CONTA_ID, cc.CODIGO, cc.NOME, dc.DRIVER_TIPO FROM DRIVER_CONFIG dc JOIN CONTA_CONTABIL cc ON dc.CONTA_ID = cc.ID WHERE dc.CR_ID = " + crId + " ORDER BY cc.CODIGO");

  var orc = await q("SELECT CONTA_ID, MES, VALOR, QUANTIDADE, VALOR_UNITARIO FROM ORCAMENTO WHERE CICLO_ID = " + cicloId + " AND CR_ID = " + crId);
  var orcMap = {};
  for (var i = 0; i < orc.length; i++) { var o = orc[i]; orcMap[o.CONTA_ID + "_" + o.MES] = o; }

  var real = await q("SELECT CONTA_ID, MES, VALOR FROM REALIZADO_CONTABIL WHERE CR_ID = " + crId + " AND ANO = " + anoAnt);
  var realMap = {};
  for (var i = 0; i < real.length; i++) { var r = real[i]; realMap[r.CONTA_ID + "_" + r.MES] = pf(r.VALOR); }

  var drivers = { BASE_ZERO: [], BASE_HISTORICO: [], RECEITA: [], PESSOAL: [] };
  for (var i = 0; i < drvs.length; i++) {
    var d = drvs[i];
    var tipo = d.DRIVER_TIPO;
    var contaId = d.CONTA_ID;
    var realArr = []; var orcArr = [];
    var qtdArr = []; var vuArr = []; var totArr = [];
    for (var m = 1; m <= 12; m++) {
      realArr.push(realMap[contaId + "_" + m] || 0);
      var ov = orcMap[contaId + "_" + m];
      if (tipo === "RECEITA") {
        qtdArr.push(ov ? pf(ov.QUANTIDADE) : 0);
        vuArr.push(ov ? pf(ov.VALOR_UNITARIO) : 0);
        totArr.push(ov ? pf(ov.VALOR) : 0);
      } else {
        orcArr.push(ov ? pf(ov.VALOR) : 0);
      }
    }
    var entry = { contaId: pi(contaId), codigo: d.CODIGO, nome: d.NOME, realizadoAnterior: realArr };
    if (tipo === "RECEITA") {
      entry.orcadoAtual = { quantidade: qtdArr, valorUnitario: vuArr, total: totArr };
    } else {
      entry.orcadoAtual = orcArr;
    }
    if (drivers[tipo]) drivers[tipo].push(entry);
  }

  var cols = await q("SELECT * FROM COLABORADOR WHERE CR_ID = " + crId + " AND ATIVO = 'true' ORDER BY NOME");
  var hc = await q("SELECT ph.*, c.NOME AS CARGO_NOME, c.SALARIO_MEDIO FROM PROJECAO_HEADCOUNT ph LEFT JOIN CARGO c ON ph.CARGO_ID = c.ID WHERE ph.CICLO_ID = " + cicloId + " AND ph.CR_ID = " + crId);
  var bens = await q("SELECT * FROM BENEFICIO");
  var encs = await q("SELECT * FROM ENCARGO");

  var totalReal = 0; var totalOrc = 0;
  for (var k in realMap) totalReal += realMap[k];
  for (var k in orcMap) totalOrc += pf(orcMap[k].VALOR);

  return {
    success: true,
    cr: { id: pi(cr.ID), codigo: cr.CODIGO, nome: cr.NOME, empresa: cr.EMPRESA },
    status: st ? st.STATUS : "PENDENTE",
    driversConfirmados: (st && st.DRIVERS_CONFIRMADOS) ? st.DRIVERS_CONFIRMADOS.split(",").filter(function(x){return x;}) : [],
    drivers: drivers,
    colaboradores: cols.map(function(c) { return { id: pi(c.ID), nome: c.NOME, cargo: c.CARGO, tipo: c.TIPO_CONTRATO, salario: pf(c.SALARIO) }; }),
    headcountAtual: hc,
    beneficios: bens,
    encargos: encs,
    resumoFinanceiro: { totalRealizadoAnterior: Math.round(totalReal * 100) / 100, totalOrcadoAtual: Math.round(totalOrc * 100) / 100 }
  };
};