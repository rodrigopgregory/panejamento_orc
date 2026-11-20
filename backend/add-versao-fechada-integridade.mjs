// Integridade de versoes FECHADAS (aprovado pelo usuario):
//
// 1. Congela o denominador da completude: nova coluna TOTAL_MODELOS em
//    ORCAMENTO_STATUS e PACOTE_STATUS, preenchida no fechamento da versao
//    (snapshot). Versoes fechadas param de "herdar" modelos criados depois.
// 2. Leitores preferem o snapshot: SFs 95 (kanbanModelosPorCiclo), 96
//    (kanbanPacoteTotais) e 139 (publicHome) usam COALESCE(snapshot, live).
// 3. Trava escrita em ciclo FECHADO: SFs publicas 69 (salvar) e 70 (submeter)
//    ganham o gate de ciclo (a 147 ganha o mesmo gate via add-public-orc-driver.mjs).
// 4. Desativa tokens de versoes fechadas (links de e-mail antigos param de abrir)
//    + backfill de snapshot para as versoes ja fechadas (com o mapeamento atual —
//    melhor aproximacao disponivel).
// 5. Nova SF fecharVersaoHousekeeping (NAO publica) chamada pela tela de Versoes
//    no momento do fechamento: grava snapshots + desativa tokens do ciclo.
//
// A tela de Premissas (SF 122) passa a listar apenas versoes nao-fechadas
// (ABERTO/PENDENTE em configuracao + INICIADA disparada), conforme o fluxo:
// primeiro configura premissas na versao aberta, depois inicia.
//
// Aditivo e idempotente.
import 'dotenv/config';
import {
  configureSdkMitra,
  createServerFunctionMitra,
  updateServerFunctionMitra,
  listServerFunctionsMitra,
  executeServerFunctionMitra,
  runDdlMitra,
  runDmlMitra,
} from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});
const projectId = parseInt(process.env.MITRA_PROJECT_ID);

const q = async (sql) => {
  const r = await executeServerFunctionMitra({ projectId, serverFunctionId: 76, input: { sql } });
  let o = r?.result?.output; if (typeof o === 'string') o = JSON.parse(o);
  return o?.rows || [];
};

// ── 1. Coluna TOTAL_MODELOS (snapshot do denominador) ──
console.log('[1] Colunas TOTAL_MODELOS...');
for (const table of ['ORCAMENTO_STATUS', 'PACOTE_STATUS']) {
  const has = await q(`SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${table}' AND COLUMN_NAME = 'TOTAL_MODELOS'`);
  if (has.length) { console.log(`  = ${table}.TOTAL_MODELOS ja existe`); continue; }
  await runDdlMitra({ projectId, sql: `ALTER TABLE ${table} ADD COLUMN TOTAL_MODELOS INT NULL` });
  console.log(`  + ${table}.TOTAL_MODELOS criada`);
}

// Contagens "ao vivo" (mesma logica das SFs 95/96/139)
// Pacotes FICAM FORA do denominador do CR: uma conta delegada a pacote e
// preenchida/submetida pelo gestor do pacote (card proprio no kanban) — nao
// pode travar a completude do CR de outro gestor.
const LIVE_CR = `SELECT crc.CR_ID, COUNT(DISTINCT d.NOME) AS TOTAL
  FROM CR_CONTA crc
  LEFT JOIN CONTA_DRIVER_EXCECAO cde ON cde.CR_ID = crc.CR_ID AND cde.CONTA_ID = crc.CONTA_ID AND cde.ATIVO = true
  LEFT JOIN CONTA_DRIVER cd ON cd.CONTA_ID = crc.CONTA_ID
  LEFT JOIN DRIVERS d ON d.ID = COALESCE(cde.PACOTE_ID, cd.PACOTE_ID, cde.DRIVER_ID, cd.DRIVER_ID)
  WHERE crc.ATIVO = true AND d.ID IS NOT NULL AND d.ATIVO = 'true' AND d.TIPO_DRIVER = 'NORMAL'
  GROUP BY crc.CR_ID`;

const LIVE_PKG = `SELECT COALESCE(cde.PACOTE_ID, cd.PACOTE_ID, cde.DRIVER_ID, cd.DRIVER_ID) AS PACOTE_ID,
       COUNT(DISTINCT modelo.ID) AS TOTAL
  FROM CR_CONTA crc
  LEFT JOIN CONTA_DRIVER_EXCECAO cde ON cde.CR_ID = crc.CR_ID AND cde.CONTA_ID = crc.CONTA_ID AND cde.ATIVO = true
  LEFT JOIN CONTA_DRIVER cd ON cd.CONTA_ID = crc.CONTA_ID
  LEFT JOIN DRIVERS modelo ON modelo.ID = COALESCE(cde.DRIVER_ID, cd.DRIVER_ID) AND modelo.TIPO_DRIVER = 'NORMAL'
  WHERE crc.ATIVO = true AND modelo.ID IS NOT NULL
  GROUP BY COALESCE(cde.PACOTE_ID, cd.PACOTE_ID, cde.DRIVER_ID, cd.DRIVER_ID)`;

// ── 2. Backfill: versoes ja FECHADAS ganham snapshot (mapeamento atual) ──
console.log('[2] Backfill de snapshot nas versoes fechadas...');
await runDmlMitra({ projectId, sql:
`UPDATE ORCAMENTO_STATUS os
JOIN CICLO c ON c.ID = os.CICLO_ID AND c.STATUS = 'FECHADO'
LEFT JOIN (${LIVE_CR}) live ON live.CR_ID = os.CR_ID
SET os.TOTAL_MODELOS = COALESCE(live.TOTAL, 0)
WHERE os.TOTAL_MODELOS IS NULL` });
await runDmlMitra({ projectId, sql:
`UPDATE PACOTE_STATUS ps
JOIN CICLO c ON c.ID = ps.CICLO_ID AND c.STATUS = 'FECHADO'
LEFT JOIN (${LIVE_PKG}) live ON live.PACOTE_ID = ps.DRIVER_ID
SET ps.TOTAL_MODELOS = COALESCE(live.TOTAL, 0)
WHERE ps.TOTAL_MODELOS IS NULL` });
console.log('  OK');

// ── 3. Desativa tokens de versoes fechadas (links antigos param de abrir) ──
console.log('[3] Desativando tokens de versoes fechadas...');
await runDmlMitra({ projectId, sql:
`UPDATE PREENCHIMENTO_TOKEN t
JOIN CICLO c ON c.ID = t.CICLO_ID AND c.STATUS = 'FECHADO'
SET t.ATIVO = 'false'
WHERE t.ATIVO = 'true'` });
console.log('  OK');

// ── 4. Atualiza SFs leitoras para preferir o snapshot ──
console.log('[4] SFs leitoras (95, 96, 122)...');
await updateServerFunctionMitra({ projectId, serverFunctionId: 95, code:
`SELECT os.CR_ID, COALESCE(MAX(os.TOTAL_MODELOS), MAX(live.TOTAL), 0) AS TOTAL
FROM ORCAMENTO_STATUS os
LEFT JOIN (${LIVE_CR}) live ON live.CR_ID = os.CR_ID
WHERE os.CICLO_ID = {{cicloId}}
GROUP BY os.CR_ID`,
  description: 'Total de modelos por CR do ciclo — usa snapshot TOTAL_MODELOS quando a versao foi fechada, senao contagem ao vivo. Params: cicloId' });
console.log('  ~ SF 95 (kanbanModelosPorCiclo)');

await updateServerFunctionMitra({ projectId, serverFunctionId: 96, code:
`SELECT ps.DRIVER_ID AS PACOTE_ID, COALESCE(MAX(ps.TOTAL_MODELOS), MAX(live.TOTAL), 0) AS TOTAL
FROM PACOTE_STATUS ps
LEFT JOIN (${LIVE_PKG}) live ON live.PACOTE_ID = ps.DRIVER_ID
WHERE ps.CICLO_ID = {{cicloId}}
GROUP BY ps.DRIVER_ID`,
  description: 'Total de modelos NORMAL por pacote do ciclo — usa snapshot TOTAL_MODELOS quando a versao foi fechada, senao contagem ao vivo. Params: cicloId' });
console.log('  ~ SF 96 (kanbanPacoteTotais)');

// Premissas: TODAS as versoes (fechadas incluidas, para auditoria) — a tela trava
// a edicao quando a versao selecionada esta FECHADA e nunca a seleciona por padrao
await updateServerFunctionMitra({ projectId, serverFunctionId: 122, code:
`SELECT
  COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('ID',ID,'NOME',NOME,'ANO',ANO,'STATUS',STATUS,'ULTIMO_MES_REALIZADO',ULTIMO_MES_REALIZADO,'VERSAO_ATUAL',VERSAO_ATUAL,'VERSAO_CONTROLE',VERSAO_CONTROLE,'VERSAO_ORIGEM_ID',VERSAO_ORIGEM_ID,'CRIADO_EM',CRIADO_EM,'CRIADO_POR',CRIADO_POR)) FROM CICLO), JSON_ARRAY()) AS CICLOS,
  COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('ID',ID,'CODIGO',CODIGO,'NOME',NOME)) FROM CONTA_CONTABIL), JSON_ARRAY()) AS CONTAS`,
  description: 'Base da tela de Premissas em 1 ida (todas as versoes, com STATUS, + CONTAS como JSON) — edicao de fechadas e travada na tela. Sem params.' });
console.log('  ~ SF 122 (hotPremissasBase)');

// ── 5. SFs publicas 69/70 — NAO tocar aqui ──
// As versoes vigentes dessas SFs foram endurecidas DEPOIS deste script:
//   - SF 69: harden-status-transitions.mjs (gate SUBMETIDO+APROVADO)
//   - SF 70: add-workflow-auditoria.mjs (transicoes validadas + auditoria + email)
// Este script NAO deve reescreve-las — reexecutar as versoes antigas regrediria
// o hardening. Se precisar mexer nas 69/70, edite os scripts acima.
console.log('[5] SFs 69/70: geridas por harden-status-transitions.mjs / add-workflow-auditoria.mjs (pulado)');
// ── 6. SF fecharVersaoHousekeeping (NAO publica — chamada pela tela de Versoes) ──
console.log('[6] SF fecharVersaoHousekeeping...');
const HOUSEKEEPING_CODE = `
// Chamada pela tela de Versoes no momento em que versoes sao FECHADAS.
// Congela a completude (snapshot TOTAL_MODELOS) e desativa os tokens dos links.
const { runDmlMitra } = require('mitra-sdk');
const projectId = parseInt(process.env.MITRA_PROJECT_ID);
const raw = Array.isArray(event.cicloIds) ? event.cicloIds : [event.cicloIds];
const ids = raw.map(Number).filter(Number.isInteger);
if (ids.length === 0) return { ok: false, error: 'cicloIds_invalido' };
const IN = ids.join(',');
await runDmlMitra({ projectId, sql:
  "UPDATE ORCAMENTO_STATUS os LEFT JOIN (${LIVE_CR.replace(/\n/g, ' ')}) live ON live.CR_ID = os.CR_ID " +
  "SET os.TOTAL_MODELOS = COALESCE(live.TOTAL, 0) WHERE os.CICLO_ID IN (" + IN + ")" });
await runDmlMitra({ projectId, sql:
  "UPDATE PACOTE_STATUS ps LEFT JOIN (${LIVE_PKG.replace(/\n/g, ' ')}) live ON live.PACOTE_ID = ps.DRIVER_ID " +
  "SET ps.TOTAL_MODELOS = COALESCE(live.TOTAL, 0) WHERE ps.CICLO_ID IN (" + IN + ")" });
await runDmlMitra({ projectId, sql:
  "UPDATE PREENCHIMENTO_TOKEN SET ATIVO = 'false' WHERE CICLO_ID IN (" + IN + ")" });
return { ok: true, ciclos: ids.length };`;

const all = await listServerFunctionsMitra({ projectId });
const list = all?.result || all || [];
const existing = Array.isArray(list) ? list.find((s) => s.name === 'fecharVersaoHousekeeping') : null;
let hkId;
if (existing) {
  await updateServerFunctionMitra({ projectId, serverFunctionId: existing.id, code: HOUSEKEEPING_CODE,
    description: 'Fechamento de versao: congela TOTAL_MODELOS (snapshot) e desativa tokens dos links. Params: cicloIds[]' });
  hkId = existing.id;
  console.log(`  ~ atualizada (id ${hkId})`);
} else {
  const res = await createServerFunctionMitra({ projectId, name: 'fecharVersaoHousekeeping', type: 'JAVASCRIPT', code: HOUSEKEEPING_CODE,
    description: 'Fechamento de versao: congela TOTAL_MODELOS (snapshot) e desativa tokens dos links. Params: cicloIds[]' });
  hkId = res?.result?.serverFunctionId || res?.serverFunctionId || res?.id;
  console.log(`  + criada (id ${hkId})`);
}

console.log('\n=== fecharVersaoHousekeeping ID:', hkId, '===');
console.log('done');
