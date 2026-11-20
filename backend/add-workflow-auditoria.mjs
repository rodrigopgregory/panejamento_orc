// Auditoria + notificacoes por e-mail + validacao de servidor no fluxo de aprovacao.
//
// 1. Tabela WORKFLOW_AUDITORIA — trilha de toda transicao de status (CR e pacote)
//    e de confirmacao/desfazer de modelos: quem, quando, de onde (APP/LINK), motivo.
// 2. SF avaliarWorkflowStatus (JS, NAO publica) — UNICO caminho para aprovar/
//    reprovar/submeter/reabrir pelo app. Valida a maquina de estados no servidor
//    (o patchRecordMitra direto do navegador nao validava nada), exige comentario
//    na reprovacao, bloqueia ciclo FECHADO, grava auditoria e dispara e-mails:
//      -> SUBMETIDO: notifica aprovadores (USUARIOS admin/aprovador)
//      -> APROVADO/REPROVADO: notifica o gestor dono (GESTOR.EMAIL); na reprovacao
//         o e-mail inclui o motivo e o magic-link para revisar e reenviar.
// 3. SF registrarEventoWorkflow (SQL, NAO publica) — auditoria de eventos que nao
//    transicionam status pela SF acima (confirmar/desfazer modelo no app interno).
// 4. SF listarAuditoriaWorkflow (SQL, NAO publica) — alimenta o modal "Historico".
// 5. SF 70 (publicSubmeterCR) — versao final: mantem TODOS os gates do
//    harden-status-transitions.mjs e adiciona auditoria + e-mail aos aprovadores.
// 6. SF 138 (hotOrcamentoStatus) — contagem de modelos passa a excluir pacotes
//    (patch no codigo atual, fonte em add-hot-cadastros.mjs ja corrigida).
// 7. Re-snapshot de TOTAL_MODELOS nas versoes FECHADAS com a contagem sem pacote
//    (os snapshots antigos incluiam o pacote, que nunca entrou no numerador).
//
// Aditivo e idempotente.
import 'dotenv/config';
import {
  configureSdkMitra,
  createServerFunctionMitra,
  updateServerFunctionMitra,
  readServerFunctionMitra,
  listServerFunctionsMitra,
  executeServerFunctionMitra,
  togglePublicExecutionMitra,
  runDdlMitra,
  runDmlMitra,
} from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});
const projectId = parseInt(process.env.MITRA_PROJECT_ID);

const q = async (sql) => {
  const r = await executeServerFunctionMitra({ projectId, serverFunctionId: 76, input: { sql } });
  let o = r?.result?.output; if (typeof o === 'string') o = JSON.parse(o);
  return o?.rows || [];
};

// ── 1. Tabela WORKFLOW_AUDITORIA ──
console.log('[1] Tabela WORKFLOW_AUDITORIA...');
const has = await q(`SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'WORKFLOW_AUDITORIA'`);
if (has.length) {
  console.log('  = ja existe');
} else {
  await runDdlMitra({ projectId, sql: `CREATE TABLE WORKFLOW_AUDITORIA (
    ID INT AUTO_INCREMENT PRIMARY KEY,
    CICLO_ID INT NOT NULL,
    TIPO VARCHAR(10) NOT NULL,
    CR_ID INT NULL,
    DRIVER_ID INT NULL,
    GESTOR_ID INT NULL,
    EVENTO VARCHAR(30) NOT NULL,
    STATUS_DE VARCHAR(20),
    STATUS_PARA VARCHAR(20),
    COMENTARIO VARCHAR(500),
    AUTOR VARCHAR(200),
    ORIGEM VARCHAR(10),
    CRIADO_EM VARCHAR(19),
    FOREIGN KEY (CICLO_ID) REFERENCES CICLO(ID)
  )` });
  console.log('  + criada');
}

// ── helpers de upsert por nome (SFs internas, NAO publicas) ──
async function upsertSF({ name, type, code, description }) {
  const all = await listServerFunctionsMitra({ projectId });
  const list = all?.result || all?.content || all || [];
  const existing = Array.isArray(list) ? list.find((s) => s.name === name) : null;
  if (existing) {
    await updateServerFunctionMitra({ projectId, serverFunctionId: existing.id, code, description });
    console.log(`  ~ atualizada ${name} (id ${existing.id})`);
    return existing.id;
  }
  const res = await createServerFunctionMitra({ projectId, name, type, code, description });
  const id = res?.result?.serverFunctionId || res?.serverFunctionId || res?.id;
  console.log(`  + criada ${name} (id ${id})`);
  return id;
}

// ── 2. SF avaliarWorkflowStatus (JS, NAO publica) ──
console.log('[2] SF avaliarWorkflowStatus...');
const AVALIAR_CODE = `
// Transicao de status de CR/pacote com validacao no SERVIDOR (maquina de estados),
// auditoria e notificacao por e-mail. Unico caminho de aprovar/reprovar/submeter/
// reabrir pelo app — substitui o patchRecordMitra direto que nao validava nada.
// Params: tipo ('CR'|'PACOTE'), acao ('APROVADO'|'REPROVADO'|'SUBMETIDO'),
//         statusId OU (cicloId + crId/driverId [+ gestorId]),
//         comentario (obrigatorio p/ REPROVADO), autor, appUrl, notificar (default true).
const { runDmlMitra, executeServerFunctionMitra, sendEmailMitra } = require('mitra-sdk');
const projectId = parseInt(process.env.MITRA_PROJECT_ID);
const q = async (sql) => {
  const r = await executeServerFunctionMitra({ projectId, serverFunctionId: 76, input: { sql } });
  let o = r && r.result ? r.result.output : null;
  if (typeof o === 'string') { try { o = JSON.parse(o); } catch (e) {} }
  return (o && o.rows) || [];
};
const tipo = event.tipo === 'PACOTE' ? 'PACOTE' : 'CR';
const acao = String(event.acao || '').toUpperCase();
if (acao !== 'APROVADO' && acao !== 'REPROVADO' && acao !== 'SUBMETIDO' && acao !== 'PENDENTE') return { ok: false, error: 'acao_invalida' };
const comentRaw = String(event.comentario == null ? '' : event.comentario).replace(/[<>]/g, '').slice(0, 500);
const comentSql = comentRaw.replace(/'/g, "''");
const autorRaw = String(event.autor == null ? '' : event.autor).replace(/[<>]/g, '').slice(0, 200);
const autorSql = autorRaw.replace(/'/g, "''");
const notificar = event.notificar !== false;
const appUrl = String(event.appUrl || '').replace(/[^A-Za-z0-9:/.\\-_]/g, '').slice(0, 200);
if (acao === 'REPROVADO' && !comentRaw.trim()) return { ok: false, error: 'comentario_obrigatorio' };
const table = tipo === 'CR' ? 'ORCAMENTO_STATUS' : 'PACOTE_STATUS';
const keyCol = tipo === 'CR' ? 'CR_ID' : 'DRIVER_ID';
const agora = new Date().toISOString().slice(0, 19);
const loadRow = async (where) => (await q(
  'SELECT s.ID, s.CICLO_ID, s.GESTOR_ID, s.' + keyCol + " AS REF_ID, COALESCE(s.STATUS, 'PENDENTE') AS STATUS, c.STATUS AS CICLO_STATUS" +
  ' FROM ' + table + ' s JOIN CICLO c ON c.ID = s.CICLO_ID WHERE ' + where + ' LIMIT 1'))[0];
let row = null;
const statusId = Number(event.statusId);
const cicloId = Number(event.cicloId);
const refId = Number(tipo === 'CR' ? event.crId : event.driverId);
const gestorId = Number(event.gestorId);
if (Number.isInteger(statusId) && statusId > 0) {
  row = await loadRow('s.ID = ' + statusId);
} else if (Number.isInteger(cicloId) && cicloId > 0 && Number.isInteger(refId) && refId > 0) {
  const gFil = Number.isInteger(gestorId) && gestorId > 0 ? ' AND s.GESTOR_ID = ' + gestorId : '';
  row = await loadRow('s.CICLO_ID = ' + cicloId + ' AND s.' + keyCol + ' = ' + refId + gFil);
  if (!row && acao === 'SUBMETIDO' && Number.isInteger(gestorId) && gestorId > 0) {
    await runDmlMitra({ projectId, sql: 'INSERT INTO ' + table + ' (CICLO_ID, ' + keyCol + ', GESTOR_ID, STATUS, ATUALIZADO_EM) VALUES (' + cicloId + ', ' + refId + ', ' + gestorId + ", 'PENDENTE', '" + agora + "')" });
    row = await loadRow('s.CICLO_ID = ' + cicloId + ' AND s.' + keyCol + ' = ' + refId + gFil);
  }
} else {
  return { ok: false, error: 'params_invalidos' };
}
if (!row) return { ok: false, error: 'status_nao_encontrado' };
if (row.CICLO_STATUS === 'FECHADO') return { ok: false, error: 'ciclo_fechado' };
const de = row.STATUS;
if (de === acao) return { ok: false, error: 'sem_transicao', status: de };
const ALLOWED = {
  APROVADO: ['SUBMETIDO', 'REPROVADO'],
  REPROVADO: ['SUBMETIDO', 'APROVADO'],
  SUBMETIDO: ['PENDENTE', 'CONFIRMADO', 'REPROVADO', 'APROVADO'],
  PENDENTE: ['REPROVADO']
};
if (ALLOWED[acao].indexOf(de) === -1) return { ok: false, error: 'transicao_invalida', de: de, para: acao };
// REPROVADO grava o motivo; APROVADO/SUBMETIDO preservam o comentario anterior
// (o motivo da reprovacao sobrevive a re-submissao — semantica do fluxo atual).
const setComent = acao === 'REPROVADO' ? ", COMENTARIO = '" + comentSql + "'"
  : acao === 'PENDENTE' ? ", COMENTARIO = ''" : '';
await runDmlMitra({ projectId, sql: 'UPDATE ' + table + " SET STATUS = '" + acao + "'" + setComent + ", ATUALIZADO_EM = '" + agora + "' WHERE ID = " + row.ID + " AND STATUS = '" + de + "'" });
const after = await loadRow('s.ID = ' + row.ID);
if (!after || after.STATUS !== acao) return { ok: false, error: 'conflito_concorrente' };
const evento = ((acao === 'SUBMETIDO' && de === 'APROVADO') || acao === 'PENDENTE') ? 'REABERTO' : acao;
await runDmlMitra({ projectId, sql:
  'INSERT INTO WORKFLOW_AUDITORIA (CICLO_ID, TIPO, CR_ID, DRIVER_ID, GESTOR_ID, EVENTO, STATUS_DE, STATUS_PARA, COMENTARIO, AUTOR, ORIGEM, CRIADO_EM) VALUES (' +
  row.CICLO_ID + ", '" + tipo + "', " + (tipo === 'CR' ? row.REF_ID : 'NULL') + ', ' + (tipo === 'PACOTE' ? row.REF_ID : 'NULL') + ', ' + (row.GESTOR_ID || 'NULL') +
  ", '" + evento + "', '" + de + "', '" + acao + "', '" + comentSql + "', '" + autorSql + "', 'APP', '" + agora + "')" });
let emails = 0;
if (notificar) {
  try {
    const info = (await q(tipo === 'CR'
      ? "SELECT CONCAT(cr.CODIGO, ' - ', cr.NOME) AS LABEL, c.NOME AS CICLO_NOME, g.NOME AS GESTOR_NOME, g.EMAIL AS GESTOR_EMAIL FROM ORCAMENTO_STATUS s JOIN CENTRO_RESULTADO cr ON cr.ID = s.CR_ID JOIN CICLO c ON c.ID = s.CICLO_ID LEFT JOIN GESTOR g ON g.ID = s.GESTOR_ID WHERE s.ID = " + row.ID
      : "SELECT CONCAT('Pacote ', d.NOME) AS LABEL, c.NOME AS CICLO_NOME, g.NOME AS GESTOR_NOME, g.EMAIL AS GESTOR_EMAIL FROM PACOTE_STATUS s JOIN DRIVERS d ON d.ID = s.DRIVER_ID JOIN CICLO c ON c.ID = s.CICLO_ID LEFT JOIN GESTOR g ON g.ID = s.GESTOR_ID WHERE s.ID = " + row.ID))[0] || {};
    const label = info.LABEL || (tipo + ' ' + row.REF_ID);
    const wrap = (titulo, corpo) =>
      '<div style="font-family:Inter,Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px">' +
      '<div style="background:linear-gradient(135deg,#75c95f,#9ad889);border-radius:12px;padding:24px;color:#fff;margin-bottom:24px">' +
      '<h1 style="margin:0;font-size:20px">Mitra FP&A</h1>' +
      '<p style="margin:8px 0 0;opacity:0.9;font-size:14px">Planejamento Orçamentário</p></div>' +
      '<h2 style="color:#1e293b;font-size:18px">' + titulo + '</h2>' + corpo +
      '<p style="color:#94a3b8;font-size:12px;border-top:1px solid #e2e8f0;padding-top:16px;margin-top:32px">Este email foi enviado automaticamente pelo Mitra FP&A.</p></div>';
    if (acao === 'SUBMETIDO') {
      const aps = await q("SELECT DISTINCT EMAIL FROM USUARIOS WHERE PERFIL IN ('admin','aprovador') AND EMAIL IS NOT NULL AND EMAIL <> ''");
      const to = aps.map((a) => a.EMAIL);
      if (to.length) {
        await sendEmailMitra({ projectId, to,
          subject: 'Mitra FP&A - ' + label + ' submetido para aprovação',
          body: wrap(label + ' aguarda avaliação',
            '<p style="color:#64748b;font-size:14px;line-height:1.6"><strong>' + (info.GESTOR_NOME || autorRaw || 'O gestor') + '</strong> submeteu <strong>' + label + '</strong> na versão <strong>' + (info.CICLO_NOME || '') + '</strong> para aprovação.</p>' +
            (appUrl ? '<div style="text-align:center;margin:32px 0"><a href="' + appUrl + '/workflow" style="background:#75c95f;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;display:inline-block">Abrir Workflow</a></div>' : '')) });
        emails = to.length;
      }
    } else if (info.GESTOR_EMAIL) {
      let link = '';
      if (acao === 'REPROVADO' && appUrl && row.GESTOR_ID) {
        const t = (await q("SELECT TOKEN FROM PREENCHIMENTO_TOKEN WHERE CICLO_ID = " + row.CICLO_ID + " AND GESTOR_ID = " + row.GESTOR_ID + " AND ATIVO = 'true' ORDER BY ID DESC LIMIT 1"))[0];
        if (t && t.TOKEN) link = appUrl + '/preenchimento-publico?token=' + t.TOKEN;
      }
      const aprovado = acao === 'APROVADO';
      await sendEmailMitra({ projectId, to: [info.GESTOR_EMAIL],
        subject: 'Mitra FP&A - ' + label + (aprovado ? ' aprovado' : ' reprovado'),
        body: wrap('Olá, ' + (info.GESTOR_NOME || '') + '!',
          '<p style="color:#64748b;font-size:14px;line-height:1.6">O orçamento de <strong>' + label + '</strong> na versão <strong>' + (info.CICLO_NOME || '') + '</strong> foi <strong style="color:' + (aprovado ? '#059669' : '#b91c1c') + '">' + (aprovado ? 'APROVADO' : 'REPROVADO') + '</strong>' + (autorRaw ? ' por ' + autorRaw : '') + '.</p>' +
          (!aprovado && comentRaw ? '<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;margin:16px 0"><p style="margin:0;color:#991b1b;font-size:14px"><strong>Motivo:</strong> ' + comentRaw + '</p></div>' : '') +
          (link ? '<div style="text-align:center;margin:32px 0"><a href="' + link + '" style="background:#75c95f;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;display:inline-block">Revisar e reenviar</a></div>' : '')) });
      emails = 1;
    }
  } catch (e) { /* e-mail nunca bloqueia a transicao */ }
}
return { ok: true, de: de, para: acao, evento: evento, emails: emails };`;
const avaliarId = await upsertSF({
  name: 'avaliarWorkflowStatus', type: 'JAVASCRIPT', code: AVALIAR_CODE,
  description: 'Transicao validada de status de CR/pacote (APROVADO/REPROVADO/SUBMETIDO) com auditoria e e-mail. Params: tipo, acao, statusId ou (cicloId+crId/driverId+gestorId), comentario, autor, appUrl, notificar',
});

// ── 3. SF registrarEventoWorkflow (SQL, NAO publica) ──
console.log('[3] SF registrarEventoWorkflow...');
const registrarId = await upsertSF({
  name: 'registrarEventoWorkflow', type: 'SQL',
  code: `INSERT INTO WORKFLOW_AUDITORIA (CICLO_ID, TIPO, CR_ID, DRIVER_ID, GESTOR_ID, EVENTO, STATUS_DE, STATUS_PARA, COMENTARIO, AUTOR, ORIGEM, CRIADO_EM)
VALUES ({{cicloId}}, '{{tipo}}', NULLIF({{crId}}, 0), NULLIF({{driverId}}, 0), NULLIF({{gestorId}}, 0), '{{evento}}', '{{statusDe}}', '{{statusPara}}', '{{comentario}}', '{{autor}}', '{{origem}}', '{{agora}}')`,
  description: 'Grava um evento na trilha de auditoria do workflow (usado pelo app para confirmar/desfazer modelo). Params: cicloId, tipo, crId, driverId, gestorId (0 = NULL), evento, statusDe, statusPara, comentario, autor, origem, agora',
});

// ── 4. SF listarAuditoriaWorkflow (SQL, NAO publica) ──
console.log('[4] SF listarAuditoriaWorkflow...');
const listarId = await upsertSF({
  name: 'listarAuditoriaWorkflow', type: 'SQL',
  code: `SELECT a.ID, a.EVENTO, a.STATUS_DE, a.STATUS_PARA, a.COMENTARIO, a.AUTOR, a.ORIGEM, a.CRIADO_EM
FROM WORKFLOW_AUDITORIA a
WHERE a.CICLO_ID = {{cicloId}} AND a.TIPO = '{{tipo}}'
  AND ((('{{tipo}}' = 'CR') AND a.CR_ID = {{refId}}) OR (('{{tipo}}' = 'PACOTE') AND a.DRIVER_ID = {{refId}}))
ORDER BY a.ID DESC
LIMIT 100`,
  description: 'Historico de auditoria de um CR ou pacote no ciclo. Params: cicloId, tipo (CR|PACOTE), refId (crId ou driverId)',
});

// ── 5. SF 70 (publicSubmeterCR) — versao final com auditoria + e-mail ──
// Mantem os gates do harden-status-transitions.mjs (so PENDENTE/CONFIRMADO/
// REPROVADO -> SUBMETIDO, ciclo FECHADO bloqueado, token-escopado) e passa a
// retornar erro explicito em vez de no-op silencioso.
console.log('[5] SF 70 (publicSubmeterCR)...');
const SF70_CODE = `
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
const appUrl = String(event.appUrl || '').replace(/[^A-Za-z0-9:/.\\-_]/g, '').slice(0, 200);
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
        '<div style="background:linear-gradient(135deg,#75c95f,#9ad889);border-radius:12px;padding:24px;color:#fff;margin-bottom:24px">' +
        '<h1 style="margin:0;font-size:20px">Mitra FP&A</h1>' +
        '<p style="margin:8px 0 0;opacity:0.9;font-size:14px">Planejamento Orçamentário</p></div>' +
        '<h2 style="color:#1e293b;font-size:18px">' + ctx.LABEL + ' aguarda avaliação</h2>' +
        '<p style="color:#64748b;font-size:14px;line-height:1.6"><strong>' + (ctx.GESTOR_NOME || 'O gestor') + '</strong> submeteu <strong>' + ctx.LABEL + '</strong> na versão <strong>' + (ctx.CICLO_NOME || '') + '</strong> para aprovação.</p>' +
        (appUrl ? '<div style="text-align:center;margin:32px 0"><a href="' + appUrl + '/workflow" style="background:#75c95f;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;display:inline-block">Abrir Workflow</a></div>' : '') +
        '<p style="color:#94a3b8;font-size:12px;border-top:1px solid #e2e8f0;padding-top:16px;margin-top:32px">Este email foi enviado automaticamente pelo Mitra FP&A.</p></div>' });
  }
} catch (e) {}
return { ok: true };`;
await updateServerFunctionMitra({ projectId, serverFunctionId: 70, code: SF70_CODE,
  description: 'Marca o CR como SUBMETIDO, escopado por token; so transiciona PENDENTE/CONFIRMADO/REPROVADO, bloqueia ciclo FECHADO, grava auditoria e notifica aprovadores (params: token, crId, appUrl)' });
await togglePublicExecutionMitra({ projectId, serverFunctionId: 70, publicExecution: true });
console.log('  ~ SF 70 atualizada (publica)');

// ── 6. SF 138 (hotOrcamentoStatus) — modelos do CR sem pacote ──
console.log('[6] SF 138 (hotOrcamentoStatus)...');
const sf138 = await readServerFunctionMitra({ projectId, serverFunctionId: 138 });
const code138 = sf138?.result?.code || '';
const FRAG_OLD = "AND d.ATIVO = 'true' GROUP BY crc.CR_ID";
const FRAG_NEW = "AND d.ATIVO = 'true' AND d.TIPO_DRIVER = 'NORMAL' GROUP BY crc.CR_ID";
if (code138.includes(FRAG_NEW)) {
  console.log('  = ja corrigida');
} else if (code138.includes(FRAG_OLD)) {
  await updateServerFunctionMitra({ projectId, serverFunctionId: 138, code: code138.replace(FRAG_OLD, FRAG_NEW) });
  console.log('  ~ corrigida (pacote fora da contagem)');
} else {
  console.log('  ! fragmento nao encontrado — verificar manualmente');
}

// ── 7. Re-snapshot de TOTAL_MODELOS nas versoes FECHADAS (sem pacote) ──
console.log('[7] Re-snapshot TOTAL_MODELOS (versoes fechadas, contagem sem pacote)...');
const LIVE_CR_NORMAL = `SELECT crc.CR_ID, COUNT(DISTINCT d.NOME) AS TOTAL
  FROM CR_CONTA crc
  LEFT JOIN CONTA_DRIVER_EXCECAO cde ON cde.CR_ID = crc.CR_ID AND cde.CONTA_ID = crc.CONTA_ID AND cde.ATIVO = true
  LEFT JOIN CONTA_DRIVER cd ON cd.CONTA_ID = crc.CONTA_ID
  LEFT JOIN DRIVERS d ON d.ID = COALESCE(cde.PACOTE_ID, cd.PACOTE_ID, cde.DRIVER_ID, cd.DRIVER_ID)
  WHERE crc.ATIVO = true AND d.ID IS NOT NULL AND d.ATIVO = 'true' AND d.TIPO_DRIVER = 'NORMAL'
  GROUP BY crc.CR_ID`;
await runDmlMitra({ projectId, sql:
`UPDATE ORCAMENTO_STATUS os
JOIN CICLO c ON c.ID = os.CICLO_ID AND c.STATUS = 'FECHADO'
LEFT JOIN (${LIVE_CR_NORMAL}) live ON live.CR_ID = os.CR_ID
SET os.TOTAL_MODELOS = COALESCE(live.TOTAL, 0)
WHERE os.TOTAL_MODELOS IS NOT NULL` });
console.log('  OK');

console.log('\n=== IDs para o frontend ===');
console.log('avaliarWorkflowStatus :', avaliarId);
console.log('registrarEventoWorkflow:', registrarId);
console.log('listarAuditoriaWorkflow:', listarId);
console.log('done');
