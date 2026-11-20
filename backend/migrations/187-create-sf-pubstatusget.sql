INSERT INTO INT_SERVERFUNCTION (ID, NAME, DESCRIPTION, TYPE, CODE, JDBC_ID, PUBLIC_EXECUTION, CRON_EXPRESSION, CRON_INPUT_JSON, CREATED_BY) VALUES (167, 'pubStatusGet', 'Publico: le o registro de status do CR do gestor do token (params: token,cicloId,crId)', 'SQL', 'SELECT s.* FROM ORCAMENTO_STATUS s
 JOIN PREENCHIMENTO_TOKEN pt ON pt.TOKEN = ''{{token}}'' AND pt.ATIVO = ''true'' AND pt.CICLO_ID = {{cicloId}}
 JOIN GESTOR_CR gc ON gc.GESTOR_ID = pt.GESTOR_ID AND gc.CR_ID = {{crId}}
 WHERE s.CICLO_ID = {{cicloId}} AND s.CR_ID = {{crId}} AND s.GESTOR_ID = pt.GESTOR_ID
 LIMIT 1', NULL, FALSE, NULL, NULL, 'sarah@mitralab.io');
