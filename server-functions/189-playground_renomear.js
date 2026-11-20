-- tipo: JAVASCRIPT | Playground: renomeia o estudo (escaping seguro). Input { id, nome }.
const { runDmlMitra, runQueryMitra } = require('mitra-sdk');
const projectId = parseInt(process.env.MITRA_PROJECT_ID);
const esc = (s) => { const t = String(s); let o = ''; for (let i = 0; i < t.length; i++) { const c = t.charCodeAt(i); if (c < 0xD800 || c > 0xDFFF) o += t[i]; } return o.replace(/\\/g, '\\\\').replace(/'/g, "''"); };
const agora = new Date().toISOString().slice(0, 19);
const _u = await runQueryMitra({ projectId, sql: 'SELECT :VAR_USER AS UID' });
const uid = parseInt((((_u && _u.result && _u.result.rows) || [])[0] || {}).UID);
if (!uid) throw new Error('usuario nao identificado');
const id = parseInt(event.id);
if (!id) throw new Error('id obrigatorio');
const nome = String(event.nome || '').trim().slice(0, 200);
if (!nome) throw new Error('nome obrigatorio');
await runDmlMitra({ projectId, sql: "UPDATE PLAYGROUND SET NOME = '" + esc(nome) + "', ATUALIZADO_EM = '" + agora + "' WHERE ID = " + id + " AND USUARIO_ID = " + uid });
return { ok: true, nome };