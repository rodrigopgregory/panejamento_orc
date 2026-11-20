INSERT INTO INT_SERVERFUNCTION (ID, NAME, DESCRIPTION, TYPE, CODE, JDBC_ID, PUBLIC_EXECUTION, CRON_EXPRESSION, CRON_INPUT_JSON, CREATED_BY) VALUES (174, 'listarAuditoriaGeral', 'Trilha de auditoria completa do workflow com filtros opcionais. Params: cicloId (0=todos), evento (''''=todos), tipo (''''=todos, CR|PACOTE), busca (''''=sem busca), limit, offset', 'SQL', 'SELECT a.ID, a.CICLO_ID, c.NOME AS CICLO_NOME, a.TIPO, a.EVENTO,
  a.STATUS_DE, a.STATUS_PARA, a.COMENTARIO, a.AUTOR, a.ORIGEM, a.CRIADO_EM,
  CASE WHEN a.TIPO = ''CR'' THEN CONCAT(cr.CODIGO, '' - '', cr.NOME) ELSE CONCAT(''Pacote '', COALESCE(d.NOME, ''?'')) END AS ALVO
FROM WORKFLOW_AUDITORIA a
JOIN CICLO c ON c.ID = a.CICLO_ID
LEFT JOIN CENTRO_RESULTADO cr ON cr.ID = a.CR_ID
LEFT JOIN DRIVERS d ON d.ID = a.DRIVER_ID
WHERE ({{cicloId}} = 0 OR a.CICLO_ID = {{cicloId}})
  AND (''{{evento}}'' = '''' OR a.EVENTO = ''{{evento}}'')
  AND (''{{tipo}}'' = '''' OR a.TIPO = ''{{tipo}}'')
  AND (''{{busca}}'' = '''' OR a.AUTOR LIKE ''%{{busca}}%'' OR cr.NOME LIKE ''%{{busca}}%'' OR cr.CODIGO LIKE ''%{{busca}}%'' OR d.NOME LIKE ''%{{busca}}%'')
ORDER BY a.ID DESC
LIMIT {{limit}} OFFSET {{offset}}', NULL, FALSE, NULL, NULL, 'sarah@mitralab.io');
