INSERT INTO INT_SERVERFUNCTION (ID, NAME, DESCRIPTION, TYPE, CODE, JDBC_ID, PUBLIC_EXECUTION, CRON_EXPRESSION, CRON_INPUT_JSON, CREATED_BY) VALUES (154, 'pubContratMaxId', 'Publico: ID da ultima contratacao criada no ciclo/CR, token-gated (params: token,cicloId,crId)', 'SQL', 'SELECT MAX(cp.ID) AS ID
 FROM CONTRATACAO_PROJETADA cp
 JOIN PREENCHIMENTO_TOKEN pt ON pt.TOKEN = ''{{token}}'' AND pt.ATIVO = ''true'' AND pt.CICLO_ID = {{cicloId}}
 JOIN GESTOR_CR gc ON gc.GESTOR_ID = pt.GESTOR_ID AND gc.CR_ID = cp.CR_ID
 WHERE cp.CICLO_ID = {{cicloId}} AND cp.CR_ID = {{crId}}', NULL, FALSE, NULL, NULL, 'sarah@mitralab.io');
