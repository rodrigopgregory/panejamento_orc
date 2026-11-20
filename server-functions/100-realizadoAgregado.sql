-- tipo: SQL | Realizado agregado por empresa/conta/CR/mes. Params: ano, empresaId e crIds (opcionais).
SELECT rc.EMPRESA_ID, e.NOME AS EMPRESA_NOME, rc.CONTA_ID, rc.CR_ID, rc.MES, SUM(rc.VALOR) AS VALOR,
       cc.CODIGO AS CONTA_CODIGO, cc.NOME AS CONTA_NOME, cc.TIPO AS CONTA_TIPO,
       cr.CODIGO AS CR_CODIGO, cr.NOME AS CR_NOME
     FROM REALIZADO_CONTABIL rc
     JOIN EMPRESA e ON e.ID = rc.EMPRESA_ID
     JOIN CONTA_CONTABIL cc ON cc.ID = rc.CONTA_ID
     JOIN CENTRO_RESULTADO cr ON cr.ID = rc.CR_ID
     WHERE rc.ANO = {{ano}} AND ('{{empresaId}}' = '' OR rc.EMPRESA_ID = NULLIF('{{empresaId}}', '')) AND ('{{crIds}}' = '' OR FIND_IN_SET(rc.CR_ID, '{{crIds}}'))
     GROUP BY rc.EMPRESA_ID, e.NOME, rc.CONTA_ID, rc.CR_ID, rc.MES, cc.CODIGO, cc.NOME, cc.TIPO, cr.CODIGO, cr.NOME
     ORDER BY cc.CODIGO, rc.MES