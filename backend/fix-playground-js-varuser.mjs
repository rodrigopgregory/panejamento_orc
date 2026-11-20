// Correcao do fix de seguranca do Playground (add-playground-seguranca.mjs):
// nas SFs JAVASCRIPT (187/188/189/190) eu usei ":VAR_USER" DENTRO de runDmlMitra,
// mas :VAR_USER SO e substituido em SF tipo SQL e em runQueryMitra — em runDmlMitra
// ele vai literal e quebra o SQL (SYNTAX_ERROR). Resultado: salvar_html / renomear
// / salvar_conversa / restaurar falhavam e o estudo nascia sem tela e sem nome.
//
// Solucao: resolver o ID real do usuario logado via runQueryMitra('SELECT :VAR_USER')
// (que substitui certo) e interpolar o numero (uid) no WHERE dos runDmlMitra.
// As SFs SQL (178-186) ja funcionam com :VAR_USER direto — nao mexo nelas.
import 'dotenv/config';
import { configureSdkMitra, updateServerFunctionMitra, executeServerFunctionMitra, runDmlMitra } from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});
const projectId = parseInt(process.env.MITRA_PROJECT_ID);

// Preambulo: escaping + resolve uid do usuario logado (runQuery substitui :VAR_USER).
const PRE = [
  "const { runDmlMitra, runQueryMitra } = require('mitra-sdk');",
  "const projectId = parseInt(process.env.MITRA_PROJECT_ID);",
  "const esc = (s) => String(s).replace(/\\\\/g, '\\\\\\\\').replace(/'/g, \"''\");",
  "const agora = new Date().toISOString().slice(0, 19);",
  "const _u = await runQueryMitra({ projectId, sql: 'SELECT :VAR_USER AS UID' });",
  "const uid = parseInt((((_u && _u.result && _u.result.rows) || [])[0] || {}).UID);",
  "if (!uid) throw new Error('usuario nao identificado');",
];

const JS = {
  187: [...PRE,
    "const id = parseInt(event.id);",
    "if (!id) throw new Error('id obrigatorio');",
    "const html = String(event.html || '');",
    "if (!html.trim()) throw new Error('html vazio');",
    "await runDmlMitra({ projectId, sql: \"INSERT INTO PLAYGROUND_VERSAO (PLAYGROUND_ID, HTML, CRIADO_EM) SELECT ID, HTML, '\" + agora + \"' FROM PLAYGROUND WHERE ID = \" + id + \" AND USUARIO_ID = \" + uid + \" AND HTML IS NOT NULL AND HTML <> ''\" });",
    "await runDmlMitra({ projectId, sql: \"UPDATE PLAYGROUND SET HTML = '\" + esc(html) + \"', ATUALIZADO_EM = '\" + agora + \"' WHERE ID = \" + id + \" AND USUARIO_ID = \" + uid });",
    "return { ok: true, tamanho: html.length };",
  ].join('\n'),
  188: [...PRE,
    "const id = parseInt(event.id);",
    "if (!id) throw new Error('id obrigatorio');",
    "const conversa = String(event.conversa || '');",
    "await runDmlMitra({ projectId, sql: \"UPDATE PLAYGROUND SET CONVERSA = '\" + esc(conversa) + \"', ATUALIZADO_EM = '\" + agora + \"' WHERE ID = \" + id + \" AND USUARIO_ID = \" + uid });",
    "return { ok: true };",
  ].join('\n'),
  189: [...PRE,
    "const id = parseInt(event.id);",
    "if (!id) throw new Error('id obrigatorio');",
    "const nome = String(event.nome || '').trim().slice(0, 200);",
    "if (!nome) throw new Error('nome obrigatorio');",
    "await runDmlMitra({ projectId, sql: \"UPDATE PLAYGROUND SET NOME = '\" + esc(nome) + \"', ATUALIZADO_EM = '\" + agora + \"' WHERE ID = \" + id + \" AND USUARIO_ID = \" + uid });",
    "return { ok: true, nome };",
  ].join('\n'),
  190: [...PRE,
    "const id = parseInt(event.id);",
    "const versaoId = parseInt(event.versaoId);",
    "if (!id || !versaoId) throw new Error('id e versaoId obrigatorios');",
    "const v = await runQueryMitra({ projectId, sql: 'SELECT v.HTML AS HTML FROM PLAYGROUND_VERSAO v JOIN PLAYGROUND p ON p.ID = v.PLAYGROUND_ID WHERE v.ID = ' + versaoId + ' AND v.PLAYGROUND_ID = ' + id + ' AND p.USUARIO_ID = ' + uid });",
    "const rows = (v && v.result && v.result.rows) ? v.result.rows : [];",
    "if (!rows.length) throw new Error('versao nao encontrada');",
    "await runDmlMitra({ projectId, sql: \"INSERT INTO PLAYGROUND_VERSAO (PLAYGROUND_ID, HTML, CRIADO_EM) SELECT ID, HTML, '\" + agora + \"' FROM PLAYGROUND WHERE ID = \" + id + \" AND USUARIO_ID = \" + uid + \" AND HTML IS NOT NULL AND HTML <> ''\" });",
    "await runDmlMitra({ projectId, sql: \"UPDATE PLAYGROUND SET HTML = '\" + esc(rows[0].HTML || '') + \"', ATUALIZADO_EM = '\" + agora + \"' WHERE ID = \" + id + \" AND USUARIO_ID = \" + uid });",
    "return { ok: true };",
  ].join('\n'),
};

const ex = async (id, input = {}) => {
  const r = await executeServerFunctionMitra({ projectId, serverFunctionId: id, input });
  let o = r?.result?.output; if (typeof o === 'string') { try { o = JSON.parse(o); } catch { /* */ } }
  return { st: r?.result?.executionStatus, o, err: r?.result?.error };
};

async function main() {
  console.log('=== Fix Playground JS SFs (:VAR_USER via uid resolvido) ===\n');
  for (const [id, code] of Object.entries(JS)) {
    await updateServerFunctionMitra({ projectId, serverFunctionId: parseInt(id), code });
    console.log(`OK: SF ${id} (JS) corrigida`);
  }

  // Verify: cria estudo de teste (dono = uid do token), salva HTML, renomeia, confirma.
  const agora = new Date().toISOString().slice(0, 19);
  await ex(178, { usuario: 'verify@interno', agora });
  const ult = await ex(179, {});
  const tid = ult.o?.rows?.[0]?.ID;
  console.log(`\nVERIFY: estudo de teste id=${tid}`);
  const sh = await ex(187, { id: tid, html: '<!DOCTYPE html><html><body>ok</body></html>' });
  console.log('salvar_html →', sh.st, sh.err || JSON.stringify(sh.o));
  const rn = await ex(189, { id: tid, nome: 'Estudo verificado' });
  console.log('renomear    →', rn.st, rn.err || JSON.stringify(rn.o));
  const sc = await ex(188, { id: tid, conversa: '[{"role":"user","segments":[{"t":"md","c":"oi"}]}]' });
  console.log('salvar_conversa →', sc.st, sc.err || JSON.stringify(sc.o));
  const g = await ex(181, { id: tid, _cb: Date.now() });
  const row = g.o?.rows?.[0];
  console.log(`get id=${tid} → NOME='${row?.NOME}' TEM_HTML=${row?.HTML ? 1 : 0}`);
  // limpa
  await runDmlMitra({ projectId, sql: `DELETE FROM PLAYGROUND_VERSAO WHERE PLAYGROUND_ID = ${tid}` });
  await runDmlMitra({ projectId, sql: `DELETE FROM PLAYGROUND WHERE ID = ${tid} AND USUARIO_ID = ${row?.USUARIO_ID || 0}` });
  console.log(`cleanup id=${tid} ok`);
  console.log('\nConcluido.');
}

main().catch((e) => { console.error('FALHOU:', e); process.exit(1); });
