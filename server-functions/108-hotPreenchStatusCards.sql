-- tipo: SQL | Status cards do gestor no ciclo.
SELECT os.*, cr.CODIGO as CR_CODIGO, cr.NOME as CR_NOME
     FROM ORCAMENTO_STATUS os JOIN CENTRO_RESULTADO cr ON cr.ID = os.CR_ID
     WHERE os.CICLO_ID = {{cicloId}} AND os.GESTOR_ID = {{gestorId}} ORDER BY cr.CODIGO