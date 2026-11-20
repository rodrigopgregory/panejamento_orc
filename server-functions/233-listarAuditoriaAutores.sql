-- tipo: SQL | Responsaveis distintos presentes na trilha de auditoria. Sem params. Popula o filtro Responsavel da tela de Auditoria.
SELECT DISTINCT AUTOR
FROM WORKFLOW_AUDITORIA
WHERE AUTOR IS NOT NULL AND AUTOR <> ''
ORDER BY AUTOR