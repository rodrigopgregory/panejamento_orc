-- tipo: SQL | Lista a projecao de folha calculada de um ciclo/CR (params: cicloId, crId)
SELECT * FROM ORCAMENTO_PESSOAL WHERE CICLO_ID = {{cicloId}} AND CR_ID = {{crId}}