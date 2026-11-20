-- tipo: SQL | Gera token UUID para (cicloId, gestorId) se ainda nao existir (params: cicloId, gestorId, agora)
INSERT INTO PREENCHIMENTO_TOKEN (CICLO_ID, GESTOR_ID, TOKEN, ATIVO, CRIADO_EM)
SELECT * FROM (SELECT {{cicloId}} AS CICLO_ID, {{gestorId}} AS GESTOR_ID, UUID() AS TOKEN, 'true' AS ATIVO, '{{agora}}' AS CRIADO_EM) novo
WHERE NOT EXISTS (
  SELECT 1 FROM (SELECT CICLO_ID, GESTOR_ID, ATIVO FROM PREENCHIMENTO_TOKEN) p
  WHERE p.CICLO_ID = {{cicloId}} AND p.GESTOR_ID = {{gestorId}} AND p.ATIVO = 'true'
)