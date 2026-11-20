-- tipo: SQL | Lista as versoes publicadas de um modelo (sem o snapshot, para ser leve). Param: driverId.
SELECT v.ID, v.NUMERO, v.CRIADO_EM, COALESCE(u.DESCR, v.CRIADO_POR) AS AUTOR,
       JSON_LENGTH(v.SNAPSHOT) AS QTD_LINHAS
FROM DRIVER_VERSAO v
LEFT JOIN INT_USER u ON u.ID = v.CRIADO_POR
WHERE v.DRIVER_ID = {{driverId}}
ORDER BY v.NUMERO DESC