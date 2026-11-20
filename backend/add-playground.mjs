// Playground — estudos com agente analista (canvas HTML + chat).
// Cria: tabelas PLAYGROUND / PLAYGROUND_VERSAO + SFs de CRUD, consulta livre
// guardada, schema resumo, share publico e versionamento de HTML.
//
// ⚠️ SFs JAVASCRIPT tem o code montado como ARRAY DE STRINGS (padrao da
// add-batch-query-sf.mjs): dentro dessas strings, '\\s' produz \s no code
// final. NUNCA usar template literal com \s cru — vira 's' e quebra as regexes.
import 'dotenv/config';
import {
  configureSdkMitra, runDdlMitra, createServerFunctionMitra,
  listServerFunctionsMitra, executeServerFunctionMitra, togglePublicExecutionMitra,
} from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});
const projectId = parseInt(process.env.MITRA_PROJECT_ID);

// ── 1. Tabelas ──────────────────────────────────────────────────────────
async function ddl() {
  await runDdlMitra({
    projectId,
    sql: `CREATE TABLE IF NOT EXISTS PLAYGROUND (
      ID INT AUTO_INCREMENT PRIMARY KEY,
      USUARIO VARCHAR(200),
      NOME VARCHAR(200),
      HTML MEDIUMTEXT,
      TASK_ID VARCHAR(100),
      SHARE_TOKEN VARCHAR(64),
      CONVERSA MEDIUMTEXT,
      ATIVO VARCHAR(5) DEFAULT 'true',
      CRIADO_EM VARCHAR(19),
      ATUALIZADO_EM VARCHAR(19)
    );`,
  });
  await runDdlMitra({
    projectId,
    sql: `CREATE TABLE IF NOT EXISTS PLAYGROUND_VERSAO (
      ID INT AUTO_INCREMENT PRIMARY KEY,
      PLAYGROUND_ID INT,
      HTML MEDIUMTEXT,
      CRIADO_EM VARCHAR(19),
      FOREIGN KEY (PLAYGROUND_ID) REFERENCES PLAYGROUND(ID)
    );`,
  });
  console.log('DDL ok');
}

// ── 2. SF JS: consulta_livre — SELECT-only com LIMIT 200 forcado ────────
const CODE_CONSULTA_LIVRE = [
  "const { runQueryMitra } = require('mitra-sdk');",
  "const projectId = parseInt(process.env.MITRA_PROJECT_ID);",
  "const sql = String(event.consulta || '').trim();",
  "if (!sql) throw new Error('Informe a consulta em {\"consulta\": \"SELECT ...\"}');",
  "const noComments = sql.replace(/\\/\\*[\\s\\S]*?\\*\\//g, ' ').replace(/--[^\\n]*/g, ' ').replace(/#[^\\n]*/g, ' ').trim();",
  "if (!/^(select|with)\\b/i.test(noComments)) throw new Error('Apenas consultas SELECT sao permitidas');",
  "const semLiterais = noComments.replace(/'(?:[^'\\\\]|\\\\.|'')*'/g, \"''\");",
  "if (semLiterais.replace(/;\\s*$/, '').includes(';')) throw new Error('Apenas uma instrucao por consulta');",
  "if (/\\binto\\s+(outfile|dumpfile)\\b/i.test(semLiterais)) throw new Error('INTO OUTFILE nao permitido');",
  "if (/\\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|rename|call|handler|load)\\b/i.test(semLiterais)) throw new Error('Instrucao nao permitida — apenas SELECT');",
  "let finalSql = noComments.replace(/;\\s*$/, '');",
  "if (!/\\blimit\\s+\\d+/i.test(semLiterais)) finalSql += ' LIMIT 200';",
  "const r = await runQueryMitra({ projectId, sql: finalSql });",
  "const rows = (r && r.result && r.result.rows) ? r.result.rows : [];",
  "return { rowCount: rows.length, rows };",
].join('\n');

// ── 3. SF JS: escrita com escaping correto (aspas E backslashes) ────────
const ESC_LINES = [
  "const { runDmlMitra, runQueryMitra } = require('mitra-sdk');",
  "const projectId = parseInt(process.env.MITRA_PROJECT_ID);",
  "const esc = (s) => String(s).replace(/\\\\/g, '\\\\\\\\').replace(/'/g, \"''\");",
  "const agora = new Date().toISOString().slice(0, 19);",
];

const CODE_SALVAR_HTML = [
  ...ESC_LINES,
  "const id = parseInt(event.id);",
  "if (!id) throw new Error('id obrigatorio');",
  "const html = String(event.html || '');",
  "if (!html.trim()) throw new Error('html vazio');",
  "await runDmlMitra({ projectId, sql: \"INSERT INTO PLAYGROUND_VERSAO (PLAYGROUND_ID, HTML, CRIADO_EM) SELECT ID, HTML, '\" + agora + \"' FROM PLAYGROUND WHERE ID = \" + id + \" AND HTML IS NOT NULL AND HTML <> ''\" });",
  "await runDmlMitra({ projectId, sql: \"UPDATE PLAYGROUND SET HTML = '\" + esc(html) + \"', ATUALIZADO_EM = '\" + agora + \"' WHERE ID = \" + id });",
  "return { ok: true, tamanho: html.length };",
].join('\n');

const CODE_SALVAR_CONVERSA = [
  ...ESC_LINES,
  "const id = parseInt(event.id);",
  "if (!id) throw new Error('id obrigatorio');",
  "const conversa = String(event.conversa || '');",
  "await runDmlMitra({ projectId, sql: \"UPDATE PLAYGROUND SET CONVERSA = '\" + esc(conversa) + \"', ATUALIZADO_EM = '\" + agora + \"' WHERE ID = \" + id });",
  "return { ok: true };",
].join('\n');

const CODE_RENOMEAR = [
  ...ESC_LINES,
  "const id = parseInt(event.id);",
  "if (!id) throw new Error('id obrigatorio');",
  "const nome = String(event.nome || '').trim().slice(0, 200);",
  "if (!nome) throw new Error('nome obrigatorio');",
  "await runDmlMitra({ projectId, sql: \"UPDATE PLAYGROUND SET NOME = '\" + esc(nome) + \"', ATUALIZADO_EM = '\" + agora + \"' WHERE ID = \" + id });",
  "return { ok: true, nome };",
].join('\n');

const CODE_RESTAURAR = [
  ...ESC_LINES,
  "const id = parseInt(event.id);",
  "const versaoId = parseInt(event.versaoId);",
  "if (!id || !versaoId) throw new Error('id e versaoId obrigatorios');",
  "const v = await runQueryMitra({ projectId, sql: 'SELECT HTML FROM PLAYGROUND_VERSAO WHERE ID = ' + versaoId + ' AND PLAYGROUND_ID = ' + id });",
  "const rows = (v && v.result && v.result.rows) ? v.result.rows : [];",
  "if (!rows.length) throw new Error('versao nao encontrada');",
  "await runDmlMitra({ projectId, sql: \"INSERT INTO PLAYGROUND_VERSAO (PLAYGROUND_ID, HTML, CRIADO_EM) SELECT ID, HTML, '\" + agora + \"' FROM PLAYGROUND WHERE ID = \" + id + \" AND HTML IS NOT NULL AND HTML <> ''\" });",
  "await runDmlMitra({ projectId, sql: \"UPDATE PLAYGROUND SET HTML = '\" + esc(rows[0].HTML || '') + \"', ATUALIZADO_EM = '\" + agora + \"' WHERE ID = \" + id });",
  "return { ok: true };",
].join('\n');

// ── 4. Definicao das SFs ────────────────────────────────────────────────
const SFS = [
  { name: 'consulta_livre', type: 'JAVASCRIPT', code: CODE_CONSULTA_LIVRE,
    description: 'Playground: SELECT livre com guardas (so SELECT, 1 statement, LIMIT 200 forcado). Input {"consulta": "SELECT ..."}. Retorna { rowCount, rows }.' },
  { name: 'schema_resumo', type: 'SQL',
    code: "SELECT TABLE_NAME AS TABELA, GROUP_CONCAT(COLUMN_NAME ORDER BY ORDINAL_POSITION SEPARATOR ', ') AS COLUNAS FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() GROUP BY TABLE_NAME ORDER BY TABLE_NAME",
    description: 'Playground: resumo do schema — cada tabela com suas colunas concatenadas (sem params).' },
  { name: 'playground_criar', type: 'SQL',
    code: "INSERT INTO PLAYGROUND (USUARIO, NOME, HTML, TASK_ID, SHARE_TOKEN, CONVERSA, ATIVO, CRIADO_EM, ATUALIZADO_EM) VALUES ('{{usuario}}', 'Novo estudo', '', '', '', '', 'true', '{{agora}}', '{{agora}}')",
    description: 'Playground: cria estudo vazio — params usuario, agora.' },
  { name: 'playground_ultimo', type: 'SQL',
    code: "SELECT MAX(ID) AS ID FROM PLAYGROUND WHERE USUARIO = '{{usuario}}'",
    description: 'Playground: ID do estudo mais recente do usuario — param usuario.' },
  { name: 'playground_listar', type: 'SQL',
    code: "SELECT ID, NOME, SHARE_TOKEN, TASK_ID, CRIADO_EM, ATUALIZADO_EM, (HTML IS NOT NULL AND HTML <> '') AS TEM_HTML FROM PLAYGROUND WHERE USUARIO = '{{usuario}}' AND ATIVO = 'true' ORDER BY ATUALIZADO_EM DESC LIMIT 100",
    description: 'Playground: lista estudos ativos do usuario — param usuario.' },
  { name: 'playground_get', type: 'SQL',
    code: "SELECT ID, USUARIO, NOME, HTML, TASK_ID, SHARE_TOKEN, CONVERSA, CRIADO_EM, ATUALIZADO_EM FROM PLAYGROUND WHERE ID = {{id}} AND ATIVO = 'true'",
    description: 'Playground: carrega um estudo completo — param id.' },
  { name: 'playground_excluir', type: 'SQL',
    code: "UPDATE PLAYGROUND SET ATIVO = 'false', ATUALIZADO_EM = '{{agora}}' WHERE ID = {{id}}",
    description: 'Playground: exclusao soft — params id, agora.' },
  { name: 'playground_set_task', type: 'SQL',
    code: "UPDATE PLAYGROUND SET TASK_ID = '{{taskId}}' WHERE ID = {{id}}",
    description: 'Playground: vincula a thread do agente ao estudo — params id, taskId.' },
  { name: 'playground_compartilhar', type: 'SQL',
    code: "UPDATE PLAYGROUND SET SHARE_TOKEN = '{{token}}', ATUALIZADO_EM = '{{agora}}' WHERE ID = {{id}}",
    description: 'Playground: define token de compartilhamento — params id, token, agora.' },
  { name: 'playground_publico', type: 'SQL',
    code: "SELECT NOME, HTML, ATUALIZADO_EM FROM PLAYGROUND WHERE SHARE_TOKEN = '{{token}}' AND SHARE_TOKEN <> '' AND ATIVO = 'true'",
    description: 'Playground: leitura de um estudo compartilhado por token — param token. Exige sessao logada (nao e publica).' },
  { name: 'playground_versoes', type: 'SQL',
    code: "SELECT ID, CRIADO_EM, CHAR_LENGTH(HTML) AS TAMANHO FROM PLAYGROUND_VERSAO WHERE PLAYGROUND_ID = {{id}} ORDER BY ID DESC LIMIT 50",
    description: 'Playground: lista versoes de HTML do estudo — param id.' },
  { name: 'playground_salvar_html', type: 'JAVASCRIPT', code: CODE_SALVAR_HTML,
    description: 'Playground: salva o HTML do canvas versionando o anterior. Input { id, html }.' },
  { name: 'playground_salvar_conversa', type: 'JAVASCRIPT', code: CODE_SALVAR_CONVERSA,
    description: 'Playground: persiste a conversa rica (JSON de segmentos). Input { id, conversa }.' },
  { name: 'playground_renomear', type: 'JAVASCRIPT', code: CODE_RENOMEAR,
    description: 'Playground: renomeia o estudo (escaping seguro). Input { id, nome }.' },
  { name: 'playground_restaurar', type: 'JAVASCRIPT', code: CODE_RESTAURAR,
    description: 'Playground: restaura uma versao de HTML (versionando a atual). Input { id, versaoId }.' },
];

async function createSfs() {
  const existing = await listServerFunctionsMitra({ projectId });
  const byName = new Map((existing.result || existing || []).map((f) => [f.name, f]));
  const ids = {};
  for (const sf of SFS) {
    const found = byName.get(sf.name);
    if (found) {
      console.log(`= ja existe: ${sf.name} (id ${found.id})`);
      ids[sf.name] = found.id;
      continue;
    }
    const r = await createServerFunctionMitra({ projectId, name: sf.name, type: sf.type, code: sf.code, description: sf.description });
    const id = r?.result?.serverFunctionId ?? r?.result?.id;
    console.log(`+ criada: ${sf.name} (id ${id})`);
    ids[sf.name] = id;
  }
  // fonte da verdade
  const after = await listServerFunctionsMitra({ projectId });
  for (const sf of SFS) {
    const f = (after.result || after || []).find((x) => x.name === sf.name);
    if (f) ids[sf.name] = f.id;
  }
  // marca a SF publica
  try {
    // Link compartilhado exige login na base (pedido do usuario em 2026-07-10):
    // a SF NAO e publica — executa apenas com token de sessao valido.
    await togglePublicExecutionMitra({ projectId, serverFunctionId: ids.playground_publico, publicExecution: false });
    console.log('playground_publico restrita a usuarios logados');
  } catch (e) {
    console.error('togglePublic falhou:', e?.message || e);
  }
  console.log('\n=== IDS ===');
  console.log(JSON.stringify(ids, null, 2));
  return ids;
}

// ── 5. Suite de validacao ───────────────────────────────────────────────
async function exec(id, input) {
  const r = await executeServerFunctionMitra({ projectId, serverFunctionId: id, input });
  const res = r?.result;
  let out = res?.output;
  if (typeof out === 'string') { try { out = JSON.parse(out); } catch { /* keep */ } }
  return { status: res?.executionStatus, error: res?.error, out };
}

function assert(cond, label) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) process.exitCode = 1;
}

async function validate(ids) {
  console.log('\n=== SUITE consulta_livre ===');
  let r = await exec(ids.consulta_livre, { consulta: 'SELECT ID, NOME FROM CENTRO_RESULTADO ORDER BY ID' });
  assert(r.status === 'COMPLETED' && Array.isArray(r.out?.rows) && r.out.rows.length > 0, `SELECT simples ok (${r.out?.rowCount} rows) ${r.error || ''}`);

  r = await exec(ids.consulta_livre, { consulta: 'SELECT * FROM ORCAMENTO' });
  assert(r.status === 'COMPLETED' && (r.out?.rows?.length ?? 999) <= 200, `LIMIT 200 forcado (${r.out?.rows?.length} rows)`);

  r = await exec(ids.consulta_livre, { consulta: "UPDATE PLAYGROUND SET NOME = 'x'" });
  assert(r.status === 'FAILED', `UPDATE bloqueado (${(r.error || '').slice(0, 60)})`);

  r = await exec(ids.consulta_livre, { consulta: "SELECT 1; DROP TABLE PLAYGROUND" });
  assert(r.status === 'FAILED', `multi-statement bloqueado (${(r.error || '').slice(0, 60)})`);

  r = await exec(ids.consulta_livre, { consulta: "SELECT 'a;b' AS X, ID FROM CICLO LIMIT 3" });
  assert(r.status === 'COMPLETED', `';' dentro de literal permitido ${r.error || ''}`);

  r = await exec(ids.consulta_livre, { consulta: "SELECT ID, CONCAT('cr-', NOME) AS ROTULO FROM CENTRO_RESULTADO LIMIT 5" });
  assert(r.status === 'COMPLETED' && r.out?.rows?.length > 0, 'SELECT com funcao/alias ok');

  console.log('\n=== SUITE schema_resumo ===');
  r = await exec(ids.schema_resumo, {});
  const temPg = r.out?.rows?.some((x) => x.TABELA === 'PLAYGROUND');
  assert(r.status === 'COMPLETED' && temPg, `schema_resumo ok (${r.out?.rows?.length} tabelas)`);

  console.log('\n=== SUITE CRUD do estudo ===');
  const agora = new Date().toISOString().slice(0, 19);
  const usuario = 'suite@teste.local';
  await exec(ids.playground_criar, { usuario, agora });
  r = await exec(ids.playground_ultimo, { usuario });
  const pgId = r.out?.rows?.[0]?.ID;
  assert(!!pgId, `criar + ultimo → id ${pgId}`);

  // salvar_html com aspas, backslash e emoji-free html
  const html1 = `<html><body><h1>Analise 'v1'</h1><div style="color:#8b5cf6">path\\to\\x & "quote"</div></body></html>`;
  r = await exec(ids.playground_salvar_html, { id: pgId, html: html1 });
  assert(r.status === 'COMPLETED' && r.out?.ok, `salvar_html v1 ${r.error || ''}`);
  r = await exec(ids.playground_get, { id: pgId });
  assert(r.out?.rows?.[0]?.HTML === html1, 'roundtrip HTML preserva aspas e backslashes');

  const html2 = '<html><body><h2>v2</h2></body></html>';
  await exec(ids.playground_salvar_html, { id: pgId, html: html2 });
  r = await exec(ids.playground_versoes, { id: pgId });
  assert(r.out?.rows?.length === 1, `salvar_html v2 versionou a v1 (${r.out?.rows?.length} versao)`);
  const versaoId = r.out?.rows?.[0]?.ID;

  r = await exec(ids.playground_restaurar, { id: pgId, versaoId });
  const g = await exec(ids.playground_get, { id: pgId });
  assert(r.status === 'COMPLETED' && g.out?.rows?.[0]?.HTML === html1, 'restaurar volta pra v1 (e versiona a v2)');

  r = await exec(ids.playground_renomear, { id: pgId, nome: "Queda do Ze — analise 'quali'" });
  const g2 = await exec(ids.playground_get, { id: pgId });
  assert(r.status === 'COMPLETED' && g2.out?.rows?.[0]?.NOME?.includes("'quali'"), `renomear com apostrofe ok (${g2.out?.rows?.[0]?.NOME})`);

  const conversa = JSON.stringify([{ role: 'agent', segments: [{ t: 'md', c: 'linha1\ncom "aspas" e \\barra' }, { t: 'tool', label: 'Consultando dados' }] }]);
  r = await exec(ids.playground_salvar_conversa, { id: pgId, conversa });
  const g3 = await exec(ids.playground_get, { id: pgId });
  assert(r.status === 'COMPLETED' && g3.out?.rows?.[0]?.CONVERSA === conversa, 'roundtrip CONVERSA (JSON) intacto');

  await exec(ids.playground_set_task, { id: pgId, taskId: 'task-abc-123' });
  const g4 = await exec(ids.playground_get, { id: pgId });
  assert(g4.out?.rows?.[0]?.TASK_ID === 'task-abc-123', 'set_task ok');

  const token = 'tok' + Math.random().toString(16).slice(2, 18);
  await exec(ids.playground_compartilhar, { id: pgId, token, agora });
  r = await exec(ids.playground_publico, { token });
  assert(r.out?.rows?.[0]?.HTML === html1, 'compartilhar + publico devolve o HTML');
  r = await exec(ids.playground_publico, { token: 'inexistente' });
  assert((r.out?.rows?.length ?? 0) === 0, 'publico com token invalido devolve vazio');

  r = await exec(ids.playground_listar, { usuario });
  assert(r.out?.rows?.some((x) => x.ID === pgId && Number(x.TEM_HTML) === 1), 'listar mostra o estudo com TEM_HTML');

  await exec(ids.playground_excluir, { id: pgId, agora });
  r = await exec(ids.playground_listar, { usuario });
  assert(!r.out?.rows?.some((x) => x.ID === pgId), 'excluir (soft) some da lista');
  r = await exec(ids.playground_publico, { token });
  assert((r.out?.rows?.length ?? 0) === 0, 'estudo excluido nao vaza pelo link publico');
}

await ddl();
const ids = await createSfs();
await validate(ids);
console.log('\nDone.');
