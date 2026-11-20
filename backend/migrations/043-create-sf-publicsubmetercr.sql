INSERT INTO INT_SERVERFUNCTION (ID, NAME, DESCRIPTION, TYPE, CODE, JDBC_ID, PUBLIC_EXECUTION, CRON_EXPRESSION, CRON_INPUT_JSON, CREATED_BY) VALUES (70, 'publicSubmeterCR', 'Marca o CR como SUBMETIDO, escopado por token (params: token, crId)', 'JAVASCRIPT', 'const { runDmlMitra } = require(''mitra-sdk'');
const projectId = parseInt(process.env.MITRA_PROJECT_ID);
const token = String(event.token || '''').replace(/[^0-9a-fA-F-]/g, '''').slice(0, 36);
const crId = Number(event.crId);
if (!token || !Number.isInteger(crId)) return { ok: false, error: ''params_invalidos'' };
const agora = new Date().toISOString().slice(0, 19);
await runDmlMitra({ projectId, sql:
  "UPDATE ORCAMENTO_STATUS os " +
  "JOIN PREENCHIMENTO_TOKEN t ON t.CICLO_ID = os.CICLO_ID AND t.GESTOR_ID = os.GESTOR_ID AND t.TOKEN = ''" + token + "'' AND t.ATIVO = ''true'' " +
  "JOIN GESTOR_CR gc ON gc.GESTOR_ID = t.GESTOR_ID AND gc.CR_ID = os.CR_ID " +
  "SET os.STATUS = ''SUBMETIDO'', os.ATUALIZADO_EM = ''" + agora + "'' " +
  "WHERE os.CR_ID = " + crId });
await runDmlMitra({ projectId, sql:
  "INSERT INTO ORCAMENTO_STATUS (CICLO_ID, GESTOR_ID, CR_ID, STATUS, ATUALIZADO_EM) " +
  "SELECT t.CICLO_ID, t.GESTOR_ID, " + crId + ", ''SUBMETIDO'', ''" + agora + "'' " +
  "FROM PREENCHIMENTO_TOKEN t " +
  "JOIN GESTOR_CR gc ON gc.GESTOR_ID = t.GESTOR_ID AND gc.CR_ID = " + crId + " " +
  "WHERE t.TOKEN = ''" + token + "'' AND t.ATIVO = ''true'' " +
  "AND NOT EXISTS (SELECT 1 FROM (SELECT CICLO_ID, GESTOR_ID, CR_ID FROM ORCAMENTO_STATUS) s " +
  "WHERE s.CICLO_ID = t.CICLO_ID AND s.GESTOR_ID = t.GESTOR_ID AND s.CR_ID = " + crId + ")" });
return { ok: true };', NULL, FALSE, NULL, NULL, 'sarah@mitralab.io');
