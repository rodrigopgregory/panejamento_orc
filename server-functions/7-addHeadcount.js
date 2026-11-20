-- tipo: JAVASCRIPT | Adiciona projecao de headcount (novas contratacoes). Rode calculatePayroll depois para efetivar.
module.exports = async function(params, context) {
  var pid = parseInt(context.tenantId);
  var q = async function(sql) { var r = await mitra.runQueryMitra({ projectId: pid, sql: sql }); return (r && r.result && r.result.rows) || []; };
  var dml = async function(sql) { return await mitra.runDmlMitra({ projectId: pid, sql: sql }); };
  var pf = function(v) { return parseFloat(v) || 0; };
  var pi = function(v) { return parseInt(v) || 0; };
  var esc = function(s) { return s ? String(s).replace(/'/g, "''") : ""; };
  var cicloId = pi(params.cicloId); var crId = pi(params.crId);
  var cargoId = pi(params.cargoId); var mesInicio = pi(params.mesInicio); var qtd = pi(params.quantidade);
  if (!cicloId || !crId || !cargoId || !mesInicio || !qtd) return { success: false, erro: "Todos os campos obrigatorios" };
  if (mesInicio < 1 || mesInicio > 12) return { success: false, erro: "mesInicio deve ser 1-12" };

  var cargos = await q("SELECT * FROM CARGO WHERE ID = " + cargoId);
  if (!cargos[0]) return { success: false, erro: "Cargo nao encontrado: " + cargoId };
  var cargo = cargos[0]; var salMedio = pf(cargo.SALARIO_MEDIO);

  await dml("INSERT INTO PROJECAO_HEADCOUNT (CICLO_ID, CR_ID, CARGO_ID, MES, QUANTIDADE) VALUES (" + cicloId + ", " + crId + ", " + cargoId + ", " + mesInicio + ", " + qtd + ")");

  var bens = await q("SELECT * FROM BENEFICIO");
  var encs = await q("SELECT * FROM ENCARGO");
  var benTotal = 0; var encTotal = 0;
  for (var i = 0; i < bens.length; i++) { var b = bens[i]; if (b.APLICA_CLT !== "true") continue; if (b.TIPO === "FIXO") benTotal += pf(b.VALOR); else benTotal += salMedio * pf(b.PERCENTUAL) / 100; }
  for (var i = 0; i < encs.length; i++) { var e = encs[i]; if (e.APLICA_CLT !== "true") continue; encTotal += salMedio * pf(e.PERCENTUAL) / 100; }
  var meses = 13 - mesInicio;

  return {
    success: true, cargo: cargo.NOME, salarioMedio: salMedio, mesInicio: mesInicio, quantidade: qtd, mesesAteDezembro: meses,
    impactoCustoEstimado: { salarios: Math.round(salMedio*qtd*meses*100)/100, encargos: Math.round(encTotal*qtd*meses*100)/100, beneficios: Math.round(benTotal*qtd*meses*100)/100, total: Math.round((salMedio+encTotal+benTotal)*qtd*meses*100)/100 },
    nota: "Rode calculatePayroll para efetivar estes valores no orcamento"
  };
};