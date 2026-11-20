-- tipo: SQL | Remove uma premissa geral e todos os seus valores mensais
DELETE pl, pv FROM PREMISSA_LINHA pl
LEFT JOIN PREMISSA_VALOR pv ON pv.LINHA_ID = pl.ID
WHERE pl.ID = {{linhaId}}