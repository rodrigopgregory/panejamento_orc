-- tipo: SQL | Total de contas contabeis para paginacao (mesmos filtros da listagem)
SELECT COUNT(*) AS TOTAL FROM CONTA_CONTABIL
WHERE ('{{busca}}' = '' OR LOWER(CODIGO) LIKE LOWER('%{{busca}}%') OR LOWER(NOME) LIKE LOWER('%{{busca}}%'))
  AND ('{{tipo}}' = '' OR TIPO = '{{tipo}}')