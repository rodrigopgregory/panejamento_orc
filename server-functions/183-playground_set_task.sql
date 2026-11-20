-- tipo: SQL | Playground: vincula a thread do agente ao estudo — params id, taskId.
UPDATE PLAYGROUND SET TASK_ID = '{{taskId}}' WHERE ID = {{id}} AND USUARIO_ID = :VAR_USER