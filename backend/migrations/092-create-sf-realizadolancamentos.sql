INSERT INTO INT_SERVERFUNCTION (ID, NAME, DESCRIPTION, TYPE, CODE, JDBC_ID, PUBLIC_EXECUTION, CRON_EXPRESSION, CRON_INPUT_JSON, CREATED_BY) VALUES (101, 'realizadoLancamentos', 'Lancamentos realizados paginados+filtrados. Params: ano, crIds, meses, tipos, busca, limit, offset.', 'SQL', 'SELECT rc.ID, rc.CR_ID, rc.CONTA_ID, rc.ANO, rc.MES, rc.VALOR,
       cc.CODIGO AS CONTA_CODIGO, cc.NOME AS CONTA_NOME, cc.TIPO AS CONTA_TIPO,
       cr.CODIGO AS CR_CODIGO, cr.NOME AS CR_NOME
     FROM REALIZADO_CONTABIL rc
     JOIN CONTA_CONTABIL cc ON cc.ID = rc.CONTA_ID
     JOIN CENTRO_RESULTADO cr ON cr.ID = rc.CR_ID
     WHERE rc.ANO = {{ano}} AND (''{{crIds}}'' = '''' OR FIND_IN_SET(rc.CR_ID, ''{{crIds}}'')) AND (''{{meses}}'' = '''' OR FIND_IN_SET(rc.MES, ''{{meses}}''))
  AND (''{{tipos}}'' = '''' OR FIND_IN_SET(cc.TIPO, ''{{tipos}}''))
  AND (''{{busca}}'' = '''' OR cc.CODIGO LIKE ''%{{busca}}%'' OR cc.NOME LIKE ''%{{busca}}%''
       OR cr.CODIGO LIKE ''%{{busca}}%'' OR cr.NOME LIKE ''%{{busca}}%'')
     ORDER BY rc.MES DESC, cc.CODIGO, cr.CODIGO
     LIMIT {{limit}} OFFSET {{offset}}', NULL, FALSE, NULL, NULL, 'sarah@mitralab.io');
