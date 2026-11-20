INSERT INTO INT_SERVERFUNCTION (ID, NAME, DESCRIPTION, TYPE, CODE, JDBC_ID, PUBLIC_EXECUTION, CRON_EXPRESSION, CRON_INPUT_JSON, CREATED_BY) VALUES (102, 'realizadoLancamentosResumo', 'Resumo lancamentos (COUNT + SUM) sobre todo o filtro. Params: ano, crIds, meses, tipos, busca.', 'SQL', 'SELECT COUNT(*) AS TOTAL, COALESCE(SUM(rc.VALOR),0) AS SOMA
     FROM REALIZADO_CONTABIL rc
     JOIN CONTA_CONTABIL cc ON cc.ID = rc.CONTA_ID
     JOIN CENTRO_RESULTADO cr ON cr.ID = rc.CR_ID
     WHERE rc.ANO = {{ano}} AND (''{{crIds}}'' = '''' OR FIND_IN_SET(rc.CR_ID, ''{{crIds}}'')) AND (''{{meses}}'' = '''' OR FIND_IN_SET(rc.MES, ''{{meses}}''))
  AND (''{{tipos}}'' = '''' OR FIND_IN_SET(cc.TIPO, ''{{tipos}}''))
  AND (''{{busca}}'' = '''' OR cc.CODIGO LIKE ''%{{busca}}%'' OR cc.NOME LIKE ''%{{busca}}%''
       OR cr.CODIGO LIKE ''%{{busca}}%'' OR cr.NOME LIKE ''%{{busca}}%'')', NULL, FALSE, NULL, NULL, 'sarah@mitralab.io');
