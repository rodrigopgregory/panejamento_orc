INSERT INTO INT_SERVERFUNCTION (ID, NAME, DESCRIPTION, TYPE, CODE, JDBC_ID, PUBLIC_EXECUTION, CRON_EXPRESSION, CRON_INPUT_JSON, CREATED_BY) VALUES (153, 'pubContratIns', 'Publico: INSERT de contratacao projetada, token-gated (params: token,cicloId,crId,cargoId,mesEntrada,motivo,qtdVagas,criadoEm)', 'SQL', 'INSERT INTO CONTRATACAO_PROJETADA (CICLO_ID, CR_ID, CARGO_ID, MES_ENTRADA, MOTIVO, QTD_VAGAS, CRIADO_EM)
 SELECT {{cicloId}}, {{crId}}, {{cargoId}}, {{mesEntrada}}, ''{{motivo}}'', {{qtdVagas}}, ''{{criadoEm}}''
 FROM PREENCHIMENTO_TOKEN pt
 JOIN GESTOR_CR gc ON gc.GESTOR_ID = pt.GESTOR_ID AND gc.CR_ID = {{crId}}
 WHERE pt.TOKEN = ''{{token}}'' AND pt.ATIVO = ''true'' AND pt.CICLO_ID = {{cicloId}}
 LIMIT 1', NULL, FALSE, NULL, NULL, 'sarah@mitralab.io');
