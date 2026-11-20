// FUSAO DOS CONCEITOS: "pacote" passa a ser o proprio modelo de pacote
// (DRIVERS.ESCOPO='PACOTE'). A entidade antiga TIPO_DRIVER='PACOTE' deixa de
// existir — este script:
//  1) Regrava as SFs que filtravam TIPO_DRIVER='PACOTE' para usar ESCOPO='PACOTE'
//     (Governanca, kanban, preenchimento, versao, espelhos publicos).
//  2) Exclui modelos de pacote das contagens de modelos de CR (progress bottom-up)
//     — antes a exclusao era implicita porque a rota apontava para TIPO_DRIVER='PACOTE'.
//  3) excluirModelo passa a limpar tambem PACOTE_STATUS e DRIVER_FORMULA_VALOR
//     do pacote (higiene: nada fica sem conexao com o pacote ao excluir).
//  4) LIMPEZA GERAL dos pacotes antigos (TIPO_DRIVER='PACOTE') e de todos os dados
//     pendurados neles (status, vinculos de gestor, orcamento, rateios legados),
//     autorizada pelo usuario em 2026-07-15.
import 'dotenv/config';
import {
  configureSdkMitra, readServerFunctionMitra, updateServerFunctionMitra,
  runDmlMitra, runQueryMitra,
} from 'mitra-sdk';
function backUrlFromToken(token) { try { const raw = (token || '').replace(/^Bearer\s+/i, ''); const payload = JSON.parse(Buffer.from(raw.split('.')[1], 'base64').toString('utf8')); return payload.backURL || payload.backUrl; } catch { return null; } }
const baseURL = process.env.MITRA_BASE_URL || backUrlFromToken(process.env.MITRA_TOKEN);
configureSdkMitra({ baseURL, token: process.env.MITRA_TOKEN, integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS || baseURL });
const projectId = parseInt(process.env.MITRA_PROJECT_ID);
async function q(sql) { const r = await runQueryMitra({ projectId, sql }); return r.result?.rows || r; }
async function dml(sql) { await runDmlMitra({ projectId, sql }); }

// ── helpers de patch com verificacao ──────────────────────────────────────
function replaceExact(code, from, to, expected) {
  const count = code.split(from).length - 1;
  if (count !== expected) throw new Error(`padrao "${from}" encontrado ${count}x (esperado ${expected})`);
  return code.split(from).join(to);
}

const EXCL = ` AND COALESCE(d.ESCOPO,'CR') <> 'PACOTE'`;

// [sfId, descricao, (code) => newCode]
const SF_PATCHES = [
  [110, 'hotPreenchPacotes: pacotes do gestor por ESCOPO', (c) =>
    replaceExact(c, `d.TIPO_DRIVER = 'PACOTE'`, `d.ESCOPO = 'PACOTE'`, 1)],
  [121, 'hotKanbanMount: PACOTES/PKG_TOTAIS por ESCOPO + MODELOS exclui pacote', (c) => {
    c = replaceExact(c, `d.TIPO_DRIVER='PACOTE'`, `d.ESCOPO='PACOTE'`, 2);
    c = replaceExact(c, `AND d.TIPO_DRIVER='NORMAL'`, `AND d.TIPO_DRIVER='NORMAL' AND COALESCE(d.ESCOPO,'CR')<>'PACOTE'`, 1);
    return c;
  }],
  [124, 'hotOrcBase: PACOTE_DRIVERS por ESCOPO', (c) =>
    replaceExact(c, `d.TIPO_DRIVER = 'PACOTE'`, `d.ESCOPO = 'PACOTE'`, 1)],
  [130, 'hotGestoresBase: GESTOR_PACOTES/PACOTES por ESCOPO', (c) =>
    replaceExact(c, `d.TIPO_DRIVER = 'PACOTE'`, `d.ESCOPO = 'PACOTE'`, 2)],
  [142, 'publicHotOrcBase: PACOTE_DRIVERS por ESCOPO', (c) =>
    replaceExact(c, `d.TIPO_DRIVER = 'PACOTE'`, `d.ESCOPO = 'PACOTE'`, 1)],
  [191, 'criarVersaoOrcamento: PACOTE_STATUS da nova versao por ESCOPO', (c) =>
    replaceExact(c, `d.TIPO_DRIVER = 'PACOTE'`, `d.ESCOPO = 'PACOTE'`, 1)],
  [138, 'hotOrcamentoStatus: MODELOS exclui modelos de pacote', (c) =>
    replaceExact(c, `AND d.TIPO_DRIVER = 'NORMAL'`, `AND d.TIPO_DRIVER = 'NORMAL'${EXCL}`, 1)],
  [95, 'kanbanModelosPorCiclo: exclui modelos de pacote', (c) =>
    replaceExact(c, `AND d.TIPO_DRIVER = 'NORMAL'`, `AND d.TIPO_DRIVER = 'NORMAL'${EXCL}`, 1)],
  [139, 'publicHome: contagem de modelos de CR exclui pacote', (c) =>
    replaceExact(c, `AND d.TIPO_DRIVER = 'NORMAL'`, `AND d.TIPO_DRIVER = 'NORMAL'${EXCL}`, 1)],
  [170, 'fecharVersaoHousekeeping: TOTAL_MODELOS de CR exclui pacote', (c) =>
    replaceExact(c, `AND d.TIPO_DRIVER = 'NORMAL'`, `AND d.TIPO_DRIVER = 'NORMAL'${EXCL}`, 1)],
  [175, 'excluirModelo: limpa PACOTE_STATUS e DRIVER_FORMULA_VALOR do pacote', (c) =>
    replaceExact(
      c,
      `await dml("DELETE FROM GESTOR_PACOTE WHERE DRIVER_ID = " + id);`,
      `await dml("DELETE FROM GESTOR_PACOTE WHERE DRIVER_ID = " + id);\n  await dml("DELETE FROM PACOTE_STATUS WHERE DRIVER_ID = " + id);\n  await dml("DELETE FROM DRIVER_FORMULA_VALOR WHERE PACOTE_ID = " + id);`,
      1
    )],
];

// Marcadores de idempotencia: se o codigo ja contem o resultado do patch, pula.
const DONE_MARKERS = {
  110: `d.ESCOPO = 'PACOTE'`, 121: `d.ESCOPO='PACOTE'`, 124: `d.ESCOPO = 'PACOTE'`,
  130: `d.ESCOPO = 'PACOTE'`, 142: `d.ESCOPO = 'PACOTE'`, 191: `d.ESCOPO = 'PACOTE'`,
  138: `COALESCE(d.ESCOPO,'CR')`, 95: `COALESCE(d.ESCOPO,'CR')`, 139: `COALESCE(d.ESCOPO,'CR')`,
  170: `COALESCE(d.ESCOPO,'CR')`, 175: `DELETE FROM PACOTE_STATUS WHERE DRIVER_ID`,
};

console.log('── 1/2: atualizando Server Functions ──');
for (const [id, desc, patch] of SF_PATCHES) {
  const fn = await readServerFunctionMitra({ projectId, serverFunctionId: id });
  const code = fn.result?.code;
  if (!code) throw new Error(`SF ${id} sem codigo`);
  if (code.includes(DONE_MARKERS[id])) { console.log(`SF ${id}: ja migrada, pulando`); continue; }
  const novo = patch(code);
  await updateServerFunctionMitra({ projectId, serverFunctionId: id, code: novo });
  console.log(`SF ${id} OK — ${desc}`);
}

console.log('── 2/2: limpeza geral dos pacotes antigos (TIPO_DRIVER=PACOTE) ──');
const antigos = await q(`SELECT ID, NOME, ATIVO FROM DRIVERS WHERE TIPO_DRIVER = 'PACOTE'`);
if (antigos.length === 0) {
  console.log('Nenhum pacote antigo encontrado.');
} else {
  const ids = antigos.map((r) => r.ID).join(',');
  console.log('Pacotes antigos:', antigos.map((r) => `${r.ID}=${r.NOME}(ativo=${r.ATIVO})`).join(', '));
  const counts = {};
  for (const [label, sql] of [
    ['PACOTE_STATUS', `SELECT COUNT(*) AS N FROM PACOTE_STATUS WHERE DRIVER_ID IN (${ids})`],
    ['GESTOR_PACOTE', `SELECT COUNT(*) AS N FROM GESTOR_PACOTE WHERE DRIVER_ID IN (${ids})`],
    ['ORCAMENTO_PACOTE', `SELECT COUNT(*) AS N FROM ORCAMENTO_PACOTE WHERE DRIVER_ID IN (${ids})`],
    ['RATEIO_CONFIG', `SELECT COUNT(*) AS N FROM RATEIO_CONFIG WHERE DRIVER_ID IN (${ids})`],
    ['DRIVER_FORMULA_VALOR (PACOTE_ID)', `SELECT COUNT(*) AS N FROM DRIVER_FORMULA_VALOR WHERE PACOTE_ID IN (${ids})`],
    ['CONTA_DRIVER.PACOTE_ID', `SELECT COUNT(*) AS N FROM CONTA_DRIVER WHERE PACOTE_ID IN (${ids})`],
    ['CONTA_DRIVER_EXCECAO.PACOTE_ID', `SELECT COUNT(*) AS N FROM CONTA_DRIVER_EXCECAO WHERE PACOTE_ID IN (${ids})`],
    ['CONTA_DRIVER.DRIVER_ID (legado)', `SELECT COUNT(*) AS N FROM CONTA_DRIVER WHERE DRIVER_ID IN (${ids})`],
  ]) {
    counts[label] = Number((await q(sql))[0]?.N || 0);
  }
  console.log('Dados pendurados a remover/desvincular:', JSON.stringify(counts));

  await dml(`DELETE FROM PACOTE_STATUS WHERE DRIVER_ID IN (${ids})`);
  await dml(`DELETE FROM GESTOR_PACOTE WHERE DRIVER_ID IN (${ids})`);
  await dml(`DELETE FROM ORCAMENTO_PACOTE WHERE DRIVER_ID IN (${ids})`);
  await dml(`DELETE FROM RATEIO_CR WHERE RATEIO_CONFIG_ID IN (SELECT ID FROM RATEIO_CONFIG WHERE DRIVER_ID IN (${ids}))`);
  await dml(`DELETE FROM RATEIO_CONFIG WHERE DRIVER_ID IN (${ids})`);
  await dml(`DELETE FROM DRIVER_FORMULA_VALOR WHERE PACOTE_ID IN (${ids})`);
  // contas que apontavam a rota para o pacote antigo: mantem o modelo (DRIVER_ID)
  // e voltam para rota CR — o usuario reencaminha para os novos pacotes
  await dml(`UPDATE CONTA_DRIVER SET PACOTE_ID = NULL WHERE PACOTE_ID IN (${ids})`);
  await dml(`UPDATE CONTA_DRIVER_EXCECAO SET PACOTE_ID = NULL WHERE PACOTE_ID IN (${ids})`);
  // formato legado (rota gravada em DRIVER_ID): remove o vinculo
  await dml(`DELETE FROM CONTA_DRIVER WHERE DRIVER_ID IN (${ids})`);
  await dml(`DELETE FROM CONTA_DRIVER_EXCECAO WHERE DRIVER_ID IN (${ids})`);
  // residuos defensivos
  await dml(`DELETE FROM DRIVER_CONFIG WHERE DRIVER_ID IN (${ids})`);
  await dml(`DELETE FROM DRIVERS WHERE ID IN (${ids})`);
  console.log('Pacotes antigos e dados dependentes removidos.');
}

// PACOTE_ID legado que sobrou apontando pra qualquer coisa (coluna deprecada)
await dml(`UPDATE CONTA_DRIVER SET PACOTE_ID = NULL WHERE PACOTE_ID IS NOT NULL`);
await dml(`UPDATE CONTA_DRIVER_EXCECAO SET PACOTE_ID = NULL WHERE PACOTE_ID IS NOT NULL`);

console.log('Fusao concluida.');
