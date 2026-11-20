INSERT INTO INT_SERVERFUNCTION (ID, NAME, DESCRIPTION, TYPE, CODE, JDBC_ID, PUBLIC_EXECUTION, CRON_EXPRESSION, CRON_INPUT_JSON, CREATED_BY) VALUES (52, 'cadastroContarCRs', 'Total de centros de resultado para paginacao (mesmos filtros da listagem)', 'SQL', 'SELECT COUNT(*) AS TOTAL FROM CENTRO_RESULTADO CR
WHERE (''{{busca}}'' = '''' OR LOWER(CR.CODIGO) LIKE LOWER(''%{{busca}}%'') OR LOWER(CR.NOME) LIKE LOWER(''%{{busca}}%''))
  AND (''{{empresaId}}'' = '''' OR CR.EMPRESA_ID = ''{{empresaId}}'')', NULL, FALSE, NULL, NULL, 'sarah@mitralab.io');
