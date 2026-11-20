-- tipo: SQL | Cards de status por pacote do kanban — param cicloId (int)
SELECT ps.*, g.NOME as GESTOR_NOME, g.EMAIL as GESTOR_EMAIL,
       d.NOME as DRIVER_NOME, d.DESCRICAO as DRIVER_DESCRICAO
FROM PACOTE_STATUS ps
JOIN GESTOR g ON g.ID = ps.GESTOR_ID
JOIN DRIVERS d ON d.ID = ps.DRIVER_ID
WHERE ps.CICLO_ID = {{cicloId}}
ORDER BY g.NOME, d.NOME