-- tipo: SQL | Pacotes do gestor.
SELECT d.*, gp.ID as GP_ID FROM DRIVERS d
     JOIN GESTOR_PACOTE gp ON gp.DRIVER_ID = d.ID
     WHERE gp.GESTOR_ID = {{gestorId}} AND d.ESCOPO = 'PACOTE' AND d.ATIVO = 'true' ORDER BY d.NOME