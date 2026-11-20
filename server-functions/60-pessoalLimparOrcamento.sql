-- tipo: SQL | Limpa contas de pessoal do ORCAMENTO (ciclo+CR) antes de regravar a folha. Contas pelo mapeamento vivo (CR_CONTA x CONTA_DRIVER, driver PESSOAL) + contas legadas 5.1.01/02/03 p/ nao deixar residuo. Params: cicloId, crId.
DELETE FROM ORCAMENTO
WHERE CICLO_ID = {{cicloId}} AND CR_ID = {{crId}}
  AND CONTA_ID IN (
    SELECT CONTA_ID FROM (
      SELECT cc.ID AS CONTA_ID,
         CASE cc.CODIGO WHEN '5.1.01.01' THEN 'SAL' WHEN '5.1.02' THEN 'ENC' WHEN '5.1.03' THEN 'BEN' END AS BLOCO
  FROM CR_CONTA rc
  JOIN CONTA_CONTABIL cc ON cc.ID = rc.CONTA_ID
  LEFT JOIN CONTA_DRIVER_EXCECAO cde ON cde.CR_ID = rc.CR_ID AND cde.CONTA_ID = rc.CONTA_ID AND cde.ATIVO = true
  LEFT JOIN CONTA_DRIVER cd ON cd.CONTA_ID = rc.CONTA_ID
  LEFT JOIN DRIVERS d ON d.ID = COALESCE(cde.DRIVER_ID, cd.DRIVER_ID)
  WHERE rc.CR_ID = {{crId}} AND rc.ATIVO = true AND d.NOME = 'PESSOAL'
    AND cc.CODIGO IN ('5.1.01.01','5.1.02','5.1.03')
      UNION
      SELECT cl.ID AS CONTA_ID, 'LEGADA' AS BLOCO FROM CONTA_CONTABIL cl WHERE cl.CODIGO IN ('5.1.01','5.1.02','5.1.03')
    ) alvo
  )