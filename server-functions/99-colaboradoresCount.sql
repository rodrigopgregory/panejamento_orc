-- tipo: SQL | Total de colaboradores para paginacao. Params: crId, busca.
SELECT COUNT(*) AS TOTAL FROM COLABORADOR c WHERE ('{{crId}}' = '' OR c.CR_ID = '{{crId}}')
  AND ('{{busca}}' = '' OR c.NOME LIKE '%{{busca}}%' OR c.CARGO LIKE '%{{busca}}%')