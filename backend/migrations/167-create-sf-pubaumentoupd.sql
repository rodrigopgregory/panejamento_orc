INSERT INTO INT_SERVERFUNCTION (ID, NAME, DESCRIPTION, TYPE, CODE, JDBC_ID, PUBLIC_EXECUTION, CRON_EXPRESSION, CRON_INPUT_JSON, CREATED_BY) VALUES (157, 'pubAumentoUpd', 'Publico: UPDATE de aumento salarial por chaves, token-gated (params: token,cicloId,colabId,percentual,mesAplicacao,motivo,criadoEm)', 'SQL', 'UPDATE AUMENTO_SALARIAL a
 JOIN COLABORADOR c ON c.ID = a.COLABORADOR_ID
 JOIN PREENCHIMENTO_TOKEN pt ON pt.TOKEN = ''{{token}}'' AND pt.ATIVO = ''true'' AND pt.CICLO_ID = {{cicloId}}
 JOIN GESTOR_CR gc ON gc.GESTOR_ID = pt.GESTOR_ID AND gc.CR_ID = c.CR_ID
 SET a.PERCENTUAL = {{percentual}}, a.MES_APLICACAO = {{mesAplicacao}}, a.MOTIVO = ''{{motivo}}'', a.CRIADO_EM = ''{{criadoEm}}''
 WHERE a.CICLO_ID = {{cicloId}} AND a.COLABORADOR_ID = {{colabId}}', NULL, FALSE, NULL, NULL, 'sarah@mitralab.io');
