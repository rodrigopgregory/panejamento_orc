-- tipo: JAVASCRIPT | Marca o CR como SUBMETIDO, escopado por token; so transiciona PENDENTE/CONFIRMADO/REPROVADO, bloqueia ciclo FECHADO, grava auditoria e notifica aprovadores (params: token, crId, appUrl)

const { runDmlMitra, executeServerFunctionMitra, sendEmailMitra } = require('mitra-sdk');
const projectId = parseInt(process.env.MITRA_PROJECT_ID);
const token = String(event.token || '').replace(/[^0-9a-fA-F-]/g, '').slice(0, 36);
const crId = Number(event.crId);
if (!token || !Number.isInteger(crId)) return { ok: false, error: 'params_invalidos' };
const q = async (sql) => {
  const r = await executeServerFunctionMitra({ projectId, serverFunctionId: 76, input: { sql } });
  let o = r && r.result ? r.result.output : null;
  if (typeof o === 'string') { try { o = JSON.parse(o); } catch (e) {} }
  return (o && o.rows) || [];
};
const agora = new Date().toISOString().slice(0, 19);
const appUrl = String(event.appUrl || '').replace(/[^A-Za-z0-9:/.\-_]/g, '').slice(0, 200);
// contexto token-escopado ANTES da transicao (status atual + nomes p/ auditoria e e-mail)
const ctx = (await q(
  "SELECT t.CICLO_ID, t.GESTOR_ID, g.NOME AS GESTOR_NOME, c.NOME AS CICLO_NOME, c.STATUS AS CICLO_STATUS," +
  " CONCAT(cr.CODIGO, ' - ', cr.NOME) AS LABEL, COALESCE(os.STATUS, 'PENDENTE') AS STATUS" +
  " FROM PREENCHIMENTO_TOKEN t" +
  " JOIN GESTOR g ON g.ID = t.GESTOR_ID" +
  " JOIN CICLO c ON c.ID = t.CICLO_ID" +
  " JOIN GESTOR_CR gc ON gc.GESTOR_ID = t.GESTOR_ID AND gc.CR_ID = " + crId +
  " JOIN CENTRO_RESULTADO cr ON cr.ID = " + crId +
  " LEFT JOIN ORCAMENTO_STATUS os ON os.CICLO_ID = t.CICLO_ID AND os.GESTOR_ID = t.GESTOR_ID AND os.CR_ID = " + crId +
  " WHERE t.TOKEN = '" + token + "' AND t.ATIVO = 'true' ORDER BY t.ID DESC LIMIT 1"))[0];
if (!ctx) return { ok: false, error: 'token_invalido' };
if (ctx.CICLO_STATUS === 'FECHADO') return { ok: false, error: 'ciclo_fechado' };
if (ctx.STATUS !== 'PENDENTE' && ctx.STATUS !== 'CONFIRMADO' && ctx.STATUS !== 'REPROVADO') return { ok: false, error: 'status_nao_permite', status: ctx.STATUS };
// transicao com os MESMOS gates SQL do hardening (defesa em profundidade)
const CICLO_GATE = "AND NOT EXISTS (SELECT 1 FROM CICLO ck WHERE ck.ID = t.CICLO_ID AND ck.STATUS = 'FECHADO') ";
await runDmlMitra({ projectId, sql:
  "UPDATE ORCAMENTO_STATUS os " +
  "JOIN PREENCHIMENTO_TOKEN t ON t.CICLO_ID = os.CICLO_ID AND t.GESTOR_ID = os.GESTOR_ID AND t.TOKEN = '" + token + "' AND t.ATIVO = 'true' " +
  "JOIN GESTOR_CR gc ON gc.GESTOR_ID = t.GESTOR_ID AND gc.CR_ID = os.CR_ID " +
  "SET os.STATUS = 'SUBMETIDO', os.ATUALIZADO_EM = '" + agora + "' " +
  "WHERE os.CR_ID = " + crId + " AND os.STATUS IN ('PENDENTE','CONFIRMADO','REPROVADO') " + CICLO_GATE });
await runDmlMitra({ projectId, sql:
  "INSERT INTO ORCAMENTO_STATUS (CICLO_ID, GESTOR_ID, CR_ID, STATUS, ATUALIZADO_EM) " +
  "SELECT t.CICLO_ID, t.GESTOR_ID, " + crId + ", 'SUBMETIDO', '" + agora + "' " +
  "FROM PREENCHIMENTO_TOKEN t " +
  "JOIN GESTOR_CR gc ON gc.GESTOR_ID = t.GESTOR_ID AND gc.CR_ID = " + crId + " " +
  "WHERE t.TOKEN = '" + token + "' AND t.ATIVO = 'true' " + CICLO_GATE +
  "AND NOT EXISTS (SELECT 1 FROM (SELECT CICLO_ID, GESTOR_ID, CR_ID FROM ORCAMENTO_STATUS) s " +
  "WHERE s.CICLO_ID = t.CICLO_ID AND s.GESTOR_ID = t.GESTOR_ID AND s.CR_ID = " + crId + ")" });
const after = (await q("SELECT STATUS FROM ORCAMENTO_STATUS WHERE CICLO_ID = " + ctx.CICLO_ID + " AND GESTOR_ID = " + ctx.GESTOR_ID + " AND CR_ID = " + crId + " LIMIT 1"))[0];
if (!after || after.STATUS !== 'SUBMETIDO') return { ok: false, error: 'transicao_nao_aplicada' };
// auditoria (origem LINK, autor = gestor do token)
await runDmlMitra({ projectId, sql:
  "INSERT INTO WORKFLOW_AUDITORIA (CICLO_ID, TIPO, CR_ID, GESTOR_ID, EVENTO, STATUS_DE, STATUS_PARA, COMENTARIO, AUTOR, ORIGEM, CRIADO_EM) VALUES (" +
  ctx.CICLO_ID + ", 'CR', " + crId + ", " + ctx.GESTOR_ID + ", 'SUBMETIDO', '" + ctx.STATUS + "', 'SUBMETIDO', '', '" + String(ctx.GESTOR_NOME || '').replace(/'/g, "''") + "', 'LINK', '" + agora + "')" });
// notifica aprovadores (nunca bloqueia a submissao)
try {
  const aps = await q("SELECT DISTINCT EMAIL FROM USUARIOS WHERE PERFIL IN ('admin','aprovador') AND EMAIL IS NOT NULL AND EMAIL <> ''");
  const to = aps.map((a) => a.EMAIL);
  if (to.length) {
    await sendEmailMitra({ projectId, to,
      subject: 'Mitra FP&A - ' + ctx.LABEL + ' submetido para aprovação',
      body: '<div style="font-family:Inter,Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px">' +
        '<div style="background:linear-gradient(135deg,#8b5cf6,#a78bfa);border-radius:12px;padding:24px;color:#fff;margin-bottom:24px">' +
        '<h1 style="margin:0;font-size:20px">Mitra FP&A</h1>' +
        '<p style="margin:8px 0 0;opacity:0.9;font-size:14px">Planejamento Orçamentário</p></div>' +
        '<h2 style="color:#1e293b;font-size:18px">' + ctx.LABEL + ' aguarda avaliação</h2>' +
        '<p style="color:#64748b;font-size:14px;line-height:1.6"><strong>' + (ctx.GESTOR_NOME || 'O gestor') + '</strong> submeteu <strong>' + ctx.LABEL + '</strong> na versão <strong>' + (ctx.CICLO_NOME || '') + '</strong> para aprovação.</p>' +
        (appUrl ? '<div style="text-align:center;margin:32px 0"><a href="' + appUrl + '/workflow" style="background:#8b5cf6;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;display:inline-block">Abrir Workflow</a></div>' : '') +
        '<p style="color:#94a3b8;font-size:12px;border-top:1px solid #e2e8f0;padding-top:16px;margin-top:32px">Este email foi enviado automaticamente pelo Mitra FP&A.</p></div>' });
  }
} catch (e) {}
return { ok: true };