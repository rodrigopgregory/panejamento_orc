-- tipo: SQL | Gestores ativos com seus CRs concatenados (sem params)
SELECT g.*, GROUP_CONCAT(gc.CR_ID) as CR_IDS
FROM GESTOR g
JOIN GESTOR_CR gc ON gc.GESTOR_ID = g.ID
WHERE g.ATIVO = 'true'
GROUP BY g.ID