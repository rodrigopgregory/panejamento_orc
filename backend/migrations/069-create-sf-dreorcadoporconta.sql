INSERT INTO INT_SERVERFUNCTION (ID, NAME, DESCRIPTION, TYPE, CODE, JDBC_ID, PUBLIC_EXECUTION, CRON_EXPRESSION, CRON_INPUT_JSON, CREATED_BY) VALUES (86, 'dreOrcadoPorConta', 'Orcado agregado por conta e mes — params cicloId (int), crIds (CSV opcional), contaIds (CSV opcional)', 'SQL', 'SELECT o.CONTA_ID, o.MES, SUM(o.VALOR) as VALOR
FROM ORCAMENTO o
WHERE o.CICLO_ID = {{cicloId}}
  AND (''{{crIds}}'' = '''' OR FIND_IN_SET(o.CR_ID, ''{{crIds}}''))
  AND (''{{contaIds}}'' = '''' OR FIND_IN_SET(o.CONTA_ID, ''{{contaIds}}''))
GROUP BY o.CONTA_ID, o.MES', NULL, FALSE, NULL, NULL, 'sarah@mitralab.io');
