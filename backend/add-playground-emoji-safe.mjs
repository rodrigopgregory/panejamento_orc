// Playground — blindagem contra EMOJI vindo do modelo.
//
// CAUSA RAIZ (provada em 2026-08-03):
//   As colunas de PLAYGROUND/PLAYGROUND_VERSAO sao utf8mb3 (maximo 3 bytes por
//   caractere) e o sql_mode do servidor tem STRICT_TRANS_TABLES. Emoji e todo
//   caractere acima de U+FFFF ocupa 4 bytes. Resultado: qualquer UPDATE que
//   leve um emoji para HTML / CONVERSA / NOME e RECUSADO pelo banco, a SF
//   lanca erro e o estudo fica sem tela publicada — exatamente o sintoma de
//   "nao consigo gerar dashboard".
//   Prova colhida no proprio banco:
//     - INFORMATION_SCHEMA: PLAYGROUND.HTML = utf8mb3 / utf8mb3_bin
//     - SELECT @@sql_mode  = ...,STRICT_TRANS_TABLES,...
//     - comparar um emoji com a coluna devolve:
//       "Illegal mix of collations (utf8mb3_bin,IMPLICIT) and (utf8mb4_0900_ai_ci,COERCIBLE)"
//     - CONVERT(emoji USING utf8mb3) devolve '?'  (perda de dado)
//
// CORRECAO: o helper esc() das SFs de escrita passa a descartar os caracteres
// de 4 bytes ANTES de montar o SQL. Instrucao no prompt nao resolve — o modelo
// escorrega; o guard tem de estar no unico ponto por onde TODA escrita passa.
// Emoji nao faz parte do design system do produto, entao descartar (e nao
// substituir por texto) e o comportamento certo: a tela sai limpa e publicada.
//
// Este script NAO recria nada — le o code atual de cada SF na plataforma e
// troca somente a linha do esc(). Idempotente: rodar duas vezes nao duplica.
import 'dotenv/config';
import {
  configureSdkMitra, readServerFunctionMitra, updateServerFunctionMitra,
  executeServerFunctionMitra,
} from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});
const projectId = parseInt(process.env.MITRA_PROJECT_ID);

// SFs de ESCRITA do Playground (as unicas que montam SQL com texto do modelo).
const SFS = [
  { id: 187, nome: 'playground_salvar_html' },
  { id: 188, nome: 'playground_salvar_conversa' },
  { id: 189, nome: 'playground_renomear' },
  { id: 190, nome: 'playground_restaurar' },
];

// Sem regex: os caracteres de 4 bytes sao exatamente os que o JS guarda como
// par surrogate (code units 0xD800-0xDFFF). Varrer por charCodeAt evita o
// inferno de escape das SFs JAVASCRIPT (o code vai como string).
const ESC_NOVO = String.raw`const esc = (s) => { const t = String(s); let o = ''; for (let i = 0; i < t.length; i++) { const c = t.charCodeAt(i); if (c < 0xD800 || c > 0xDFFF) o += t[i]; } return o.replace(/\\/g, '\\\\').replace(/'/g, "''"); };`;

async function blindar() {
  for (const sf of SFS) {
    const fn = await readServerFunctionMitra({ projectId, serverFunctionId: sf.id });
    const code = String(fn?.result?.code || '');
    if (!code) throw new Error(`SF ${sf.id} (${sf.nome}) sem code — abortando`);

    const linhas = code.split('\n');
    const alvo = linhas.findIndex((l) => l.trim().startsWith('const esc ='));
    if (alvo === -1) throw new Error(`SF ${sf.id} (${sf.nome}): linha do esc() nao encontrada`);

    if (linhas[alvo].includes('0xD800')) {
      console.log(`= ${sf.nome} (${sf.id}) ja blindada`);
      continue;
    }
    linhas[alvo] = ESC_NOVO;
    await updateServerFunctionMitra({
      projectId, serverFunctionId: sf.id, code: linhas.join('\n'),
    });
    console.log(`+ ${sf.nome} (${sf.id}) blindada`);
  }
}

// ── Prova end-to-end: um estudo descartavel leva emoji em HTML, conversa e
//    nome; conferimos que grava, que o emoji sumiu e que o resto do texto
//    ficou intacto. No fim o estudo sai por exclusao soft (mesmo caminho que
//    o proprio app usa) — nada fica sujando a lista de ninguem.
const SF_CRIAR = 178, SF_ULTIMO = 179, SF_GET = 181, SF_EXCLUIR = 182;
const USUARIO_TESTE = 'teste-emoji@interno';
const EMOJI = '\u{1F4CA}';       // grafico de barras — o classico do modelo
const ASTRAL = '\u{1D400}';      // "A" matematico: 4 bytes sem ser emoji

async function exec(serverFunctionId, input) {
  const r = await executeServerFunctionMitra({ projectId, serverFunctionId, input });
  return { status: r?.result?.executionStatus, out: r?.result?.output, erro: r?.result?.error };
}

function assert(cond, msg) {
  if (!cond) throw new Error(`FALHOU: ${msg}`);
  console.log(`  ok — ${msg}`);
}

async function provar() {
  const agora = new Date().toISOString().slice(0, 19);
  // criar devolve affectedRows, nao o ID — o ID vem do playground_ultimo
  await exec(SF_CRIAR, { usuario: USUARIO_TESTE, agora });
  const ultimo = await exec(SF_ULTIMO, { usuario: USUARIO_TESTE });
  const pgId = ultimo.out?.rows?.[0]?.ID;
  if (!pgId) throw new Error(`nao consegui criar o estudo de teste: ${JSON.stringify(ultimo).slice(0, 300)}`);
  console.log(`\nEstudo descartavel #${pgId} criado para a prova`);

  try {
    const html = `<!DOCTYPE html><html><body><h1>Receita ${EMOJI} 2026</h1><p>Var. ${ASTRAL} 12,5% — acentuação preservada</p></body></html>`;
    let r = await exec(187, { id: pgId, html });
    assert(r.status === 'COMPLETED' && r.out?.ok, `salvar_html com emoji nao quebra (${r.erro || 'sem erro'})`);

    const conversa = JSON.stringify([{ role: 'agent', texto: `Analise concluída ${EMOJI} com sucesso` }]);
    r = await exec(188, { id: pgId, conversa });
    assert(r.status === 'COMPLETED' && r.out?.ok, `salvar_conversa com emoji nao quebra (${r.erro || 'sem erro'})`);

    r = await exec(189, { id: pgId, nome: `Orçado x Realizado ${EMOJI}` });
    assert(r.status === 'COMPLETED', `renomear com emoji nao quebra (${r.erro || 'sem erro'})`);

    r = await exec(SF_GET, { id: pgId });
    const linha = r.out?.rows?.[0] || {};
    assert(String(linha.HTML || '').includes('Receita'), 'HTML foi gravado de verdade');
    assert(!String(linha.HTML || '').includes(EMOJI), 'emoji nao sobrou no HTML');
    assert(!String(linha.HTML || '').includes(ASTRAL), 'caractere de 4 bytes nao-emoji tambem foi filtrado');
    assert(String(linha.HTML || '').includes('acentuação preservada'), 'acentuacao (2 bytes) intacta');
    assert(String(linha.NOME || '').startsWith('Orçado x Realizado'), 'nome gravado com acento e sem emoji');
    assert(String(linha.CONVERSA || '').includes('Analise concluída'), 'conversa gravada');
    assert(!String(linha.CONVERSA || '').includes(EMOJI), 'emoji nao sobrou na conversa');
  } finally {
    await exec(SF_EXCLUIR, { id: pgId, agora: new Date().toISOString().slice(0, 19) });
    console.log(`Estudo #${pgId} removido (exclusao soft)`);
  }
}

await blindar();
await provar();
console.log('\nBlindagem de emoji aplicada e provada.');
