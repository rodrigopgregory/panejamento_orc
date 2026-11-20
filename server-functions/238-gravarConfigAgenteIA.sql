-- tipo: SQL | Grava UMA chave da configuracao do agente de IA em APP_CONFIG. Aceita somente AGENT_MODEL_ID, AGENT_TYPE e AGENT_CONNECTION_ID (guarda no proprio SQL). Params: chave, valor, quando.
INSERT INTO APP_CONFIG (CHAVE, VALOR, ATUALIZADO_EM)
           SELECT '{{chave}}', '{{valor}}', '{{quando}}'
           WHERE '{{chave}}' IN ('AGENT_MODEL_ID', 'AGENT_TYPE', 'AGENT_CONNECTION_ID')
             AND NOT EXISTS (SELECT 1 FROM APP_CONFIG WHERE CHAVE = '{{chave}}');
           UPDATE APP_CONFIG
           SET VALOR = '{{valor}}', ATUALIZADO_EM = '{{quando}}'
           WHERE CHAVE = '{{chave}}' AND '{{chave}}' IN ('AGENT_MODEL_ID', 'AGENT_TYPE', 'AGENT_CONNECTION_ID');