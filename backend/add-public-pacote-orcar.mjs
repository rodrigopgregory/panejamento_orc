// Destrava o PACOTE no link publico do gestor (antes era somente-leitura).
// Estende a SF 147 (publicOrcWrite) com ops de pacote, todas token-escopadas:
//   · pkgCells      — celulas de conta do modelo (ORCAMENTO_PACOTE, CR a CR)
//   · pkgLineCells  — valores de linha do modelo (DRIVER_FORMULA_VALOR c/ PACOTE_ID)
//   · confirmPacote — confirma/desfaz modelo (PACOTE_STATUS.DRIVERS_CONFIRMADOS)
//   · submeterPacote— PENDENTE/CONFIRMADO/REPROVADO -> SUBMETIDO + auditoria + email
// Gate comum: token ativo + ciclo nao FECHADO + pacote pertence ao gestor do token
// (PACOTE_STATUS do ciclo/gestor) + status do pacote nao SUBMETIDO/APROVADO.
// Cirurgia de string sobre o codigo vivo — preserva as ops de CR existentes.
import 'dotenv/config';
import { configureSdkMitra, readServerFunctionMitra, updateServerFunctionMitra } from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});
const projectId = parseInt(process.env.MITRA_PROJECT_ID);

const SF_ID = 147;
const fn = await readServerFunctionMitra({ projectId, serverFunctionId: SF_ID });
let code = fn?.result?.code || '';
if (!code) throw new Error('SF 147 sem codigo');

if (code.includes("op === 'pkgCells'")) {
  console.log('SF 147 ja contem as ops de pacote — nada a fazer');
  process.exit(0);
}

// 1) imports: submeterPacote precisa de query (SF 76) e e-mail
const REQ_OLD = "const { runDmlMitra } = require('mitra-sdk');";
const REQ_NEW = "const { runDmlMitra, executeServerFunctionMitra, sendEmailMitra } = require('mitra-sdk');";
if (!code.includes(REQ_OLD)) throw new Error('anchor require nao encontrado');
code = code.replace(REQ_OLD, REQ_NEW);

// 2) guard: ops de pacote usam pacoteId no lugar de crId
const GUARD_OLD = "if (!token || !op || !Number.isInteger(crId)) return { ok: false, error: 'params_invalidos' };";
const GUARD_NEW = `const PKG_OPS = ['pkgCells', 'pkgLineCells', 'confirmPacote', 'submeterPacote'];
const isPkgOp = PKG_OPS.indexOf(op) >= 0;
const pacoteId = Number(event.pacoteId);
if (!token || !op || (!isPkgOp && !Number.isInteger(crId)) || (isPkgOp && !Number.isInteger(pacoteId))) return { ok: false, error: 'params_invalidos' };`;
if (!code.includes(GUARD_OLD)) throw new Error('anchor guard nao encontrado');
code = code.replace(GUARD_OLD, GUARD_NEW);

// 3) ops de pacote antes do fallback op_desconhecida
const TAIL = "return { ok: false, error: 'op_desconhecida' };";
if (!code.includes(TAIL)) throw new Error('anchor tail nao encontrado');

const PKG_BLOCK = `
// ── Ops de PACOTE (gestor do pacote orcando pelo link) ─────────────────────
// Gate: token ativo, ciclo nao FECHADO, pacote pertence ao gestor do token
// (linha em PACOTE_STATUS do ciclo/gestor) e pacote nao SUBMETIDO/APROVADO.
// Token/pacote de outro gestor => JOIN nao casa => DML nao afeta nada.
const PK_SRC = "PREENCHIMENTO_TOKEN tkk JOIN PACOTE_STATUS psk ON psk.CICLO_ID = tkk.CICLO_ID AND psk.GESTOR_ID = tkk.GESTOR_ID AND psk.DRIVER_ID = " + pacoteId;
const PK_COND = "tkk.TOKEN = '" + token + "' AND tkk.ATIVO = 'true'" +
  " AND NOT EXISTS (SELECT 1 FROM CICLO ckk WHERE ckk.ID = tkk.CICLO_ID AND ckk.STATUS = 'FECHADO')" +
  " AND psk.STATUS NOT IN ('SUBMETIDO','APROVADO')";

if (op === 'pkgCells') {
  // Upsert em lote de celulas de conta do modelo (delete + insert em ORCAMENTO_PACOTE, CR a CR)
  const raw = Array.isArray(event.cells) ? event.cells : [];
  const cells = [];
  for (const c of raw) {
    const conta = Number(c.contaId), mes = Number(c.mes), cr = Number(c.crId);
    if (Number.isInteger(conta) && Number.isInteger(mes) && mes >= 1 && mes <= 12 && Number.isInteger(cr)) {
      cells.push({ conta, mes, cr, val: num(c.valor) });
    }
  }
  if (cells.length === 0) return { ok: true, saved: 0 };
  const trios = cells.map(c => '(' + c.conta + ',' + c.mes + ',' + c.cr + ')').join(',');
  await dml("DELETE o FROM ORCAMENTO_PACOTE o" +
    " JOIN PREENCHIMENTO_TOKEN tkk ON tkk.CICLO_ID = o.CICLO_ID" +
    " JOIN PACOTE_STATUS psk ON psk.CICLO_ID = tkk.CICLO_ID AND psk.GESTOR_ID = tkk.GESTOR_ID AND psk.DRIVER_ID = o.DRIVER_ID" +
    " WHERE o.DRIVER_ID = " + pacoteId + " AND (o.CONTA_ID, o.MES, o.CR_ID) IN (" + trios + ") AND " + PK_COND);
  const derived = cells.map(c => 'SELECT ' + c.conta + ' AS CONTA_ID, ' + c.mes + ' AS MES, ' + c.cr + ' AS CR_ID, ' + c.val + ' AS VALOR').join(' UNION ALL ');
  await dml("INSERT INTO ORCAMENTO_PACOTE (CICLO_ID, DRIVER_ID, CR_ID, CONTA_ID, MES, VALOR)" +
    " SELECT tkk.CICLO_ID, " + pacoteId + ", v.CR_ID, v.CONTA_ID, v.MES, v.VALOR" +
    " FROM " + PK_SRC +
    " JOIN (" + derived + ") v" +
    " JOIN CR_CONTA crck ON crck.CR_ID = v.CR_ID AND crck.CONTA_ID = v.CONTA_ID AND crck.ATIVO = true" +
    " WHERE " + PK_COND);
  return { ok: true, saved: cells.length };
}

if (op === 'pkgLineCells') {
  // Valores de linha do MODELO do pacote (DRIVER_FORMULA_VALOR com PACOTE_ID;
  // CR_ID 0 = valor unico da linha, CR_ID real = linha granular por CR).
  const raw = Array.isArray(event.cells) ? event.cells : [];
  const cells = [];
  for (const c of raw) {
    const fid = Number(c.formulaId), mes = Number(c.mes), cr = Number(c.crId);
    if (Number.isInteger(fid) && Number.isInteger(mes) && mes >= 1 && mes <= 12 && Number.isInteger(cr)) {
      cells.push({ fid, mes, cr, val: num(c.valor) });
    }
  }
  if (cells.length === 0) return { ok: true, saved: 0 };
  const trios = cells.map(c => '(' + c.fid + ',' + c.mes + ',' + c.cr + ')').join(',');
  await dml("DELETE fv FROM DRIVER_FORMULA_VALOR fv" +
    " JOIN PREENCHIMENTO_TOKEN tkk ON tkk.CICLO_ID = fv.CICLO_ID" +
    " JOIN PACOTE_STATUS psk ON psk.CICLO_ID = tkk.CICLO_ID AND psk.GESTOR_ID = tkk.GESTOR_ID AND psk.DRIVER_ID = fv.PACOTE_ID" +
    " WHERE fv.PACOTE_ID = " + pacoteId + " AND (fv.FORMULA_ID, fv.MES, fv.CR_ID) IN (" + trios + ") AND " + PK_COND);
  const derived = cells.map(c => 'SELECT ' + c.fid + ' AS FORMULA_ID, ' + c.mes + ' AS MES, ' + c.cr + ' AS CR_ID, ' + c.val + ' AS VALOR').join(' UNION ALL ');
  await dml("INSERT INTO DRIVER_FORMULA_VALOR (FORMULA_ID, CICLO_ID, PACOTE_ID, CR_ID, MES, VALOR)" +
    " SELECT v.FORMULA_ID, tkk.CICLO_ID, " + pacoteId + ", v.CR_ID, v.MES, v.VALOR" +
    " FROM " + PK_SRC +
    " JOIN (" + derived + ") v" +
    " JOIN DRIVER_FORMULA dfk ON dfk.ID = v.FORMULA_ID AND dfk.DRIVER_ID = " + pacoteId +
    " WHERE " + PK_COND);
  return { ok: true, saved: cells.length };
}

if (op === 'confirmPacote') {
  // Mesma maquina do confirmDriver, sobre PACOTE_STATUS (linha ja existe: o
  // disparo do pacote a cria). Todos confirmados e PENDENTE -> CONFIRMADO;
  // desfez e CONFIRMADO -> PENDENTE; demais status preservados.
  const csv = String(event.driversCsv || '').replace(/[^A-Za-z0-9_, -]/g, '').slice(0, 500);
  const all = event.allConfirmed ? 1 : 0;
  await dml("UPDATE PACOTE_STATUS psk" +
    " JOIN PREENCHIMENTO_TOKEN tkk ON tkk.CICLO_ID = psk.CICLO_ID AND tkk.GESTOR_ID = psk.GESTOR_ID" +
    " SET psk.DRIVERS_CONFIRMADOS = '" + csv + "'," +
    " psk.STATUS = CASE" +
    "   WHEN " + all + " = 1 AND psk.STATUS = 'PENDENTE' THEN 'CONFIRMADO'" +
    "   WHEN " + all + " = 0 AND psk.STATUS = 'CONFIRMADO' THEN 'PENDENTE'" +
    "   ELSE psk.STATUS END," +
    " psk.ATUALIZADO_EM = '" + agora + "'" +
    " WHERE psk.DRIVER_ID = " + pacoteId + " AND " + PK_COND);
  return { ok: true };
}

if (op === 'submeterPacote') {
  // Espelho do publicSubmeterCR (SF 70) para PACOTE_STATUS: valida a transicao,
  // grava auditoria (ORIGEM LINK) e notifica aprovadores — email nunca bloqueia.
  const q = async (sql) => {
    const r = await executeServerFunctionMitra({ projectId, serverFunctionId: 76, input: { sql } });
    let o = r && r.result ? r.result.output : null;
    if (typeof o === 'string') { try { o = JSON.parse(o); } catch (e) {} }
    return (o && o.rows) || [];
  };
  const appUrl = String(event.appUrl || '').replace(/[^A-Za-z0-9:/.\\-_]/g, '').slice(0, 200);
  const ctx = (await q(
    "SELECT tkk.CICLO_ID, tkk.GESTOR_ID, g.NOME AS GESTOR_NOME, c.NOME AS CICLO_NOME, c.STATUS AS CICLO_STATUS," +
    " d.NOME AS PACOTE_NOME, psk.STATUS" +
    " FROM PREENCHIMENTO_TOKEN tkk" +
    " JOIN GESTOR g ON g.ID = tkk.GESTOR_ID" +
    " JOIN CICLO c ON c.ID = tkk.CICLO_ID" +
    " JOIN PACOTE_STATUS psk ON psk.CICLO_ID = tkk.CICLO_ID AND psk.GESTOR_ID = tkk.GESTOR_ID AND psk.DRIVER_ID = " + pacoteId +
    " JOIN DRIVERS d ON d.ID = " + pacoteId +
    " WHERE tkk.TOKEN = '" + token + "' AND tkk.ATIVO = 'true' ORDER BY tkk.ID DESC LIMIT 1"))[0];
  if (!ctx) return { ok: false, error: 'token_invalido' };
  if (ctx.CICLO_STATUS === 'FECHADO') return { ok: false, error: 'ciclo_fechado' };
  if (ctx.STATUS !== 'PENDENTE' && ctx.STATUS !== 'CONFIRMADO' && ctx.STATUS !== 'REPROVADO') return { ok: false, error: 'status_nao_permite', status: ctx.STATUS };
  await dml("UPDATE PACOTE_STATUS psk" +
    " JOIN PREENCHIMENTO_TOKEN tkk ON tkk.CICLO_ID = psk.CICLO_ID AND tkk.GESTOR_ID = psk.GESTOR_ID AND tkk.TOKEN = '" + token + "' AND tkk.ATIVO = 'true'" +
    " SET psk.STATUS = 'SUBMETIDO', psk.ATUALIZADO_EM = '" + agora + "'" +
    " WHERE psk.DRIVER_ID = " + pacoteId + " AND psk.STATUS IN ('PENDENTE','CONFIRMADO','REPROVADO')" +
    " AND NOT EXISTS (SELECT 1 FROM CICLO ckk WHERE ckk.ID = tkk.CICLO_ID AND ckk.STATUS = 'FECHADO')");
  const after = (await q("SELECT STATUS FROM PACOTE_STATUS WHERE CICLO_ID = " + ctx.CICLO_ID + " AND GESTOR_ID = " + ctx.GESTOR_ID + " AND DRIVER_ID = " + pacoteId + " LIMIT 1"))[0];
  if (!after || after.STATUS !== 'SUBMETIDO') return { ok: false, error: 'transicao_nao_aplicada' };
  const label = String(ctx.PACOTE_NOME || 'Pacote').toLowerCase().replace(/_/g, ' ').replace(/(^|\\s)\\S/g, s => s.toUpperCase());
  await dml("INSERT INTO WORKFLOW_AUDITORIA (CICLO_ID, TIPO, CR_ID, DRIVER_ID, GESTOR_ID, EVENTO, STATUS_DE, STATUS_PARA, COMENTARIO, AUTOR, ORIGEM, CRIADO_EM) VALUES (" +
    ctx.CICLO_ID + ", 'PACOTE', NULL, " + pacoteId + ", " + ctx.GESTOR_ID + ", 'SUBMETIDO', '" + ctx.STATUS + "', 'SUBMETIDO', '', '" + String(ctx.GESTOR_NOME || '').replace(/'/g, "''") + "', 'LINK', '" + agora + "')");
  try {
    const aps = await q("SELECT DISTINCT EMAIL FROM USUARIOS WHERE PERFIL IN ('admin','aprovador') AND EMAIL IS NOT NULL AND EMAIL <> ''");
    const to = aps.map((a) => a.EMAIL);
    if (to.length) {
      await sendEmailMitra({ projectId, to,
        subject: 'Mitra FP&A - Pacote ' + label + ' submetido para aprovação',
        body: '<div style="font-family:Inter,Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px">' +
          '<div style="background:linear-gradient(135deg,#75c95f,#9ad889);border-radius:12px;padding:24px;color:#fff;margin-bottom:24px">' +
          '<h1 style="margin:0;font-size:20px">Mitra FP&A</h1>' +
          '<p style="margin:8px 0 0;opacity:0.9;font-size:14px">Planejamento Orçamentário</p></div>' +
          '<h2 style="color:#1e293b;font-size:18px">Pacote ' + label + ' aguarda avaliação</h2>' +
          '<p style="color:#64748b;font-size:14px;line-height:1.6"><strong>' + (ctx.GESTOR_NOME || 'O gestor') + '</strong> submeteu o pacote <strong>' + label + '</strong> na versão <strong>' + (ctx.CICLO_NOME || '') + '</strong> para aprovação.</p>' +
          (appUrl ? '<div style="text-align:center;margin:32px 0"><a href="' + appUrl + '/workflow" style="background:#75c95f;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;display:inline-block">Abrir Workflow</a></div>' : '') +
          '<p style="color:#94a3b8;font-size:12px;border-top:1px solid #e2e8f0;padding-top:16px;margin-top:32px">Este email foi enviado automaticamente pelo Mitra FP&A.</p></div>' });
    }
  } catch (e) {}
  return { ok: true };
}

`;

code = code.replace(TAIL, PKG_BLOCK + TAIL);

await updateServerFunctionMitra({
  projectId, serverFunctionId: SF_ID, code,
  description: 'Escrita publica token-escopada do link do gestor. Ops de CR: orcCells, formulaCells, histPremissa, aumentoUpsert/Delete, contratCreate/Delete, pessoalRecalc, confirmDriver. Ops de PACOTE: pkgCells, pkgLineCells, confirmPacote, submeterPacote (params: token, op, crId ou pacoteId, ...)',
});
console.log('SF 147 atualizada com ops de pacote (pkgCells/pkgLineCells/confirmPacote/submeterPacote)');
