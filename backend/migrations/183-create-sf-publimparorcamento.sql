INSERT INTO INT_SERVERFUNCTION (ID, NAME, DESCRIPTION, TYPE, CODE, JDBC_ID, PUBLIC_EXECUTION, CRON_EXPRESSION, CRON_INPUT_JSON, CREATED_BY) VALUES (165, 'pubLimparOrcamento', 'Publico: espelho do pessoalLimparOrcamento (60), token-gated (params: token,cicloId,crId)', 'SQL', 'DELETE o FROM ORCAMENTO o
 JOIN PREENCHIMENTO_TOKEN pt ON pt.TOKEN = ''{{token}}'' AND pt.ATIVO = ''true'' AND pt.CICLO_ID = {{cicloId}}
 JOIN GESTOR_CR gc ON gc.GESTOR_ID = pt.GESTOR_ID AND gc.CR_ID = o.CR_ID
 WHERE o.CICLO_ID = {{cicloId}} AND o.CR_ID = {{crId}}
   AND o.CONTA_ID IN (
     SELECT dc.CONTA_ID FROM DRIVER_CONFIG dc
     JOIN CONTA_CONTABIL cc ON cc.ID = dc.CONTA_ID
     WHERE dc.CR_ID = {{crId}} AND dc.DRIVER_TIPO = ''PESSOAL''
       AND cc.CODIGO IN (''5.1.01'',''5.1.02'',''5.1.03'')
   )', NULL, FALSE, NULL, NULL, 'sarah@mitralab.io');
