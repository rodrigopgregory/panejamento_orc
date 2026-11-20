-- tipo: SQL | Orcado agregado por empresa e mes — params cicloId (int), contaIds/crIds (CSV opcional)
SELECT cr.EMPRESA_ID, z.MES, SUM(z.VALOR) as VALOR
FROM (SELECT o.CONTA_ID, o.MES, o.VALOR, o.CR_ID FROM ORCAMENTO o WHERE o.CICLO_ID = {{cicloId}}
UNION ALL
SELECT op.CONTA_ID, op.MES, op.VALOR, op.CR_ID FROM ORCAMENTO_PACOTE op WHERE op.CICLO_ID = {{cicloId}} AND op.CR_ID IS NOT NULL AND EXISTS (SELECT 1 FROM PACOTE_STATUS ps WHERE ps.CICLO_ID = op.CICLO_ID AND ps.DRIVER_ID = op.DRIVER_ID AND ps.STATUS IN ('SUBMETIDO','APROVADO'))) z
JOIN CENTRO_RESULTADO cr ON cr.ID = z.CR_ID
WHERE ('{{contaIds}}' = '' OR FIND_IN_SET(z.CONTA_ID, '{{contaIds}}'))
  AND ('{{crIds}}' = '' OR FIND_IN_SET(z.CR_ID, '{{crIds}}'))
GROUP BY cr.EMPRESA_ID, z.MES