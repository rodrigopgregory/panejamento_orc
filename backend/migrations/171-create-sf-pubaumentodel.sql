INSERT INTO INT_SERVERFUNCTION (ID, NAME, DESCRIPTION, TYPE, CODE, JDBC_ID, PUBLIC_EXECUTION, CRON_EXPRESSION, CRON_INPUT_JSON, CREATED_BY) VALUES (159, 'pubAumentoDel', 'Publico: DELETE de aumento salarial por ID, token-gated pela posse do colaborador (params: token,cicloId,id)', 'SQL', 'DELETE a FROM AUMENTO_SALARIAL a
 JOIN COLABORADOR c ON c.ID = a.COLABORADOR_ID
 JOIN PREENCHIMENTO_TOKEN pt ON pt.TOKEN = ''{{token}}'' AND pt.ATIVO = ''true'' AND pt.CICLO_ID = {{cicloId}}
 JOIN GESTOR_CR gc ON gc.GESTOR_ID = pt.GESTOR_ID AND gc.CR_ID = c.CR_ID
 WHERE a.ID = {{id}}', NULL, FALSE, NULL, NULL, 'sarah@mitralab.io');
