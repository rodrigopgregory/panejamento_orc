INSERT INTO INT_SERVERFUNCTION (ID, NAME, DESCRIPTION, TYPE, CODE, JDBC_ID, PUBLIC_EXECUTION, CRON_EXPRESSION, CRON_INPUT_JSON, CREATED_BY) VALUES (69, 'publicSalvarValores', 'Upsert em lote de valores de um CR, escopado por token (params: token, crId, valores[])', 'JAVASCRIPT', 'const { runDmlMitra } = require(''mitra-sdk'');
const projectId = parseInt(process.env.MITRA_PROJECT_ID);
const token = String(event.token || '''').replace(/[^0-9a-fA-F-]/g, '''').slice(0, 36);
const crId = Number(event.crId);
if (!token || !Number.isInteger(crId)) return { ok: false, error: ''params_invalidos'' };
const raw = Array.isArray(event.valores) ? event.valores : [];
const cells = [];
for (const c of raw) {
  const conta = Number(c.contaId), mes = Number(c.mes), val = Number(c.valor);
  if (Number.isInteger(conta) && Number.isInteger(mes) && mes >= 1 && mes <= 12 && Number.isFinite(val)) {
    cells.push({ conta, mes, val });
  }
}
if (cells.length === 0) return { ok: true, saved: 0 };
const pairs = cells.map(c => ''('' + c.conta + '','' + c.mes + '')'').join('','');
// 1) apaga celulas existentes (de-dup) escopado por token + gestor dono do CR
await runDmlMitra({ projectId, sql:
  "DELETE o FROM ORCAMENTO o " +
  "JOIN PREENCHIMENTO_TOKEN t ON t.CICLO_ID = o.CICLO_ID AND t.TOKEN = ''" + token + "'' AND t.ATIVO = ''true'' " +
  "JOIN GESTOR_CR gc ON gc.GESTOR_ID = t.GESTOR_ID AND gc.CR_ID = o.CR_ID " +
  "WHERE o.CR_ID = " + crId + " AND (o.CONTA_ID, o.MES) IN (" + pairs + ")" });
// 2) insere apenas contas realmente do CR (autorizacao via CR_CONTA) e do gestor do token
const derived = cells.map(c => ''SELECT '' + c.conta + '' AS CONTA_ID, '' + c.mes + '' AS MES, '' + c.val + '' AS VALOR'').join('' UNION ALL '');
await runDmlMitra({ projectId, sql:
  "INSERT INTO ORCAMENTO (CICLO_ID, CR_ID, CONTA_ID, MES, VALOR) " +
  "SELECT t.CICLO_ID, " + crId + ", v.CONTA_ID, v.MES, v.VALOR " +
  "FROM PREENCHIMENTO_TOKEN t " +
  "JOIN GESTOR_CR gc ON gc.GESTOR_ID = t.GESTOR_ID AND gc.CR_ID = " + crId + " " +
  "JOIN (" + derived + ") v " +
  "JOIN CR_CONTA crc ON crc.CR_ID = " + crId + " AND crc.CONTA_ID = v.CONTA_ID AND crc.ATIVO = true " +
  "WHERE t.TOKEN = ''" + token + "'' AND t.ATIVO = ''true''" });
return { ok: true, saved: cells.length };', NULL, FALSE, NULL, NULL, 'sarah@mitralab.io');
