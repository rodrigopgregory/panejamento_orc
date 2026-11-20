INSERT INTO INT_SERVERFUNCTION (ID, NAME, DESCRIPTION, TYPE, CODE, JDBC_ID, PUBLIC_EXECUTION, CRON_EXPRESSION, CRON_INPUT_JSON, CREATED_BY) VALUES (73, 'publicListarCRs', 'PUBLICA JS — lista CRs do gestor do token no ciclo, com status (param: token)', 'JAVASCRIPT', 'const { runQueryMitra } = require(''mitra-sdk'');
const projectId = parseInt(process.env.MITRA_PROJECT_ID);
const token = String(event.token || '''').replace(/[^0-9a-fA-F-]/g, '''').slice(0, 36);
if (!token) return { rows: [], rowCount: 0 };
const r = await runQueryMitra({ projectId, sql:
  "SELECT cr.ID AS CR_ID, cr.CODIGO, cr.NOME, COALESCE(os.STATUS, ''PENDENTE'') AS STATUS " +
  "FROM PREENCHIMENTO_TOKEN t " +
  "JOIN GESTOR_CR gc ON gc.GESTOR_ID = t.GESTOR_ID " +
  "JOIN CENTRO_RESULTADO cr ON cr.ID = gc.CR_ID AND cr.ATIVO = ''true'' " +
  "LEFT JOIN ORCAMENTO_STATUS os ON os.CICLO_ID = t.CICLO_ID AND os.GESTOR_ID = t.GESTOR_ID AND os.CR_ID = cr.ID " +
  "WHERE t.TOKEN = ''" + token + "'' AND t.ATIVO = ''true'' ORDER BY cr.CODIGO" });
return r && r.result ? r.result : { rows: [], rowCount: 0 };', NULL, FALSE, NULL, NULL, 'sarah@mitralab.io');
