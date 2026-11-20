INSERT INTO INT_SERVERFUNCTION (ID, NAME, DESCRIPTION, TYPE, CODE, JDBC_ID, PUBLIC_EXECUTION, CRON_EXPRESSION, CRON_INPUT_JSON, CREATED_BY) VALUES (151, 'pubClvUpd', 'Publico: UPDATE de valor de linha custom (DRIVER_FORMULA_VALOR) por chaves, token-gated (params: token,cicloId,crId,formulaId,mes,valor)', 'SQL', 'UPDATE DRIVER_FORMULA_VALOR v
 JOIN PREENCHIMENTO_TOKEN pt ON pt.TOKEN = ''{{token}}'' AND pt.ATIVO = ''true'' AND pt.CICLO_ID = {{cicloId}}
 JOIN GESTOR_CR gc ON gc.GESTOR_ID = pt.GESTOR_ID AND gc.CR_ID = v.CR_ID
 SET v.VALOR = {{valor}}
 WHERE v.CICLO_ID = {{cicloId}} AND v.CR_ID = {{crId}} AND v.FORMULA_ID = {{formulaId}} AND v.MES = {{mes}}', NULL, FALSE, NULL, NULL, 'sarah@mitralab.io');
