INSERT INTO INT_SERVERFUNCTION (ID, NAME, DESCRIPTION, TYPE, CODE, JDBC_ID, PUBLIC_EXECUTION, CRON_EXPRESSION, CRON_INPUT_JSON, CREATED_BY) VALUES (156, 'pubAumentoGet', 'Publico: busca ID do aumento salarial de um colaborador do gestor, token-gated (params: token,cicloId,colabId)', 'SQL', 'SELECT a.ID FROM AUMENTO_SALARIAL a
 JOIN COLABORADOR c ON c.ID = a.COLABORADOR_ID
 JOIN PREENCHIMENTO_TOKEN pt ON pt.TOKEN = ''{{token}}'' AND pt.ATIVO = ''true'' AND pt.CICLO_ID = {{cicloId}}
 JOIN GESTOR_CR gc ON gc.GESTOR_ID = pt.GESTOR_ID AND gc.CR_ID = c.CR_ID
 WHERE a.CICLO_ID = {{cicloId}} AND a.COLABORADOR_ID = {{colabId}}
 LIMIT 1', NULL, FALSE, NULL, NULL, 'sarah@mitralab.io');
