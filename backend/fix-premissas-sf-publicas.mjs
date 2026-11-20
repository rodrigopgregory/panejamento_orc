// Conserta as SFs do link do gestor (143 publicHotOrcDetalheCr, 145 publicHotOrcDetalhePkg).
//
// O que quebrou: add-premissas-gerais.mjs acrescentou o bloco PREMISSAS no FIM do
// codigo das quatro SFs de detalhe. Nas duas INTERNAS (125/126) o codigo e um SELECT
// sem FROM, entao concatenar no fim cai dentro da lista de colunas e e SQL valido.
// Nas duas PUBLICAS o SELECT termina com o gate do token:
//
//   FROM PREENCHIMENTO_TOKEN tk WHERE tk.TOKEN = '{{token}}' ... LIMIT 1
//
// entao o append virou "LIMIT 1, COALESCE(...) AS PREMISSAS" — erro de sintaxe. A SF
// passou a devolver "bad SQL grammar", o front engoliu no catch e o gestor ficou sem
// nenhuma aba de modelo dentro do CR.
//
// A correcao move o bloco para ANTES do FROM do token — mesmo padrao ja usado em
// fix-sf145-blocos-rateio.mjs e fix-pacote-cr-a-cr.mjs. Idempotente: se o bloco ja
// estiver no lugar certo, nao faz nada.
import 'dotenv/config';
import {
  configureSdkMitra,
  listServerFunctionsMitra,
  readServerFunctionMitra,
  updateServerFunctionMitra,
} from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});
const projectId = parseInt(process.env.MITRA_PROJECT_ID);

const ANCORA = '\nFROM PREENCHIMENTO_TOKEN tk';
// Inicio exato do bloco que foi grudado no fim (vem de add-premissas-gerais.mjs).
const INICIO_BLOCO = ",\n  COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('ID',pl.ID,'NOME',pl.NOME,'ORDEM',pl.ORDEM,'MES',pv.MES,'VALOR',pv.VALOR))";

async function corrigir(nome) {
  const todas = await listServerFunctionsMitra({ projectId });
  const alvo = (todas.result || todas || []).find((f) => f.name === nome);
  if (!alvo) { console.log(`  ${nome}: nao encontrada — pulado`); return; }

  const atual = await readServerFunctionMitra({ projectId, serverFunctionId: alvo.id });
  const code = atual.result?.code || '';
  if (!code) { console.log(`  ${nome} (id ${alvo.id}): sem codigo — pulado`); return; }

  if (!code.includes('AS PREMISSAS')) {
    console.log(`  ${nome} (id ${alvo.id}): sem bloco PREMISSAS — nada a fazer`);
    return;
  }

  const idxAncora = code.indexOf(ANCORA);
  if (idxAncora === -1) throw new Error(`${nome}: ancora "FROM PREENCHIMENTO_TOKEN tk" nao encontrada — abortando sem alterar`);

  const idxBloco = code.indexOf(INICIO_BLOCO);
  if (idxBloco === -1) throw new Error(`${nome}: bloco PREMISSAS presente mas em formato inesperado — abortando sem alterar`);

  // Ja esta antes do gate do token? Entao a SF esta correta.
  if (idxBloco < idxAncora) {
    console.log(`  ${nome} (id ${alvo.id}): bloco ja esta antes do FROM — ok, nada a fazer`);
    return;
  }

  const bloco = code.slice(idxBloco).trimEnd();
  if (!bloco.endsWith('AS PREMISSAS')) throw new Error(`${nome}: ha codigo depois do bloco PREMISSAS — abortando sem alterar`);

  // Remove do fim e reinsere antes do FROM, mantendo a virgula que separa as colunas.
  const semBloco = code.slice(0, idxBloco).trimEnd();
  const idx = semBloco.indexOf(ANCORA);
  if (idx === -1) throw new Error(`${nome}: ancora sumiu apos remover o bloco — abortando sem alterar`);
  const novo = semBloco.slice(0, idx) + bloco + semBloco.slice(idx);

  if ((novo.match(/AS PREMISSAS/g) || []).length !== 1) throw new Error(`${nome}: bloco PREMISSAS duplicado — abortando sem alterar`);
  if (!novo.trimEnd().endsWith('LIMIT 1')) throw new Error(`${nome}: codigo nao termina em LIMIT 1 — abortando sem alterar`);

  await updateServerFunctionMitra({ projectId, serverFunctionId: alvo.id, code: novo });
  console.log(`  ok: ${nome} (id ${alvo.id}) — bloco PREMISSAS movido para antes do gate do token (${code.length} -> ${novo.length} chars)`);
}

async function main() {
  console.log('Corrigindo posicao do bloco PREMISSAS nas SFs do link do gestor');
  for (const nome of ['publicHotOrcDetalheCr', 'publicHotOrcDetalhePkg']) {
    await corrigir(nome);
  }
  console.log('\nPronto. Valide com: node smoke-gestor-modelos.mjs');
}

main().catch((e) => { console.error(e); process.exit(1); });
