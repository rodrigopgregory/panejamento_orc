-- tipo: SQL | Retorna o snapshot completo de uma versao para visualizacao. Param: versaoId.
SELECT ID, NUMERO, CRIADO_EM, SNAPSHOT FROM DRIVER_VERSAO WHERE ID = {{versaoId}}