INSERT INTO INT_SERVERFUNCTION (ID, NAME, DESCRIPTION, TYPE, CODE, JDBC_ID, PUBLIC_EXECUTION, CRON_EXPRESSION, CRON_INPUT_JSON, CREATED_BY) VALUES (173, 'listarAuditoriaWorkflow', 'Historico de auditoria de um CR ou pacote no ciclo. Params: cicloId, tipo (CR|PACOTE), refId (crId ou driverId)', 'SQL', 'SELECT a.ID, a.EVENTO, a.STATUS_DE, a.STATUS_PARA, a.COMENTARIO, a.AUTOR, a.ORIGEM, a.CRIADO_EM
FROM WORKFLOW_AUDITORIA a
WHERE a.CICLO_ID = {{cicloId}} AND a.TIPO = ''{{tipo}}''
  AND (((''{{tipo}}'' = ''CR'') AND a.CR_ID = {{refId}}) OR ((''{{tipo}}'' = ''PACOTE'') AND a.DRIVER_ID = {{refId}}))
ORDER BY a.ID DESC
LIMIT 100', NULL, FALSE, NULL, NULL, 'sarah@mitralab.io');
