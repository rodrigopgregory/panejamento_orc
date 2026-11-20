-- tipo: SQL | Trilha de auditoria do workflow com filtros opcionais e total do resultado. Params: cicloId (0=todos), evento (''=todos), tipo (''=todos, CR|PACOTE), origem (''=todas, APP|LINK), autor (''=todos), dataDe/dataAte (''=sem recorte, YYYY-MM-DD), busca (''=sem busca), limit, offset. Retorna TOTAL_FILTRADO com a contagem do filtro inteiro (ignora a paginacao).
SELECT a.ID, a.CICLO_ID, c.NOME AS CICLO_NOME, a.TIPO, a.EVENTO,
  a.STATUS_DE, a.STATUS_PARA, a.COMENTARIO, a.AUTOR, a.ORIGEM, a.CRIADO_EM,
  a.CR_ID, a.DRIVER_ID,
  CASE WHEN a.TIPO = 'CR' THEN CONCAT(cr.CODIGO, ' - ', cr.NOME) ELSE CONCAT('Pacote ', COALESCE(d.NOME, '?')) END AS ALVO,
  COUNT(*) OVER () AS TOTAL_FILTRADO
FROM WORKFLOW_AUDITORIA a
JOIN CICLO c ON c.ID = a.CICLO_ID
LEFT JOIN CENTRO_RESULTADO cr ON cr.ID = a.CR_ID
LEFT JOIN DRIVERS d ON d.ID = a.DRIVER_ID
WHERE ({{cicloId}} = 0 OR a.CICLO_ID = {{cicloId}})
  AND ('{{evento}}' = '' OR a.EVENTO = '{{evento}}')
  AND ('{{tipo}}' = '' OR a.TIPO = '{{tipo}}')
  AND ('{{origem}}' = '' OR a.ORIGEM = '{{origem}}')
  AND ('{{autor}}' = '' OR a.AUTOR = '{{autor}}')
  AND ('{{dataDe}}' = '' OR SUBSTRING(a.CRIADO_EM, 1, 10) >= '{{dataDe}}')
  AND ('{{dataAte}}' = '' OR SUBSTRING(a.CRIADO_EM, 1, 10) <= '{{dataAte}}')
  AND ('{{busca}}' = ''
       OR a.AUTOR      LIKE '%{{busca}}%' COLLATE utf8mb4_general_ci
       OR cr.NOME      LIKE '%{{busca}}%' COLLATE utf8mb4_general_ci
       OR cr.CODIGO    LIKE '%{{busca}}%' COLLATE utf8mb4_general_ci
       OR d.NOME       LIKE '%{{busca}}%' COLLATE utf8mb4_general_ci
       OR a.COMENTARIO LIKE '%{{busca}}%' COLLATE utf8mb4_general_ci)
ORDER BY a.CRIADO_EM DESC, a.ID DESC
LIMIT {{limit}} OFFSET {{offset}}