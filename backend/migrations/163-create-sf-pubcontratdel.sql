INSERT INTO INT_SERVERFUNCTION (ID, NAME, DESCRIPTION, TYPE, CODE, JDBC_ID, PUBLIC_EXECUTION, CRON_EXPRESSION, CRON_INPUT_JSON, CREATED_BY) VALUES (155, 'pubContratDel', 'Publico: DELETE de contratacao projetada por ID, token-gated pela posse do CR (params: token,cicloId,id)', 'SQL', 'DELETE cp FROM CONTRATACAO_PROJETADA cp
 JOIN PREENCHIMENTO_TOKEN pt ON pt.TOKEN = ''{{token}}'' AND pt.ATIVO = ''true'' AND pt.CICLO_ID = {{cicloId}}
 JOIN GESTOR_CR gc ON gc.GESTOR_ID = pt.GESTOR_ID AND gc.CR_ID = cp.CR_ID
 WHERE cp.ID = {{id}}', NULL, FALSE, NULL, NULL, 'sarah@mitralab.io');
