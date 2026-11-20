INSERT INTO INT_SERVERFUNCTION (ID, NAME, DESCRIPTION, TYPE, CODE, JDBC_ID, PUBLIC_EXECUTION, CRON_EXPRESSION, CRON_INPUT_JSON, CREATED_BY) VALUES (89, 'dreRealizadoPorCr', 'Realizado agregado por CR e mes — params ano (int), contaIds/crIds (CSV opcional)', 'SQL', 'SELECT rc.CR_ID, rc.MES, SUM(rc.VALOR) as VALOR
FROM REALIZADO_CONTABIL rc
WHERE rc.ANO = {{ano}}
  AND (''{{contaIds}}'' = '''' OR FIND_IN_SET(rc.CONTA_ID, ''{{contaIds}}''))
  AND (''{{crIds}}'' = '''' OR FIND_IN_SET(rc.CR_ID, ''{{crIds}}''))
GROUP BY rc.CR_ID, rc.MES', NULL, FALSE, NULL, NULL, 'sarah@mitralab.io');
