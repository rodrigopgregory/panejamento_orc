-- tipo: SQL | Lancamentos contabeis paginados. Params: ano, empresaId, crIds, meses, tipos, busca, limit e offset. Ordenacao opcional via ordemCampo (periodo|empresa|setor|conta|tipo|valor) e ordemDir (asc|desc); vazio mantem a ordem padrao.
SELECT rc.ID, rc.EMPRESA_ID, e.NOME AS EMPRESA_NOME, rc.CR_ID, rc.CONTA_ID, rc.ANO, rc.MES, rc.VALOR,
       cc.CODIGO AS CONTA_CODIGO, cc.NOME AS CONTA_NOME, cc.TIPO AS CONTA_TIPO,
       cr.CODIGO AS CR_CODIGO, cr.NOME AS CR_NOME
     FROM REALIZADO_CONTABIL rc
     JOIN EMPRESA e ON e.ID = rc.EMPRESA_ID
     JOIN CONTA_CONTABIL cc ON cc.ID = rc.CONTA_ID
     JOIN CENTRO_RESULTADO cr ON cr.ID = rc.CR_ID
     WHERE rc.ANO = {{ano}} AND ('{{empresaId}}' = '' OR rc.EMPRESA_ID = NULLIF('{{empresaId}}', '')) AND ('{{crIds}}' = '' OR FIND_IN_SET(rc.CR_ID, '{{crIds}}')) AND ('{{meses}}' = '' OR FIND_IN_SET(rc.MES, '{{meses}}'))
  AND ('{{tipos}}' = '' OR FIND_IN_SET(cc.TIPO, '{{tipos}}'))
  AND ('{{busca}}' = '' OR cc.CODIGO LIKE '%{{busca}}%' OR cc.NOME LIKE '%{{busca}}%'
       OR cr.CODIGO LIKE '%{{busca}}%' OR cr.NOME LIKE '%{{busca}}%' OR e.NOME LIKE '%{{busca}}%')
     ORDER BY
       CASE WHEN '{{ordemCampo}}' = 'periodo' AND '{{ordemDir}}' = 'asc' THEN rc.ANO * 100 + rc.MES END ASC,
       CASE WHEN '{{ordemCampo}}' = 'periodo' AND '{{ordemDir}}' = 'desc' THEN rc.ANO * 100 + rc.MES END DESC,
       CASE WHEN '{{ordemCampo}}' = 'empresa' AND '{{ordemDir}}' = 'asc' THEN e.NOME END ASC,
       CASE WHEN '{{ordemCampo}}' = 'empresa' AND '{{ordemDir}}' = 'desc' THEN e.NOME END DESC,
       CASE WHEN '{{ordemCampo}}' = 'setor' AND '{{ordemDir}}' = 'asc' THEN cr.CODIGO END ASC,
       CASE WHEN '{{ordemCampo}}' = 'setor' AND '{{ordemDir}}' = 'desc' THEN cr.CODIGO END DESC,
       CASE WHEN '{{ordemCampo}}' = 'conta' AND '{{ordemDir}}' = 'asc' THEN cc.CODIGO END ASC,
       CASE WHEN '{{ordemCampo}}' = 'conta' AND '{{ordemDir}}' = 'desc' THEN cc.CODIGO END DESC,
       CASE WHEN '{{ordemCampo}}' = 'tipo' AND '{{ordemDir}}' = 'asc' THEN cc.TIPO END ASC,
       CASE WHEN '{{ordemCampo}}' = 'tipo' AND '{{ordemDir}}' = 'desc' THEN cc.TIPO END DESC,
       CASE WHEN '{{ordemCampo}}' = 'valor' AND '{{ordemDir}}' = 'asc' THEN rc.VALOR END ASC,
       CASE WHEN '{{ordemCampo}}' = 'valor' AND '{{ordemDir}}' = 'desc' THEN rc.VALOR END DESC,
       rc.MES DESC, cc.CODIGO, cr.CODIGO, rc.ID
     LIMIT {{limit}} OFFSET {{offset}}