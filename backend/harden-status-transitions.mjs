// Endurece as transicoes de status nas SFs publicas de escrita/submissao.
// Motivado pelo teste E2E test-fluxo-aprovacao.mjs, que provou dois furos:
//   1. SF 69/147: escrita de celulas passava com CR SUBMETIDO — os dados podiam
//      mudar debaixo do aprovador durante a avaliacao (a UI trava, o servidor nao).
//   2. SF 70: submeter nao validava o status atual — um token valido re-submetia
//      um CR ja APROVADO, derrubando-o de volta pra fila de avaliacao.
// Regras apos este script:
//   - Escrita (69/147): bloqueada quando CR SUBMETIDO ou APROVADO (alem de ciclo FECHADO).
//   - Submissao (70): so transiciona PENDENTE/CONFIRMADO/REPROVADO -> SUBMETIDO.
//     APROVADO e intocavel; SUBMETIDO nao re-submete (preserva a data de envio real).
// A SF 147 e regenerada por add-public-orc-driver.mjs (gate TK_COND ja corrigido la).
import 'dotenv/config';
import { configureSdkMitra, updateServerFunctionMitra } from 'mitra-sdk';
configureSdkMitra({ baseURL: process.env.MITRA_BASE_URL, token: process.env.MITRA_TOKEN, integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS });
const projectId = parseInt(process.env.MITRA_PROJECT_ID);

const CICLO_GATE_T = `AND NOT EXISTS (SELECT 1 FROM CICLO ck WHERE ck.ID = t.CICLO_ID AND ck.STATUS = 'FECHADO') `;

// ── SF 69 (publicSalvarValores) — mesmo codigo do add-versao-fechada-integridade,
// com o gate de status ampliado de APROVADO para APROVADO+SUBMETIDO
await updateServerFunctionMitra({ projectId, serverFunctionId: 69, code:
`const { runDmlMitra } = require('mitra-sdk');
const projectId = parseInt(process.env.MITRA_PROJECT_ID);
const token = String(event.token || '').replace(/[^0-9a-fA-F-]/g, '').slice(0, 36);
const crId = Number(event.crId);
if (!token || !Number.isInteger(crId)) return { ok: false, error: 'params_invalidos' };
const raw = Array.isArray(event.valores) ? event.valores : [];
const cells = [];
for (const c of raw) {
  const conta = Number(c.contaId), mes = Number(c.mes), val = Number(c.valor);
  if (Number.isInteger(conta) && Number.isInteger(mes) && mes >= 1 && mes <= 12 && Number.isFinite(val)) {
    cells.push({ conta, mes, val });
  }
}
if (cells.length === 0) return { ok: true, saved: 0 };
const pairs = cells.map(c => '(' + c.conta + ',' + c.mes + ')').join(',');
// gates: token ativo + ciclo nao fechado + CR nao SUBMETIDO/APROVADO + CR do gestor
const GATES = "AND NOT EXISTS (SELECT 1 FROM CICLO ck WHERE ck.ID = t.CICLO_ID AND ck.STATUS = 'FECHADO') " +
  "AND NOT EXISTS (SELECT 1 FROM (SELECT CICLO_ID, CR_ID, STATUS FROM ORCAMENTO_STATUS) osk WHERE osk.CICLO_ID = t.CICLO_ID AND osk.CR_ID = " + crId + " AND osk.STATUS IN ('APROVADO','SUBMETIDO')) ";
// 1) apaga celulas existentes (de-dup) escopado por token + gestor dono do CR
await runDmlMitra({ projectId, sql:
  "DELETE o FROM ORCAMENTO o " +
  "JOIN PREENCHIMENTO_TOKEN t ON t.CICLO_ID = o.CICLO_ID AND t.TOKEN = '" + token + "' AND t.ATIVO = 'true' " +
  "JOIN GESTOR_CR gc ON gc.GESTOR_ID = t.GESTOR_ID AND gc.CR_ID = o.CR_ID " +
  "WHERE o.CR_ID = " + crId + " AND (o.CONTA_ID, o.MES) IN (" + pairs + ") " + GATES });
// 2) insere apenas contas realmente do CR (autorizacao via CR_CONTA) e do gestor do token
const derived = cells.map(c => 'SELECT ' + c.conta + ' AS CONTA_ID, ' + c.mes + ' AS MES, ' + c.val + ' AS VALOR').join(' UNION ALL ');
await runDmlMitra({ projectId, sql:
  "INSERT INTO ORCAMENTO (CICLO_ID, CR_ID, CONTA_ID, MES, VALOR) " +
  "SELECT t.CICLO_ID, " + crId + ", v.CONTA_ID, v.MES, v.VALOR " +
  "FROM PREENCHIMENTO_TOKEN t " +
  "JOIN GESTOR_CR gc ON gc.GESTOR_ID = t.GESTOR_ID AND gc.CR_ID = " + crId + " " +
  "JOIN (" + derived + ") v " +
  "JOIN CR_CONTA crc ON crc.CR_ID = " + crId + " AND crc.CONTA_ID = v.CONTA_ID AND crc.ATIVO = true " +
  "WHERE t.TOKEN = '" + token + "' AND t.ATIVO = 'true' " + GATES });
return { ok: true, saved: cells.length };`,
  description: 'Upsert em lote de valores de um CR, escopado por token; bloqueia ciclo FECHADO e CR SUBMETIDO/APROVADO (params: token, crId, valores[])' });
console.log('  ~ SF 69 (publicSalvarValores): gate SUBMETIDO adicionado');

// ── SF 70 (publicSubmeterCR) — so transiciona PENDENTE/CONFIRMADO/REPROVADO -> SUBMETIDO
await updateServerFunctionMitra({ projectId, serverFunctionId: 70, code:
`const { runDmlMitra } = require('mitra-sdk');
const projectId = parseInt(process.env.MITRA_PROJECT_ID);
const token = String(event.token || '').replace(/[^0-9a-fA-F-]/g, '').slice(0, 36);
const crId = Number(event.crId);
if (!token || !Number.isInteger(crId)) return { ok: false, error: 'params_invalidos' };
const agora = new Date().toISOString().slice(0, 19);
const CICLO_GATE = "${CICLO_GATE_T.trim()} ";
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
return { ok: true };`,
  description: 'Marca o CR como SUBMETIDO, escopado por token; so transiciona PENDENTE/CONFIRMADO/REPROVADO e bloqueia ciclo FECHADO (params: token, crId)' });
console.log('  ~ SF 70 (publicSubmeterCR): so PENDENTE/CONFIRMADO/REPROVADO -> SUBMETIDO');

console.log('OK');
