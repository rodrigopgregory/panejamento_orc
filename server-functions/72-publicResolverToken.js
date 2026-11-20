-- tipo: JAVASCRIPT | PUBLICA JS — valida token e retorna ciclo/gestor (param: token)
const { runQueryMitra } = require('mitra-sdk');
const projectId = parseInt(process.env.MITRA_PROJECT_ID);
const token = String(event.token || '').replace(/[^0-9a-fA-F-]/g, '').slice(0, 36);
if (!token) return { rows: [], rowCount: 0 };
const agora = new Date().toISOString().slice(0, 19);
const r = await runQueryMitra({ projectId, sql:
  "SELECT t.CICLO_ID, t.GESTOR_ID, g.NOME AS GESTOR_NOME, g.EMAIL AS GESTOR_EMAIL, c.NOME AS CICLO_NOME, c.ANO AS CICLO_ANO " +
  "FROM PREENCHIMENTO_TOKEN t JOIN GESTOR g ON g.ID = t.GESTOR_ID JOIN CICLO c ON c.ID = t.CICLO_ID " +
  "WHERE t.TOKEN = '" + token + "' AND t.ATIVO = 'true' AND (t.EXPIRA_EM IS NULL OR t.EXPIRA_EM >= '" + agora + "') LIMIT 1" });
return r && r.result ? r.result : { rows: [], rowCount: 0 };