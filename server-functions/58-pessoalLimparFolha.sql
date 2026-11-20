-- tipo: SQL | Remove a projecao de folha existente de um ciclo/CR antes do recalculo (params: cicloId, crId)
DELETE FROM ORCAMENTO_PESSOAL WHERE CICLO_ID = {{cicloId}} AND CR_ID = {{crId}}