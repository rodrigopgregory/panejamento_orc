-- tipo: SQL | Total de centros de resultado para paginacao (mesmos filtros da listagem)
SELECT COUNT(*) AS TOTAL FROM CENTRO_RESULTADO CR
WHERE ('{{busca}}' = '' OR LOWER(CR.CODIGO) LIKE LOWER('%{{busca}}%') OR LOWER(CR.NOME) LIKE LOWER('%{{busca}}%'))
  AND ('{{empresaId}}' = '' OR CR.EMPRESA_ID = '{{empresaId}}')