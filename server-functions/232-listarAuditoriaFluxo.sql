-- tipo: SQL | Trilha cronologica completa de um objeto (CR ou pacote) dentro de um ciclo, usada no painel de detalhes da tela de Auditoria. Params: cicloId, tipo (CR|PACOTE), crId (0 se pacote), driverId (0 se CR).
SELECT a.ID, a.EVENTO, a.STATUS_DE, a.STATUS_PARA, a.COMENTARIO,
  a.AUTOR, a.ORIGEM, a.CRIADO_EM
FROM WORKFLOW_AUDITORIA a
WHERE a.CICLO_ID = {{cicloId}}
  AND a.TIPO = '{{tipo}}'
  AND (({{crId}} = 0 AND a.CR_ID IS NULL) OR a.CR_ID = {{crId}})
  AND (({{driverId}} = 0 AND a.DRIVER_ID IS NULL) OR a.DRIVER_ID = {{driverId}})
ORDER BY a.CRIADO_EM ASC, a.ID ASC