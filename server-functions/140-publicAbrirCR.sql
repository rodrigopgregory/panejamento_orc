-- tipo: SQL | Abre um CR publico numa ida: config de contas + valores, escopado por token (params: token, crId)
SELECT
  COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT(
      'CONTA_ID', x.CONTA_ID, 'CODIGO', x.CODIGO, 'CONTA_NOME', x.CONTA_NOME,
      'TIPO', x.TIPO, 'DRIVER_TIPO', x.DRIVER_TIPO))
    FROM (
      SELECT cc.ID AS CONTA_ID, cc.CODIGO, cc.NOME AS CONTA_NOME, cc.TIPO, d.NOME AS DRIVER_TIPO
      FROM PREENCHIMENTO_TOKEN t
      JOIN GESTOR_CR gc ON gc.GESTOR_ID = t.GESTOR_ID AND gc.CR_ID = {{crId}}
      JOIN CR_CONTA crc ON crc.CR_ID = gc.CR_ID AND crc.ATIVO = true
      JOIN CONTA_CONTABIL cc ON cc.ID = crc.CONTA_ID
      LEFT JOIN CONTA_DRIVER_EXCECAO cde
        ON cde.CR_ID = crc.CR_ID AND cde.CONTA_ID = crc.CONTA_ID AND cde.ATIVO = true
      LEFT JOIN CONTA_DRIVER cd ON cd.CONTA_ID = crc.CONTA_ID
      LEFT JOIN DRIVERS d ON d.ID = COALESCE(cde.DRIVER_ID, cd.DRIVER_ID)
      WHERE t.TOKEN = '{{token}}' AND t.ATIVO = 'true'
        AND d.ID IS NOT NULL AND d.ATIVO = 'true'
    ) x), JSON_ARRAY()) AS CONTAS,
  COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('CONTA_ID', x.CONTA_ID, 'MES', x.MES, 'VALOR', x.VALOR))
    FROM (
      SELECT o.CONTA_ID, o.MES, SUM(o.VALOR) AS VALOR
      FROM PREENCHIMENTO_TOKEN t
      JOIN GESTOR_CR gc ON gc.GESTOR_ID = t.GESTOR_ID AND gc.CR_ID = {{crId}}
      JOIN ORCAMENTO o ON o.CICLO_ID = t.CICLO_ID AND o.CR_ID = gc.CR_ID
      WHERE t.TOKEN = '{{token}}' AND t.ATIVO = 'true'
      GROUP BY o.CONTA_ID, o.MES
    ) x), JSON_ARRAY()) AS VALORES