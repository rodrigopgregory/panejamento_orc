-- tipo: SQL | Atualiza conta contabil por ID
UPDATE CONTA_CONTABIL SET CODIGO = '{{codigo}}', NOME = '{{nome}}', TIPO = '{{tipo}}', NATUREZA = '{{natureza}}', ATIVO = '{{ativo}}' WHERE ID = {{id}}