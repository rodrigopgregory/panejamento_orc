INSERT INTO INT_SERVERFUNCTION (ID, NAME, DESCRIPTION, TYPE, CODE, JDBC_ID, PUBLIC_EXECUTION, CRON_EXPRESSION, CRON_INPUT_JSON, CREATED_BY) VALUES (98, 'colaboradoresPaginados', 'Colaboradores paginados (filtro CR + busca nome/cargo). Params: crId, busca, limit, offset.', 'SQL', 'SELECT c.*, cr.CODIGO as CR_CODIGO, cr.NOME as CR_NOME, e.NOME as EMPRESA_NOME
    FROM COLABORADOR c
    LEFT JOIN CENTRO_RESULTADO cr ON cr.ID = c.CR_ID
    LEFT JOIN EMPRESA e ON e.ID = c.EMPRESA_ID
    WHERE (''{{crId}}'' = '''' OR c.CR_ID = {{crId}})
  AND (''{{busca}}'' = '''' OR c.NOME LIKE ''%{{busca}}%'' OR c.CARGO LIKE ''%{{busca}}%'')
    ORDER BY c.NOME
    LIMIT {{limit}} OFFSET {{offset}}', NULL, FALSE, NULL, NULL, 'sarah@mitralab.io');
