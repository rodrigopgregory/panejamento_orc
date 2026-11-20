INSERT INTO INT_SERVERFUNCTION (ID, NAME, DESCRIPTION, TYPE, CODE, JDBC_ID, PUBLIC_EXECUTION, CRON_EXPRESSION, CRON_INPUT_JSON, CREATED_BY) VALUES (162, 'pubHistIns', 'Publico: INSERT de premissa historica, token-gated (params: token,cicloId,crId,contaId,percentual,modo,justificativa,criadoEm)', 'SQL', 'INSERT INTO HIST_PREMISSA (CICLO_ID, CR_ID, CONTA_ID, PERCENTUAL, MODO, JUSTIFICATIVA, CRIADO_EM)
 SELECT {{cicloId}}, {{crId}}, {{contaId}}, {{percentual}}, ''{{modo}}'', ''{{justificativa}}'', ''{{criadoEm}}''
 FROM PREENCHIMENTO_TOKEN pt
 JOIN GESTOR_CR gc ON gc.GESTOR_ID = pt.GESTOR_ID AND gc.CR_ID = {{crId}}
 WHERE pt.TOKEN = ''{{token}}'' AND pt.ATIVO = ''true'' AND pt.CICLO_ID = {{cicloId}}
 LIMIT 1', NULL, FALSE, NULL, NULL, 'sarah@mitralab.io');
