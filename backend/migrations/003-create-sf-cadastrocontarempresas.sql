INSERT INTO INT_SERVERFUNCTION (ID, NAME, DESCRIPTION, TYPE, CODE, JDBC_ID, PUBLIC_EXECUTION, CRON_EXPRESSION, CRON_INPUT_JSON, CREATED_BY) VALUES (42, 'cadastroContarEmpresas', 'Total de empresas para paginacao (mesmos filtros da listagem)', 'SQL', 'SELECT COUNT(*) AS TOTAL FROM EMPRESA
WHERE (''{{busca}}'' = '''' OR LOWER(NOME) LIKE LOWER(''%{{busca}}%'') OR LOWER(CNPJ) LIKE LOWER(''%{{busca}}%''))
  AND (''{{ativo}}'' = '''' OR ATIVO = ''{{ativo}}'')', NULL, FALSE, NULL, NULL, 'sarah@mitralab.io');
