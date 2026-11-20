-- tipo: SQL | Realizado agregado por empresa e mes — params ano (int), contaIds/crIds (CSV opcional)
SELECT rc.EMPRESA_ID, rc.MES, SUM(rc.VALOR) as VALOR
FROM REALIZADO_CONTABIL rc
WHERE rc.ANO = {{ano}}
  AND ('{{contaIds}}' = '' OR FIND_IN_SET(rc.CONTA_ID, '{{contaIds}}'))
  AND ('{{crIds}}' = '' OR FIND_IN_SET(rc.CR_ID, '{{crIds}}'))
GROUP BY rc.EMPRESA_ID, rc.MES