// Teste E2E do fluxo de submissao/aprovacao — roda contra o endpoint publico
// real (sem auth, como o navegador do gestor) + DML direto simulando o aprovador
// (mesmo efeito do patchRecordMitra que a UI usa). Restaura tudo ao final.
import 'dotenv/config';
import { configureSdkMitra, executeServerFunctionMitra, runDmlMitra } from 'mitra-sdk';
configureSdkMitra({ baseURL: process.env.MITRA_BASE_URL, token: process.env.MITRA_TOKEN, integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS });
const projectId = parseInt(process.env.MITRA_PROJECT_ID);

const q = async (sql) => {
  const r = await executeServerFunctionMitra({ projectId, serverFunctionId: 76, input: { sql } });
  let o = r?.result?.output; if (typeof o === 'string') o = JSON.parse(o);
  return o?.rows || [];
};
const base = 'https://newmitra.mitrasheet.com:8080';
const pub = async (sfId, input) => {
  const res = await fetch(`${base}/public/serverFunction/${projectId}/${sfId}/execute`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  const j = await res.json();
  let o = j?.result?.output ?? j?.output; if (typeof o === 'string') { try { o = JSON.parse(o); } catch { } }
  return o;
};

const auditMaxBefore = Number((await q(`SELECT COALESCE(MAX(ID), 0) AS M FROM WORKFLOW_AUDITORIA`))[0]?.M || 0);

let pass = 0, fail = 0;
const check = (nome, cond, detalhe) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${nome}${detalhe ? ' | ' + detalhe : ''}`);
  cond ? pass++ : fail++;
};

// ── setup: CR SUBMETIDO no ciclo INICIADA com token ativo (CR002 do turno anterior)
const tk = (await q(`SELECT t.TOKEN, t.CICLO_ID, os.CR_ID, os.ID AS ST_ID, os.STATUS, os.COMENTARIO, os.DRIVERS_CONFIRMADOS, os.ATUALIZADO_EM
  FROM PREENCHIMENTO_TOKEN t
  JOIN CICLO c ON c.ID = t.CICLO_ID AND c.STATUS = 'INICIADA'
  JOIN ORCAMENTO_STATUS os ON os.CICLO_ID = t.CICLO_ID AND os.GESTOR_ID = t.GESTOR_ID
  WHERE t.ATIVO = 'true' AND os.STATUS = 'SUBMETIDO' LIMIT 1`))[0];
if (!tk) { console.log('ABORT: nenhum CR SUBMETIDO com token ativo no ciclo INICIADA'); process.exit(1); }
const crId = Number(tk.CR_ID), ciclo = Number(tk.CICLO_ID), stId = Number(tk.ST_ID);
const orig = { STATUS: tk.STATUS, COMENTARIO: tk.COMENTARIO, ATUALIZADO_EM: tk.ATUALIZADO_EM };
console.log(`Cenario: CR ${crId}, ciclo ${ciclo}, status original ${orig.STATUS}\n`);

const stq = `SELECT STATUS, COMENTARIO FROM ORCAMENTO_STATUS WHERE ID = ${stId}`;
const st = async () => (await q(stq))[0];

// conta editavel do CR pra teste de escrita
const conta = (await q(`SELECT cc.CONTA_ID, COALESCE((SELECT o.VALOR FROM ORCAMENTO o WHERE o.CICLO_ID=${ciclo} AND o.CR_ID=${crId} AND o.CONTA_ID=cc.CONTA_ID AND o.MES=6 LIMIT 1), -999999) AS VAL
  FROM CR_CONTA cc WHERE cc.CR_ID=${crId} AND cc.ATIVO=true LIMIT 1`))[0];
const contaId = Number(conta.CONTA_ID);
const valOrig = Number(conta.VAL); // -999999 = linha nao existia
const valMes6 = async () => {
  const r = (await q(`SELECT VALOR FROM ORCAMENTO WHERE CICLO_ID=${ciclo} AND CR_ID=${crId} AND CONTA_ID=${contaId} AND MES=6`))[0];
  return r ? Number(r.VALOR) : null;
};
const restoreCell = async () => {
  await runDmlMitra({ projectId, sql: `DELETE FROM ORCAMENTO WHERE CICLO_ID=${ciclo} AND CR_ID=${crId} AND CONTA_ID=${contaId} AND MES=6` });
  if (valOrig !== -999999) await runDmlMitra({ projectId, sql: `INSERT INTO ORCAMENTO (CICLO_ID, CR_ID, CONTA_ID, MES, VALOR) VALUES (${ciclo}, ${crId}, ${contaId}, 6, ${valOrig})` });
};

// ── 1) SUBMETIDO: escrita publica ainda passa? (UI trava, servidor deveria travar tambem)
await pub(147, { token: tk.TOKEN, op: 'orcCells', crId, cells: [{ contaId, mes: 6, valor: 777001 }] });
const v1 = await valMes6();
check('SUBMETIDO bloqueia escrita publica de celula', v1 !== 777001, `valor apos tentativa: ${v1}`);
if (v1 === 777001) await restoreCell();

// ── 2) APROVAR (acao do aprovador — mesmo efeito do botao Aprovar)
await runDmlMitra({ projectId, sql: `UPDATE ORCAMENTO_STATUS SET STATUS='APROVADO', ATUALIZADO_EM='${new Date().toISOString().slice(0, 19)}' WHERE ID=${stId}` });
check('SUBMETIDO -> APROVADO aplicado', (await st()).STATUS === 'APROVADO');

// ── 3) APROVADO: escrita publica deve ser bloqueada
await pub(147, { token: tk.TOKEN, op: 'orcCells', crId, cells: [{ contaId, mes: 6, valor: 777002 }] });
const v2 = await valMes6();
check('APROVADO bloqueia escrita publica de celula', v2 !== 777002, `valor apos tentativa: ${v2}`);
if (v2 === 777002) await restoreCell();

// ── 4) APROVADO: gestor consegue re-submeter pelo link? (nao deveria)
await pub(70, { token: tk.TOKEN, crId });
const s4 = (await st()).STATUS;
check('APROVADO nao pode voltar a SUBMETIDO pelo link do gestor', s4 === 'APROVADO', `status apos submeter: ${s4}`);
if (s4 !== 'APROVADO') await runDmlMitra({ projectId, sql: `UPDATE ORCAMENTO_STATUS SET STATUS='APROVADO' WHERE ID=${stId}` });

// ── 5) REPROVAR com comentario (acao do aprovador)
await runDmlMitra({ projectId, sql: `UPDATE ORCAMENTO_STATUS SET STATUS='REPROVADO', COMENTARIO='TESTE: revisar premissas de pessoal', ATUALIZADO_EM='${new Date().toISOString().slice(0, 19)}' WHERE ID=${stId}` });
check('APROVADO -> REPROVADO aplicado', (await st()).STATUS === 'REPROVADO');

// ── 6) REPROVADO: gestor ve o motivo no link publico (home SF 139)
const home = await pub(139, { token: tk.TOKEN });
const homeRow = home?.rows?.[0] || {};
let homeCrs = homeRow.CRS || '[]';
if (typeof homeCrs === 'string') { try { homeCrs = JSON.parse(homeCrs); } catch { homeCrs = []; } }
const crCard = homeCrs.find((c) => Number(c.CR_ID) === crId);
check('comentario de reprovacao visivel no link do gestor', !!crCard && String(crCard.COMENTARIO || '').includes('TESTE: revisar'), `card: ${JSON.stringify({ STATUS: crCard?.STATUS, COMENTARIO: crCard?.COMENTARIO })}`);

// ── 7) REPROVADO: gestor pode corrigir valores (escrita deve passar)
await pub(147, { token: tk.TOKEN, op: 'orcCells', crId, cells: [{ contaId, mes: 6, valor: 777003 }] });
const v3 = await valMes6();
check('REPROVADO permite gestor corrigir valores', v3 === 777003, `valor apos escrita: ${v3}`);
await restoreCell();

// ── 8) REPROVADO: desfazer confirmacao preserva status REPROVADO
const csvOrig = tk.DRIVERS_CONFIRMADOS || '';
if (csvOrig.includes(',')) {
  const menos = csvOrig.split(',').filter(Boolean).slice(0, -1).join(',');
  await pub(147, { token: tk.TOKEN, op: 'confirmDriver', crId, driversCsv: menos, allConfirmed: false });
  const s8 = await st();
  check('desfazer confirmacao mantem REPROVADO (nao vira PENDENTE)', s8.STATUS === 'REPROVADO', `status: ${s8.STATUS}`);
  await pub(147, { token: tk.TOKEN, op: 'confirmDriver', crId, driversCsv: csvOrig, allConfirmed: true });
}

// ── 9) re-submissao do gestor pelo link (REPROVADO -> SUBMETIDO)
await pub(70, { token: tk.TOKEN, crId });
const s9 = await st();
check('REPROVADO -> SUBMETIDO (gestor re-submete pelo link)', s9.STATUS === 'SUBMETIDO', `status: ${s9.STATUS}`);
check('comentario de reprovacao sobrevive a re-submissao (auditoria)', String(s9.COMENTARIO || '').includes('TESTE: revisar'), `comentario: ${s9.COMENTARIO}`);

// ── restaura estado original
await runDmlMitra({ projectId, sql: `UPDATE ORCAMENTO_STATUS SET STATUS='${orig.STATUS}', COMENTARIO=${orig.COMENTARIO == null ? 'NULL' : `'${String(orig.COMENTARIO).replace(/'/g, "''")}'`}, ATUALIZADO_EM='${orig.ATUALIZADO_EM}', DRIVERS_CONFIRMADOS=${tk.DRIVERS_CONFIRMADOS == null ? 'NULL' : `'${tk.DRIVERS_CONFIRMADOS}'`} WHERE ID=${stId}` });
const fim = await st();
console.log(`\nRestaurado: ${JSON.stringify(fim)} (original: ${orig.STATUS})`);
// limpa os eventos de auditoria gerados pelo proprio teste (submissoes via SF 70)
await runDmlMitra({ projectId, sql: `DELETE FROM WORKFLOW_AUDITORIA WHERE ID > ${auditMaxBefore}` });

console.log(`\n${pass} PASS / ${fail} FAIL`);
