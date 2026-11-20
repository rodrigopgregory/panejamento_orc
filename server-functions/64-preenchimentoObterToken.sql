-- tipo: SQL | Retorna o token ativo de (cicloId, gestorId) (params: cicloId, gestorId)
SELECT TOKEN FROM PREENCHIMENTO_TOKEN
WHERE CICLO_ID = {{cicloId}} AND GESTOR_ID = {{gestorId}} AND ATIVO = 'true'
ORDER BY ID DESC LIMIT 1