-- tipo: SQL | Cards de status por CR do kanban — param cicloId (int)
SELECT os.*, g.NOME as GESTOR_NOME, g.EMAIL as GESTOR_EMAIL,
       cr.CODIGO as CR_CODIGO, cr.NOME as CR_NOME
FROM ORCAMENTO_STATUS os
JOIN GESTOR g ON g.ID = os.GESTOR_ID
JOIN CENTRO_RESULTADO cr ON cr.ID = os.CR_ID
WHERE os.CICLO_ID = {{cicloId}}
ORDER BY g.NOME, cr.CODIGO