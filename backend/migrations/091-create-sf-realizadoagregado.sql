INSERT INTO INT_SERVERFUNCTION (ID, NAME, DESCRIPTION, TYPE, CODE, JDBC_ID, PUBLIC_EXECUTION, CRON_EXPRESSION, CRON_INPUT_JSON, CREATED_BY) VALUES (100, 'realizadoAgregado', 'Realizado agregado por conta/CR/mes (SUM no banco). Params: ano, crIds (CSV opcional).', 'SQL', 'SELECT rc.CONTA_ID, rc.CR_ID, rc.MES, SUM(rc.VALOR) AS VALOR,
       cc.CODIGO AS CONTA_CODIGO, cc.NOME AS CONTA_NOME, cc.TIPO AS CONTA_TIPO,
       cr.CODIGO AS CR_CODIGO, cr.NOME AS CR_NOME
     FROM REALIZADO_CONTABIL rc
     JOIN CONTA_CONTABIL cc ON cc.ID = rc.CONTA_ID
     JOIN CENTRO_RESULTADO cr ON cr.ID = rc.CR_ID
     WHERE rc.ANO = {{ano}} AND (''{{crIds}}'' = '''' OR FIND_IN_SET(rc.CR_ID, ''{{crIds}}''))
     GROUP BY rc.CONTA_ID, rc.CR_ID, rc.MES, cc.CODIGO, cc.NOME, cc.TIPO, cr.CODIGO, cr.NOME
     ORDER BY cc.CODIGO, rc.MES', NULL, FALSE, NULL, NULL, 'sarah@mitralab.io');
