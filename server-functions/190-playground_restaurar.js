-- tipo: JAVASCRIPT | Playground: restaura uma versao de HTML (versionando a atual). Input { id, versaoId }.
const { runDmlMitra, runQueryMitra } = require('mitra-sdk');
const projectId = parseInt(process.env.MITRA_PROJECT_ID);
const esc = (s) => { const t = String(s); let o = ''; for (let i = 0; i < t.length; i++) { const c = t.charCodeAt(i); if (c < 0xD800 || c > 0xDFFF) o += t[i]; } return o.replace(/\\/g, '\\\\').replace(/'/g, "''"); };
const agora = new Date().toISOString().slice(0, 19);
const _u = await runQueryMitra({ projectId, sql: 'SELECT :VAR_USER AS UID' });
const uid = parseInt((((_u && _u.result && _u.result.rows) || [])[0] || {}).UID);
if (!uid) throw new Error('usuario nao identificado');
const id = parseInt(event.id);
const versaoId = parseInt(event.versaoId);
if (!id || !versaoId) throw new Error('id e versaoId obrigatorios');
const v = await runQueryMitra({ projectId, sql: 'SELECT v.HTML AS HTML FROM PLAYGROUND_VERSAO v JOIN PLAYGROUND p ON p.ID = v.PLAYGROUND_ID WHERE v.ID = ' + versaoId + ' AND v.PLAYGROUND_ID = ' + id + ' AND p.USUARIO_ID = ' + uid });
const rows = (v && v.result && v.result.rows) ? v.result.rows : [];
if (!rows.length) throw new Error('versao nao encontrada');
await runDmlMitra({ projectId, sql: "INSERT INTO PLAYGROUND_VERSAO (PLAYGROUND_ID, HTML, CRIADO_EM) SELECT ID, HTML, '" + agora + "' FROM PLAYGROUND WHERE ID = " + id + " AND USUARIO_ID = " + uid + " AND HTML IS NOT NULL AND HTML <> ''" });
await runDmlMitra({ projectId, sql: "UPDATE PLAYGROUND SET HTML = '" + esc(rows[0].HTML || '') + "', ATUALIZADO_EM = '" + agora + "' WHERE ID = " + id + " AND USUARIO_ID = " + uid });
return { ok: true };