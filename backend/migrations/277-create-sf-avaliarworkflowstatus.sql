INSERT INTO INT_SERVERFUNCTION (ID, NAME, DESCRIPTION, TYPE, CODE, JDBC_ID, PUBLIC_EXECUTION, CRON_EXPRESSION, CRON_INPUT_JSON, CREATED_BY) VALUES (171, 'avaliarWorkflowStatus', 'Transicao validada de status de CR/pacote (APROVADO/REPROVADO/SUBMETIDO) com auditoria e e-mail. Params: tipo, acao, statusId ou (cicloId+crId/driverId+gestorId), comentario, autor, appUrl, notificar', 'JAVASCRIPT', '
// Transicao de status de CR/pacote com validacao no SERVIDOR (maquina de estados),
// auditoria e notificacao por e-mail. Unico caminho de aprovar/reprovar/submeter/
// reabrir pelo app — substitui o patchRecordMitra direto que nao validava nada.
// Params: tipo (''CR''|''PACOTE''), acao (''APROVADO''|''REPROVADO''|''SUBMETIDO''),
//         statusId OU (cicloId + crId/driverId [+ gestorId]),
//         comentario (obrigatorio p/ REPROVADO), autor, appUrl, notificar (default true).
const { runDmlMitra, executeServerFunctionMitra, sendEmailMitra } = require(''mitra-sdk'');
const projectId = parseInt(process.env.MITRA_PROJECT_ID);
const q = async (sql) => {
  const r = await executeServerFunctionMitra({ projectId, serverFunctionId: 76, input: { sql } });
  let o = r && r.result ? r.result.output : null;
  if (typeof o === ''string'') { try { o = JSON.parse(o); } catch (e) {} }
  return (o && o.rows) || [];
};
const tipo = event.tipo === ''PACOTE'' ? ''PACOTE'' : ''CR'';
const acao = String(event.acao || '''').toUpperCase();
if (acao !== ''APROVADO'' && acao !== ''REPROVADO'' && acao !== ''SUBMETIDO'') return { ok: false, error: ''acao_invalida'' };
const comentRaw = String(event.comentario == null ? '''' : event.comentario).replace(/[<>]/g, '''').slice(0, 500);
const comentSql = comentRaw.replace(/''/g, "''''");
const autorRaw = String(event.autor == null ? '''' : event.autor).replace(/[<>]/g, '''').slice(0, 200);
const autorSql = autorRaw.replace(/''/g, "''''");
const notificar = event.notificar !== false;
const appUrl = String(event.appUrl || '''').replace(/[^A-Za-z0-9:/.\\-_]/g, '''').slice(0, 200);
if (acao === ''REPROVADO'' && !comentRaw.trim()) return { ok: false, error: ''comentario_obrigatorio'' };
const table = tipo === ''CR'' ? ''ORCAMENTO_STATUS'' : ''PACOTE_STATUS'';
const keyCol = tipo === ''CR'' ? ''CR_ID'' : ''DRIVER_ID'';
const agora = new Date().toISOString().slice(0, 19);
const loadRow = async (where) => (await q(
  ''SELECT s.ID, s.CICLO_ID, s.GESTOR_ID, s.'' + keyCol + " AS REF_ID, COALESCE(s.STATUS, ''PENDENTE'') AS STATUS, c.STATUS AS CICLO_STATUS" +
  '' FROM '' + table + '' s JOIN CICLO c ON c.ID = s.CICLO_ID WHERE '' + where + '' LIMIT 1''))[0];
let row = null;
const statusId = Number(event.statusId);
const cicloId = Number(event.cicloId);
const refId = Number(tipo === ''CR'' ? event.crId : event.driverId);
const gestorId = Number(event.gestorId);
if (Number.isInteger(statusId) && statusId > 0) {
  row = await loadRow(''s.ID = '' + statusId);
} else if (Number.isInteger(cicloId) && cicloId > 0 && Number.isInteger(refId) && refId > 0) {
  const gFil = Number.isInteger(gestorId) && gestorId > 0 ? '' AND s.GESTOR_ID = '' + gestorId : '''';
  row = await loadRow(''s.CICLO_ID = '' + cicloId + '' AND s.'' + keyCol + '' = '' + refId + gFil);
  if (!row && acao === ''SUBMETIDO'' && Number.isInteger(gestorId) && gestorId > 0) {
    await runDmlMitra({ projectId, sql: ''INSERT INTO '' + table + '' (CICLO_ID, '' + keyCol + '', GESTOR_ID, STATUS, ATUALIZADO_EM) VALUES ('' + cicloId + '', '' + refId + '', '' + gestorId + ", ''PENDENTE'', ''" + agora + "'')" });
    row = await loadRow(''s.CICLO_ID = '' + cicloId + '' AND s.'' + keyCol + '' = '' + refId + gFil);
  }
} else {
  return { ok: false, error: ''params_invalidos'' };
}
if (!row) return { ok: false, error: ''status_nao_encontrado'' };
if (row.CICLO_STATUS === ''FECHADO'') return { ok: false, error: ''ciclo_fechado'' };
const de = row.STATUS;
if (de === acao) return { ok: false, error: ''sem_transicao'', status: de };
const ALLOWED = {
  APROVADO: [''SUBMETIDO'', ''REPROVADO''],
  REPROVADO: [''SUBMETIDO'', ''APROVADO''],
  SUBMETIDO: [''PENDENTE'', ''CONFIRMADO'', ''REPROVADO'', ''APROVADO'']
};
if (ALLOWED[acao].indexOf(de) === -1) return { ok: false, error: ''transicao_invalida'', de: de, para: acao };
// REPROVADO grava o motivo; APROVADO/SUBMETIDO preservam o comentario anterior
// (o motivo da reprovacao sobrevive a re-submissao — semantica do fluxo atual).
const setComent = acao === ''REPROVADO'' ? ", COMENTARIO = ''" + comentSql + "''" : '''';
await runDmlMitra({ projectId, sql: ''UPDATE '' + table + " SET STATUS = ''" + acao + "''" + setComent + ", ATUALIZADO_EM = ''" + agora + "'' WHERE ID = " + row.ID + " AND STATUS = ''" + de + "''" });
const after = await loadRow(''s.ID = '' + row.ID);
if (!after || after.STATUS !== acao) return { ok: false, error: ''conflito_concorrente'' };
const evento = (acao === ''SUBMETIDO'' && de === ''APROVADO'') ? ''REABERTO'' : acao;
await runDmlMitra({ projectId, sql:
  ''INSERT INTO WORKFLOW_AUDITORIA (CICLO_ID, TIPO, CR_ID, DRIVER_ID, GESTOR_ID, EVENTO, STATUS_DE, STATUS_PARA, COMENTARIO, AUTOR, ORIGEM, CRIADO_EM) VALUES ('' +
  row.CICLO_ID + ", ''" + tipo + "'', " + (tipo === ''CR'' ? row.REF_ID : ''NULL'') + '', '' + (tipo === ''PACOTE'' ? row.REF_ID : ''NULL'') + '', '' + (row.GESTOR_ID || ''NULL'') +
  ", ''" + evento + "'', ''" + de + "'', ''" + acao + "'', ''" + comentSql + "'', ''" + autorSql + "'', ''APP'', ''" + agora + "'')" });
let emails = 0;
if (notificar) {
  try {
    const info = (await q(tipo === ''CR''
      ? "SELECT CONCAT(cr.CODIGO, '' - '', cr.NOME) AS LABEL, c.NOME AS CICLO_NOME, g.NOME AS GESTOR_NOME, g.EMAIL AS GESTOR_EMAIL FROM ORCAMENTO_STATUS s JOIN CENTRO_RESULTADO cr ON cr.ID = s.CR_ID JOIN CICLO c ON c.ID = s.CICLO_ID LEFT JOIN GESTOR g ON g.ID = s.GESTOR_ID WHERE s.ID = " + row.ID
      : "SELECT CONCAT(''Pacote '', d.NOME) AS LABEL, c.NOME AS CICLO_NOME, g.NOME AS GESTOR_NOME, g.EMAIL AS GESTOR_EMAIL FROM PACOTE_STATUS s JOIN DRIVERS d ON d.ID = s.DRIVER_ID JOIN CICLO c ON c.ID = s.CICLO_ID LEFT JOIN GESTOR g ON g.ID = s.GESTOR_ID WHERE s.ID = " + row.ID))[0] || {};
    const label = info.LABEL || (tipo + '' '' + row.REF_ID);
    const wrap = (titulo, corpo) =>
      ''<div style="font-family:Inter,Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px">'' +
      ''<div style="background:linear-gradient(135deg,#75c95f,#9ad889);border-radius:12px;padding:24px;color:#fff;margin-bottom:24px">'' +
      ''<h1 style="margin:0;font-size:20px">Mitra FP&A</h1>'' +
      ''<p style="margin:8px 0 0;opacity:0.9;font-size:14px">Planejamento Orçamentário</p></div>'' +
      ''<h2 style="color:#1e293b;font-size:18px">'' + titulo + ''</h2>'' + corpo +
      ''<p style="color:#94a3b8;font-size:12px;border-top:1px solid #e2e8f0;padding-top:16px;margin-top:32px">Este email foi enviado automaticamente pelo Mitra FP&A.</p></div>'';
    if (acao === ''SUBMETIDO'') {
      const aps = await q("SELECT DISTINCT EMAIL FROM USUARIOS WHERE PERFIL IN (''admin'',''aprovador'') AND EMAIL IS NOT NULL AND EMAIL <> ''''");
      const to = aps.map((a) => a.EMAIL);
      if (to.length) {
        await sendEmailMitra({ projectId, to,
          subject: ''Mitra FP&A - '' + label + '' submetido para aprovação'',
          body: wrap(label + '' aguarda avaliação'',
            ''<p style="color:#64748b;font-size:14px;line-height:1.6"><strong>'' + (info.GESTOR_NOME || autorRaw || ''O gestor'') + ''</strong> submeteu <strong>'' + label + ''</strong> na versão <strong>'' + (info.CICLO_NOME || '''') + ''</strong> para aprovação.</p>'' +
            (appUrl ? ''<div style="text-align:center;margin:32px 0"><a href="'' + appUrl + ''/workflow" style="background:#75c95f;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;display:inline-block">Abrir Workflow</a></div>'' : '''')) });
        emails = to.length;
      }
    } else if (info.GESTOR_EMAIL) {
      let link = '''';
      if (acao === ''REPROVADO'' && appUrl && row.GESTOR_ID) {
        const t = (await q("SELECT TOKEN FROM PREENCHIMENTO_TOKEN WHERE CICLO_ID = " + row.CICLO_ID + " AND GESTOR_ID = " + row.GESTOR_ID + " AND ATIVO = ''true'' ORDER BY ID DESC LIMIT 1"))[0];
        if (t && t.TOKEN) link = appUrl + ''/preenchimento-publico?token='' + t.TOKEN;
      }
      const aprovado = acao === ''APROVADO'';
      await sendEmailMitra({ projectId, to: [info.GESTOR_EMAIL],
        subject: ''Mitra FP&A - '' + label + (aprovado ? '' aprovado'' : '' reprovado''),
        body: wrap(''Olá, '' + (info.GESTOR_NOME || '''') + ''!'',
          ''<p style="color:#64748b;font-size:14px;line-height:1.6">O orçamento de <strong>'' + label + ''</strong> na versão <strong>'' + (info.CICLO_NOME || '''') + ''</strong> foi <strong style="color:'' + (aprovado ? ''#059669'' : ''#b91c1c'') + ''">'' + (aprovado ? ''APROVADO'' : ''REPROVADO'') + ''</strong>'' + (autorRaw ? '' por '' + autorRaw : '''') + ''.</p>'' +
          (!aprovado && comentRaw ? ''<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;margin:16px 0"><p style="margin:0;color:#991b1b;font-size:14px"><strong>Motivo:</strong> '' + comentRaw + ''</p></div>'' : '''') +
          (link ? ''<div style="text-align:center;margin:32px 0"><a href="'' + link + ''" style="background:#75c95f;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;display:inline-block">Revisar e reenviar</a></div>'' : '''')) });
      emails = 1;
    }
  } catch (e) { /* e-mail nunca bloqueia a transicao */ }
}
return { ok: true, de: de, para: acao, evento: evento, emails: emails };', NULL, FALSE, NULL, NULL, 'sarah@mitralab.io');
