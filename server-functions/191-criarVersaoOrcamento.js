-- tipo: JAVASCRIPT | Cria/duplica versao de orcamento em 1 chamada (fecha abertas, cria CICLO, mapa de status, copia premissas e, no modo duplicar, os dados). Idempotente contra duplo clique. Params: modo, nome, ano, ultimoMesRealizado, versaoControle, origemId, criadoPor

// Criacao/duplicacao de versao de orcamento — tudo server-side, set-based e idempotente.
const { runDmlMitra, executeServerFunctionMitra } = require('mitra-sdk');
const projectId = parseInt(process.env.MITRA_PROJECT_ID);
const q = async (sql) => {
  const r = await executeServerFunctionMitra({ projectId, serverFunctionId: 76, input: { sql } });
  let o = r && r.result ? r.result.output : null;
  if (typeof o === 'string') { try { o = JSON.parse(o); } catch (e) {} }
  return (o && o.rows) || [];
};
const dml = (sql) => runDmlMitra({ projectId, sql });
const esc = (s) => String(s == null ? '' : s).replace(/'/g, "''");

const modo = event.modo === 'duplicar' ? 'duplicar' : 'nova';
const nome = esc(String(event.nome || '').trim().slice(0, 200));
const ano = parseInt(event.ano);
if (!nome || !Number.isInteger(ano)) return { ok: false, error: 'params_invalidos' };
const umr = parseInt(event.ultimoMesRealizado) || 0;
const controle = (event.versaoControle === 'true' || event.versaoControle === true) ? 'true' : 'false';
const origemId = parseInt(event.origemId) || 0;
const criadoPor = esc(String(event.criadoPor || '').slice(0, 200));
const hoje = new Date().toISOString().slice(0, 10);
const agora = new Date().toISOString().slice(0, 19);

// Idempotencia: se ja existe uma versao ABERTA com o mesmo NOME+ANO (duplo clique),
// devolve a existente sem fechar/criar nada. Precisa ser o PRIMEIRO passo — se
// rodasse depois do fechamento, o segundo clique fecharia a versao do primeiro.
const dup = await q("SELECT ID FROM CICLO WHERE NOME = '" + nome + "' AND ANO = " + ano +
  " AND STATUS IN ('ABERTO','PENDENTE','INICIADA','REVISAO') LIMIT 1");
if (dup.length) return { ok: true, id: dup[0].ID, dedup: true };

// Fonte das premissas, em cadeia:
//   1. origem explicita (revisao/duplicacao), senao a versao atual;
//   2. se essa candidata estiver VAZIA (sem nenhuma premissa), cai para o ultimo
//      ciclo que tenha — assim duplicar uma versao antiga vazia nao gera uma nova
//      versao vazia. Como toda versao nova nasce com premissas, ela propria ja
//      vira fonte valida para a proxima e a corrente nao quebra.
// Precisa rodar ANTES do fechamento em massa abaixo (que zera VERSAO_ATUAL).
const TEM_PREMISSAS =
  "(EXISTS (SELECT 1 FROM BENEFICIO x WHERE x.CICLO_ID = c.ID)" +
  " OR EXISTS (SELECT 1 FROM ENCARGO x WHERE x.CICLO_ID = c.ID)" +
  " OR EXISTS (SELECT 1 FROM PREMISSA_LINHA x WHERE x.CICLO_ID = c.ID)" +
  " OR EXISTS (SELECT 1 FROM PREMISSA_IMPOSTO x WHERE x.CICLO_ID = c.ID))";

const atual = await q("SELECT ID FROM CICLO WHERE VERSAO_ATUAL = 'true' LIMIT 1");
let sourceId = origemId || (atual[0] && atual[0].ID) || 0;
let sourceFallback = false;
if (sourceId) {
  const temPrem = await q("SELECT c.ID FROM CICLO c WHERE c.ID = " + sourceId + " AND " + TEM_PREMISSAS + " LIMIT 1");
  if (!temPrem.length) sourceId = 0;
}
if (!sourceId) {
  const ultima = await q("SELECT c.ID FROM CICLO c WHERE " + TEM_PREMISSAS + " ORDER BY c.ANO DESC, c.ID DESC LIMIT 1");
  sourceId = (ultima[0] && ultima[0].ID) || 0;
  sourceFallback = sourceId > 0;
}

// Fechar versoes abertas + housekeeping (snapshot de completude e desativa tokens)
const abertas = await q("SELECT ID FROM CICLO WHERE STATUS IN ('ABERTO','PENDENTE','INICIADA','REVISAO')");
if (abertas.length) {
  const ids = abertas.map((v) => v.ID).join(',');
  await dml("UPDATE CICLO SET STATUS = 'FECHADO', VERSAO_ATUAL = 'false' WHERE ID IN (" + ids + ")");
  try { await executeServerFunctionMitra({ projectId, serverFunctionId: 170, input: { cicloIds: abertas.map((v) => v.ID) } }); } catch (e) {}
}
await dml("UPDATE CICLO SET VERSAO_ATUAL = 'false' WHERE VERSAO_ATUAL = 'true'");
if (controle === 'true') {
  await dml("UPDATE CICLO SET VERSAO_CONTROLE = 'false' WHERE ANO = " + ano + " AND VERSAO_CONTROLE = 'true'");
}

// Criar a nova versao. VERSAO_ORIGEM_ID grava a fonte EFETIVA das premissas
// (inclusive quando ela veio da versao atual ou do fallback), nao so a origem
// escolhida na tela — e isso que torna a corrente rastreavel versao a versao.
await dml("INSERT INTO CICLO (NOME, ANO, STATUS, VERSAO_ATUAL, ULTIMO_MES_REALIZADO, VERSAO_CONTROLE, CRIADO_EM, CRIADO_POR" +
  (sourceId ? ", VERSAO_ORIGEM_ID" : "") + ") VALUES ('" + nome + "', " + ano + ", 'PENDENTE', 'true', " + umr +
  ", '" + controle + "', '" + hoje + "', '" + criadoPor + "'" + (sourceId ? ", " + sourceId : "") + ")");
const novo = await q("SELECT ID FROM CICLO WHERE NOME = '" + nome + "' AND ANO = " + ano + " ORDER BY ID DESC LIMIT 1");
const novoId = novo[0] && novo[0].ID;
if (!novoId) return { ok: false, error: 'falha_criacao' };

// Mapa de status por gestor/CR e por pacote (workflow ja nasce completo)
try {
  await dml("INSERT INTO ORCAMENTO_STATUS (CICLO_ID, GESTOR_ID, CR_ID, STATUS, ATUALIZADO_EM) " +
    "SELECT " + novoId + ", g.ID, gc.CR_ID, 'PENDENTE', '" + agora + "' FROM GESTOR g JOIN GESTOR_CR gc ON gc.GESTOR_ID = g.ID WHERE g.ATIVO = 'true'");
} catch (e) {}
try {
  await dml("INSERT INTO PACOTE_STATUS (CICLO_ID, DRIVER_ID, GESTOR_ID, STATUS, ATUALIZADO_EM) " +
    "SELECT " + novoId + ", gp.DRIVER_ID, gp.GESTOR_ID, 'PENDENTE', '" + agora + "' FROM GESTOR_PACOTE gp JOIN DRIVERS d ON d.ID = gp.DRIVER_ID AND d.ATIVO = 'true' AND d.TIPO_DRIVER = 'PACOTE'");
} catch (e) {}

// Copiar premissas da fonte (set-based)
if (sourceId) {
  const copies = [
    "INSERT INTO BENEFICIO (NOME, TIPO, VALOR, PERCENTUAL, APLICA_PJ, APLICA_CLT, CICLO_ID) SELECT NOME, TIPO, VALOR, PERCENTUAL, APLICA_PJ, APLICA_CLT, " + novoId + " FROM BENEFICIO WHERE CICLO_ID = " + sourceId,
    "INSERT INTO ENCARGO (NOME, PERCENTUAL, APLICA_PJ, APLICA_CLT, CICLO_ID) SELECT NOME, PERCENTUAL, APLICA_PJ, APLICA_CLT, " + novoId + " FROM ENCARGO WHERE CICLO_ID = " + sourceId,
    "INSERT INTO PREMISSA_IMPOSTO (CICLO_ID, CONTA_ID, PERCENTUAL, CRIADO_EM) SELECT " + novoId + ", CONTA_ID, PERCENTUAL, '" + agora + "' FROM PREMISSA_IMPOSTO WHERE CICLO_ID = " + sourceId,
    "INSERT INTO PREMISSA_DISSIDIO (CICLO_ID, EMPRESA_ID, PERCENTUAL, MES_APLICACAO, CRIADO_EM) SELECT " + novoId + ", EMPRESA_ID, PERCENTUAL, MES_APLICACAO, '" + agora + "' FROM PREMISSA_DISSIDIO WHERE CICLO_ID = " + sourceId,
    "INSERT INTO PREMISSA_TURNOVER (CICLO_ID, EMPRESA_ID, PERCENTUAL, CRIADO_EM) SELECT " + novoId + ", EMPRESA_ID, PERCENTUAL, '" + agora + "' FROM PREMISSA_TURNOVER WHERE CICLO_ID = " + sourceId,
  ];
  for (const s of copies) { try { await dml(s); } catch (e) {} }
  // PREMISSA_LINHA precisa do novo ID por linha para religar PREMISSA_VALOR
  try {
    const linhas = await q("SELECT ID, NOME, ORDEM FROM PREMISSA_LINHA WHERE CICLO_ID = " + sourceId);
    for (const ln of linhas) {
      await dml("INSERT INTO PREMISSA_LINHA (CICLO_ID, NOME, ORDEM, CRIADO_EM) VALUES (" + novoId + ", '" + esc(ln.NOME) + "', " + (ln.ORDEM || 0) + ", '" + agora + "')");
      const nl = await q("SELECT ID FROM PREMISSA_LINHA WHERE CICLO_ID = " + novoId + " ORDER BY ID DESC LIMIT 1");
      if (nl[0]) await dml("INSERT INTO PREMISSA_VALOR (LINHA_ID, MES, VALOR) SELECT " + nl[0].ID + ", MES, VALOR FROM PREMISSA_VALOR WHERE LINHA_ID = " + ln.ID);
    }
  } catch (e) {}
}

// Duplicacao: copia tambem os dados de orcamento da versao de origem
if (modo === 'duplicar' && origemId) {
  const dcopies = [
    "INSERT INTO ORCAMENTO (CICLO_ID, CR_ID, CONTA_ID, MES, VALOR, QUANTIDADE, VALOR_UNITARIO) SELECT " + novoId + ", CR_ID, CONTA_ID, MES, VALOR, QUANTIDADE, VALOR_UNITARIO FROM ORCAMENTO WHERE CICLO_ID = " + origemId,
    "INSERT INTO ORCAMENTO_PACOTE (CICLO_ID, DRIVER_ID, CONTA_ID, CR_ID, MES, VALOR) SELECT " + novoId + ", DRIVER_ID, CONTA_ID, CR_ID, MES, VALOR FROM ORCAMENTO_PACOTE WHERE CICLO_ID = " + origemId,
    "INSERT INTO ORCAMENTO_PESSOAL (CICLO_ID, CR_ID, COLABORADOR_ID, MES, SALARIO, BENEFICIOS, ENCARGOS, TOTAL) SELECT " + novoId + ", CR_ID, COLABORADOR_ID, MES, SALARIO, BENEFICIOS, ENCARGOS, TOTAL FROM ORCAMENTO_PESSOAL WHERE CICLO_ID = " + origemId,
    "INSERT INTO DESLIGAMENTO_PROJETADO (CICLO_ID, CR_ID, COLABORADOR_ID, MES_DESLIGAMENTO, CRIADO_EM) SELECT " + novoId + ", CR_ID, COLABORADOR_ID, MES_DESLIGAMENTO, '" + agora + "' FROM DESLIGAMENTO_PROJETADO WHERE CICLO_ID = " + origemId,
    "INSERT INTO PROJECAO_HEADCOUNT (CICLO_ID, CR_ID, CARGO_ID, MES, QUANTIDADE) SELECT " + novoId + ", CR_ID, CARGO_ID, MES, QUANTIDADE FROM PROJECAO_HEADCOUNT WHERE CICLO_ID = " + origemId,
    "INSERT INTO HIST_PREMISSA (CICLO_ID, CR_ID, CONTA_ID, PERCENTUAL, MODO, JUSTIFICATIVA, CRIADO_EM) SELECT " + novoId + ", CR_ID, CONTA_ID, PERCENTUAL, MODO, COALESCE(JUSTIFICATIVA, ''), '" + agora + "' FROM HIST_PREMISSA WHERE CICLO_ID = " + origemId,
    "INSERT INTO AUMENTO_SALARIAL (CICLO_ID, COLABORADOR_ID, PERCENTUAL, MES_APLICACAO, MOTIVO, CRIADO_EM) SELECT " + novoId + ", COLABORADOR_ID, PERCENTUAL, MES_APLICACAO, MOTIVO, '" + agora + "' FROM AUMENTO_SALARIAL WHERE CICLO_ID = " + origemId,
    "INSERT INTO CONTRATACAO_PROJETADA (CICLO_ID, CR_ID, CARGO_ID, MES_ENTRADA, MOTIVO, QTD_VAGAS, JUSTIFICATIVA, CRIADO_EM) SELECT " + novoId + ", CR_ID, CARGO_ID, MES_ENTRADA, MOTIVO, QTD_VAGAS, JUSTIFICATIVA, '" + agora + "' FROM CONTRATACAO_PROJETADA WHERE CICLO_ID = " + origemId,
  ];
  for (const s of dcopies) { try { await dml(s); } catch (e) {} }
}

// Devolve a fonte efetiva das premissas para a tela poder ser transparente —
// principalmente quando houve fallback, que o usuario nao escolheu.
let origemNome = '';
if (sourceId) {
  try {
    const on = await q("SELECT NOME FROM CICLO WHERE ID = " + sourceId + " LIMIT 1");
    origemNome = (on[0] && on[0].NOME) || '';
  } catch (e) {}
}
return { ok: true, id: novoId, dedup: false, origemPremissasId: sourceId, origemPremissasNome: origemNome, origemFallback: sourceFallback };