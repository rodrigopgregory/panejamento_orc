// Validador obrigatorio do handoff de implantacao (IMPLANTACAO.md §0/§7).
// Uso: node backend/validate-implantacao.mjs implantacoes/<empresa>
//
// Read-only: le apenas os cinco artefatos da implantacao e sai com codigo != 0
// se a implantacao estiver incompleta. NAO acessa banco nem SFs — a validacao
// funcional (DRE, links, seguranca) e o checklist do §6, feito pelo humano+agente.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) {
  console.error('Uso: node backend/validate-implantacao.mjs implantacoes/<empresa>');
  process.exit(2);
}

const ARQUIVOS = ['estado-implantacao.md', 'tarefas.md', 'dossie.md', 'mapa-implantacao.md', 'extensoes.md'];
const erros = [];
const avisos = [];

const conteudo = {};
for (const nome of ARQUIVOS) {
  const p = join(dir, nome);
  if (!existsSync(p)) { erros.push(`${nome}: arquivo ausente em ${dir}`); continue; }
  // comentarios HTML sao instrucao de preenchimento, nao conteudo do artefato
  const txt = readFileSync(p, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  if (txt.trim().length < 40) erros.push(`${nome}: praticamente vazio — artefato nao preenchido`);
  if (txt.includes('<EMPRESA>')) erros.push(`${nome}: placeholder <EMPRESA> ainda presente`);
  if (txt.includes('<AAAA-MM-DD>')) erros.push(`${nome}: placeholder de data ainda presente`);
  conteudo[nome] = txt;
}

// --- estado-implantacao.md: protocolo declarado + gates ---
const estado = conteudo['estado-implantacao.md'] || '';
if (estado && !/Protocolo:\*{0,2}\s*1\.1\.1/.test(estado)) {
  avisos.push('estado-implantacao.md: versao do protocolo (1.1.1) nao declarada');
}
for (const linha of estado.split('\n')) {
  const m = linha.match(/^\|\s*(§\d[^|]*)\|\s*pendente\s*\|/i);
  if (!m) continue;
  const gate = m[1].trim();
  if (gate.startsWith('§7')) avisos.push(`estado-implantacao.md: gate ${gate} pendente (fecha com este validador verde + aprovacao do usuario)`);
  else erros.push(`estado-implantacao.md: gate ${gate} ainda pendente`);
}

// --- mapa-implantacao.md: 100% das contas classificadas e configuradas ---
const mapa = conteudo['mapa-implantacao.md'] || '';
if (mapa) {
  const linhas = mapa.split('\n').filter((l) => /^\|/.test(l) && !/^\|\s*-{2,}/.test(l) && !/Conta \(c/.test(l) && !/^\|-{0,3}(\|-{0,3})+\|?$/.test(l.replace(/\s/g, '')));
  const dados = linhas.filter((l) => !/^\|\s*—\s*\|/.test(l));
  if (dados.length === 0) erros.push('mapa-implantacao.md: nenhuma conta registrada no mapa');
  const semStatus = dados.filter((l) => !l.includes('✅'));
  if (semStatus.length > 0) erros.push(`mapa-implantacao.md: ${semStatus.length} conta(s) sem status ✅ (classificada mas nao configurada/conferida)`);
  const semTratamento = dados.filter((l) => {
    const cols = l.split('|').map((c) => c.trim());
    return cols.length > 3 && (cols[3] === '' || cols[3] === '—');
  });
  if (semTratamento.length > 0) erros.push(`mapa-implantacao.md: ${semTratamento.length} conta(s) com Tratamento em branco`);
}

// --- extensoes.md: NENHUMA ou extensoes com testes de aceite fechados ---
const ext = conteudo['extensoes.md'] || '';
if (ext) {
  const temExtensao = /##\s*Extens/i.test(ext);
  const declaraNenhuma = /^\s*NENHUMA\s*$/m.test(ext);
  if (!temExtensao && !declaraNenhuma) {
    erros.push('extensoes.md: nem declara NENHUMA nem registra extensao');
  }
  if (temExtensao) {
    const pendentes = (ext.match(/- \[ \]/g) || []).length;
    if (pendentes > 0) erros.push(`extensoes.md: ${pendentes} teste(s) de aceite nao marcados (§4.1)`);
  }
}

// --- tarefas.md: itens abertos viram aviso (o gate real e o estado + telas) ---
const tarefas = conteudo['tarefas.md'] || '';
if (tarefas) {
  const abertas = (tarefas.match(/- \[ \]/g) || []).length;
  if (abertas > 0) avisos.push(`tarefas.md: ${abertas} tarefa(s) ainda abertas`);
}

// --- dossie.md: fonte direcionada de verdade ---
const dossie = conteudo['dossie.md'] || '';
if (dossie && /Fonte direcionada:\*{0,2}\s*(<|—|$)/m.test(dossie)) {
  erros.push('dossie.md: fonte de dados nao direcionada/registrada');
}

// --- resultado ---
for (const e of erros) console.error('ERRO   ' + e);
for (const a of avisos) console.warn('AVISO  ' + a);
console.log(`\n${erros.length} erro(s), ${avisos.length} aviso(s) — ${dir}`);
if (erros.length > 0) {
  console.error('Implantacao INCOMPLETA. Corrija os erros antes do handoff (IMPLANTACAO.md §7).');
  process.exit(1);
}
console.log('Validador verde (artefatos). Lembrete: este validador so cobre os documentos —');
console.log('a auditoria de dados e funcional e o AUDITORIA-IMPLANTACAO.md (rodar tambem');
console.log('`node backend/check-implantacao-dados.mjs`). Avisos devem ser justificados no estado-implantacao.md.');
