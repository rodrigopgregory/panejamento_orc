-- tipo: SQL | Remove um desligamento projetado da versao e CR. Params: id, cicloId, crId.
DELETE FROM DESLIGAMENTO_PROJETADO
WHERE ID = {{id}} AND CICLO_ID = {{cicloId}} AND CR_ID = {{crId}}