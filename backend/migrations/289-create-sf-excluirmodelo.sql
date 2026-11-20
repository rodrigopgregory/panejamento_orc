INSERT INTO INT_SERVERFUNCTION (ID, NAME, DESCRIPTION, TYPE, CODE, JDBC_ID, PUBLIC_EXECUTION, CRON_EXPRESSION, CRON_INPUT_JSON, CREATED_BY) VALUES (175, 'excluirModelo', 'Exclui ou inativa um modelo (DRIVERS) da tela de Modelagem. Bloqueia exclusao se ja houver orcamento preenchido atraves do modelo (oferece inativar). Nativo protegido. Params: driverId, op (check|excluir|inativar).', 'JAVASCRIPT', '
const { runDmlMitra, executeServerFunctionMitra } = require(''mitra-sdk'');
const projectId = parseInt(process.env.MITRA_PROJECT_ID);
const q = async (sql) => {
  const r = await executeServerFunctionMitra({ projectId, serverFunctionId: 76, input: { sql } });
  let o = r && r.result ? r.result.output : null;
  if (typeof o === ''string'') { try { o = JSON.parse(o); } catch (e) {} }
  return (o && o.rows) || [];
};
const cnt = async (sql) => { const r = await q(sql); return r.length ? Number(r[0].N || 0) : 0; };
const dml = async (sql) => { try { await runDmlMitra({ projectId, sql: sql }); return true; } catch (e) { return false; } };

const id = Number(event.driverId);
const op = String(event.op || ''check'');
if (!Number.isInteger(id) || id <= 0) return { ok: false, error: ''params_invalidos'' };

const drv = (await q("SELECT ID, NOME, TIPO_DRIVER, ORIGEM, ATIVO FROM DRIVERS WHERE ID = " + id + " LIMIT 1"))[0];
if (!drv) return { ok: false, error: ''nao_encontrado'' };

const PADRAO = [''BASE_ZERO'', ''BASE_HISTORICO'', ''PESSOAL''];
const origem = (drv.ORIGEM === ''NATIVO'' || drv.ORIGEM === ''IA'' || drv.ORIGEM === ''TELA'')
  ? drv.ORIGEM : (PADRAO.indexOf(drv.NOME) >= 0 ? ''NATIVO'' : ''TELA'');
if (origem === ''NATIVO'') return { ok: false, error: ''nativo_protegido'', nome: drv.NOME };

// ── orcamento preenchido atraves do modelo ──
const nPacote = await cnt("SELECT COUNT(*) AS N FROM ORCAMENTO_PACOTE WHERE DRIVER_ID = " + id + " AND VALOR IS NOT NULL AND VALOR <> 0");
const nFormula = await cnt("SELECT COUNT(*) AS N FROM DRIVER_FORMULA_VALOR WHERE VALOR IS NOT NULL AND VALOR <> 0 AND FORMULA_ID IN (SELECT ID FROM DRIVER_FORMULA WHERE DRIVER_ID = " + id + ")");
const nOrc = await cnt(
  "SELECT COUNT(*) AS N FROM ORCAMENTO o WHERE o.VALOR IS NOT NULL AND o.VALOR <> 0 AND ("
  + " ( o.CONTA_ID IN (SELECT CONTA_ID FROM CONTA_DRIVER WHERE DRIVER_ID = " + id + " OR PACOTE_ID = " + id + ")"
  + "   AND NOT EXISTS (SELECT 1 FROM CONTA_DRIVER_EXCECAO e2 WHERE e2.CONTA_ID = o.CONTA_ID AND e2.CR_ID = o.CR_ID AND e2.ATIVO = true) )"
  + " OR EXISTS (SELECT 1 FROM CONTA_DRIVER_EXCECAO e WHERE (e.DRIVER_ID = " + id + " OR e.PACOTE_ID = " + id + ") AND e.CONTA_ID = o.CONTA_ID AND e.CR_ID = o.CR_ID AND e.ATIVO = true) )");
const orcamento = nPacote + nFormula + nOrc;
const temOrcamento = orcamento > 0;

// ── contagens informativas de associacao (para a UI) ──
const nContas = await cnt("SELECT COUNT(*) AS N FROM CONTA_DRIVER WHERE DRIVER_ID = " + id + " OR PACOTE_ID = " + id);
const nFormulas = await cnt("SELECT COUNT(*) AS N FROM DRIVER_FORMULA WHERE DRIVER_ID = " + id);
const nExcecoes = await cnt("SELECT COUNT(*) AS N FROM CONTA_DRIVER_EXCECAO WHERE (DRIVER_ID = " + id + " OR PACOTE_ID = " + id + ") AND ATIVO = true");

const info = { nome: drv.NOME, temOrcamento: temOrcamento, orcamento: orcamento, contas: nContas, formulas: nFormulas, excecoes: nExcecoes };

if (op === ''check'') return Object.assign({ ok: true }, info);

if (op === ''inativar'') {
  const okU = await dml("UPDATE DRIVERS SET ATIVO = ''false'' WHERE ID = " + id);
  if (!okU) return { ok: false, error: ''falha_inativar'' };
  return Object.assign({ ok: true, inativado: true }, info);
}

if (op === ''excluir'') {
  if (temOrcamento) return Object.assign({ ok: false, error: ''tem_orcamento'' }, info);
  // limpeza em cascata (ordem FK-safe) — vinculos/formulas/config vao junto com o modelo
  await dml("DELETE FROM DRIVER_FORMULA_CR WHERE FORMULA_ID IN (SELECT ID FROM DRIVER_FORMULA WHERE DRIVER_ID = " + id + ")");
  await dml("DELETE FROM DRIVER_FORMULA_VALOR WHERE FORMULA_ID IN (SELECT ID FROM DRIVER_FORMULA WHERE DRIVER_ID = " + id + ")");
  await dml("DELETE FROM DRIVER_FORMULA WHERE DRIVER_ID = " + id);
  await dml("DELETE FROM DRIVER_CONFIG WHERE DRIVER_ID = " + id);
  const nameEsc = String(drv.NOME).replace(/''/g, "''''");
  await dml("DELETE FROM DRIVER_CONFIG WHERE DRIVER_TIPO = ''" + nameEsc + "''");
  await dml("DELETE FROM CONTA_DRIVER WHERE DRIVER_ID = " + id + " OR PACOTE_ID = " + id);
  await dml("DELETE FROM CONTA_DRIVER_EXCECAO WHERE DRIVER_ID = " + id + " OR PACOTE_ID = " + id);
  await dml("DELETE FROM RATEIO_CR WHERE RATEIO_CONFIG_ID IN (SELECT ID FROM RATEIO_CONFIG WHERE DRIVER_ID = " + id + ")");
  await dml("DELETE FROM RATEIO_CONFIG WHERE DRIVER_ID = " + id);
  await dml("DELETE FROM GESTOR_PACOTE WHERE DRIVER_ID = " + id);
  await dml("DELETE FROM ORCAMENTO_PACOTE WHERE DRIVER_ID = " + id);
  const okD = await dml("DELETE FROM DRIVERS WHERE ID = " + id);
  if (!okD) return { ok: false, error: ''falha_excluir'' };
  return Object.assign({ ok: true, excluido: true }, info);
}

return { ok: false, error: ''op_invalida'' };
', NULL, FALSE, NULL, NULL, 'sarah@mitralab.io');
