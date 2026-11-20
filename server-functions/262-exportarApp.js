-- tipo: JAVASCRIPT | Configuracoes > Exportar: codigo leve, pacote completo e envio ao GitHub. Acoes: estado, iniciar, executar, link, iniciarGit, executarGit. So donos em EXPORT_DONOS.
const sdk = require('mitra-sdk');
const zlib = require('zlib');
const projectId = Number(process.env.MITRA_PROJECT_ID);
const ACAO = String(event.acao || '');

const sqlTxt = (v) => String(v == null ? '' : v).replace(/[\u{10000}-\u{10FFFF}]/gu, '').replace(/\\/g, '\\\\').replace(/'/g, "''");
const agora = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 19);
const rows = async (sql) => { const r = await sdk.runQueryMitra({ projectId, sql }); return (r && r.result && r.result.rows) || []; };
const dml = async (sql) => sdk.runDmlMitra({ projectId, sql });
const paginar = async (base, ordem) => {
  const out = [];
  for (let off = 0; ; off += 2000) {
    const lote = await rows(base + ' ORDER BY ' + ordem + ' LIMIT 2000 OFFSET ' + off);
    for (const l of lote) out.push(l);
    if (lote.length < 2000) break;
  }
  return out;
};

const PADROES = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  /AIza[0-9A-Za-z_-]{20,}/g,
  /\b(?:t?sk)_[A-Za-z0-9]{20,}/g,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g,
];
const limpar = (texto, extras) => {
  let t = String(texto);
  for (const p of PADROES) t = t.replace(p, '[REMOVIDO]');
  for (const e of extras || []) if (e && String(e).length >= 6) t = t.split(String(e)).join('[REMOVIDO]');
  return t;
};

const TAB = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t.push(c >>> 0); } return t; })();
const crc32 = (buf) => { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = TAB[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
const montarZip = (entradas) => {
  const partes = []; const central = []; let off = 0;
  for (const e of entradas) {
    const nome = Buffer.from(e.nome, 'utf8'); const dados = Buffer.isBuffer(e.dados) ? e.dados : Buffer.from(e.dados, 'utf8');
    const comp = zlib.deflateRawSync(dados); const crc = crc32(dados);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(8, 8);
    h.writeUInt16LE(0, 10); h.writeUInt16LE(0x21, 12); h.writeUInt32LE(crc, 14); h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(dados.length, 22); h.writeUInt16LE(nome.length, 26);
    partes.push(h, nome, comp);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10);
    c.writeUInt16LE(0, 12); c.writeUInt16LE(0x21, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(dados.length, 24); c.writeUInt16LE(nome.length, 28); c.writeUInt32LE(off, 42);
    central.push(c, nome);
    off += 30 + nome.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const f = Buffer.alloc(22); f.writeUInt32LE(0x06054b50, 0); f.writeUInt16LE(entradas.length, 8); f.writeUInt16LE(entradas.length, 10); f.writeUInt32LE(cd.length, 12); f.writeUInt32LE(off, 16);
  return Buffer.concat([...partes, cd, f]);
};
const lerZip = (buf) => {
  let p = buf.length - 22; while (p >= 0 && buf.readUInt32LE(p) !== 0x06054b50) p--;
  if (p < 0) throw new Error('arquivo zip invalido');
  const n = buf.readUInt16LE(p + 10); let c = buf.readUInt32LE(p + 16); const out = [];
  for (let i = 0; i < n; i++) {
    const metodo = buf.readUInt16LE(c + 10); const cs = buf.readUInt32LE(c + 20); const nl = buf.readUInt16LE(c + 28); const el = buf.readUInt16LE(c + 30); const cl = buf.readUInt16LE(c + 32); const lo = buf.readUInt32LE(c + 42);
    const nome = buf.slice(c + 46, c + 46 + nl).toString('utf8');
    const ini = lo + 30 + buf.readUInt16LE(lo + 26) + buf.readUInt16LE(lo + 28);
    const bruto = buf.slice(ini, ini + cs);
    if (!nome.endsWith('/')) out.push({ nome, dados: metodo === 8 ? zlib.inflateRawSync(bruto) : bruto });
    c += 46 + nl + el + cl;
  }
  return out;
};

const ehTexto = (nome, dados) => {
  if (/\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|bundle|woff2?|ttf|eot)$/i.test(nome)) return false;
  const topo = dados.slice(0, 8000); for (let i = 0; i < topo.length; i++) if (topo[i] === 0) return false;
  return true;
};
const ignorado = (nome) => /(^|\/)node_modules\//.test(nome) || /(^|\/)\.git\//.test(nome) || /(^|\/)\.env($|\.(?!example$))/.test(nome);
const semEmoji = (s) => String(s || '').replace(/[\u{10000}-\u{10FFFF}]/gu, '');

const tabelasDoApp = async () => {
  const tabs = await rows("SELECT TABLE_NAME AS NOME, TABLE_ROWS AS LINHAS FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME");
  return tabs.filter((t) => !/^(INT_|DATABASECHANGELOG|CONNECTION)/.test(t.NOME) && t.NOME !== 'GIT_CONFIG')
    .map((t) => ({ nome: t.NOME, linhas: Number(t.LINHAS) || 0 }));
};
const estruturaSql = async (tabelas) => {
  const cols = await paginar("SELECT TABLE_NAME AS T, COLUMN_NAME AS C, COLUMN_TYPE AS TIPO, IS_NULLABLE AS NUL, COLUMN_DEFAULT AS DEF, EXTRA AS EXTRA, COLUMN_KEY AS CHAVE, ORDINAL_POSITION AS POS FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE()", 'TABLE_NAME, ORDINAL_POSITION');
  const idx = await paginar("SELECT TABLE_NAME AS T, INDEX_NAME AS I, NON_UNIQUE AS NU, SEQ_IN_INDEX AS S, COLUMN_NAME AS C FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE()", 'TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX');
  let sql = '-- Estrutura do banco (gerada a partir do information_schema)\n\n';
  for (const t of tabelas) {
    const cs = cols.filter((c) => c.T === t.nome);
    const linhas = cs.map((c) => '  `' + c.C + '` ' + c.TIPO + (c.NUL === 'NO' ? ' NOT NULL' : '') + (c.DEF != null && !/auto_increment/i.test(c.EXTRA || '') ? ' DEFAULT ' + (/^\d+(\.\d+)?$/.test(String(c.DEF)) ? c.DEF : "'" + String(c.DEF).replace(/'/g, "''") + "'") : '') + (/auto_increment/i.test(c.EXTRA || '') ? ' AUTO_INCREMENT' : ''));
    const grupos = {};
    for (const i of idx.filter((x) => x.T === t.nome)) (grupos[i.I] = grupos[i.I] || { nu: i.NU, cols: [] }).cols.push('`' + i.C + '`');
    for (const nome of Object.keys(grupos)) {
      const g = grupos[nome];
      linhas.push(nome === 'PRIMARY' ? '  PRIMARY KEY (' + g.cols.join(', ') + ')' : '  ' + (Number(g.nu) === 0 ? 'UNIQUE KEY' : 'KEY') + ' `' + nome + '` (' + g.cols.join(', ') + ')');
    }
    sql += 'CREATE TABLE `' + t.nome + '` (\n' + linhas.join(',\n') + '\n);\n\n';
  }
  return sql;
};
const csvCel = (v) => { if (v == null) return ''; const s = typeof v === 'object' ? JSON.stringify(v) : String(v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const tabelaCsv = async (nome) => {
  const cols = (await rows("SELECT COLUMN_NAME AS C FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '" + sqlTxt(nome) + "' ORDER BY ORDINAL_POSITION")).map((c) => c.C);
  const dados = await paginar('SELECT * FROM `' + nome + '`', '1');
  return [cols.map(csvCel).join(',')].concat(dados.map((l) => cols.map((c) => csvCel(l[c])).join(','))).join('\n') + '\n';
};
const baixar = async (key) => {
  const r = await sdk.downloadFilePrivateMitra({ projectId, key });
  if (Buffer.isBuffer(r)) return r;
  if (r && typeof r.arrayBuffer === 'function') return Buffer.from(await r.arrayBuffer());
  if (r instanceof ArrayBuffer) return Buffer.from(r);
  throw new Error('download invalido');
};
const subir = async (zip, nome) => {
  const blob = typeof File === 'function' ? new File([zip], nome, { type: 'application/zip' }) : new Blob([zip], { type: 'application/zip' });
  const r = await sdk.uploadFilePrivateMitra({ projectId, file: blob });
  const key = (r && r.result && r.result.key) || (r && r.key);
  if (!key) throw new Error('upload sem chave');
  return key;
};

const email = async () => {
  const r = await sdk.executeServerFunctionMitra({ projectId, serverFunctionId: 40, input: {} });
  const l = r && r.result && r.result.output && r.result.output.rows;
  return String((l && l[0] && l[0].EMAIL) || '').toLowerCase();
};
const permitido = async () => {
  const em = await email(); if (!em) return false;
  const l = await rows("SELECT EMAIL FROM EXPORT_DONOS WHERE LOWER(EMAIL) = '" + sqlTxt(em) + "' LIMIT 1");
  return l.length > 0;
};

const gitConfig = async () => {
  const l = await rows('SELECT CHAVE, VALOR FROM GIT_CONFIG');
  const c = {}; for (const x of l) c[x.CHAVE] = String(x.VALOR || '').trim();
  return c;
};
const configOk = (c) => !!(c.TOKEN && /^[\w.-]+\/[\w.-]+$/.test(c.REPOSITORIO || '') && (c.BRANCH || 'main'));

const andamento = async (tabela, id, etapa) => { await dml('UPDATE ' + tabela + " SET ETAPA = '" + sqlTxt(semEmoji(etapa)) + "' WHERE ID = " + Number(id)); };
const falhou = async (tabela, id, e, extras) => {
  const msg = limpar(semEmoji((e && e.message) || e), extras).slice(0, 400);
  await dml('UPDATE ' + tabela + " SET ESTADO = 'ERRO', ERRO = '" + sqlTxt(msg) + "', TERMINOU_EM = '" + agora() + "' WHERE ID = " + Number(id));
};

const montarExportacao = async (tipo, tabela, id) => {
  await andamento(tabela, id, 'Lendo o codigo do app');
  const cod = await rows("SELECT CHAVE_ARQUIVO FROM EXPORT_CODIGO WHERE TIPO = 'CODIGO' ORDER BY ID DESC LIMIT 1");
  if (!cod.length) throw new Error('O pacote de codigo ainda nao foi preparado');
  const entradas = [];
  for (const e of lerZip(await baixar(cod[0].CHAVE_ARQUIVO))) {
    if (ignorado(e.nome)) continue;
    entradas.push({ nome: e.nome, dados: ehTexto(e.nome, e.dados) ? Buffer.from(limpar(e.dados.toString('utf8')), 'utf8') : e.dados });
  }
  await andamento(tabela, id, 'Lendo a estrutura do banco');
  const tabelas = await tabelaCompleta();
  entradas.push({ nome: 'estrutura-banco/schema.sql', dados: limpar(await estruturaSql(tabelas)) });
  const comDados = tabelas.filter((t) => !/^EXPORT_/.test(t.nome) && (tipo === 'pacote' || t.linhas <= 3000));
  const apenasEstrutura = tabelas.filter((t) => !comDados.includes(t)).map((t) => t.nome);
  let n = 0;
  for (const t of comDados) {
    n++; await andamento(tabela, id, 'Tabela ' + n + ' de ' + comDados.length + ': ' + t.nome);
    entradas.push({ nome: 'dados/' + t.nome + '.csv', dados: limpar(await tabelaCsv(t.nome)) });
  }
  if (tipo === 'pacote') {
    const g = await rows("SELECT CHAVE_ARQUIVO FROM EXPORT_CODIGO WHERE TIPO = 'GIT' ORDER BY ID DESC LIMIT 1");
    if (g.length) { await andamento(tabela, id, 'Anexando o historico git'); entradas.push({ nome: 'historico-git/repositorio.bundle', dados: await baixar(g[0].CHAVE_ARQUIVO) }); }
  }
  entradas.push({ nome: 'LEIA-ME.txt', dados: 'Exportacao ' + (tipo === 'pacote' ? 'completa' : 'leve') + ' do Planejamento Orcamentario, gerada em ' + agora() + '.\n\ncodigo/: codigo do app (frontend, backend, Server Functions).\nestrutura-banco/schema.sql: CREATE TABLE de todas as tabelas.\ndados/: uma planilha CSV por tabela.\n' + (apenasEstrutura.length ? 'Tabelas so com a estrutura: ' + apenasEstrutura.join(', ') + '.\n' : '') + 'Tabelas internas da plataforma e de configuracao de envio nao entram. Textos com cara de chave ou token foram trocados por [REMOVIDO].\n' });
  await andamento(tabela, id, 'Compactando e guardando o arquivo');
  const zip = montarZip(entradas);
  const key = await subir(zip, (tipo === 'pacote' ? 'pacote-completo-' : 'codigo-leve-') + id + '.zip');
  await dml('UPDATE ' + tabela + " SET ESTADO = 'PRONTO', ETAPA = 'Pronto', CHAVE_ARQUIVO = '" + sqlTxt(key) + "', TAMANHO_BYTES = " + zip.length + ", TERMINOU_EM = '" + agora() + "' WHERE ID = " + Number(id));
  return { key, zip };
};
const tabelaCompleta = async () => tabelasDoApp();

const ghRequest = (cfg) => async (metodo, caminho, corpo) => {
  const r = await fetch('https://api.github.com/repos/' + cfg.REPOSITORIO + caminho, {
    method: metodo,
    headers: { Authorization: 'Bearer ' + cfg.TOKEN, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'planejamento-orcamentario-export', 'Content-Type': 'application/json' },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  let j = null; try { j = await r.json(); } catch (e) { j = null; }
  if (!r.ok) throw new Error('GitHub ' + r.status + ': ' + String((j && j.message) || 'falha').slice(0, 200));
  return j;
};
const enviarAoGithub = async (zip, cfg, gitId) => {
  const gh = ghRequest(cfg); const branch = cfg.BRANCH || 'main';
  const arquivos = [];
  for (const e of lerZip(zip)) {
    const rel = e.nome.startsWith('codigo/') ? e.nome.slice(7) : 'exportacao/' + e.nome;
    if (!rel || ignorado(rel)) continue;
    const texto = ehTexto(e.nome, e.dados);
    arquivos.push({ path: rel, texto, conteudo: texto ? limpar(e.dados.toString('utf8'), [cfg.TOKEN]) : e.dados.toString('base64') });
  }
  await andamento('EXPORT_GIT', gitId, 'Lendo o estado do repositorio');
  let ref; try { ref = await gh('GET', '/git/ref/heads/' + encodeURIComponent(branch)); } catch (e) { throw new Error('Nao achei a branch ' + branch + '. O repositorio precisa ter ao menos um commit. (' + e.message + ')'); }
  const pai = ref.object.sha; const base = (await gh('GET', '/git/commits/' + pai)).tree.sha;
  const itens = []; let feitos = 0; let prox = 0;
  const trabalhador = async () => {
    while (prox < arquivos.length) {
      const a = arquivos[prox++];
      const b = await gh('POST', '/git/blobs', { content: a.conteudo, encoding: a.texto ? 'utf-8' : 'base64' });
      itens.push({ path: a.path, mode: '100644', type: 'blob', sha: b.sha });
      feitos++; if (feitos % 100 === 0) await andamento('EXPORT_GIT', gitId, 'Enviando arquivos ' + feitos + ' de ' + arquivos.length);
    }
  };
  await andamento('EXPORT_GIT', gitId, 'Enviando arquivos 0 de ' + arquivos.length);
  await Promise.all([trabalhador(), trabalhador(), trabalhador(), trabalhador()]);
  let arvore = base;
  for (let i = 0; i < itens.length; i += 60) arvore = (await gh('POST', '/git/trees', { base_tree: arvore, tree: itens.slice(i, i + 60) })).sha;
  await andamento('EXPORT_GIT', gitId, 'Criando o commit');
  const commit = await gh('POST', '/git/commits', { message: 'Exportacao do Planejamento Orcamentario em ' + agora(), tree: arvore, parents: [pai] });
  await gh('PATCH', '/git/refs/heads/' + encodeURIComponent(branch), { sha: commit.sha, force: false });
  return { arquivos: arquivos.length, commitUrl: 'https://github.com/' + cfg.REPOSITORIO + '/commit/' + commit.sha, repoUrl: 'https://github.com/' + cfg.REPOSITORIO };
};

const ultimo = async (tabela) => (await rows('SELECT * FROM ' + tabela + ' ORDER BY ID DESC LIMIT 1'))[0] || null;
const emAndamento = (l) => l && l.ESTADO === 'ENVIANDO' && (Date.now() - 3 * 3600 * 1000 - Date.parse(String(l.CRIADO_EM || l.INICIOU_EM || '').slice(0, 19) + 'Z')) < 40 * 60 * 1000;
const publico = (l) => l && { id: l.ID, estado: l.ESTADO, etapa: l.ETAPA, erro: l.ERRO, tamanho: l.TAMANHO_BYTES, terminouEm: l.TERMINOU_EM, arquivos: l.ARQUIVOS, commitUrl: l.COMMIT_URL, repoUrl: l.REPO_URL };

if (ACAO === 'autoteste') {
  const falsas = ['AIza' + 'A'.repeat(35), 'ghp_' + 'b'.repeat(36), 'github_pat_' + 'C'.repeat(30), '[REMOVIDO]', 'tokenzinho-secreto-123'];
  const saida = limpar('a ' + falsas.join(' | ') + ' z', ['tokenzinho-secreto-123']);
  const zip = montarZip([{ nome: 'a/b.txt', dados: 'ola' }, { nome: 'c.bin', dados: Buffer.from([0, 1, 2]) }]);
  const volta = lerZip(zip);
  return { limpo: saida, semSegredo: !/AIza|ghp_|github_pat_|PRIVATE KEY|tokenzinho/.test(saida), zipOk: volta.length === 2 && volta[0].dados.toString() === 'ola' };
}

if (!(await permitido())) return { ok: false, erro: 'acesso_negado' };

if (ACAO === 'estado') {
  const cfg = await gitConfig();
  return { ok: true, leve: publico(await ultimo('EXPORT_LEVE')), pacote: publico(await ultimo('EXPORT_PACOTE')), git: { configurado: configOk(cfg), ...(publico(await ultimo('EXPORT_GIT')) || {}) } };
}
if (ACAO === 'link') {
  const tabela = event.tipo === 'pacote' ? 'EXPORT_PACOTE' : 'EXPORT_LEVE';
  const l = await rows('SELECT CHAVE_ARQUIVO FROM ' + tabela + " WHERE ID = " + Number(event.id) + " AND ESTADO = 'PRONTO'");
  if (!l.length) return { ok: false, erro: 'Exportacao nao encontrada' };
  const r = await sdk.getFileLinkMitra({ projectId, key: l[0].CHAVE_ARQUIVO, ttlSeconds: 90 });
  return { ok: true, url: (r && r.result && r.result.url) || (r && r.url) };
}
if (ACAO === 'iniciar') {
  const tipo = event.tipo === 'pacote' ? 'pacote' : 'leve'; const tabela = tipo === 'pacote' ? 'EXPORT_PACOTE' : 'EXPORT_LEVE';
  if (emAndamento(await ultimo(tabela))) return { ok: false, erro: 'Ja existe uma exportacao em andamento.' };
  await dml('INSERT INTO ' + tabela + " (NOME, ESTADO, ETAPA, CRIADO_EM) VALUES ('" + (tipo === 'pacote' ? 'Pacote completo' : 'Codigo leve') + "', 'ENVIANDO', 'Na fila', '" + agora() + "')");
  return { ok: true, id: (await ultimo(tabela)).ID };
}
if (ACAO === 'executar') {
  const tipo = event.tipo === 'pacote' ? 'pacote' : 'leve'; const tabela = tipo === 'pacote' ? 'EXPORT_PACOTE' : 'EXPORT_LEVE';
  try { await montarExportacao(tipo, tabela, event.id); } catch (e) { await falhou(tabela, event.id, e); }
  return { ok: true };
}
if (ACAO === 'iniciarGit') {
  const cfg = await gitConfig();
  if (!configOk(cfg)) return { ok: false, erro: 'O envio ao GitHub ainda nao foi configurado' };
  if (emAndamento(await ultimo('EXPORT_GIT'))) return { ok: false, erro: 'Ja existe um envio em andamento.' };
  await dml("INSERT INTO EXPORT_GIT (ESTADO, ETAPA, REPO_URL, INICIOU_EM) VALUES ('ENVIANDO', 'Na fila', 'https://github.com/" + sqlTxt(cfg.REPOSITORIO) + "', '" + agora() + "')");
  return { ok: true, id: (await ultimo('EXPORT_GIT')).ID };
}
if (ACAO === 'executarGit') {
  const gitId = Number(event.id); const cfg = await gitConfig(); const extras = [cfg.TOKEN];
  try {
    await andamento('EXPORT_GIT', gitId, 'Preparando os arquivos');
    await dml("INSERT INTO EXPORT_LEVE (NOME, ESTADO, ETAPA, CRIADO_EM) VALUES ('Codigo leve (envio ao GitHub)', 'ENVIANDO', 'Na fila', '" + agora() + "')");
    const leveId = (await ultimo('EXPORT_LEVE')).ID;
    await montarExportacao('leve', 'EXPORT_LEVE', leveId);
    const pronto = (await rows('SELECT ESTADO, ERRO, CHAVE_ARQUIVO FROM EXPORT_LEVE WHERE ID = ' + leveId))[0];
    if (!pronto || pronto.ESTADO !== 'PRONTO') throw new Error('A exportacao leve nao ficou pronta');
    const zip = await baixar(pronto.CHAVE_ARQUIVO);
    const r = await enviarAoGithub(zip, cfg, gitId);
    await dml("UPDATE EXPORT_GIT SET ESTADO = 'OK', ETAPA = 'Enviado', ARQUIVOS = " + r.arquivos + ", COMMIT_URL = '" + sqlTxt(r.commitUrl) + "', REPO_URL = '" + sqlTxt(r.repoUrl) + "', TERMINOU_EM = '" + agora() + "' WHERE ID = " + gitId);
  } catch (e) { await falhou('EXPORT_GIT', gitId, e, extras); }
  return { ok: true };
}
return { ok: false, erro: 'acao_desconhecida' };
