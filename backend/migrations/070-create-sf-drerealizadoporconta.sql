INSERT INTO INT_SERVERFUNCTION (ID, NAME, DESCRIPTION, TYPE, CODE, JDBC_ID, PUBLIC_EXECUTION, CRON_EXPRESSION, CRON_INPUT_JSON, CREATED_BY) VALUES (87, 'dreRealizadoPorConta', 'Realizado agregado por conta e mes — params ano (int), crIds/contaIds (CSV opcional), empresaId (opcional)', 'SQL', 'SELECT rc.CONTA_ID, rc.MES, SUM(rc.VALOR) as VALOR
FROM REALIZADO_CONTABIL rc
WHERE rc.ANO = {{ano}}
  AND (''{{crIds}}'' = '''' OR FIND_IN_SET(rc.CR_ID, ''{{crIds}}''))
  AND (''{{contaIds}}'' = '''' OR FIND_IN_SET(rc.CONTA_ID, ''{{contaIds}}''))
  AND (''{{empresaId}}'' = '''' OR rc.EMPRESA_ID = ''{{empresaId}}'')
GROUP BY rc.CONTA_ID, rc.MES', NULL, FALSE, NULL, NULL, 'sarah@mitralab.io');
