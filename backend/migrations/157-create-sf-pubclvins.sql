INSERT INTO INT_SERVERFUNCTION (ID, NAME, DESCRIPTION, TYPE, CODE, JDBC_ID, PUBLIC_EXECUTION, CRON_EXPRESSION, CRON_INPUT_JSON, CREATED_BY) VALUES (152, 'pubClvIns', 'Publico: INSERT de valor de linha custom (DRIVER_FORMULA_VALOR), token-gated (params: token,cicloId,crId,formulaId,mes,valor)', 'SQL', 'INSERT INTO DRIVER_FORMULA_VALOR (FORMULA_ID, CICLO_ID, CR_ID, MES, VALOR)
 SELECT {{formulaId}}, {{cicloId}}, {{crId}}, {{mes}}, {{valor}}
 FROM PREENCHIMENTO_TOKEN pt
 JOIN GESTOR_CR gc ON gc.GESTOR_ID = pt.GESTOR_ID AND gc.CR_ID = {{crId}}
 WHERE pt.TOKEN = ''{{token}}'' AND pt.ATIVO = ''true'' AND pt.CICLO_ID = {{cicloId}}
 LIMIT 1', NULL, FALSE, NULL, NULL, 'sarah@mitralab.io');
