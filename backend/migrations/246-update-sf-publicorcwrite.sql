UPDATE INT_SERVERFUNCTION SET NAME = COALESCE(NULL, NAME), DESCRIPTION = COALESCE('Escritas do driver publico (orcCells,formulaCells,histPremissa,aumentoUpsert/Delete,contratCreate/Delete,pessoalRecalc,confirmDriver), token-escopadas. Params: token,op,crId,...', DESCRIPTION), TYPE = COALESCE(NULL, TYPE), JDBC_ID = NULL, CODE = COALESCE('
const { runDmlMitra } = require(''mitra-sdk'');
const projectId = parseInt(process.env.MITRA_PROJECT_ID);

const token = String(event.token || '''').replace(/[^0-9a-fA-F-]/g, '''').slice(0, 36);
const op = String(event.op || '''');
const crId = Number(event.crId);
if (!token || !op || !Number.isInteger(crId)) return { ok: false, error: ''params_invalidos'' };

const esc = (s, max) => String(s == null ? '''' : s).replace(/\\\\/g, '''').replace(/''/g, "''''").slice(0, max || 500);
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const intOr0 = (v) => { const n = Number(v); return Number.isInteger(n) ? n : 0; };
const agora = new Date().toISOString().slice(0, 19);

// Fragmentos do gate — todo DML embute a autorizacao: token ativo, ciclo NAO
// fechado, CR pertence ao gestor do token e CR nao esta APROVADO (mesma regra
// readOnly da tela interna). Token invalido => JOIN nao casa => DML nao afeta nada.
const TK_SRC = "PREENCHIMENTO_TOKEN tkk JOIN GESTOR_CR gck ON gck.GESTOR_ID = tkk.GESTOR_ID AND gck.CR_ID = " + crId;
const TK_COND = "tkk.TOKEN = ''" + token + "'' AND tkk.ATIVO = ''true''" +
  " AND NOT EXISTS (SELECT 1 FROM CICLO ckk WHERE ckk.ID = tkk.CICLO_ID AND ckk.STATUS = ''FECHADO'')" +
  " AND NOT EXISTS (SELECT 1 FROM (SELECT CICLO_ID, CR_ID, STATUS FROM ORCAMENTO_STATUS) osk" +
  " WHERE osk.CICLO_ID = tkk.CICLO_ID AND osk.CR_ID = " + crId + " AND osk.STATUS = ''APROVADO'')";

const dml = (sql) => runDmlMitra({ projectId, sql });

if (op === ''orcCells'') {
  // Upsert em lote de celulas do ORCAMENTO (delete + insert), com QUANTIDADE/VALOR_UNITARIO.
  const raw = Array.isArray(event.cells) ? event.cells : [];
  const cells = [];
  for (const c of raw) {
    const conta = Number(c.contaId), mes = Number(c.mes);
    if (Number.isInteger(conta) && Number.isInteger(mes) && mes >= 1 && mes <= 12) {
      cells.push({ conta, mes, val: num(c.valor), qtd: num(c.qtd), vu: num(c.vu) });
    }
  }
  if (cells.length === 0) return { ok: true, saved: 0 };
  const pairs = cells.map(c => ''('' + c.conta + '','' + c.mes + '')'').join('','');
  await dml("DELETE o FROM ORCAMENTO o" +
    " JOIN PREENCHIMENTO_TOKEN tkk ON tkk.CICLO_ID = o.CICLO_ID" +
    " JOIN GESTOR_CR gck ON gck.GESTOR_ID = tkk.GESTOR_ID AND gck.CR_ID = o.CR_ID" +
    " WHERE o.CR_ID = " + crId + " AND (o.CONTA_ID, o.MES) IN (" + pairs + ") AND " + TK_COND);
  const derived = cells.map(c => ''SELECT '' + c.conta + '' AS CONTA_ID, '' + c.mes + '' AS MES, '' + c.val + '' AS VALOR, '' + c.qtd + '' AS QUANTIDADE, '' + c.vu + '' AS VALOR_UNITARIO'').join('' UNION ALL '');
  await dml("INSERT INTO ORCAMENTO (CICLO_ID, CR_ID, CONTA_ID, MES, VALOR, QUANTIDADE, VALOR_UNITARIO)" +
    " SELECT tkk.CICLO_ID, " + crId + ", v.CONTA_ID, v.MES, v.VALOR, v.QUANTIDADE, v.VALOR_UNITARIO" +
    " FROM " + TK_SRC +
    " JOIN (" + derived + ") v" +
    " JOIN CR_CONTA crck ON crck.CR_ID = " + crId + " AND crck.CONTA_ID = v.CONTA_ID AND crck.ATIVO = true" +
    " WHERE " + TK_COND);
  return { ok: true, saved: cells.length };
}

if (op === ''formulaCells'') {
  // Upsert de valores de linha custom de formula (DRIVER_FORMULA_VALOR).
  const raw = Array.isArray(event.cells) ? event.cells : [];
  const cells = [];
  for (const c of raw) {
    const fid = Number(c.formulaId), mes = Number(c.mes);
    if (Number.isInteger(fid) && Number.isInteger(mes) && mes >= 1 && mes <= 12) cells.push({ fid, mes, val: num(c.valor) });
  }
  if (cells.length === 0) return { ok: true, saved: 0 };
  const pairs = cells.map(c => ''('' + c.fid + '','' + c.mes + '')'').join('','');
  await dml("DELETE fv FROM DRIVER_FORMULA_VALOR fv" +
    " JOIN PREENCHIMENTO_TOKEN tkk ON tkk.CICLO_ID = fv.CICLO_ID" +
    " JOIN GESTOR_CR gck ON gck.GESTOR_ID = tkk.GESTOR_ID AND gck.CR_ID = fv.CR_ID" +
    " WHERE fv.CR_ID = " + crId + " AND (fv.FORMULA_ID, fv.MES) IN (" + pairs + ") AND " + TK_COND);
  const derived = cells.map(c => ''SELECT '' + c.fid + '' AS FORMULA_ID, '' + c.mes + '' AS MES, '' + c.val + '' AS VALOR'').join('' UNION ALL '');
  await dml("INSERT INTO DRIVER_FORMULA_VALOR (FORMULA_ID, CICLO_ID, CR_ID, MES, VALOR)" +
    " SELECT v.FORMULA_ID, tkk.CICLO_ID, " + crId + ", v.MES, v.VALOR" +
    " FROM " + TK_SRC + " JOIN (" + derived + ") v WHERE " + TK_COND);
  return { ok: true, saved: cells.length };
}

if (op === ''histPremissa'') {
  const contaId = Number(event.contaId);
  if (!Number.isInteger(contaId)) return { ok: false, error: ''contaId_invalido'' };
  const pct = num(event.percentual);
  const modo = event.modo === ''igual'' ? ''igual'' : ''sazonalidade'';
  const just = esc(event.justificativa, 1000);
  await dml("DELETE hp FROM HIST_PREMISSA hp" +
    " JOIN PREENCHIMENTO_TOKEN tkk ON tkk.CICLO_ID = hp.CICLO_ID" +
    " JOIN GESTOR_CR gck ON gck.GESTOR_ID = tkk.GESTOR_ID AND gck.CR_ID = hp.CR_ID" +
    " WHERE hp.CR_ID = " + crId + " AND hp.CONTA_ID = " + contaId + " AND " + TK_COND);
  await dml("INSERT INTO HIST_PREMISSA (CICLO_ID, CR_ID, CONTA_ID, PERCENTUAL, MODO, JUSTIFICATIVA, CRIADO_EM)" +
    " SELECT tkk.CICLO_ID, " + crId + ", " + contaId + ", " + pct + ", ''" + modo + "'', ''" + just + "'', ''" + agora + "''" +
    " FROM " + TK_SRC + " WHERE " + TK_COND);
  return { ok: true };
}

if (op === ''aumentoUpsert'') {
  const colabId = Number(event.colaboradorId);
  if (!Number.isInteger(colabId)) return { ok: false, error: ''colaboradorId_invalido'' };
  const pct = num(event.percentual);
  const mesAp = Math.min(12, Math.max(1, intOr0(event.mesAplicacao) || 1));
  const motivo = esc(event.motivo, 500);
  // colaborador precisa pertencer ao CR do gestor
  await dml("DELETE a FROM AUMENTO_SALARIAL a" +
    " JOIN COLABORADOR cbk ON cbk.ID = a.COLABORADOR_ID AND cbk.CR_ID = " + crId +
    " JOIN PREENCHIMENTO_TOKEN tkk ON tkk.CICLO_ID = a.CICLO_ID" +
    " JOIN GESTOR_CR gck ON gck.GESTOR_ID = tkk.GESTOR_ID AND gck.CR_ID = " + crId +
    " WHERE a.COLABORADOR_ID = " + colabId + " AND " + TK_COND);
  await dml("INSERT INTO AUMENTO_SALARIAL (CICLO_ID, COLABORADOR_ID, PERCENTUAL, MES_APLICACAO, MOTIVO, CRIADO_EM)" +
    " SELECT tkk.CICLO_ID, " + colabId + ", " + pct + ", " + mesAp + ", ''" + motivo + "'', ''" + agora + "''" +
    " FROM " + TK_SRC +
    " JOIN COLABORADOR cbk ON cbk.ID = " + colabId + " AND cbk.CR_ID = " + crId +
    " WHERE " + TK_COND);
  return { ok: true };
}

if (op === ''aumentoDelete'') {
  const id = Number(event.id);
  if (!Number.isInteger(id)) return { ok: false, error: ''id_invalido'' };
  await dml("DELETE a FROM AUMENTO_SALARIAL a" +
    " JOIN COLABORADOR cbk ON cbk.ID = a.COLABORADOR_ID AND cbk.CR_ID = " + crId +
    " JOIN PREENCHIMENTO_TOKEN tkk ON tkk.CICLO_ID = a.CICLO_ID" +
    " JOIN GESTOR_CR gck ON gck.GESTOR_ID = tkk.GESTOR_ID AND gck.CR_ID = " + crId +
    " WHERE a.ID = " + id + " AND " + TK_COND);
  return { ok: true };
}

if (op === ''contratCreate'') {
  const cargoId = Number(event.cargoId);
  if (!Number.isInteger(cargoId)) return { ok: false, error: ''cargoId_invalido'' };
  const mesEnt = Math.min(12, Math.max(1, intOr0(event.mesEntrada) || 1));
  const qtd = Math.max(1, intOr0(event.qtdVagas) || 1);
  const motivo = esc(event.motivo, 200);
  await dml("INSERT INTO CONTRATACAO_PROJETADA (CICLO_ID, CR_ID, CARGO_ID, MES_ENTRADA, MOTIVO, QTD_VAGAS, CRIADO_EM)" +
    " SELECT tkk.CICLO_ID, " + crId + ", " + cargoId + ", " + mesEnt + ", ''" + motivo + "'', " + qtd + ", ''" + agora + "''" +
    " FROM " + TK_SRC + " WHERE " + TK_COND);
  return { ok: true };
}

if (op === ''contratDelete'') {
  const id = Number(event.id);
  if (!Number.isInteger(id)) return { ok: false, error: ''id_invalido'' };
  await dml("DELETE cp FROM CONTRATACAO_PROJETADA cp" +
    " JOIN PREENCHIMENTO_TOKEN tkk ON tkk.CICLO_ID = cp.CICLO_ID" +
    " JOIN GESTOR_CR gck ON gck.GESTOR_ID = tkk.GESTOR_ID AND gck.CR_ID = cp.CR_ID" +
    " WHERE cp.CR_ID = " + crId + " AND cp.ID = " + id + " AND " + TK_COND);
  return { ok: true };
}

if (op === ''pessoalRecalc'') {
  // Mesmo fluxo interno: limparFolha (SF 58) -> insert projecao (calculada no
  // cliente, identica a tela interna) -> limparOrcamento (SF 60) -> gravarOrcamento (SF 61).
  const raw = Array.isArray(event.records) ? event.records : [];
  const recs = [];
  for (const r of raw) {
    const mes = Number(r.MES);
    if (!Number.isInteger(mes) || mes < 1 || mes > 12) continue;
    const colab = r.COLABORADOR_ID == null ? ''NULL'' : intOr0(r.COLABORADOR_ID);
    recs.push({ colab, mes, sal: num(r.SALARIO), ben: num(r.BENEFICIOS), enc: num(r.ENCARGOS), tot: num(r.TOTAL) });
  }
  // 1) limpar folha (mesma SQL da SF 58, token-escopada)
  await dml("DELETE opk FROM ORCAMENTO_PESSOAL opk" +
    " JOIN PREENCHIMENTO_TOKEN tkk ON tkk.CICLO_ID = opk.CICLO_ID" +
    " JOIN GESTOR_CR gck ON gck.GESTOR_ID = tkk.GESTOR_ID AND gck.CR_ID = opk.CR_ID" +
    " WHERE opk.CR_ID = " + crId + " AND " + TK_COND);
  // 2) inserir projecao em chunks
  for (let i = 0; i < recs.length; i += 200) {
    const chunk = recs.slice(i, i + 200);
    const derived = chunk.map(r => ''SELECT '' + r.colab + '' AS COLABORADOR_ID, '' + r.mes + '' AS MES, '' + r.sal + '' AS SALARIO, '' + r.ben + '' AS BENEFICIOS, '' + r.enc + '' AS ENCARGOS, '' + r.tot + '' AS TOTAL'').join('' UNION ALL '');
    await dml("INSERT INTO ORCAMENTO_PESSOAL (CICLO_ID, CR_ID, COLABORADOR_ID, MES, SALARIO, BENEFICIOS, ENCARGOS, TOTAL)" +
      " SELECT tkk.CICLO_ID, " + crId + ", v.COLABORADOR_ID, v.MES, v.SALARIO, v.BENEFICIOS, v.ENCARGOS, v.TOTAL" +
      " FROM " + TK_SRC + " JOIN (" + derived + ") v WHERE " + TK_COND);
  }
  // 3) limpar contas de pessoal do ORCAMENTO (mesma SQL da SF 60, token-escopada)
  const CONTAS_PESSOAL = "SELECT DISTINCT dck.CONTA_ID FROM DRIVER_CONFIG dck JOIN CONTA_CONTABIL cck ON cck.ID = dck.CONTA_ID" +
    " WHERE dck.CR_ID = " + crId + " AND dck.DRIVER_TIPO = ''PESSOAL'' AND cck.CODIGO IN (''5.1.01'',''5.1.02'',''5.1.03'')";
  await dml("DELETE o FROM ORCAMENTO o" +
    " JOIN PREENCHIMENTO_TOKEN tkk ON tkk.CICLO_ID = o.CICLO_ID" +
    " JOIN GESTOR_CR gck ON gck.GESTOR_ID = tkk.GESTOR_ID AND gck.CR_ID = o.CR_ID" +
    " WHERE o.CR_ID = " + crId + " AND o.CONTA_ID IN (" + CONTAS_PESSOAL + ") AND " + TK_COND);
  // 4) regravar agregando da folha (mesma SQL da SF 61, token-escopada)
  await dml("INSERT INTO ORCAMENTO (CICLO_ID, CR_ID, CONTA_ID, MES, VALOR)" +
    " SELECT opk.CICLO_ID, opk.CR_ID, pc.CONTA_ID, opk.MES," +
    " ROUND(SUM(CASE pc.CODIGO WHEN ''5.1.01'' THEN opk.SALARIO WHEN ''5.1.02'' THEN opk.ENCARGOS WHEN ''5.1.03'' THEN opk.BENEFICIOS ELSE 0 END), 2)" +
    " FROM ORCAMENTO_PESSOAL opk" +
    " JOIN PREENCHIMENTO_TOKEN tkk ON tkk.CICLO_ID = opk.CICLO_ID" +
    " JOIN GESTOR_CR gck ON gck.GESTOR_ID = tkk.GESTOR_ID AND gck.CR_ID = opk.CR_ID" +
    " JOIN (SELECT DISTINCT dck.CONTA_ID, cck.CODIGO FROM DRIVER_CONFIG dck JOIN CONTA_CONTABIL cck ON cck.ID = dck.CONTA_ID" +
    " WHERE dck.CR_ID = " + crId + " AND dck.DRIVER_TIPO = ''PESSOAL'' AND cck.CODIGO IN (''5.1.01'',''5.1.02'',''5.1.03'')) pc ON 1 = 1" +
    " WHERE opk.CR_ID = " + crId + " AND " + TK_COND +
    " GROUP BY opk.CICLO_ID, opk.CR_ID, pc.CONTA_ID, pc.CODIGO, opk.MES");
  return { ok: true, inserted: recs.length };
}

if (op === ''confirmDriver'') {
  // Confirma/desfaz confirmacao de um modelo do CR: garante a linha em
  // ORCAMENTO_STATUS e grava o CSV de drivers confirmados. Todos confirmados e
  // PENDENTE -> CONFIRMADO; deixou de ter todos e CONFIRMADO -> volta a PENDENTE
  // (desfazer confirmacao); demais status (REPROVADO) sao preservados.
  const csv = String(event.driversCsv || '''').replace(/[^A-Za-z0-9_, -]/g, '''').slice(0, 500);
  const all = event.allConfirmed ? 1 : 0;
  await dml("INSERT INTO ORCAMENTO_STATUS (CICLO_ID, GESTOR_ID, CR_ID, STATUS, DRIVERS_CONFIRMADOS, ATUALIZADO_EM)" +
    " SELECT tkk.CICLO_ID, tkk.GESTOR_ID, " + crId + ", ''PENDENTE'', '''', ''" + agora + "''" +
    " FROM " + TK_SRC + " WHERE " + TK_COND +
    " AND NOT EXISTS (SELECT 1 FROM (SELECT CICLO_ID, CR_ID FROM ORCAMENTO_STATUS) s WHERE s.CICLO_ID = tkk.CICLO_ID AND s.CR_ID = " + crId + ")");
  await dml("UPDATE ORCAMENTO_STATUS os" +
    " JOIN PREENCHIMENTO_TOKEN tkk ON tkk.CICLO_ID = os.CICLO_ID" +
    " JOIN GESTOR_CR gck ON gck.GESTOR_ID = tkk.GESTOR_ID AND gck.CR_ID = os.CR_ID" +
    " SET os.DRIVERS_CONFIRMADOS = ''" + csv + "''," +
    " os.STATUS = CASE" +
    "   WHEN " + all + " = 1 AND os.STATUS = ''PENDENTE'' THEN ''CONFIRMADO''" +
    "   WHEN " + all + " = 0 AND os.STATUS = ''CONFIRMADO'' THEN ''PENDENTE''" +
    "   ELSE os.STATUS END," +
    " os.ATUALIZADO_EM = ''" + agora + "''" +
    " WHERE os.CR_ID = " + crId + " AND " + TK_COND);
  return { ok: true };
}

return { ok: false, error: ''op_desconhecida'' };', CODE), PUBLIC_EXECUTION = COALESCE(NULL, PUBLIC_EXECUTION), CRON_EXPRESSION = NULL, CRON_INPUT_JSON = NULL WHERE NAME = 'publicOrcWrite';
