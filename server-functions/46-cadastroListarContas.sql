-- tipo: SQL | Lista contas contabeis paginada com busca (codigo/nome) e filtro de tipo
SELECT ID, CODIGO, NOME, TIPO, NATUREZA, ATIVO FROM CONTA_CONTABIL
WHERE ('{{busca}}' = '' OR LOWER(CODIGO) LIKE LOWER('%{{busca}}%') OR LOWER(NOME) LIKE LOWER('%{{busca}}%'))
  AND ('{{tipo}}' = '' OR TIPO = '{{tipo}}')
ORDER BY CODIGO
LIMIT {{limit}} OFFSET {{offset}}