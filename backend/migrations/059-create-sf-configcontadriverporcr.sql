INSERT INTO INT_SERVERFUNCTION (ID, NAME, DESCRIPTION, TYPE, CODE, JDBC_ID, PUBLIC_EXECUTION, CRON_EXPRESSION, CRON_INPUT_JSON, CREATED_BY) VALUES (78, 'configContaDriverPorCR', 'Mapa conta -> driver efetivo ativo de um CR a partir da config viva (substitui leitura da tabela legada DRIVER_CONFIG) — param crId (inteiro)', 'SQL', 'SELECT DISTINCT crc.CONTA_ID, d.NOME AS DRIVER_TIPO
FROM CR_CONTA crc
LEFT JOIN CONTA_DRIVER_EXCECAO cde ON cde.CR_ID = crc.CR_ID AND cde.CONTA_ID = crc.CONTA_ID AND cde.ATIVO = true
LEFT JOIN CONTA_DRIVER cd ON cd.CONTA_ID = crc.CONTA_ID
LEFT JOIN DRIVERS d ON d.ID = COALESCE(cde.PACOTE_ID, cd.PACOTE_ID, cde.DRIVER_ID, cd.DRIVER_ID)
WHERE crc.CR_ID = {{crId}} AND crc.ATIVO = true AND d.ID IS NOT NULL AND d.ATIVO = ''true''', NULL, FALSE, NULL, NULL, 'sarah@mitralab.io');
