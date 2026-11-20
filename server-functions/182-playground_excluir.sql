-- tipo: SQL | Playground: exclusao soft — params id, agora.
UPDATE PLAYGROUND SET ATIVO = 'false', ATUALIZADO_EM = '{{agora}}' WHERE ID = {{id}} AND USUARIO_ID = :VAR_USER