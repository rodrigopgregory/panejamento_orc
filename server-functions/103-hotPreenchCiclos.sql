-- tipo: SQL | Ciclos nao fechados (Preenchimento/Pessoal).
SELECT * FROM CICLO WHERE STATUS != 'FECHADO' OR VERSAO_ATUAL = 'true' ORDER BY ANO DESC, ID DESC