// Teste E2E — auditoria + validacao de servidor no fluxo de aprovacao + pacotes.
// Exercita a SF 171 (avaliarWorkflowStatus), a SF 70 publica (submissao) e a
// auditoria do confirmDriver publico (SF 147). Restaura tudo ao final.
import 'dotenv/config';
import { configureSdkMitra, executeServerFunctionMitra, runDmlMitra } from 'mitra-sdk';
configureSdkMitra({ baseURL: process.env.MITRA_BASE_URL, token: process.env.MITRA_TOKEN, integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS });
const projectId = parseInt(process.env.MITRA_PROJECT_ID);

const q = async (sql) => {
  const r = await executeServerFunctionMitra({ projectId, serverFunctionId: 76, input: { sql } });
  let o = r?.result?.output; if (typeof o === 'string') o = JSON.parse(o);
  return o?.rows || [];
};
const avaliar = async (input) => {
  const r = await executeServerFunctionMitra({ projectId, serverFunctionId: 171, input: { notificar: false, ...input } });
  let o = r?.result?.output; if (typeof o === 'string') { try { o = JSON.parse(o); } catch { } }
  return o;
};
const base = 'https://newmitra.mitrasheet.com:8080';
const pub = async (sfId, input) => {
  const res = await fetch(`${base}/public/serverFunction/${projectId}/${sfId}/execute`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  const j = await res.json();
  let o = j?.result?.output ?? j?.output; if (typeof o === 'string') { try { o = JSON.parse(o); } catch { } }
  return o;
};

let pass = 0, fail = 0;
const check = (nome, cond, detalhe) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${nome}${detalhe ? ' | ' + detalhe : ''}`);
  cond ? pass++ : fail++;
};

// ── setup: CR com token ativo no ciclo INICIADA
const tk = (await q(`SELECT t.TOKEN, t.CICLO_ID, t.GESTOR_ID, os.CR_ID, os.ID AS ST_ID, os.STATUS, os.COMENTARIO, os.DRIVERS_CONFIRMADOS, os.ATUALIZADO_EM
  FROM PREENCHIMENTO_TOKEN t
  JOIN CICLO c ON c.ID = t.CICLO_ID AND c.STATUS = 'INICIADA'
  JOIN ORCAMENTO_STATUS os ON os.CICLO_ID = t.CICLO_ID AND os.GESTOR_ID = t.GESTOR_ID
  WHERE t.ATIVO = 'true' ORDER BY os.ID LIMIT 1`))[0];
if (!tk) { console.log('ABORT: nenhum CR com token ativo no ciclo INICIADA'); process.exit(1); }
const crId = Number(tk.CR_ID), ciclo = Number(tk.CICLO_ID), stId = Number(tk.ST_ID);
const orig = { STATUS: tk.STATUS, COMENTARIO: tk.COMENTARIO, DRIVERS_CONFIRMADOS: tk.DRIVERS_CONFIRMADOS, ATUALIZADO_EM: tk.ATUALIZADO_EM };
const auditMaxBefore = Number((await q(`SELECT COALESCE(MAX(ID), 0) AS M FROM WORKFLOW_AUDITORIA`))[0]?.M || 0);
console.log(`Cenario: CR ${crId}, ciclo ${ciclo}, status original ${orig.STATUS}\n`);

const esc = (v) => v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`;
const setStatus = (st, coment) => runDmlMitra({ projectId, sql:
  `UPDATE ORCAMENTO_STATUS SET STATUS = '${st}'${coment !== undefined ? `, COMENTARIO = ${esc(coment)}` : ''} WHERE ID = ${stId}` });
const getSt = async () => (await q(`SELECT STATUS, COMENTARIO FROM ORCAMENTO_STATUS WHERE ID = ${stId}`))[0];

// ── 1. maquina de estados da SF 171
await setStatus('SUBMETIDO');
let out = await avaliar({ tipo: 'CR', statusId: stId, acao: 'APROVADO', autor: 'Teste E2E' });
check('SUBMETIDO -> APROVADO permitido', out?.ok === true && (await getSt()).STATUS === 'APROVADO', JSON.stringify(out));

out = await avaliar({ tipo: 'CR', statusId: stId, acao: 'APROVADO', autor: 'Teste E2E' });
check('APROVADO -> APROVADO recusado (sem_transicao)', out?.ok === false && out?.error === 'sem_transicao', JSON.stringify(out));

out = await avaliar({ tipo: 'CR', statusId: stId, acao: 'REPROVADO', comentario: '', autor: 'Teste E2E' });
check('REPROVADO sem comentario recusado', out?.ok === false && out?.error === 'comentario_obrigatorio', JSON.stringify(out));

out = await avaliar({ tipo: 'CR', statusId: stId, acao: 'REPROVADO', comentario: 'Motivo teste auditoria', autor: 'Teste E2E' });
const st1 = await getSt();
check('APROVADO -> REPROVADO com comentario', out?.ok === true && st1.STATUS === 'REPROVADO' && st1.COMENTARIO === 'Motivo teste auditoria', JSON.stringify(out));

out = await avaliar({ tipo: 'CR', statusId: stId, acao: 'PENDENTE', autor: 'Teste E2E' });
const st2 = await getSt();
check('REPROVADO -> PENDENTE (reabrir) limpa comentario', out?.ok === true && st2.STATUS === 'PENDENTE' && !st2.COMENTARIO, JSON.stringify(out));

out = await avaliar({ tipo: 'CR', statusId: stId, acao: 'APROVADO', autor: 'Teste E2E' });
check('PENDENTE -> APROVADO recusado (transicao_invalida)', out?.ok === false && out?.error === 'transicao_invalida', JSON.stringify(out));

// ── 2. auditoria gravada pelas transicoes acima
const trilha = await q(`SELECT EVENTO, STATUS_DE, STATUS_PARA, AUTOR, ORIGEM FROM WORKFLOW_AUDITORIA WHERE ID > ${auditMaxBefore} AND TIPO = 'CR' AND CR_ID = ${crId} ORDER BY ID`);
const eventos = trilha.map((t) => t.EVENTO).join(',');
check('trilha de auditoria: APROVADO, REPROVADO, REABERTO', eventos === 'APROVADO,REPROVADO,REABERTO', eventos);
check('auditoria com autor e origem APP', trilha.every((t) => t.AUTOR === 'Teste E2E' && t.ORIGEM === 'APP'), JSON.stringify(trilha[0] || {}));

// ── 3. e-mail: reprovacao com notificar:true retorna emails=1 (gestor notificado)
await setStatus('SUBMETIDO');
out = await avaliar({ tipo: 'CR', statusId: stId, acao: 'REPROVADO', comentario: 'Teste de notificacao', autor: 'Teste E2E', notificar: true, appUrl: 'https://exemplo.mitra' });
check('REPROVADO com notificar envia e-mail ao gestor (emails=1)', out?.ok === true && out?.emails === 1, JSON.stringify(out));

// ── 4. SF 70 publica: submissao valida + auditoria LINK; APROVADO intocavel
await setStatus('PENDENTE', null);
out = await pub(70, { token: tk.TOKEN, crId });
const st3 = await getSt();
check('SF 70: PENDENTE -> SUBMETIDO pelo link', out?.ok === true && st3.STATUS === 'SUBMETIDO', JSON.stringify(out));
const audLink = await q(`SELECT EVENTO, ORIGEM, AUTOR FROM WORKFLOW_AUDITORIA WHERE ID > ${auditMaxBefore} AND CR_ID = ${crId} AND ORIGEM = 'LINK' AND EVENTO = 'SUBMETIDO'`);
check('SF 70: auditoria ORIGEM=LINK gravada', audLink.length >= 1, JSON.stringify(audLink[0] || {}));

await setStatus('APROVADO');
out = await pub(70, { token: tk.TOKEN, crId });
const st4 = await getSt();
check('SF 70: APROVADO nao re-submete (status_nao_permite)', out?.ok === false && out?.error === 'status_nao_permite' && st4.STATUS === 'APROVADO', JSON.stringify(out));

// ── 5. confirmDriver publico nao polui a auditoria com confirmacoes por modelo
// (CR precisa estar editavel: com APROVADO o gate da 147 bloqueia — comportamento correto)
await setStatus('PENDENTE');
out = await pub(147, { token: tk.TOKEN, op: 'confirmDriver', crId, driversCsv: orig.DRIVERS_CONFIRMADOS || '', allConfirmed: false });
const audModelo = await q(`SELECT EVENTO, COMENTARIO, ORIGEM FROM WORKFLOW_AUDITORIA WHERE ID > ${auditMaxBefore} AND CR_ID = ${crId} AND EVENTO = 'MODELO_CONFIRMADO'`);
check('SF 147: confirmacao de modelo sem evento individual', out?.ok === true && audModelo.length === 0, JSON.stringify(audModelo));

// ── 6. pacote fora do denominador do CR (SF 95)
const cmp = await q(`SELECT com.CR_ID, com.TOTAL AS COM_PACOTE, sem.TOTAL AS SEM_PACOTE FROM
  (SELECT crc.CR_ID, COUNT(DISTINCT d.NOME) AS TOTAL FROM CR_CONTA crc
    LEFT JOIN CONTA_DRIVER_EXCECAO cde ON cde.CR_ID = crc.CR_ID AND cde.CONTA_ID = crc.CONTA_ID AND cde.ATIVO = true
    LEFT JOIN CONTA_DRIVER cd ON cd.CONTA_ID = crc.CONTA_ID
    LEFT JOIN DRIVERS d ON d.ID = COALESCE(cde.PACOTE_ID, cd.PACOTE_ID, cde.DRIVER_ID, cd.DRIVER_ID)
    WHERE crc.ATIVO = true AND d.ID IS NOT NULL AND d.ATIVO = 'true' GROUP BY crc.CR_ID) com
  JOIN (SELECT crc.CR_ID, COUNT(DISTINCT d.NOME) AS TOTAL FROM CR_CONTA crc
    LEFT JOIN CONTA_DRIVER_EXCECAO cde ON cde.CR_ID = crc.CR_ID AND cde.CONTA_ID = crc.CONTA_ID AND cde.ATIVO = true
    LEFT JOIN CONTA_DRIVER cd ON cd.CONTA_ID = crc.CONTA_ID
    LEFT JOIN DRIVERS d ON d.ID = COALESCE(cde.PACOTE_ID, cd.PACOTE_ID, cde.DRIVER_ID, cd.DRIVER_ID)
    WHERE crc.ATIVO = true AND d.ID IS NOT NULL AND d.ATIVO = 'true' AND d.TIPO_DRIVER = 'NORMAL' GROUP BY crc.CR_ID) sem
  ON sem.CR_ID = com.CR_ID WHERE com.TOTAL > sem.TOTAL`);
const sf95 = await executeServerFunctionMitra({ projectId, serverFunctionId: 95, input: { cicloId: ciclo } });
let rows95 = sf95?.result?.output; if (typeof rows95 === 'string') rows95 = JSON.parse(rows95);
rows95 = rows95?.rows || [];
const crComPacote = cmp[0];
if (crComPacote) {
  const total95 = Number(rows95.find((r) => Number(r.CR_ID) === Number(crComPacote.CR_ID))?.TOTAL);
  check(`SF 95: CR ${crComPacote.CR_ID} (tem pacote) conta ${crComPacote.SEM_PACOTE} e nao ${crComPacote.COM_PACOTE}`,
    total95 === Number(crComPacote.SEM_PACOTE), `SF95=${total95}`);
} else {
  check('SF 95: nenhum CR com pacote no mapeamento (nada a validar)', true, 'sem pacotes mapeados');
}

// ── restauracao total
await runDmlMitra({ projectId, sql: `UPDATE ORCAMENTO_STATUS SET STATUS = ${esc(orig.STATUS)}, COMENTARIO = ${esc(orig.COMENTARIO)}, DRIVERS_CONFIRMADOS = ${esc(orig.DRIVERS_CONFIRMADOS ?? '')}, ATUALIZADO_EM = ${esc(orig.ATUALIZADO_EM)} WHERE ID = ${stId}` });
await runDmlMitra({ projectId, sql: `DELETE FROM WORKFLOW_AUDITORIA WHERE ID > ${auditMaxBefore}` });
const fin = await getSt();
check('restauracao: status original de volta', fin.STATUS === orig.STATUS, `${fin.STATUS}`);

console.log(`\n${pass} PASS / ${fail} FAIL`);
process.exit(fail > 0 ? 1 : 0);
