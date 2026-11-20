INSERT INTO INT_SERVERFUNCTION (ID, NAME, DESCRIPTION, TYPE, CODE, JDBC_ID, PUBLIC_EXECUTION, CRON_EXPRESSION, CRON_INPUT_JSON, CREATED_BY) VALUES (88, 'dreOrcadoPorCr', 'Orcado agregado por CR e mes — params cicloId (int), contaIds/crIds (CSV opcional)', 'SQL', 'SELECT o.CR_ID, o.MES, SUM(o.VALOR) as VALOR
FROM ORCAMENTO o
WHERE o.CICLO_ID = {{cicloId}}
  AND (''{{contaIds}}'' = '''' OR FIND_IN_SET(o.CONTA_ID, ''{{contaIds}}''))
  AND (''{{crIds}}'' = '''' OR FIND_IN_SET(o.CR_ID, ''{{crIds}}''))
GROUP BY o.CR_ID, o.MES', NULL, FALSE, NULL, NULL, 'sarah@mitralab.io');
