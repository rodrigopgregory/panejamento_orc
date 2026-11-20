-- tipo: SQL | Cria o vinculo conta x setor a partir dos rateios aplicados em linhas de modelo de pacote (setor com quantidade > 0 passa a receber). Idempotente, sem params.
INSERT INTO CR_CONTA (CR_ID, CONTA_ID, ATIVO, CRIADO_EM)
SELECT DISTINCT ri.CR_ID, df.CONTA_ID, true, DATE_FORMAT(NOW(), '%Y-%m-%dT%H:%i:%s')
FROM DRIVER_FORMULA df
JOIN DRIVERS d ON d.ID = df.DRIVER_ID AND d.ESCOPO = 'PACOTE'
JOIN RATEIO_ITEM ri ON ri.RATEIO_ID = df.RATEIO_ID AND ri.QUANTIDADE > 0
WHERE df.CONTA_ID IS NOT NULL AND df.RATEIO_ID IS NOT NULL
ON DUPLICATE KEY UPDATE ATIVO = true