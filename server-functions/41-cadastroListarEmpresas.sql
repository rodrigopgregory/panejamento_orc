-- tipo: SQL | Lista empresas paginada com busca (nome/CNPJ) e filtro de status
SELECT ID, NOME, CNPJ, ATIVO FROM EMPRESA
WHERE ('{{busca}}' = '' OR LOWER(NOME) LIKE LOWER('%{{busca}}%') OR LOWER(CNPJ) LIKE LOWER('%{{busca}}%'))
  AND ('{{ativo}}' = '' OR ATIVO = '{{ativo}}')
ORDER BY NOME
LIMIT {{limit}} OFFSET {{offset}}