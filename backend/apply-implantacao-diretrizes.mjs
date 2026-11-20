// Aplica (ou atualiza) o bloco do protocolo de implantacao nas diretrizes
// adicionais do projeto, SEM apagar diretrizes ja existentes.
//
// Fonte do bloco: backend/templates/implantacao/diretrizes-adicionais.md
// Runbook canonico: IMPLANTACAO.md (raiz do projeto)
//
// Idempotente: o bloco fica delimitado por marcadores; rodar de novo substitui
// apenas o conteudo entre os marcadores (ou anexa, se ainda nao existir).

import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configureSdkMitra, getProjectContextMitra, updateAdditionalInstructionsMitra } from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});

const projectId = parseInt(process.env.MITRA_PROJECT_ID);
const __dir = dirname(fileURLToPath(import.meta.url));

const INICIO = '<<< INICIO PROTOCOLO IMPLANTACAO (gerenciado por backend/apply-implantacao-diretrizes.mjs — nao editar a mao) >>>';
const FIM = '<<< FIM PROTOCOLO IMPLANTACAO >>>';

function extractInstructions(ctx) {
  const r = ctx?.result ?? ctx ?? {};
  // campo real observado: result.project.instructions (fallbacks defensivos)
  return (
    r.project?.instructions ??
    r.instructions ??
    r.additionalInstructions ??
    r.project?.additionalInstructions ??
    ''
  );
}

async function main() {
  const bloco = readFileSync(join(__dir, 'templates', 'implantacao', 'diretrizes-adicionais.md'), 'utf8').trim();
  const novoBloco = `${INICIO}\n${bloco}\n${FIM}`;

  let atuais = '';
  try {
    const ctx = await getProjectContextMitra({ projectId });
    atuais = String(extractInstructions(ctx) || '');
  } catch (e) {
    console.warn('Aviso: nao consegui ler as diretrizes atuais (' + (e?.message || e) + '). Vou tratar como vazias — se o projeto JA tem diretrizes, aborte e investigue antes de rodar de novo.');
    throw e; // nao sobrescrever as diretrizes existentes as cegas
  }

  let novas;
  const iIni = atuais.indexOf(INICIO);
  const iFim = atuais.indexOf(FIM);
  if (iIni !== -1 && iFim !== -1 && iFim > iIni) {
    novas = atuais.slice(0, iIni) + novoBloco + atuais.slice(iFim + FIM.length);
    console.log('Bloco existente encontrado — substituindo apenas o conteudo entre os marcadores.');
  } else {
    novas = atuais.trim() ? atuais.trimEnd() + '\n\n' + novoBloco : novoBloco;
    console.log(atuais.trim() ? 'Anexando o bloco ao fim das diretrizes existentes.' : 'Diretrizes vazias — gravando somente o bloco do protocolo.');
  }

  await updateAdditionalInstructionsMitra({ projectId, instructions: novas });
  console.log('Diretrizes adicionais atualizadas (' + novas.length + ' chars). Runbook: IMPLANTACAO.md');
}

main().catch((e) => {
  console.error('FALHA:', e?.message || e);
  process.exit(1);
});
