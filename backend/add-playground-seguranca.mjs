// Segmentacao de seguranca do Playground por usuario REAL (:VAR_USER).
//
// Problema (vazamento): os estudos do Playground eram filtrados por um EMAIL
// vindo do cliente (spoofavel e duplicado/ vazio em INT_USER), e a maioria das
// SFs (get/versoes/salvar_*/excluir/renomear/restaurar/set_task) NAO tinha
// nenhuma checagem de dono — qualquer usuario autenticado lia/alterava o estudo
// de outro pelo ID (IDOR). Resultado: "todos veem de todos".
//
// Correcao: dono passa a ser o ID real do usuario logado, injetado pelo servidor
// via :VAR_USER (funciona em SF SQL e JS, validado). Nova coluna PLAYGROUND.
// USUARIO_ID guarda o dono; toda leitura/escrita exige USUARIO_ID = :VAR_USER.
// O compartilhamento por token (SF 185 'publico') continua sendo a UNICA via de
// leitura entre usuarios — por design.
//
// Nao mexe em dados: estudos antigos (todos de demo) ficam com USUARIO_ID NULL e
// simplesmente deixam de aparecer — que e o comportamento seguro desejado.
import 'dotenv/config';
import { configureSdkMitra, runDdlMitra, updateServerFunctionMitra, readServerFunctionMitra, executeServerFunctionMitra } from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});
const projectId = parseInt(process.env.MITRA_PROJECT_ID);

const q = async (sql) => {
  const r = await executeServerFunctionMitra({ projectId, serverFunctionId: 76, input: { sql } });
  let o = r?.result?.output; if (typeof o === 'string') { try { o = JSON.parse(o); } catch { /* */ } }
  return o?.rows || [];
};

// Preambulo identico ao add-playground.mjs (escaping de aspas E backslashes)
const ESC = [
  "const { runDmlMitra, runQueryMitra } = require('mitra-sdk');",
  "const projectId = parseInt(process.env.MITRA_PROJECT_ID);",
  "const esc = (s) => String(s).replace(/\\\\/g, '\\\\\\\\').replace(/'/g, \"''\");",
  "const agora = new Date().toISOString().slice(0, 19);",
];

// ── Codigos SQL (dono = :VAR_USER) ──────────────────────────────────────
const SQL = {
  // 178 criar — grava o dono real na criacao
  178: "INSERT INTO PLAYGROUND (USUARIO, USUARIO_ID, NOME, HTML, TASK_ID, SHARE_TOKEN, CONVERSA, ATIVO, CRIADO_EM, ATUALIZADO_EM) VALUES ('{{usuario}}', :VAR_USER, 'Novo estudo', '', '', '', '', 'true', '{{agora}}', '{{agora}}')",
  // 179 ultimo — ultimo estudo do proprio usuario
  179: "SELECT MAX(ID) AS ID FROM PLAYGROUND WHERE USUARIO_ID = :VAR_USER",
  // 180 listar — SO os estudos do usuario logado
  180: "SELECT ID, NOME, SHARE_TOKEN, TASK_ID, CRIADO_EM, ATUALIZADO_EM, (HTML IS NOT NULL AND HTML <> '') AS TEM_HTML FROM PLAYGROUND WHERE USUARIO_ID = :VAR_USER AND ATIVO = 'true' ORDER BY ATUALIZADO_EM DESC LIMIT 100",
  // 181 get — abre so o proprio estudo (compartilhados vao pela SF 185 publico)
  181: "SELECT ID, USUARIO, NOME, HTML, TASK_ID, SHARE_TOKEN, CONVERSA, CRIADO_EM, ATUALIZADO_EM FROM PLAYGROUND WHERE ID = {{id}} AND USUARIO_ID = :VAR_USER AND ATIVO = 'true'",
  // 182 excluir — so o dono exclui
  182: "UPDATE PLAYGROUND SET ATIVO = 'false', ATUALIZADO_EM = '{{agora}}' WHERE ID = {{id}} AND USUARIO_ID = :VAR_USER",
  // 183 set_task — so o dono vincula a task
  183: "UPDATE PLAYGROUND SET TASK_ID = '{{taskId}}' WHERE ID = {{id}} AND USUARIO_ID = :VAR_USER",
  // 184 compartilhar — so o dono gera o link publico
  184: "UPDATE PLAYGROUND SET SHARE_TOKEN = '{{token}}', ATUALIZADO_EM = '{{agora}}' WHERE ID = {{id}} AND USUARIO_ID = :VAR_USER",
  // 186 versoes — versoes so do proprio estudo (join garante o dono)
  186: "SELECT v.ID, v.CRIADO_EM, CHAR_LENGTH(v.HTML) AS TAMANHO FROM PLAYGROUND_VERSAO v JOIN PLAYGROUND p ON p.ID = v.PLAYGROUND_ID WHERE v.PLAYGROUND_ID = {{id}} AND p.USUARIO_ID = :VAR_USER ORDER BY v.ID DESC LIMIT 50",
};

// ── Codigos JS (dono = :VAR_USER embutido no WHERE do runDml) ───────────
const JS = {
  // 187 salvar_html
  187: [...ESC,
    "const id = parseInt(event.id);",
    "if (!id) throw new Error('id obrigatorio');",
    "const html = String(event.html || '');",
    "if (!html.trim()) throw new Error('html vazio');",
    "await runDmlMitra({ projectId, sql: \"INSERT INTO PLAYGROUND_VERSAO (PLAYGROUND_ID, HTML, CRIADO_EM) SELECT ID, HTML, '\" + agora + \"' FROM PLAYGROUND WHERE ID = \" + id + \" AND USUARIO_ID = :VAR_USER AND HTML IS NOT NULL AND HTML <> ''\" });",
    "await runDmlMitra({ projectId, sql: \"UPDATE PLAYGROUND SET HTML = '\" + esc(html) + \"', ATUALIZADO_EM = '\" + agora + \"' WHERE ID = \" + id + \" AND USUARIO_ID = :VAR_USER\" });",
    "return { ok: true, tamanho: html.length };",
  ].join('\n'),
  // 188 salvar_conversa
  188: [...ESC,
    "const id = parseInt(event.id);",
    "if (!id) throw new Error('id obrigatorio');",
    "const conversa = String(event.conversa || '');",
    "await runDmlMitra({ projectId, sql: \"UPDATE PLAYGROUND SET CONVERSA = '\" + esc(conversa) + \"', ATUALIZADO_EM = '\" + agora + \"' WHERE ID = \" + id + \" AND USUARIO_ID = :VAR_USER\" });",
    "return { ok: true };",
  ].join('\n'),
  // 189 renomear
  189: [...ESC,
    "const id = parseInt(event.id);",
    "if (!id) throw new Error('id obrigatorio');",
    "const nome = String(event.nome || '').trim().slice(0, 200);",
    "if (!nome) throw new Error('nome obrigatorio');",
    "await runDmlMitra({ projectId, sql: \"UPDATE PLAYGROUND SET NOME = '\" + esc(nome) + \"', ATUALIZADO_EM = '\" + agora + \"' WHERE ID = \" + id + \" AND USUARIO_ID = :VAR_USER\" });",
    "return { ok: true, nome };",
  ].join('\n'),
  // 190 restaurar
  190: [...ESC,
    "const id = parseInt(event.id);",
    "const versaoId = parseInt(event.versaoId);",
    "if (!id || !versaoId) throw new Error('id e versaoId obrigatorios');",
    "const v = await runQueryMitra({ projectId, sql: 'SELECT v.HTML AS HTML FROM PLAYGROUND_VERSAO v JOIN PLAYGROUND p ON p.ID = v.PLAYGROUND_ID WHERE v.ID = ' + versaoId + ' AND v.PLAYGROUND_ID = ' + id + ' AND p.USUARIO_ID = :VAR_USER' });",
    "const rows = (v && v.result && v.result.rows) ? v.result.rows : [];",
    "if (!rows.length) throw new Error('versao nao encontrada');",
    "await runDmlMitra({ projectId, sql: \"INSERT INTO PLAYGROUND_VERSAO (PLAYGROUND_ID, HTML, CRIADO_EM) SELECT ID, HTML, '\" + agora + \"' FROM PLAYGROUND WHERE ID = \" + id + \" AND USUARIO_ID = :VAR_USER AND HTML IS NOT NULL AND HTML <> ''\" });",
    "await runDmlMitra({ projectId, sql: \"UPDATE PLAYGROUND SET HTML = '\" + esc(rows[0].HTML || '') + \"', ATUALIZADO_EM = '\" + agora + \"' WHERE ID = \" + id + \" AND USUARIO_ID = :VAR_USER\" });",
    "return { ok: true };",
  ].join('\n'),
};

async function main() {
  console.log('=== Playground: segmentacao por usuario real (:VAR_USER) ===\n');

  // 1. Coluna USUARIO_ID (idempotente)
  const col = await q("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='PLAYGROUND' AND COLUMN_NAME='USUARIO_ID'");
  if (col.length === 0) {
    await runDdlMitra({ projectId, sql: 'ALTER TABLE PLAYGROUND ADD COLUMN USUARIO_ID INT' });
    console.log('OK: coluna PLAYGROUND.USUARIO_ID criada');
  } else {
    console.log('SKIP: coluna PLAYGROUND.USUARIO_ID ja existe');
  }

  // 2. SFs SQL
  for (const [id, code] of Object.entries(SQL)) {
    await updateServerFunctionMitra({ projectId, serverFunctionId: parseInt(id), code });
    console.log(`OK: SF ${id} (SQL) atualizada com :VAR_USER`);
  }
  // 3. SFs JS
  for (const [id, code] of Object.entries(JS)) {
    await updateServerFunctionMitra({ projectId, serverFunctionId: parseInt(id), code });
    console.log(`OK: SF ${id} (JS) atualizada com :VAR_USER`);
  }

  // 4. Verificacao end-to-end (token da service = uid 135):
  //    listar deve mostrar SO os estudos do 135; os de demo (paula, etc.) somem.
  const antes = await q("SELECT COUNT(*) AS N FROM PLAYGROUND WHERE ATIVO='true'");
  const listar = await executeServerFunctionMitra({ projectId, serverFunctionId: 180, input: {} });
  let lo = listar?.result?.output; if (typeof lo === 'string') { try { lo = JSON.parse(lo); } catch { /* */ } }
  const visiveis = lo?.rows || [];
  console.log(`\nVERIFY: estudos ativos no total = ${antes[0]?.N}; visiveis para o usuario logado (uid 135) = ${visiveis.length}`);

  // criar (178) grava USUARIO_ID = :VAR_USER; listar deve passar a ver +1
  await executeServerFunctionMitra({ projectId, serverFunctionId: 178, input: { usuario: 'verify@interno', agora: new Date().toISOString().slice(0, 19) } });
  const ult = await executeServerFunctionMitra({ projectId, serverFunctionId: 179, input: {} });
  let uo = ult?.result?.output; if (typeof uo === 'string') { try { uo = JSON.parse(uo); } catch { /* */ } }
  const novoId = uo?.rows?.[0]?.ID;
  const listar2 = await executeServerFunctionMitra({ projectId, serverFunctionId: 180, input: {} });
  let lo2 = listar2?.result?.output; if (typeof lo2 === 'string') { try { lo2 = JSON.parse(lo2); } catch { /* */ } }
  console.log(`VERIFY: apos criar (dono=:VAR_USER), visiveis para uid 135 = ${(lo2?.rows || []).length} (esperado ${visiveis.length + 1}); novo id = ${novoId}`);
  const donoNovo = await q(`SELECT USUARIO_ID FROM PLAYGROUND WHERE ID = ${novoId}`);
  console.log(`VERIFY: USUARIO_ID do novo estudo = ${donoNovo[0]?.USUARIO_ID} (esperado 135)`);
  // limpa o estudo de verificacao (hard delete — e so o registro de teste)
  await runDdlMitra({ projectId, sql: `DELETE FROM PLAYGROUND WHERE ID = ${novoId}` });
  console.log(`OK: estudo de verificacao ${novoId} removido`);

  console.log('\nConcluido.');
}

main().catch((e) => { console.error('FALHOU:', e); process.exit(1); });
