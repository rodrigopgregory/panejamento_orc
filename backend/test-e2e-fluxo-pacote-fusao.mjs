// PENTE FINO — ciclo completo do fluxo de pacote (conceito fundido), replicando
// exatamente as operacoes que a UI executa em cada tela:
//   1. Cria rateio (aba Tipos de Rateio) com quantidades por CR
//   2. Cria pacote com responsavel (Modelagem > Pacotes > Novo pacote)
//   3. Roteia contas ao pacote (Mapeamento, rota Pacote > coluna Driver) + linhas
//   4. Configura linhas (editor): granular por CR, rateio aplicado, input de total
//   5. Confere visao do gestor (SF 130 governanca, 121 kanban, 126 detalhe, 110)
//   6. Preenche (ORCAMENTO_PACOTE granular + distribuicao por rateio + SF 200)
//   7. Confere PKG_FILLED, submete (SF 171), confere DRE gateado, aprova
//   8. LIMPA tudo e restaura o estado anterior das contas
// + FIX definitivo: conta 33 (Despesas com Software) roteada ao pacote TESTE (24)
//   — estava so na linha do pacote, sem rota (descasamento reportado).
import 'dotenv/config';
import { configureSdkMitra, runQueryMitra, runDmlMitra, executeServerFunctionMitra } from 'mitra-sdk';
function backUrlFromToken(token) { try { const raw = (token || '').replace(/^Bearer\s+/i, ''); const payload = JSON.parse(Buffer.from(raw.split('.')[1], 'base64').toString('utf8')); return payload.backURL || payload.backUrl; } catch { return null; } }
const baseURL = process.env.MITRA_BASE_URL || backUrlFromToken(process.env.MITRA_TOKEN);
configureSdkMitra({ baseURL, token: process.env.MITRA_TOKEN, integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS || baseURL });
const projectId = parseInt(process.env.MITRA_PROJECT_ID);
const q = async (sql) => { const r = await runQueryMitra({ projectId, sql }); return r.result?.rows || []; };
const dml = async (sql) => { await runDmlMitra({ projectId, sql }); };
const sf = async (id, input = {}) => {
  const r = await executeServerFunctionMitra({ projectId, serverFunctionId: id, input });
  if (r.result?.executionStatus !== 'COMPLETED') throw new Error(`SF ${id} FAILED: ${r.result?.error}`);
  return r.result?.output;
};
const jblock = (row, key) => { try { return JSON.parse(row?.[key] || '[]'); } catch { return []; } };

const CICLO = 132;       // Revisao Orcamento (INICIADA)
const GESTOR = 2;        // Ana Beatriz Silva
const CONTA_A = 19;      // Publicidade e Marketing — linha granular por CR
const CONTA_B = 20;      // Eventos e Feiras — linha com rateio aplicado
const agora = () => new Date().toISOString().slice(0, 19);

const results = [];
const check = (nome, ok, detalhe = '') => {
  results.push({ nome, ok, detalhe });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${nome}${detalhe ? ' — ' + detalhe : ''}`);
};

// Snapshot do estado a restaurar
const rotasOriginais = await q(`SELECT ID, CONTA_ID, DRIVER_ID FROM CONTA_DRIVER WHERE CONTA_ID IN (${CONTA_A}, ${CONTA_B})`);

let pkgId = null, rateioId = null;
const criados = { linhas: [], rateioItens: [] };

try {
  // ── 0. FIX descasamento TESTE: conta 33 roteada ao pacote 24 (linha ja existe) ──
  const cd33 = await q(`SELECT ID FROM CONTA_DRIVER WHERE CONTA_ID = 33`);
  if (cd33.length === 0) {
    await dml(`INSERT INTO CONTA_DRIVER (CONTA_ID, DRIVER_ID, PACOTE_ID, CRIADO_EM) VALUES (33, 24, NULL, '${agora()}')`);
  } else {
    await dml(`UPDATE CONTA_DRIVER SET DRIVER_ID = 24, PACOTE_ID = NULL WHERE CONTA_ID = 33`);
  }
  const fix33 = await q(`SELECT cd.DRIVER_ID FROM CONTA_DRIVER cd WHERE cd.CONTA_ID = 33`);
  check('FIX: conta Software (33) roteada ao pacote TESTE', Number(fix33[0]?.DRIVER_ID) === 24);

  // ── 1. Criar rateio por quantidade (aba Tipos de Rateio) ──
  await dml(`INSERT INTO RATEIO (NOME, DESCRICAO, TIPO, ATIVO, CRIADO_EM) VALUES ('E2E_RATEIO_PENTE_FINO', 'teste automatizado', 'QUANTIDADE', true, '${agora()}')`);
  rateioId = Number((await q(`SELECT ID FROM RATEIO WHERE NOME = 'E2E_RATEIO_PENTE_FINO'`))[0].ID);
  // quantidades pelos CRs da conta B (1, 6, 7, 8): pesos 10/20/30/40
  const pesos = new Map([[1, 10], [6, 20], [7, 30], [8, 40]]);
  for (const [cr, qt] of pesos) {
    await dml(`INSERT INTO RATEIO_ITEM (RATEIO_ID, CR_ID, QUANTIDADE) VALUES (${rateioId}, ${cr}, ${qt})`);
  }
  criados.rateioItens = (await q(`SELECT ID FROM RATEIO_ITEM WHERE RATEIO_ID = ${rateioId}`)).map(r => r.ID);
  check('1. Rateio criado com 4 itens', criados.rateioItens.length === 4, `rateioId=${rateioId}`);

  // ── 2. Criar pacote com responsavel (Modelagem > Novo pacote) ──
  await dml(`INSERT INTO DRIVERS (NOME, DESCRICAO, COR, ATIVO, CRIADO_EM, TIPO_DRIVER, ORIGEM, ESCOPO)
             VALUES ('E2E_PACOTE_PENTE_FINO', 'teste automatizado', 'info', 'true', '${agora()}', 'NORMAL', 'TELA', 'PACOTE')`);
  pkgId = Number((await q(`SELECT ID FROM DRIVERS WHERE NOME = 'E2E_PACOTE_PENTE_FINO'`))[0].ID);
  await dml(`INSERT INTO GESTOR_PACOTE (GESTOR_ID, DRIVER_ID) VALUES (${GESTOR}, ${pkgId})`);
  await dml(`INSERT INTO PACOTE_STATUS (CICLO_ID, DRIVER_ID, GESTOR_ID, STATUS, ATUALIZADO_EM) VALUES (${CICLO}, ${pkgId}, ${GESTOR}, 'PENDENTE', '${agora()}')`);
  check('2. Pacote criado com responsavel e status no ciclo aberto', pkgId > 0, `pkgId=${pkgId}`);

  // ── 3. Rotear contas ao pacote (Mapeamento) + linhas automaticas ──
  for (const conta of [CONTA_A, CONTA_B]) {
    await dml(`UPDATE CONTA_DRIVER SET DRIVER_ID = ${pkgId}, PACOTE_ID = NULL WHERE CONTA_ID = ${conta}`);
  }
  // linhas espelhando o editor/sync: A granular por CR (L1), B rateio (L2), custom total (L3)
  await dml(`INSERT INTO DRIVER_FORMULA (DRIVER_ID, CONTA_ID, TIPO, FORMULA, ORDEM, ESCONDER, NEGRITO, FORMATO, GRANULARIDADE, RATEIO_ID, CODIGO)
             VALUES (${pkgId}, ${CONTA_A}, 'INPUT', '', 1, false, false, 'MONETARIO', 'CR', NULL, 'L1')`);
  await dml(`INSERT INTO DRIVER_FORMULA (DRIVER_ID, CONTA_ID, TIPO, FORMULA, ORDEM, ESCONDER, NEGRITO, FORMATO, GRANULARIDADE, RATEIO_ID, CODIGO)
             VALUES (${pkgId}, ${CONTA_B}, 'INPUT', '', 2, false, false, 'MONETARIO', NULL, ${rateioId}, 'L2')`);
  await dml(`INSERT INTO DRIVER_FORMULA (DRIVER_ID, CONTA_ID, TIPO, FORMULA, ORDEM, ESCONDER, NEGRITO, FORMATO, GRANULARIDADE, RATEIO_ID, CODIGO, NOME_CUSTOM)
             VALUES (${pkgId}, NULL, 'INPUT', '', 3, false, false, 'SEM_PREFIXO', NULL, NULL, 'L3', 'Premissa de teste')`);
  criados.linhas = (await q(`SELECT ID, CODIGO FROM DRIVER_FORMULA WHERE DRIVER_ID = ${pkgId} ORDER BY ORDEM`)).map(r => ({ id: Number(r.ID), codigo: r.CODIGO }));
  const rotas = await q(`SELECT COUNT(*) AS N FROM CONTA_DRIVER WHERE DRIVER_ID = ${pkgId}`);
  check('3. Contas roteadas ao pacote + 3 linhas configuradas', Number(rotas[0].N) === 2 && criados.linhas.length === 3);

  // ── 4. Governanca ve o pacote e o vinculo (SF 130) ──
  const gov = (await sf(130)).rows[0];
  const govPacotes = jblock(gov, 'PACOTES');
  const govLinks = jblock(gov, 'GESTOR_PACOTES');
  check('4. Governanca lista o pacote e o vinculo do responsavel',
    govPacotes.some(p => p.ID === pkgId) && govLinks.some(l => l.DRIVER_ID === pkgId && l.GESTOR_ID === GESTOR));

  // ── 5. Visao do gestor: kanban (SF 121) + pacotes do gestor (SF 110) ──
  const kb = (await sf(121, { cicloId: CICLO, gestorId: GESTOR, ano: 2026 })).rows[0];
  const kbPacotes = jblock(kb, 'PACOTES');
  const kbTotais = jblock(kb, 'PKG_TOTAIS');
  const totalPares = kbTotais.find(t => t.DRIVER_ID === pkgId)?.TOTAL;
  check('5a. Kanban do gestor mostra o card do pacote', kbPacotes.some(p => p.ID === pkgId));
  check('5b. PKG_TOTAIS conta os pares conta x CR (5 + 4 = 9)', Number(totalPares) === 9, `TOTAL=${totalPares}`);
  const meus = (await sf(110, { gestorId: GESTOR })).rows;
  check('5c. SF de pacotes do gestor lista o pacote', meus.some(p => Number(p.ID) === pkgId));

  // ── 6. Detalhe do pacote (SF 126): pares, rateios e status ──
  const det = (await sf(126, { pkgId, cicloId: CICLO, ano: 2026, anoPrev: 2025, controlCicloId: 0 })).rows[0];
  const cfgs = jblock(det, 'CONFIGS');
  const detRateios = jblock(det, 'RATEIOS');
  const detItens = jblock(det, 'RATEIO_ITENS');
  const paresA = cfgs.filter(c => c.CONTA_ID === CONTA_A).length;
  const paresB = cfgs.filter(c => c.CONTA_ID === CONTA_B).length;
  check('6a. Detalhe traz pares por conta (A=5 CRs, B=4 CRs)', paresA === 5 && paresB === 4, `A=${paresA} B=${paresB}`);
  check('6b. Detalhe traz o rateio novo com itens', detRateios.some(r => Number(r.ID) === rateioId) && detItens.filter(i => Number(i.RATEIO_ID) === rateioId).length === 4);

  // ── 7. Preencher como gestor ──
  // L1 granular: valores diretos por CR da conta A no mes 1
  const crsA = [1, 2, 3, 6, 7];
  let somaA = 0;
  for (let i = 0; i < crsA.length; i++) {
    const v = (i + 1) * 1000; somaA += v;
    await dml(`INSERT INTO ORCAMENTO_PACOTE (CICLO_ID, DRIVER_ID, CR_ID, CONTA_ID, MES, VALOR) VALUES (${CICLO}, ${pkgId}, ${crsA[i]}, ${CONTA_A}, 1, ${v})`);
  }
  // L2 rateio: total 12000 distribuido pelos shares renormalizados (CRs validos da conta B)
  const totalB = 12000;
  const validB = [1, 6, 7, 8];
  const somaPesos = validB.reduce((s, cr) => s + pesos.get(cr), 0);
  let usado = 0;
  for (let i = 0; i < validB.length; i++) {
    const cr = validB[i];
    const v = i === validB.length - 1 ? totalB - usado : Math.round(totalB * (pesos.get(cr) / somaPesos));
    usado += i < validB.length - 1 ? v : 0;
    await dml(`INSERT INTO ORCAMENTO_PACOTE (CICLO_ID, DRIVER_ID, CR_ID, CONTA_ID, MES, VALOR) VALUES (${CICLO}, ${pkgId}, ${cr}, ${CONTA_B}, 1, ${v})`);
  }
  const somaB = (await q(`SELECT SUM(VALOR) AS S FROM ORCAMENTO_PACOTE WHERE DRIVER_ID = ${pkgId} AND CONTA_ID = ${CONTA_B}`))[0].S;
  check('7a. Distribuicao por rateio fecha exatamente no total digitado', Number(somaB) === totalB, `soma=${somaB}`);
  // L3 valor unico da linha custom via SF 200 (mesma chamada do grid)
  const l3 = criados.linhas.find(l => l.codigo === 'L3');
  await sf(200, { formulaId: l3.id, cicloId: CICLO, pacoteId: pkgId, crId: 0, mes: 1, valor: 500 });
  const clv = await q(`SELECT VALOR FROM DRIVER_FORMULA_VALOR WHERE FORMULA_ID = ${l3.id} AND PACOTE_ID = ${pkgId} AND CICLO_ID = ${CICLO}`);
  check('7b. Valor unico da linha custom gravado via SF 200', Number(clv[0]?.VALOR) === 500);

  // ── 8. Progresso reflete o preenchimento (PKG_FILLED) ──
  const kb2 = (await sf(121, { cicloId: CICLO, gestorId: GESTOR, ano: 2026 })).rows[0];
  const filled = jblock(kb2, 'PKG_FILLED').find(f => f.DRIVER_ID === pkgId)?.FILLED;
  check('8. PKG_FILLED conta os 9 pares lancados', Number(filled) === 9, `FILLED=${filled}`);

  // ── 9. DRE ANTES de submeter: valores do pacote NAO aparecem (gate por status) ──
  const dreAntes = (await sf(86, { cicloId: CICLO, crIds: '', contaIds: `${CONTA_A},${CONTA_B}` })).rows;
  const somaAntes = dreAntes.reduce((s, r) => s + Number(r.VALOR || 0), 0);
  check('9. DRE nao mostra pacote PENDENTE (gate por status)', somaAntes === 0, `soma=${somaAntes}`);

  // ── 10. Submeter (SF 171 — mesma chamada do botao Submeter) ──
  let out171 = await sf(171, { tipo: 'PACOTE', cicloId: CICLO, driverId: pkgId, gestorId: GESTOR, acao: 'SUBMETIDO', autor: 'Pente Fino E2E', notificar: false });
  if (typeof out171 === 'string') out171 = JSON.parse(out171);
  const st1 = await q(`SELECT STATUS FROM PACOTE_STATUS WHERE CICLO_ID = ${CICLO} AND DRIVER_ID = ${pkgId}`);
  check('10a. Submissao valida e status vira SUBMETIDO', out171?.ok === true && st1[0]?.STATUS === 'SUBMETIDO', JSON.stringify(out171));
  const aud = await q(`SELECT EVENTO, STATUS_DE, STATUS_PARA FROM WORKFLOW_AUDITORIA WHERE DRIVER_ID = ${pkgId} AND CICLO_ID = ${CICLO}`);
  check('10b. Auditoria registra a transicao PENDENTE -> SUBMETIDO', aud.some(a => a.STATUS_PARA === 'SUBMETIDO'));

  // ── 11. DRE DEPOIS de submeter: valores aparecem ──
  const dreDepois = (await sf(86, { cicloId: CICLO, crIds: '', contaIds: `${CONTA_A},${CONTA_B}` })).rows;
  const somaDepois = dreDepois.reduce((s, r) => s + Number(r.VALOR || 0), 0);
  check('11. DRE mostra os valores apos submissao', somaDepois === somaA + totalB, `soma=${somaDepois} esperado=${somaA + totalB}`);

  // ── 12. Aprovar ──
  let outAprov = await sf(171, { tipo: 'PACOTE', cicloId: CICLO, driverId: pkgId, gestorId: GESTOR, acao: 'APROVADO', autor: 'Pente Fino E2E', notificar: false });
  if (typeof outAprov === 'string') outAprov = JSON.parse(outAprov);
  const st2 = await q(`SELECT STATUS FROM PACOTE_STATUS WHERE CICLO_ID = ${CICLO} AND DRIVER_ID = ${pkgId}`);
  check('12. Aprovacao valida e status vira APROVADO', outAprov?.ok === true && st2[0]?.STATUS === 'APROVADO');

  // ── 13. Transicao invalida e barrada (PENDENTE <- APROVADO nao permitido sem reprovar) ──
  let outInv = await sf(171, { tipo: 'PACOTE', cicloId: CICLO, driverId: pkgId, gestorId: GESTOR, acao: 'PENDENTE', autor: 'Pente Fino E2E', notificar: false });
  if (typeof outInv === 'string') outInv = JSON.parse(outInv);
  check('13. Maquina de estados barra transicao invalida', outInv?.ok === false, JSON.stringify(outInv));
} catch (e) {
  check('EXECUCAO SEM ERRO FATAL', false, String(e.message || e).slice(0, 300));
} finally {
  // ── LIMPEZA TOTAL: remove artefatos do teste e restaura as contas ──
  console.log('\n── limpeza ──');
  try {
    if (pkgId) {
      await dml(`DELETE FROM WORKFLOW_AUDITORIA WHERE DRIVER_ID = ${pkgId}`);
      await dml(`DELETE FROM DRIVER_FORMULA_VALOR WHERE PACOTE_ID = ${pkgId}`);
      await dml(`DELETE FROM ORCAMENTO_PACOTE WHERE DRIVER_ID = ${pkgId}`);
      await dml(`DELETE FROM PACOTE_STATUS WHERE DRIVER_ID = ${pkgId}`);
      await dml(`DELETE FROM GESTOR_PACOTE WHERE DRIVER_ID = ${pkgId}`);
      await dml(`DELETE FROM DRIVER_FORMULA WHERE DRIVER_ID = ${pkgId}`);
      for (const r of rotasOriginais) {
        await dml(`UPDATE CONTA_DRIVER SET DRIVER_ID = ${r.DRIVER_ID}, PACOTE_ID = NULL WHERE ID = ${r.ID}`);
      }
      await dml(`DELETE FROM DRIVERS WHERE ID = ${pkgId}`);
    }
    if (rateioId) {
      await dml(`DELETE FROM RATEIO_ITEM WHERE RATEIO_ID = ${rateioId}`);
      await dml(`DELETE FROM RATEIO WHERE ID = ${rateioId}`);
    }
    const sobra = await q(`SELECT
      (SELECT COUNT(*) FROM DRIVERS WHERE NOME LIKE 'E2E_%') +
      (SELECT COUNT(*) FROM RATEIO WHERE NOME LIKE 'E2E_%') +
      (SELECT COUNT(*) FROM ORCAMENTO_PACOTE WHERE DRIVER_ID = ${pkgId ?? -1}) AS N`);
    const rotasRestauradas = await q(`SELECT CONTA_ID, DRIVER_ID FROM CONTA_DRIVER WHERE CONTA_ID IN (${CONTA_A}, ${CONTA_B})`);
    const okRestore = rotasRestauradas.every(r => rotasOriginais.some(o => o.CONTA_ID === r.CONTA_ID && Number(o.DRIVER_ID) === Number(r.DRIVER_ID)));
    check('LIMPEZA: zero artefatos de teste e rotas restauradas', Number(sobra[0].N) === 0 && okRestore);
  } catch (e) {
    check('LIMPEZA', false, String(e.message || e).slice(0, 200));
  }
}

const fails = results.filter(r => !r.ok);
console.log(`\n===== ${results.length - fails.length}/${results.length} checks passaram =====`);
if (fails.length) { console.log('FALHAS:', fails.map(f => f.nome).join(' | ')); process.exit(1); }
