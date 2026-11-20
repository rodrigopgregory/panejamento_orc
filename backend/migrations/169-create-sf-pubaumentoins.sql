INSERT INTO INT_SERVERFUNCTION (ID, NAME, DESCRIPTION, TYPE, CODE, JDBC_ID, PUBLIC_EXECUTION, CRON_EXPRESSION, CRON_INPUT_JSON, CREATED_BY) VALUES (158, 'pubAumentoIns', 'Publico: INSERT de aumento salarial, token-gated pela posse do colaborador (params: token,cicloId,colabId,percentual,mesAplicacao,motivo,criadoEm)', 'SQL', 'INSERT INTO AUMENTO_SALARIAL (CICLO_ID, COLABORADOR_ID, PERCENTUAL, MES_APLICACAO, MOTIVO, CRIADO_EM)
 SELECT {{cicloId}}, {{colabId}}, {{percentual}}, {{mesAplicacao}}, ''{{motivo}}'', ''{{criadoEm}}''
 FROM PREENCHIMENTO_TOKEN pt
 JOIN COLABORADOR c ON c.ID = {{colabId}}
 JOIN GESTOR_CR gc ON gc.GESTOR_ID = pt.GESTOR_ID AND gc.CR_ID = c.CR_ID
 WHERE pt.TOKEN = ''{{token}}'' AND pt.ATIVO = ''true'' AND pt.CICLO_ID = {{cicloId}}
 LIMIT 1', NULL, FALSE, NULL, NULL, 'sarah@mitralab.io');
