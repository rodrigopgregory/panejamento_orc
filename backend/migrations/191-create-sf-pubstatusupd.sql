INSERT INTO INT_SERVERFUNCTION (ID, NAME, DESCRIPTION, TYPE, CODE, JDBC_ID, PUBLIC_EXECUTION, CRON_EXPRESSION, CRON_INPUT_JSON, CREATED_BY) VALUES (169, 'pubStatusUpd', 'Publico: atualiza modelos confirmados/status do CR do gestor, token-gated (params: token,cicloId,crId,csv,novoStatus; novoStatus vazio mantem)', 'SQL', 'UPDATE ORCAMENTO_STATUS s
 JOIN PREENCHIMENTO_TOKEN pt ON pt.TOKEN = ''{{token}}'' AND pt.ATIVO = ''true'' AND pt.CICLO_ID = {{cicloId}}
 JOIN GESTOR_CR gc ON gc.GESTOR_ID = pt.GESTOR_ID AND gc.CR_ID = {{crId}}
 SET s.DRIVERS_CONFIRMADOS = ''{{csv}}'', s.STATUS = IF(''{{novoStatus}}'' = '''', s.STATUS, ''{{novoStatus}}'')
 WHERE s.CICLO_ID = {{cicloId}} AND s.CR_ID = {{crId}} AND s.GESTOR_ID = pt.GESTOR_ID', NULL, FALSE, NULL, NULL, 'sarah@mitralab.io');
