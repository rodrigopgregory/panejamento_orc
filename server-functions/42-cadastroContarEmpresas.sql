-- tipo: SQL | Total de empresas para paginacao (mesmos filtros da listagem)
SELECT COUNT(*) AS TOTAL FROM EMPRESA
WHERE ('{{busca}}' = '' OR LOWER(NOME) LIKE LOWER('%{{busca}}%') OR LOWER(CNPJ) LIKE LOWER('%{{busca}}%'))
  AND ('{{ativo}}' = '' OR ATIVO = '{{ativo}}')