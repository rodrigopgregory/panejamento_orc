-- tipo: SQL | Status de pacotes do gestor no ciclo.
SELECT * FROM PACOTE_STATUS WHERE CICLO_ID = {{cicloId}} AND GESTOR_ID = {{gestorId}}