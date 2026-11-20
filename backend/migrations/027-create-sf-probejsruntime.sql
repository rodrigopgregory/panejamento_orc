INSERT INTO INT_SERVERFUNCTION (ID, NAME, DESCRIPTION, TYPE, CODE, JDBC_ID, PUBLIC_EXECUTION, CRON_EXPRESSION, CRON_INPUT_JSON, CREATED_BY) VALUES (62, '_probeJsRuntime', 'probe temporario', 'JAVASCRIPT', '
  let sdkOk=false, envPid=null, runDmlType=null, err=null;
  try { const sdk = require(''mitra-sdk''); sdkOk = !!sdk; runDmlType = typeof sdk.runDmlMitra; } catch(e){ err = ''require:''+e.message; }
  try { envPid = process.env.MITRA_PROJECT_ID || null; } catch(e){ err = (err||'''')+'' env:''+e.message; }
  return { sdkOk, runDmlType, envPid, hasEvent: typeof event, eventKeys: Object.keys(event||{}), err };
', NULL, FALSE, NULL, NULL, 'sarah@mitralab.io');
