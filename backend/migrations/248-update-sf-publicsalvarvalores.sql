UPDATE INT_SERVERFUNCTION SET NAME = COALESCE(NULL, NAME), DESCRIPTION = COALESCE('Upsert em lote de valores de um CR, escopado por token; bloqueia ciclo FECHADO e CR SUBMETIDO/APROVADO (params: token, crId, valores[])', DESCRIPTION), TYPE = COALESCE(NULL, TYPE), JDBC_ID = NULL, CODE = COALESCE('const { runDmlMitra } = require(''mitra-sdk'');
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
// gates: token ativo + ciclo nao fechado + CR nao SUBMETIDO/APROVADO + CR do gestor
const GATES = "AND NOT EXISTS (SELECT 1 FROM CICLO ck WHERE ck.ID = t.CICLO_ID AND ck.STATUS = ''FECHADO'') " +
  "AND NOT EXISTS (SELECT 1 FROM (SELECT CICLO_ID, CR_ID, STATUS FROM ORCAMENTO_STATUS) osk WHERE osk.CICLO_ID = t.CICLO_ID AND osk.CR_ID = " + crId + " AND osk.STATUS IN (''APROVADO'',''SUBMETIDO'')) ";
// 1) apaga celulas existentes (de-dup) escopado por token + gestor dono do CR
await runDmlMitra({ projectId, sql:
  "DELETE o FROM ORCAMENTO o " +
  "JOIN PREENCHIMENTO_TOKEN t ON t.CICLO_ID = o.CICLO_ID AND t.TOKEN = ''" + token + "'' AND t.ATIVO = ''true'' " +
  "JOIN GESTOR_CR gc ON gc.GESTOR_ID = t.GESTOR_ID AND gc.CR_ID = o.CR_ID " +
  "WHERE o.CR_ID = " + crId + " AND (o.CONTA_ID, o.MES) IN (" + pairs + ") " + GATES });
// 2) insere apenas contas realmente do CR (autorizacao via CR_CONTA) e do gestor do token
const derived = cells.map(c => ''SELECT '' + c.conta + '' AS CONTA_ID, '' + c.mes + '' AS MES, '' + c.val + '' AS VALOR'').join('' UNION ALL '');
await runDmlMitra({ projectId, sql:
  "INSERT INTO ORCAMENTO (CICLO_ID, CR_ID, CONTA_ID, MES, VALOR) " +
  "SELECT t.CICLO_ID, " + crId + ", v.CONTA_ID, v.MES, v.VALOR " +
  "FROM PREENCHIMENTO_TOKEN t " +
  "JOIN GESTOR_CR gc ON gc.GESTOR_ID = t.GESTOR_ID AND gc.CR_ID = " + crId + " " +
  "JOIN (" + derived + ") v " +
  "JOIN CR_CONTA crc ON crc.CR_ID = " + crId + " AND crc.CONTA_ID = v.CONTA_ID AND crc.ATIVO = true " +
  "WHERE t.TOKEN = ''" + token + "'' AND t.ATIVO = ''true'' " + GATES });
return { ok: true, saved: cells.length };', CODE), PUBLIC_EXECUTION = COALESCE(NULL, PUBLIC_EXECUTION), CRON_EXPRESSION = NULL, CRON_INPUT_JSON = NULL WHERE NAME = 'publicSalvarValores';
