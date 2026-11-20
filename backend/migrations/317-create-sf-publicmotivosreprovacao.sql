INSERT INTO INT_SERVERFUNCTION (ID, NAME, DESCRIPTION, TYPE, CODE, JDBC_ID, PUBLIC_EXECUTION, CRON_EXPRESSION, CRON_INPUT_JSON, CREATED_BY) VALUES (193, 'publicMotivosReprovacao', 'Lista motivos de reprovação do CR ou pacote do gestor, delimitado pelo token ativo (params: token, tipo, refId, agora).', 'SQL', 'SELECT a.EVENTO, a.COMENTARIO, a.AUTOR, a.CRIADO_EM
FROM WORKFLOW_AUDITORIA a
JOIN PREENCHIMENTO_TOKEN t ON t.TOKEN = ''{{token}}'' AND t.ATIVO = ''true''
WHERE a.EVENTO = ''REPROVADO''
  AND (t.EXPIRA_EM IS NULL OR t.EXPIRA_EM >= ''{{agora}}'')
  AND (
    (''{{tipo}}'' = ''CR'' AND a.TIPO = ''CR'' AND a.CR_ID = {{refId}}
      AND EXISTS (SELECT 1 FROM GESTOR_CR gc WHERE gc.GESTOR_ID = t.GESTOR_ID AND gc.CR_ID = a.CR_ID))
    OR
    (''{{tipo}}'' = ''PACOTE'' AND a.TIPO = ''PACOTE'' AND a.DRIVER_ID = {{refId}}
      AND EXISTS (SELECT 1 FROM PACOTE_STATUS ps WHERE ps.CICLO_ID = t.CICLO_ID AND ps.GESTOR_ID = t.GESTOR_ID AND ps.DRIVER_ID = a.DRIVER_ID))
  )
ORDER BY a.CRIADO_EM DESC, a.ID DESC', NULL, FALSE, NULL, NULL, 'sarah@mitralab.io');
