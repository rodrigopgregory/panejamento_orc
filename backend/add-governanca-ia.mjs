// Governanca de IA — o admin passa a escolher QUAL credencial e QUAL modelo
// rodam o agente analista do Playground, em vez do modelo cravado no bundle.
//
// O problema que isso resolve: sem uma connection do projeto, a task do agente
// usa a credencial PESSOAL de quem esta logado. No modo demo isso funciona (o
// app cai no token de build), mas com usuario real cada pessoa teria que
// conectar uma assinatura propria — e quem nao conectou recebe "erro de
// credencial". Com AGENT_CONNECTION_ID preenchido, todos passam a usar a mesma
// credencial do projeto.
//
// Cria (idempotente — pode rodar 2x sem duplicar):
//   1. APP_CONFIG (CREATE TABLE IF NOT EXISTS — a tabela ja existe desde
//      add-public-demo-flag.mjs; fica aqui so por idempotencia) + seed vazio
//      das 3 chaves novas: AGENT_MODEL_ID, AGENT_TYPE, AGENT_CONNECTION_ID
//   2. SF lerConfigAgenteIA    — SELECT das 3 chaves (autenticada; o Playground
//      exige login, entao nao ha motivo para expor isso sem token)
//   3. SF gravarConfigAgenteIA — upsert de UMA chave, com guarda que aceita
//      SOMENTE as 3 chaves acima (nao da para reaproveitar a SF para escrever
//      em LOGINS_DEMO_ATIVOS ou em qualquer outra config)
//
// Valor VAZIO em qualquer chave = usar o default de hoje. O frontend nunca
// quebra por causa dessa config: leitura falhou ou veio vazia => fallback.
//
// ADITIVO: nao altera nem apaga nada existente (sem DROP/TRUNCATE/DELETE/ALTER).

import 'dotenv/config';
import {
  configureSdkMitra,
  runDdlMitra,
  runDmlMitra,
  listServerFunctionsMitra,
  createServerFunctionMitra,
  updateServerFunctionMitra,
  executeServerFunctionMitra,
} from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});
const projectId = parseInt(process.env.MITRA_PROJECT_ID);

// As UNICAS chaves que a SF de escrita aceita. A lista entra literal no SQL
// (guarda server-side) — assim a SF nao vira um "UPDATE em APP_CONFIG" generico.
const CHAVES = ['AGENT_MODEL_ID', 'AGENT_TYPE', 'AGENT_CONNECTION_ID'];
const CHAVES_SQL = CHAVES.map((c) => `'${c}'`).join(', ');

async function upsertSf({ name, code, description }) {
  const listRes = await listServerFunctionsMitra({ projectId });
  const list = listRes?.result || listRes || [];
  const existing = (Array.isArray(list) ? list : []).find((f) => f.name === name);
  if (existing) {
    await updateServerFunctionMitra({ projectId, serverFunctionId: existing.id, code, description });
    console.log(`SF ${name} atualizada (id ${existing.id})`);
    return existing.id;
  }
  const res = await createServerFunctionMitra({ projectId, name, type: 'SQL', code, description });
  const id = res?.result?.serverFunctionId || res?.serverFunctionId || res?.id;
  console.log(`SF ${name} criada (id ${id})`);
  return id;
}

async function main() {
  // 1. Tabela (ja existe — IF NOT EXISTS mantem o script rodavel de novo)
  await runDdlMitra({
    projectId,
    sql: `CREATE TABLE IF NOT EXISTS APP_CONFIG (
      ID INT AUTO_INCREMENT PRIMARY KEY,
      CHAVE VARCHAR(100),
      VALOR VARCHAR(200),
      ATUALIZADO_EM VARCHAR(19)
    );`,
  });
  console.log('Tabela APP_CONFIG ok');

  // Seed VAZIO das 3 chaves (so se ausentes). Vazio = "usa o default do app",
  // entao o seed nao muda o comportamento de ninguem.
  for (const chave of CHAVES) {
    await runDmlMitra({
      projectId,
      sql: `INSERT INTO APP_CONFIG (CHAVE, VALOR, ATUALIZADO_EM)
            SELECT '${chave}', '', ''
            WHERE NOT EXISTS (SELECT 1 FROM APP_CONFIG WHERE CHAVE = '${chave}');`,
    });
  }
  console.log('Linhas AGENT_MODEL_ID / AGENT_TYPE / AGENT_CONNECTION_ID ok (seed apenas se ausentes)');

  // 2. Leitura — devolve SO as 3 chaves de IA (nao vaza o resto do APP_CONFIG)
  const readId = await upsertSf({
    name: 'lerConfigAgenteIA',
    code: `SELECT CHAVE, VALOR FROM APP_CONFIG WHERE CHAVE IN (${CHAVES_SQL})`,
    description: 'Le a configuracao do agente de IA (AGENT_MODEL_ID, AGENT_TYPE, AGENT_CONNECTION_ID) em APP_CONFIG. Valor vazio = usar o default do app.',
  });

  // 3. Escrita — upsert de UMA chave. O INSERT vem antes do UPDATE para cobrir
  // a linha ausente; ambos carregam a MESMA guarda de chave permitida, entao
  // um {{chave}} fora da lista simplesmente nao afeta nenhuma linha.
  const writeId = await upsertSf({
    name: 'gravarConfigAgenteIA',
    code: `INSERT INTO APP_CONFIG (CHAVE, VALOR, ATUALIZADO_EM)
           SELECT '{{chave}}', '{{valor}}', '{{quando}}'
           WHERE '{{chave}}' IN (${CHAVES_SQL})
             AND NOT EXISTS (SELECT 1 FROM APP_CONFIG WHERE CHAVE = '{{chave}}');
           UPDATE APP_CONFIG
           SET VALOR = '{{valor}}', ATUALIZADO_EM = '{{quando}}'
           WHERE CHAVE = '{{chave}}' AND '{{chave}}' IN (${CHAVES_SQL});`,
    description: 'Grava UMA chave da configuracao do agente de IA em APP_CONFIG. Aceita somente AGENT_MODEL_ID, AGENT_TYPE e AGENT_CONNECTION_ID (guarda no proprio SQL). Params: chave, valor, quando.',
  });

  // 4. Smoke: leitura devolve as 3 chaves e a escrita respeita a guarda.
  // A tentativa usa uma chave INEXISTENTE de proposito — se a guarda falhasse,
  // o pior caso e uma linha orfa de teste (e nao a config de outro fluxo
  // sobrescrita). O passo seguinte confirma que nada foi criado.
  const quando = new Date().toISOString().slice(0, 19);
  const bloqueado = await executeServerFunctionMitra({
    projectId,
    serverFunctionId: writeId,
    input: { chave: 'AGENT_CHAVE_NAO_PERMITIDA', valor: 'x', quando },
  });
  console.log('Guarda (chave nao permitida) →', bloqueado?.result?.executionStatus);

  const probe = await executeServerFunctionMitra({ projectId, serverFunctionId: readId, input: {} });
  const rows = probe?.result?.output?.rows || [];
  console.log('Smoke lerConfigAgenteIA →', JSON.stringify(rows));
  if (rows.length !== CHAVES.length) {
    throw new Error(`smoke falhou: esperava ${CHAVES.length} chaves, veio ${rows.length}`);
  }
  if (rows.some((r) => !CHAVES.includes(r.CHAVE))) {
    throw new Error('smoke falhou: a leitura devolveu chave fora da lista permitida');
  }

  // Confirma que a chave nao permitida NAO entrou na tabela (SF 76 = SELECT-only)
  const audit = await executeServerFunctionMitra({
    projectId,
    serverFunctionId: 76,
    input: { sql: `SELECT COUNT(*) AS N FROM APP_CONFIG WHERE CHAVE = 'AGENT_CHAVE_NAO_PERMITIDA'` },
  });
  let out = audit?.result?.output;
  if (typeof out === 'string') { try { out = JSON.parse(out); } catch { /* keep */ } }
  const n = Number(out?.rows?.[0]?.N ?? -1);
  console.log('Linhas com chave nao permitida em APP_CONFIG →', n);
  if (n !== 0) throw new Error('smoke falhou: a guarda de chave da SF de escrita NAO funcionou');

  console.log(`\nOK. IDs: lerConfigAgenteIA=${readId} gravarConfigAgenteIA=${writeId}`);
}

main().catch((e) => {
  console.error('FALHA:', e?.message || e);
  process.exit(1);
});
