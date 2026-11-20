-- tipo: JAVASCRIPT | Calcula folha completa: salarios + beneficios + encargos + headcount. Gera ORCAMENTO_PESSOAL e atualiza ORCAMENTO (5.1.01/02/03)
module.exports = async function(params, context) {
  var pid = parseInt(context.tenantId);
  var q = async function(sql) { var r = await mitra.runQueryMitra({ projectId: pid, sql: sql }); return (r && r.result && r.result.rows) || []; };
  var dml = async function(sql) { return await mitra.runDmlMitra({ projectId: pid, sql: sql }); };
  var pf = function(v) { return parseFloat(v) || 0; };
  var pi = function(v) { return parseInt(v) || 0; };
  var esc = function(s) { return s ? String(s).replace(/'/g, "''") : ""; };
  var cicloId = pi(params.cicloId); var crId = pi(params.crId);
  if (!cicloId || !crId) return { success: false, erro: "cicloId e crId obrigatorios" };

  var cols = await q("SELECT * FROM COLABORADOR WHERE CR_ID = " + crId + " AND ATIVO = 'true'");
  var bens = await q("SELECT * FROM BENEFICIO");
  var encs = await q("SELECT * FROM ENCARGO");
  var hcs = await q("SELECT ph.*, c.SALARIO_MEDIO FROM PROJECAO_HEADCOUNT ph LEFT JOIN CARGO c ON ph.CARGO_ID = c.ID WHERE ph.CICLO_ID = " + cicloId + " AND ph.CR_ID = " + crId);

  var contaSal = await q("SELECT ID FROM CONTA_CONTABIL WHERE CODIGO = '5.1.01'");
  var contaEnc = await q("SELECT ID FROM CONTA_CONTABIL WHERE CODIGO = '5.1.02'");
  var contaBen = await q("SELECT ID FROM CONTA_CONTABIL WHERE CODIGO = '5.1.03'");
  var idSal = contaSal[0] ? pi(contaSal[0].ID) : 0;
  var idEnc = contaEnc[0] ? pi(contaEnc[0].ID) : 0;
  var idBen = contaBen[0] ? pi(contaBen[0].ID) : 0;

  function calcBen(salario, isCLT) {
    var total = 0;
    for (var i = 0; i < bens.length; i++) {
      var b = bens[i];
      if (isCLT && b.APLICA_CLT !== "true") continue;
      if (!isCLT && b.APLICA_PJ !== "true") continue;
      if (b.TIPO === "FIXO") total += pf(b.VALOR); else total += salario * pf(b.PERCENTUAL) / 100;
    }
    return Math.round(total * 100) / 100;
  }
  function calcEnc(salario, isCLT) {
    var total = 0;
    for (var i = 0; i < encs.length; i++) {
      var e = encs[i];
      if (isCLT && e.APLICA_CLT !== "true") continue;
      if (!isCLT && e.APLICA_PJ !== "true") continue;
      total += salario * pf(e.PERCENTUAL) / 100;
    }
    return Math.round(total * 100) / 100;
  }

  await dml("DELETE FROM ORCAMENTO_PESSOAL WHERE CICLO_ID = " + cicloId + " AND CR_ID = " + crId);

  var mensal = [];
  for (var m = 0; m < 12; m++) mensal.push({ sal: 0, enc: 0, ben: 0 });

  var colDetail = [];
  for (var i = 0; i < cols.length; i++) {
    var c = cols[i]; var sal = pf(c.SALARIO); var isCLT = c.TIPO_CONTRATO === "CLT";
    var benVal = calcBen(sal, isCLT); var encVal = calcEnc(sal, isCLT);
    colDetail.push({ nome: c.NOME, tipo: c.TIPO_CONTRATO, salario: sal, beneficiosMensal: benVal, encargosMensal: encVal, totalMensal: sal + benVal + encVal });
    for (var m = 1; m <= 12; m++) {
      mensal[m-1].sal += sal; mensal[m-1].enc += encVal; mensal[m-1].ben += benVal;
      await dml("INSERT INTO ORCAMENTO_PESSOAL (CICLO_ID, CR_ID, COLABORADOR_ID, MES, SALARIO, BENEFICIOS, ENCARGOS, TOTAL) VALUES (" + cicloId + ", " + crId + ", " + c.ID + ", " + m + ", " + sal + ", " + benVal + ", " + encVal + ", " + (sal+benVal+encVal) + ")");
    }
  }

  var hcDetail = [];
  for (var i = 0; i < hcs.length; i++) {
    var h = hcs[i]; var salMedio = pf(h.SALARIO_MEDIO); var mesI = pi(h.MES); var qtd = pi(h.QUANTIDADE);
    var benH = calcBen(salMedio, true); var encH = calcEnc(salMedio, true); var custoAte = 0;
    for (var m = mesI; m <= 12; m++) {
      for (var n = 0; n < qtd; n++) {
        mensal[m-1].sal += salMedio; mensal[m-1].enc += encH; mensal[m-1].ben += benH;
        custoAte += salMedio + benH + encH;
        await dml("INSERT INTO ORCAMENTO_PESSOAL (CICLO_ID, CR_ID, COLABORADOR_ID, MES, SALARIO, BENEFICIOS, ENCARGOS, TOTAL) VALUES (" + cicloId + ", " + crId + ", NULL, " + m + ", " + salMedio + ", " + benH + ", " + encH + ", " + (salMedio+benH+encH) + ")");
      }
    }
    hcDetail.push({ cargoNome: h.CARGO_NOME || "Cargo " + h.CARGO_ID, salarioMedio: salMedio, mesInicio: mesI, quantidade: qtd, custoAteAno: Math.round(custoAte*100)/100 });
  }

  await dml("DELETE FROM ORCAMENTO WHERE CICLO_ID = " + cicloId + " AND CR_ID = " + crId + " AND CONTA_ID IN (" + idSal + "," + idEnc + "," + idBen + ")");
  var totalAnual = 0; var resumoMensal = [];
  for (var m = 0; m < 12; m++) {
    var s = Math.round(mensal[m].sal*100)/100; var e = Math.round(mensal[m].enc*100)/100; var b = Math.round(mensal[m].ben*100)/100;
    totalAnual += s + e + b;
    resumoMensal.push({ mes: m+1, salarios: s, encargos: e, beneficios: b, total: Math.round((s+e+b)*100)/100 });
    if (idSal) await dml("INSERT INTO ORCAMENTO (CICLO_ID, CR_ID, CONTA_ID, MES, VALOR, QUANTIDADE, VALOR_UNITARIO) VALUES (" + cicloId + ", " + crId + ", " + idSal + ", " + (m+1) + ", " + s + ", 0, 0)");
    if (idEnc) await dml("INSERT INTO ORCAMENTO (CICLO_ID, CR_ID, CONTA_ID, MES, VALOR, QUANTIDADE, VALOR_UNITARIO) VALUES (" + cicloId + ", " + crId + ", " + idEnc + ", " + (m+1) + ", " + e + ", 0, 0)");
    if (idBen) await dml("INSERT INTO ORCAMENTO (CICLO_ID, CR_ID, CONTA_ID, MES, VALOR, QUANTIDADE, VALOR_UNITARIO) VALUES (" + cicloId + ", " + crId + ", " + idBen + ", " + (m+1) + ", " + b + ", 0, 0)");
  }

  return {
    success: true, colaboradores: colDetail, headcountProjetado: hcDetail, resumoMensal: resumoMensal,
    contasGeradas: { "5.1.01_Salarios": resumoMensal.reduce(function(a,r){return a+r.salarios},0), "5.1.02_Encargos": resumoMensal.reduce(function(a,r){return a+r.encargos},0), "5.1.03_Beneficios": resumoMensal.reduce(function(a,r){return a+r.beneficios},0) },
    totalAnual: Math.round(totalAnual*100)/100
  };
};