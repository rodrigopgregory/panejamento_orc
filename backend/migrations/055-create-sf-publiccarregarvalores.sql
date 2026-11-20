INSERT INTO INT_SERVERFUNCTION (ID, NAME, DESCRIPTION, TYPE, CODE, JDBC_ID, PUBLIC_EXECUTION, CRON_EXPRESSION, CRON_INPUT_JSON, CREATED_BY) VALUES (75, 'publicCarregarValores', 'PUBLICA JS — valores ja preenchidos de um CR, autorizado pelo token (params: token, crId)', 'JAVASCRIPT', 'const { runQueryMitra } = require(''mitra-sdk'');
const projectId = parseInt(process.env.MITRA_PROJECT_ID);
const token = String(event.token || '''').replace(/[^0-9a-fA-F-]/g, '''').slice(0, 36);
if (!token) return { rows: [], rowCount: 0 };
const crId = Number(event.crId);
if (!Number.isInteger(crId)) return { rows: [], rowCount: 0 };
const r = await runQueryMitra({ projectId, sql:
  "SELECT o.CONTA_ID, o.MES, SUM(o.VALOR) AS VALOR " +
  "FROM PREENCHIMENTO_TOKEN t " +
  "JOIN GESTOR_CR gc ON gc.GESTOR_ID = t.GESTOR_ID AND gc.CR_ID = " + crId + " " +
  "JOIN ORCAMENTO o ON o.CICLO_ID = t.CICLO_ID AND o.CR_ID = gc.CR_ID " +
  "WHERE t.TOKEN = ''" + token + "'' AND t.ATIVO = ''true'' GROUP BY o.CONTA_ID, o.MES" });
return r && r.result ? r.result : { rows: [], rowCount: 0 };', NULL, FALSE, NULL, NULL, 'sarah@mitralab.io');
