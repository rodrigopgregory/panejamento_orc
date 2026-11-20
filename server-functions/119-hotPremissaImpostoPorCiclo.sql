-- tipo: SQL | Premissas de imposto do ciclo.
SELECT pi.*, cc.CODIGO, cc.NOME FROM PREMISSA_IMPOSTO pi
     JOIN CONTA_CONTABIL cc ON cc.ID = pi.CONTA_ID WHERE pi.CICLO_ID = {{cicloId}} ORDER BY cc.CODIGO