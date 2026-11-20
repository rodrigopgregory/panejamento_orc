INSERT INTO INT_SERVERFUNCTION (ID, NAME, DESCRIPTION, TYPE, CODE, JDBC_ID, PUBLIC_EXECUTION, CRON_EXPRESSION, CRON_INPUT_JSON, CREATED_BY) VALUES (161, 'pubHistUpd', 'Publico: UPDATE de premissa historica por chaves, token-gated (params: token,cicloId,crId,contaId,percentual,modo,justificativa,criadoEm)', 'SQL', 'UPDATE HIST_PREMISSA h
 JOIN PREENCHIMENTO_TOKEN pt ON pt.TOKEN = ''{{token}}'' AND pt.ATIVO = ''true'' AND pt.CICLO_ID = {{cicloId}}
 JOIN GESTOR_CR gc ON gc.GESTOR_ID = pt.GESTOR_ID AND gc.CR_ID = h.CR_ID
 SET h.PERCENTUAL = {{percentual}}, h.MODO = ''{{modo}}'', h.JUSTIFICATIVA = ''{{justificativa}}'', h.CRIADO_EM = ''{{criadoEm}}''
 WHERE h.CICLO_ID = {{cicloId}} AND h.CR_ID = {{crId}} AND h.CONTA_ID = {{contaId}}', NULL, FALSE, NULL, NULL, 'sarah@mitralab.io');
