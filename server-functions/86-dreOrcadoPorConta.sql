-- tipo: SQL | Orcado agregado por conta e mes — params cicloId (int), crIds (CSV opcional), contaIds (CSV opcional)
SELECT z.CONTA_ID, z.MES, SUM(z.VALOR) as VALOR
FROM (SELECT o.CONTA_ID, o.MES, o.VALOR, o.CR_ID FROM ORCAMENTO o WHERE o.CICLO_ID = {{cicloId}}
UNION ALL
SELECT op.CONTA_ID, op.MES, op.VALOR, op.CR_ID FROM ORCAMENTO_PACOTE op WHERE op.CICLO_ID = {{cicloId}} AND op.CR_ID IS NOT NULL AND EXISTS (SELECT 1 FROM PACOTE_STATUS ps WHERE ps.CICLO_ID = op.CICLO_ID AND ps.DRIVER_ID = op.DRIVER_ID AND ps.STATUS IN ('SUBMETIDO','APROVADO'))) z
WHERE ('{{crIds}}' = '' OR FIND_IN_SET(z.CR_ID, '{{crIds}}'))
  AND ('{{contaIds}}' = '' OR FIND_IN_SET(z.CONTA_ID, '{{contaIds}}'))
GROUP BY z.CONTA_ID, z.MES