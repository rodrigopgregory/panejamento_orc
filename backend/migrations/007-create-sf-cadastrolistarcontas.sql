INSERT INTO INT_SERVERFUNCTION (ID, NAME, DESCRIPTION, TYPE, CODE, JDBC_ID, PUBLIC_EXECUTION, CRON_EXPRESSION, CRON_INPUT_JSON, CREATED_BY) VALUES (46, 'cadastroListarContas', 'Lista contas contabeis paginada com busca (codigo/nome) e filtro de tipo', 'SQL', 'SELECT ID, CODIGO, NOME, TIPO, NATUREZA, ATIVO FROM CONTA_CONTABIL
WHERE (''{{busca}}'' = '''' OR LOWER(CODIGO) LIKE LOWER(''%{{busca}}%'') OR LOWER(NOME) LIKE LOWER(''%{{busca}}%''))
  AND (''{{tipo}}'' = '''' OR TIPO = ''{{tipo}}'')
ORDER BY CODIGO
LIMIT {{limit}} OFFSET {{offset}}', NULL, FALSE, NULL, NULL, 'sarah@mitralab.io');
