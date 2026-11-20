-- tipo: SQL | Lista centros de resultado paginada com nome da empresa, busca e filtro por empresa
SELECT CR.ID, CR.CODIGO, CR.NOME, CR.EMPRESA_ID, CR.ATIVO, E.NOME AS EMPRESA_NOME
FROM CENTRO_RESULTADO CR
LEFT JOIN EMPRESA E ON E.ID = CR.EMPRESA_ID
WHERE ('{{busca}}' = '' OR LOWER(CR.CODIGO) LIKE LOWER('%{{busca}}%') OR LOWER(CR.NOME) LIKE LOWER('%{{busca}}%'))
  AND ('{{empresaId}}' = '' OR CR.EMPRESA_ID = '{{empresaId}}')
ORDER BY CR.CODIGO
LIMIT {{limit}} OFFSET {{offset}}