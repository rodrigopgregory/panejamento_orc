-- tipo: SQL | Cria ou atualiza desligamento projetado. O mes e o primeiro sem custo. Params: cicloId, crId, colaboradorId, mesDesligamento, criadoEm.
INSERT INTO DESLIGAMENTO_PROJETADO (CICLO_ID, CR_ID, COLABORADOR_ID, MES_DESLIGAMENTO, CRIADO_EM)
SELECT {{cicloId}}, {{crId}}, c.ID, {{mesDesligamento}}, '{{criadoEm}}'
FROM COLABORADOR c
WHERE c.ID = {{colaboradorId}} AND c.CR_ID = {{crId}} AND {{mesDesligamento}} BETWEEN 1 AND 12
ON DUPLICATE KEY UPDATE CR_ID = VALUES(CR_ID), MES_DESLIGAMENTO = VALUES(MES_DESLIGAMENTO), CRIADO_EM = VALUES(CRIADO_EM)