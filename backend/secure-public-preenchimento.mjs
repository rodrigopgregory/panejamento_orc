// Hardening + Preenchimento Público Seguro (magic-link com token UUID)
//
// O QUE ESTE SCRIPT FAZ (idempotente, aditivo — não recria schema nem apaga dados):
//   1. Remove a SF validarLoginTemporario (id 39): login demo público e injetável,
//      NÃO usado pelo frontend. Elimina o vetor de comprometimento não autenticado.
//   2. Cria a tabela PREENCHIMENTO_TOKEN (1 token UUID por CICLO+GESTOR).
//   3. SFs internas (autenticadas) para gerar/obter o token: usadas pelo envio de email.
//   4. SFs PÚBLICAS parametrizadas e escopadas pelo token — a autorização é derivada
//      do token no próprio SQL (JOIN em PREENCHIMENTO_TOKEN/GESTOR_CR), nunca de um ID
//      vindo do cliente. Nenhuma delas executa SQL arbitrário (jamais a SF 18).
//   5. Backfill de tokens para os pares CICLO+GESTOR já existentes.
//
// SEGURANÇA DAS SFs PÚBLICAS:
//   - token: único parâmetro string; sanitizado para [0-9a-f-] no frontend E validado
//     por igualdade exata no WHERE. Token inválido => zero linhas => no-op.
//   - demais params (crId, contaId, mes, valor): numéricos, coeridos com Number() no
//     frontend e, nas SFs JS de escrita, re-coeridos server-side (Number.isInteger/
//     isFinite) antes de montar o SQL — imune a injeção mesmo com cliente hostil.

import 'dotenv/config';
import {
  configureSdkMitra,
  runDdlMitra,
  runDmlMitra,
  createServerFunctionMitra,
  updateServerFunctionMitra,
  deleteServerFunctionMitra,
  listServerFunctionsMitra,
  togglePublicExecutionMitra,
} from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});

const projectId = parseInt(process.env.MITRA_PROJECT_ID);
const now = new Date().toISOString().slice(0, 19);

async function listSFs() {
  const all = await listServerFunctionsMitra({ projectId });
  return all?.result || all?.content || all || [];
}

async function upsertSF({ name, type, code, description, isPublic }) {
  const list = await listSFs();
  const existing = Array.isArray(list) ? list.find((s) => s.name === name) : null;
  let id;
  if (existing) {
    await updateServerFunctionMitra({ projectId, serverFunctionId: existing.id, code, description });
    id = existing.id;
    console.log(`  ~ atualizada ${name} (id ${id})`);
  } else {
    const res = await createServerFunctionMitra({ projectId, name, type, code, description });
    id = res?.result?.serverFunctionId || res?.serverFunctionId || res?.id;
    console.log(`  + criada ${name} (id ${id})`);
  }
  if (isPublic) {
    try {
      await togglePublicExecutionMitra({ projectId, serverFunctionId: id, publicExecution: true });
      console.log(`    -> marcada PUBLICA`);
    } catch (e) {
      console.log(`    ! nao foi possivel marcar publica: ${e?.message || e}`);
    }
  }
  return id;
}

async function run() {
  // ---------------------------------------------------------------------------
  // 1. Remover SF 39 (login demo publico injetavel — morto no frontend)
  // ---------------------------------------------------------------------------
  console.log('[1] Removendo SF validarLoginTemporario (vetor nao autenticado)...');
  const list0 = await listSFs();
  const sf39 = Array.isArray(list0) ? list0.find((s) => s.name === 'validarLoginTemporario' || s.id === 39) : null;
  if (sf39) {
    await deleteServerFunctionMitra({ projectId, serverFunctionId: sf39.id });
    console.log(`  - removida (id ${sf39.id})`);
  } else {
    console.log('  (ja nao existe)');
  }

  // ---------------------------------------------------------------------------
  // 2. Tabela PREENCHIMENTO_TOKEN
  // ---------------------------------------------------------------------------
  console.log('[2] Criando tabela PREENCHIMENTO_TOKEN...');
  await runDdlMitra({
    projectId,
    sql: `CREATE TABLE IF NOT EXISTS PREENCHIMENTO_TOKEN (
      ID INT AUTO_INCREMENT PRIMARY KEY,
      CICLO_ID INT NOT NULL,
      GESTOR_ID INT NOT NULL,
      TOKEN VARCHAR(36) NOT NULL,
      ATIVO VARCHAR(5) DEFAULT 'true',
      CRIADO_EM VARCHAR(19),
      EXPIRA_EM VARCHAR(19)
    )`,
  });
  try {
    await runDdlMitra({ projectId, sql: `CREATE INDEX IDX_PREENCH_TOKEN ON PREENCHIMENTO_TOKEN (TOKEN)` });
  } catch (e) { console.log('  (indice token ja existe)'); }
  console.log('  OK');

  // ---------------------------------------------------------------------------
  // 3. SFs internas (autenticadas) — geração/obtenção de token
  // ---------------------------------------------------------------------------
  console.log('[3] SFs internas de token...');
  await upsertSF({
    name: 'preenchimentoGarantirToken',
    type: 'SQL',
    description: 'Gera token UUID para (cicloId, gestorId) se ainda nao existir (params: cicloId, gestorId, agora)',
    code:
`INSERT INTO PREENCHIMENTO_TOKEN (CICLO_ID, GESTOR_ID, TOKEN, ATIVO, CRIADO_EM)
SELECT * FROM (SELECT {{cicloId}} AS CICLO_ID, {{gestorId}} AS GESTOR_ID, UUID() AS TOKEN, 'true' AS ATIVO, '{{agora}}' AS CRIADO_EM) novo
WHERE NOT EXISTS (
  SELECT 1 FROM (SELECT CICLO_ID, GESTOR_ID, ATIVO FROM PREENCHIMENTO_TOKEN) p
  WHERE p.CICLO_ID = {{cicloId}} AND p.GESTOR_ID = {{gestorId}} AND p.ATIVO = 'true'
)`,
  });
  await upsertSF({
    name: 'preenchimentoObterToken',
    type: 'SQL',
    description: 'Retorna o token ativo de (cicloId, gestorId) (params: cicloId, gestorId)',
    code:
`SELECT TOKEN FROM PREENCHIMENTO_TOKEN
WHERE CICLO_ID = {{cicloId}} AND GESTOR_ID = {{gestorId}} AND ATIVO = 'true'
ORDER BY ID DESC LIMIT 1`,
  });

  // ---------------------------------------------------------------------------
  // 4. SFs PÚBLICAS escopadas por token
  // ---------------------------------------------------------------------------
  console.log('[4] SFs publicas escopadas por token...');

  await upsertSF({
    name: 'publicResolverToken',
    type: 'SQL',
    isPublic: true,
    description: 'Valida token e retorna ciclo/gestor (param: token)',
    code:
`SELECT t.CICLO_ID, t.GESTOR_ID, g.NOME AS GESTOR_NOME, g.EMAIL AS GESTOR_EMAIL,
        c.NOME AS CICLO_NOME, c.ANO AS CICLO_ANO
FROM PREENCHIMENTO_TOKEN t
JOIN GESTOR g ON g.ID = t.GESTOR_ID
JOIN CICLO c ON c.ID = t.CICLO_ID
WHERE t.TOKEN = '{{token}}' AND t.ATIVO = 'true'
  AND (t.EXPIRA_EM IS NULL OR t.EXPIRA_EM >= '{{agora}}')
LIMIT 1`,
  });

  await upsertSF({
    name: 'publicListarCRs',
    type: 'SQL',
    isPublic: true,
    description: 'Lista os CRs que o gestor do token preenche no ciclo, com status (param: token)',
    code:
`SELECT cr.ID AS CR_ID, cr.CODIGO, cr.NOME,
        COALESCE(os.STATUS, 'PENDENTE') AS STATUS
FROM PREENCHIMENTO_TOKEN t
JOIN GESTOR_CR gc ON gc.GESTOR_ID = t.GESTOR_ID
JOIN CENTRO_RESULTADO cr ON cr.ID = gc.CR_ID AND cr.ATIVO = 'true'
LEFT JOIN ORCAMENTO_STATUS os
  ON os.CICLO_ID = t.CICLO_ID AND os.GESTOR_ID = t.GESTOR_ID AND os.CR_ID = cr.ID
WHERE t.TOKEN = '{{token}}' AND t.ATIVO = 'true'
ORDER BY cr.CODIGO`,
  });

  await upsertSF({
    name: 'publicCarregarConfig',
    type: 'SQL',
    isPublic: true,
    description: 'Config conta x driver de um CR — autorizado pelo token (params: token, crId)',
    code:
`SELECT cc.ID AS CONTA_ID, cc.CODIGO, cc.NOME AS CONTA_NOME, cc.TIPO,
        d.NOME AS DRIVER_TIPO, d.ID AS DRIVER_ID
FROM PREENCHIMENTO_TOKEN t
JOIN GESTOR_CR gc ON gc.GESTOR_ID = t.GESTOR_ID AND gc.CR_ID = {{crId}}
JOIN CR_CONTA crc ON crc.CR_ID = gc.CR_ID AND crc.ATIVO = true
JOIN CONTA_CONTABIL cc ON cc.ID = crc.CONTA_ID
LEFT JOIN CONTA_DRIVER_EXCECAO cde
  ON cde.CR_ID = crc.CR_ID AND cde.CONTA_ID = crc.CONTA_ID AND cde.ATIVO = true
LEFT JOIN CONTA_DRIVER cd ON cd.CONTA_ID = crc.CONTA_ID
LEFT JOIN DRIVERS d ON d.ID = COALESCE(cde.DRIVER_ID, cd.DRIVER_ID)
WHERE t.TOKEN = '{{token}}' AND t.ATIVO = 'true'
  AND d.ID IS NOT NULL AND d.ATIVO = 'true'
ORDER BY cc.CODIGO`,
  });

  await upsertSF({
    name: 'publicCarregarValores',
    type: 'SQL',
    isPublic: true,
    description: 'Valores ja preenchidos de um CR — autorizado pelo token (params: token, crId)',
    code:
`SELECT o.CONTA_ID, o.MES, SUM(o.VALOR) AS VALOR
FROM PREENCHIMENTO_TOKEN t
JOIN GESTOR_CR gc ON gc.GESTOR_ID = t.GESTOR_ID AND gc.CR_ID = {{crId}}
JOIN ORCAMENTO o ON o.CICLO_ID = t.CICLO_ID AND o.CR_ID = gc.CR_ID
WHERE t.TOKEN = '{{token}}' AND t.ATIVO = 'true'
GROUP BY o.CONTA_ID, o.MES`,
  });

  // Escrita em lote — JS SF: coage numeros server-side e monta SQL seguro.
  await upsertSF({
    name: 'publicSalvarValores',
    type: 'JAVASCRIPT',
    isPublic: true,
    description: 'Upsert em lote de valores de um CR, escopado por token (params: token, crId, valores[])',
    code:
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
// 1) apaga celulas existentes (de-dup) escopado por token + gestor dono do CR
await runDmlMitra({ projectId, sql:
  "DELETE o FROM ORCAMENTO o " +
  "JOIN PREENCHIMENTO_TOKEN t ON t.CICLO_ID = o.CICLO_ID AND t.TOKEN = '" + token + "' AND t.ATIVO = 'true' " +
  "JOIN GESTOR_CR gc ON gc.GESTOR_ID = t.GESTOR_ID AND gc.CR_ID = o.CR_ID " +
  "WHERE o.CR_ID = " + crId + " AND (o.CONTA_ID, o.MES) IN (" + pairs + ")" });
// 2) insere apenas contas realmente do CR (autorizacao via CR_CONTA) e do gestor do token
const derived = cells.map(c => 'SELECT ' + c.conta + ' AS CONTA_ID, ' + c.mes + ' AS MES, ' + c.val + ' AS VALOR').join(' UNION ALL ');
await runDmlMitra({ projectId, sql:
  "INSERT INTO ORCAMENTO (CICLO_ID, CR_ID, CONTA_ID, MES, VALOR) " +
  "SELECT t.CICLO_ID, " + crId + ", v.CONTA_ID, v.MES, v.VALOR " +
  "FROM PREENCHIMENTO_TOKEN t " +
  "JOIN GESTOR_CR gc ON gc.GESTOR_ID = t.GESTOR_ID AND gc.CR_ID = " + crId + " " +
  "JOIN (" + derived + ") v " +
  "JOIN CR_CONTA crc ON crc.CR_ID = " + crId + " AND crc.CONTA_ID = v.CONTA_ID AND crc.ATIVO = true " +
  "WHERE t.TOKEN = '" + token + "' AND t.ATIVO = 'true'" });
return { ok: true, saved: cells.length };`,
  });

  await upsertSF({
    name: 'publicSubmeterCR',
    type: 'JAVASCRIPT',
    isPublic: true,
    description: 'Marca o CR como SUBMETIDO, escopado por token (params: token, crId)',
    code:
`const { runDmlMitra } = require('mitra-sdk');
const projectId = parseInt(process.env.MITRA_PROJECT_ID);
const token = String(event.token || '').replace(/[^0-9a-fA-F-]/g, '').slice(0, 36);
const crId = Number(event.crId);
if (!token || !Number.isInteger(crId)) return { ok: false, error: 'params_invalidos' };
const agora = new Date().toISOString().slice(0, 19);
await runDmlMitra({ projectId, sql:
  "UPDATE ORCAMENTO_STATUS os " +
  "JOIN PREENCHIMENTO_TOKEN t ON t.CICLO_ID = os.CICLO_ID AND t.GESTOR_ID = os.GESTOR_ID AND t.TOKEN = '" + token + "' AND t.ATIVO = 'true' " +
  "JOIN GESTOR_CR gc ON gc.GESTOR_ID = t.GESTOR_ID AND gc.CR_ID = os.CR_ID " +
  "SET os.STATUS = 'SUBMETIDO', os.ATUALIZADO_EM = '" + agora + "' " +
  "WHERE os.CR_ID = " + crId });
await runDmlMitra({ projectId, sql:
  "INSERT INTO ORCAMENTO_STATUS (CICLO_ID, GESTOR_ID, CR_ID, STATUS, ATUALIZADO_EM) " +
  "SELECT t.CICLO_ID, t.GESTOR_ID, " + crId + ", 'SUBMETIDO', '" + agora + "' " +
  "FROM PREENCHIMENTO_TOKEN t " +
  "JOIN GESTOR_CR gc ON gc.GESTOR_ID = t.GESTOR_ID AND gc.CR_ID = " + crId + " " +
  "WHERE t.TOKEN = '" + token + "' AND t.ATIVO = 'true' " +
  "AND NOT EXISTS (SELECT 1 FROM (SELECT CICLO_ID, GESTOR_ID, CR_ID FROM ORCAMENTO_STATUS) s " +
  "WHERE s.CICLO_ID = t.CICLO_ID AND s.GESTOR_ID = t.GESTOR_ID AND s.CR_ID = " + crId + ")" });
return { ok: true };`,
  });

  // ---------------------------------------------------------------------------
  // 5. Backfill de tokens para pares CICLO+GESTOR ja existentes
  // ---------------------------------------------------------------------------
  console.log('[5] Backfill de tokens existentes...');
  await runDmlMitra({
    projectId,
    sql:
`INSERT INTO PREENCHIMENTO_TOKEN (CICLO_ID, GESTOR_ID, TOKEN, ATIVO, CRIADO_EM)
SELECT s.CICLO_ID, s.GESTOR_ID, UUID(), 'true', '${now}'
FROM (
  SELECT DISTINCT CICLO_ID, GESTOR_ID FROM ORCAMENTO_STATUS WHERE GESTOR_ID IS NOT NULL
  UNION SELECT DISTINCT CICLO_ID, GESTOR_ID FROM PACOTE_STATUS WHERE GESTOR_ID IS NOT NULL
) s
WHERE NOT EXISTS (
  SELECT 1 FROM (SELECT CICLO_ID, GESTOR_ID FROM PREENCHIMENTO_TOKEN) p
  WHERE p.CICLO_ID = s.CICLO_ID AND p.GESTOR_ID = s.GESTOR_ID
)`,
  });
  console.log('  OK');

  console.log('\n=== Concluido ===');
}

run().catch((e) => { console.error('ERRO:', e?.message || e); process.exit(1); });
