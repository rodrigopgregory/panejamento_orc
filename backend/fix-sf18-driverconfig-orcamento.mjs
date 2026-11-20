// Rodada de hardening/consistencia (Task 6 do tasks.md):
//  1. Cria SF executarConsultaSegura (JAVASCRIPT, SELECT-only server-side) para
//     substituir a SF 18 ({{sql}} arbitrario) nas leituras legadas do frontend.
//  2. Cria SFs dedicadas modelosAtivosPorCR / configContaDriverPorCR lendo a
//     config VIVA (CR_CONTA x CONTA_DRIVER x CONTA_DRIVER_EXCECAO x DRIVERS),
//     substituindo as leituras da tabela legada DRIVER_CONFIG (progresso/kanban).
//  3. Remove duplicatas de ORCAMENTO (mantem o ID mais recente) e cria indice
//     unico UX_ORCAMENTO (CICLO_ID, CR_ID, CONTA_ID, MES).
// A SF 18 NAO e deletada aqui — o delete acontece depois que o frontend for
// atualizado e buildado (script delete-sf18.mjs).

import 'dotenv/config';
import {
  configureSdkMitra, createServerFunctionMitra, executeServerFunctionMitra,
  runDdlMitra, runDmlMitra, listServerFunctionsMitra,
} from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});
const projectId = parseInt(process.env.MITRA_PROJECT_ID);

// ── 1. SF SELECT-only (substituta da SF 18) ────────────────────────────────
// Valida server-side: comeca com SELECT/WITH, uma unica instrucao, sem
// INTO OUTFILE e sem palavras de mutacao fora de literais de string.
const SECURE_QUERY_CODE = [
  "const { runQueryMitra } = require('mitra-sdk');",
  "const projectId = parseInt(process.env.MITRA_PROJECT_ID);",
  "const sql = String(event.sql || '');",
  "const noComments = sql.replace(/\\/\\*[\\s\\S]*?\\*\\//g, ' ').replace(/--[^\\n]*/g, ' ').replace(/#[^\\n]*/g, ' ').trim();",
  "if (!/^(select|with)\\b/i.test(noComments)) throw new Error('Apenas consultas SELECT sao permitidas');",
  "const semLiterais = noComments.replace(/'(?:[^'\\\\]|\\\\.|'')*'/g, \"''\");",
  "if (semLiterais.replace(/;\\s*$/, '').includes(';')) throw new Error('Apenas uma instrucao por chamada');",
  "if (/\\binto\\s+(outfile|dumpfile)\\b/i.test(semLiterais)) throw new Error('INTO OUTFILE nao permitido');",
  "if (/\\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|rename|call|handler)\\b/i.test(semLiterais)) throw new Error('Instrucao nao permitida');",
  "const r = await runQueryMitra({ projectId, sql });",
  "return r && r.result ? r.result : { rows: [], rowCount: 0 };",
].join('\n');

// ── 2. SFs de config viva (substituem DRIVER_CONFIG) ───────────────────────
// Mesmo COALESCE do grid em modo CR (OrcamentoContent rawConfigs): excecao de
// pacote > pacote global > excecao de driver > driver global.
const SQL_MODELOS_POR_CR = `
SELECT crc.CR_ID, COUNT(DISTINCT d.NOME) AS TOTAL
FROM CR_CONTA crc
LEFT JOIN CONTA_DRIVER_EXCECAO cde ON cde.CR_ID = crc.CR_ID AND cde.CONTA_ID = crc.CONTA_ID AND cde.ATIVO = true
LEFT JOIN CONTA_DRIVER cd ON cd.CONTA_ID = crc.CONTA_ID
LEFT JOIN DRIVERS d ON d.ID = COALESCE(cde.PACOTE_ID, cd.PACOTE_ID, cde.DRIVER_ID, cd.DRIVER_ID)
WHERE crc.CR_ID IN ({{crIds}}) AND crc.ATIVO = true AND d.ID IS NOT NULL AND d.ATIVO = 'true'
GROUP BY crc.CR_ID`.trim();

const SQL_CONFIG_CONTA_DRIVER = `
SELECT DISTINCT crc.CONTA_ID, d.NOME AS DRIVER_TIPO
FROM CR_CONTA crc
LEFT JOIN CONTA_DRIVER_EXCECAO cde ON cde.CR_ID = crc.CR_ID AND cde.CONTA_ID = crc.CONTA_ID AND cde.ATIVO = true
LEFT JOIN CONTA_DRIVER cd ON cd.CONTA_ID = crc.CONTA_ID
LEFT JOIN DRIVERS d ON d.ID = COALESCE(cde.PACOTE_ID, cd.PACOTE_ID, cde.DRIVER_ID, cd.DRIVER_ID)
WHERE crc.CR_ID = {{crId}} AND crc.ATIVO = true AND d.ID IS NOT NULL AND d.ATIVO = 'true'`.trim();

async function main() {
  // Evita duplicar SFs se o script rodar 2x
  const existing = await listServerFunctionsMitra({ projectId });
  const byName = {};
  for (const f of existing.result || existing || []) byName[f.name] = f.id;

  async function ensureSF(def) {
    if (byName[def.name]) { console.log(`SF ja existe: ${def.name} = ${byName[def.name]}`); return byName[def.name]; }
    const r = await createServerFunctionMitra({ projectId, ...def });
    const id = r.result?.serverFunctionId ?? r.result?.id;
    console.log(`SF criada: ${def.name} = ${id}`);
    return id;
  }

  const idSegura = await ensureSF({
    name: 'executarConsultaSegura', type: 'JAVASCRIPT', code: SECURE_QUERY_CODE,
    description: 'Consulta generica SELECT-only — valida server-side que o SQL e um unico SELECT (substitui a SF 18 executarConsulta)',
  });
  const idModelos = await ensureSF({
    name: 'modelosAtivosPorCR', type: 'SQL', code: SQL_MODELOS_POR_CR,
    description: 'Total de modelos (drivers efetivos ativos) por CR a partir da config viva CR_CONTA x CONTA_DRIVER — param crIds (lista de inteiros separada por virgula)',
  });
  const idConfig = await ensureSF({
    name: 'configContaDriverPorCR', type: 'SQL', code: SQL_CONFIG_CONTA_DRIVER,
    description: 'Mapa conta -> driver efetivo ativo de um CR a partir da config viva (substitui leitura da tabela legada DRIVER_CONFIG) — param crId (inteiro)',
  });

  // ── 3. Dedup ORCAMENTO + indice unico ────────────────────────────────────
  console.log('\nDedup ORCAMENTO (mantendo o registro mais recente por CICLO/CR/CONTA/MES)...');
  await runDmlMitra({ projectId, sql:
    'DELETE o FROM ORCAMENTO o JOIN ORCAMENTO o2 ON o2.CICLO_ID = o.CICLO_ID AND o2.CR_ID = o.CR_ID AND o2.CONTA_ID = o.CONTA_ID AND o2.MES = o.MES AND o2.ID > o.ID' });
  console.log('Dedup executado.');

  try {
    await runDdlMitra({ projectId, sql:
      'ALTER TABLE ORCAMENTO ADD CONSTRAINT UX_ORCAMENTO UNIQUE (CICLO_ID, CR_ID, CONTA_ID, MES)' });
    console.log('Indice unico UX_ORCAMENTO criado.');
  } catch (e) {
    console.log('Indice unico: ' + (e.message || e));
  }

  // ── 4. Validacoes ─────────────────────────────────────────────────────────
  console.log('\n=== VALIDACOES ===');
  async function exec(id, input) {
    const r = await executeServerFunctionMitra({ projectId, serverFunctionId: id, input });
    const res = r?.result;
    let out = res?.output; if (typeof out === 'string') { try { out = JSON.parse(out); } catch {} }
    return { status: res?.executionStatus, error: res?.error, rows: out?.rows ?? out };
  }

  // 4a. SELECT legitimo passa
  let v = await exec(idSegura, { sql: 'SELECT COUNT(*) AS N FROM ORCAMENTO' });
  console.log('SELECT ok:', v.status, JSON.stringify(v.rows).slice(0, 80));

  // 4b. Mutacoes bloqueadas
  for (const bad of [
    'DELETE FROM ORCAMENTO',
    'SELECT 1; DROP TABLE ORCAMENTO',
    "SELECT * FROM ORCAMENTO INTO OUTFILE '/tmp/x'",
    'UPDATE ORCAMENTO SET VALOR = 0',
    'INSERT INTO ORCAMENTO (CICLO_ID) VALUES (1)',
  ]) {
    v = await exec(idSegura, { sql: bad });
    const blocked = v.status === 'FAILED' || (v.error != null);
    console.log(`${blocked ? 'BLOQUEADO' : '!!! PASSOU !!!'} -> ${bad.slice(0, 45)}`);
  }

  // 4c. SELECT com palavra parecida (CRIADO_EM / falso positivo) passa
  v = await exec(idSegura, { sql: "SELECT 'delete me not' AS TXT" });
  console.log('Literal com palavra proibida em string:', v.status);

  // 4d. SFs de config viva
  v = await exec(idModelos, { crIds: '1,2,3,4,5' });
  console.log('modelosAtivosPorCR:', v.status, JSON.stringify(v.rows).slice(0, 120));
  v = await exec(idConfig, { crId: 1 });
  console.log('configContaDriverPorCR:', v.status, `${Array.isArray(v.rows) ? v.rows.length : '?'} linhas`);

  // 4e. Comparativo DRIVER_CONFIG (legada) vs config viva para CR 1
  const cmpLegada = await exec(18, { sql: 'SELECT COUNT(DISTINCT DRIVER_TIPO) AS T FROM DRIVER_CONFIG WHERE CR_ID = 1' });
  console.log('CR 1 — legada DRIVER_CONFIG:', JSON.stringify(cmpLegada.rows), '| viva:', JSON.stringify((await exec(idModelos, { crIds: '1' })).rows));

  // 4f. Duplicatas remanescentes
  const dup = await exec(18, { sql: 'SELECT COUNT(*) AS GRUPOS FROM (SELECT 1 FROM ORCAMENTO GROUP BY CICLO_ID, CR_ID, CONTA_ID, MES HAVING COUNT(*) > 1) t' });
  console.log('Grupos duplicados restantes em ORCAMENTO:', JSON.stringify(dup.rows));

  console.log('\nIDs para o frontend:', JSON.stringify({ executarConsultaSegura: idSegura, modelosAtivosPorCR: idModelos, configContaDriverPorCR: idConfig }));
}

main().catch(e => { console.error('ERRO:', e.message || e); process.exit(1); });
