INSERT INTO INT_SERVERFUNCTION (ID, NAME, DESCRIPTION, TYPE, CODE, JDBC_ID, PUBLIC_EXECUTION, CRON_EXPRESSION, CRON_INPUT_JSON, CREATED_BY) VALUES (77, 'modelosAtivosPorCR', 'Total de modelos (drivers efetivos ativos) por CR a partir da config viva CR_CONTA x CONTA_DRIVER — param crIds (lista de inteiros separada por virgula)', 'SQL', 'SELECT crc.CR_ID, COUNT(DISTINCT d.NOME) AS TOTAL
FROM CR_CONTA crc
LEFT JOIN CONTA_DRIVER_EXCECAO cde ON cde.CR_ID = crc.CR_ID AND cde.CONTA_ID = crc.CONTA_ID AND cde.ATIVO = true
LEFT JOIN CONTA_DRIVER cd ON cd.CONTA_ID = crc.CONTA_ID
LEFT JOIN DRIVERS d ON d.ID = COALESCE(cde.PACOTE_ID, cd.PACOTE_ID, cde.DRIVER_ID, cd.DRIVER_ID)
WHERE crc.CR_ID IN ({{crIds}}) AND crc.ATIVO = true AND d.ID IS NOT NULL AND d.ATIVO = ''true''
GROUP BY crc.CR_ID', NULL, FALSE, NULL, NULL, 'sarah@mitralab.io');
