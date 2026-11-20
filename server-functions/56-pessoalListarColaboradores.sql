-- tipo: SQL | Lista colaboradores ativos de um CR (params: crId)
SELECT * FROM COLABORADOR WHERE CR_ID = {{crId}} AND ATIVO = 'true' ORDER BY NOME