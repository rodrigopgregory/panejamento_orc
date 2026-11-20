INSERT INTO INT_SERVERFUNCTION (ID, NAME, DESCRIPTION, TYPE, CODE, JDBC_ID, PUBLIC_EXECUTION, CRON_EXPRESSION, CRON_INPUT_JSON, CREATED_BY) VALUES (60, 'pessoalLimparOrcamento', 'Remove do ORCAMENTO as linhas das contas de pessoal do ciclo/CR antes de regravar (params: cicloId, crId)', 'SQL', 'DELETE FROM ORCAMENTO
WHERE CICLO_ID = {{cicloId}} AND CR_ID = {{crId}}
  AND CONTA_ID IN (
    SELECT dc.CONTA_ID FROM DRIVER_CONFIG dc
    JOIN CONTA_CONTABIL cc ON cc.ID = dc.CONTA_ID
    WHERE dc.CR_ID = {{crId}} AND dc.DRIVER_TIPO = ''PESSOAL''
      AND cc.CODIGO IN (''5.1.01'',''5.1.02'',''5.1.03'')
  )', NULL, FALSE, NULL, NULL, 'sarah@mitralab.io');
