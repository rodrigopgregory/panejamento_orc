INSERT INTO INT_SERVERFUNCTION (ID, NAME, DESCRIPTION, TYPE, CODE, JDBC_ID, PUBLIC_EXECUTION, CRON_EXPRESSION, CRON_INPUT_JSON, CREATED_BY) VALUES (47, 'cadastroContarContas', 'Total de contas contabeis para paginacao (mesmos filtros da listagem)', 'SQL', 'SELECT COUNT(*) AS TOTAL FROM CONTA_CONTABIL
WHERE (''{{busca}}'' = '''' OR LOWER(CODIGO) LIKE LOWER(''%{{busca}}%'') OR LOWER(NOME) LIKE LOWER(''%{{busca}}%''))
  AND (''{{tipo}}'' = '''' OR TIPO = ''{{tipo}}'')', NULL, FALSE, NULL, NULL, 'sarah@mitralab.io');
