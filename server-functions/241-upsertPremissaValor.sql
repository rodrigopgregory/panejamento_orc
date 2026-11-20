-- tipo: SQL | Grava o valor de uma premissa geral em um mes
INSERT INTO PREMISSA_VALOR (LINHA_ID, MES, VALOR) VALUES ({{linhaId}}, {{mes}}, {{valor}})
ON DUPLICATE KEY UPDATE VALOR = {{valor}}