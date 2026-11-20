INSERT INTO INT_SERVERFUNCTION (ID, NAME, DESCRIPTION, TYPE, CODE, JDBC_ID, PUBLIC_EXECUTION, CRON_EXPRESSION, CRON_INPUT_JSON, CREATED_BY) VALUES (188, 'playground_salvar_conversa', 'Playground: persiste a conversa rica (JSON de segmentos). Input { id, conversa }.', 'JAVASCRIPT', 'const { runDmlMitra, runQueryMitra } = require(''mitra-sdk'');
const projectId = parseInt(process.env.MITRA_PROJECT_ID);
const esc = (s) => String(s).replace(/\\\\/g, ''\\\\\\\\'').replace(/''/g, "''''");
const agora = new Date().toISOString().slice(0, 19);
const id = parseInt(event.id);
if (!id) throw new Error(''id obrigatorio'');
const conversa = String(event.conversa || '''');
await runDmlMitra({ projectId, sql: "UPDATE PLAYGROUND SET CONVERSA = ''" + esc(conversa) + "'', ATUALIZADO_EM = ''" + agora + "'' WHERE ID = " + id });
return { ok: true };', NULL, FALSE, NULL, NULL, 'sarah@mitralab.io');
