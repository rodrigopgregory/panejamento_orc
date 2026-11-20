INSERT INTO INT_SERVERFUNCTION (ID, NAME, DESCRIPTION, TYPE, CODE, JDBC_ID, PUBLIC_EXECUTION, CRON_EXPRESSION, CRON_INPUT_JSON, CREATED_BY) VALUES (41, 'cadastroListarEmpresas', 'Lista empresas paginada com busca (nome/CNPJ) e filtro de status', 'SQL', 'SELECT ID, NOME, CNPJ, ATIVO FROM EMPRESA
WHERE (''{{busca}}'' = '''' OR LOWER(NOME) LIKE LOWER(''%{{busca}}%'') OR LOWER(CNPJ) LIKE LOWER(''%{{busca}}%''))
  AND (''{{ativo}}'' = '''' OR ATIVO = ''{{ativo}}'')
ORDER BY NOME
LIMIT {{limit}} OFFSET {{offset}}', NULL, FALSE, NULL, NULL, 'sarah@mitralab.io');
