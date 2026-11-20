INSERT INTO INT_SERVERFUNCTION (ID, NAME, DESCRIPTION, TYPE, CODE, JDBC_ID, PUBLIC_EXECUTION, CRON_EXPRESSION, CRON_INPUT_JSON, CREATED_BY) VALUES (71, '_probeQuery', 'probe', 'JAVASCRIPT', '
  const { runQueryMitra } = require(''mitra-sdk'');
  const projectId = parseInt(process.env.MITRA_PROJECT_ID);
  const r = await runQueryMitra({ projectId, sql: "SELECT ID, NOME FROM GESTOR LIMIT 2" });
  return { type: typeof runQueryMitra, keys: Object.keys(r||{}), sample: r };
', NULL, FALSE, NULL, NULL, 'sarah@mitralab.io');
