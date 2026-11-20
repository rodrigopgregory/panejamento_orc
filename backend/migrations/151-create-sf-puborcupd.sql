INSERT INTO INT_SERVERFUNCTION (ID, NAME, DESCRIPTION, TYPE, CODE, JDBC_ID, PUBLIC_EXECUTION, CRON_EXPRESSION, CRON_INPUT_JSON, CREATED_BY) VALUES (149, 'pubOrcUpd', 'Publico: UPDATE de celula do ORCAMENTO por chaves naturais, token-gated (params: token,cicloId,crId,contaId,mes,valor,qtd,vu,setQtd,setVu)', 'SQL', 'UPDATE ORCAMENTO o
 JOIN PREENCHIMENTO_TOKEN pt ON pt.TOKEN = ''{{token}}'' AND pt.ATIVO = ''true'' AND pt.CICLO_ID = {{cicloId}}
 JOIN GESTOR_CR gc ON gc.GESTOR_ID = pt.GESTOR_ID AND gc.CR_ID = o.CR_ID
 SET o.VALOR = {{valor}},
     o.QUANTIDADE = IF({{setQtd}} = 1, {{qtd}}, o.QUANTIDADE),
     o.VALOR_UNITARIO = IF({{setVu}} = 1, {{vu}}, o.VALOR_UNITARIO)
 WHERE o.CICLO_ID = {{cicloId}} AND o.CR_ID = {{crId}} AND o.CONTA_ID = {{contaId}} AND o.MES = {{mes}}', NULL, FALSE, NULL, NULL, 'sarah@mitralab.io');
