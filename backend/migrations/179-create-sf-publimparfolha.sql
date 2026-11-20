INSERT INTO INT_SERVERFUNCTION (ID, NAME, DESCRIPTION, TYPE, CODE, JDBC_ID, PUBLIC_EXECUTION, CRON_EXPRESSION, CRON_INPUT_JSON, CREATED_BY) VALUES (163, 'pubLimparFolha', 'Publico: espelho do pessoalLimparFolha (58), token-gated (params: token,cicloId,crId)', 'SQL', 'DELETE op FROM ORCAMENTO_PESSOAL op
 JOIN PREENCHIMENTO_TOKEN pt ON pt.TOKEN = ''{{token}}'' AND pt.ATIVO = ''true'' AND pt.CICLO_ID = {{cicloId}}
 JOIN GESTOR_CR gc ON gc.GESTOR_ID = pt.GESTOR_ID AND gc.CR_ID = op.CR_ID
 WHERE op.CICLO_ID = {{cicloId}} AND op.CR_ID = {{crId}}', NULL, FALSE, NULL, NULL, 'sarah@mitralab.io');
