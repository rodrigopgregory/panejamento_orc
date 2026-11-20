-- tipo: SQL | Contagem e soma dos lancamentos contabeis filtrados por empresa e demais dimensoes.
SELECT COUNT(*) AS TOTAL, COALESCE(SUM(rc.VALOR),0) AS SOMA
     FROM REALIZADO_CONTABIL rc
     JOIN EMPRESA e ON e.ID = rc.EMPRESA_ID
     JOIN CONTA_CONTABIL cc ON cc.ID = rc.CONTA_ID
     JOIN CENTRO_RESULTADO cr ON cr.ID = rc.CR_ID
     WHERE rc.ANO = {{ano}} AND ('{{empresaId}}' = '' OR rc.EMPRESA_ID = NULLIF('{{empresaId}}', '')) AND ('{{crIds}}' = '' OR FIND_IN_SET(rc.CR_ID, '{{crIds}}')) AND ('{{meses}}' = '' OR FIND_IN_SET(rc.MES, '{{meses}}'))
  AND ('{{tipos}}' = '' OR FIND_IN_SET(cc.TIPO, '{{tipos}}'))
  AND ('{{busca}}' = '' OR cc.CODIGO LIKE '%{{busca}}%' OR cc.NOME LIKE '%{{busca}}%'
       OR cr.CODIGO LIKE '%{{busca}}%' OR cr.NOME LIKE '%{{busca}}%' OR e.NOME LIKE '%{{busca}}%')