-- tipo: SQL | Confirma vinculos CR x conta sugeridos pelo historico ({ ano, paresCsv }) — somente os pares selecionados
INSERT INTO CR_CONTA (CR_ID, CONTA_ID, ATIVO, CRIADO_EM)
    SELECT DISTINCT
      R.CR_ID,
      R.CONTA_ID,
      true,
      DATE_FORMAT(NOW(), '%Y-%m-%dT%H:%i:%s')
    FROM REALIZADO_CONTABIL R
    JOIN CENTRO_RESULTADO CR ON CR.ID = R.CR_ID AND CR.ATIVO = 'true'
    JOIN CONTA_CONTABIL CC ON CC.ID = R.CONTA_ID AND (CC.ATIVO = 'true' OR CC.ATIVO IS NULL)
    WHERE R.ANO = {{ano}}
      AND COALESCE(R.VALOR, 0) <> 0
      AND FIND_IN_SET(CONCAT(R.CR_ID, ':', R.CONTA_ID), '{{paresCsv}}') > 0
    ON DUPLICATE KEY UPDATE ATIVO = true