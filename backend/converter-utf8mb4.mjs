// Converte tabelas do APP de utf8mb3 para utf8mb4 — a correcao de fundo do
// problema de emoji.
//
// POR QUE: as colunas nasceram utf8mb3 (maximo 3 bytes por caractere). Emoji
// ocupa 4 bytes e, com STRICT_TRANS_TABLES ligado, o banco RECUSA a gravacao
// inteira em vez de truncar. Foi isso que impedia a tela do Playground de ser
// publicada (provado em 2026-08-03) e e o mesmo risco em qualquer campo de
// texto que o usuario digita — "Motivo", "Observacao" e afins.
//
// COLLATION: utf8mb4_BIN, nao o padrao utf8mb4_0900_ai_ci. Isso NAO e detalhe.
// O banco hoje e utf8mb3_bin (binario: sensivel a maiuscula e a acento).
// Medido neste banco:
//   'true' = 'TRUE'            -> bin: 0 | 0900_ai_ci: 1
//   'orcamento' = 'orçamento'  -> bin: 0 | 0900_ai_ci: 1
// Ou seja, cair no padrao mudaria silenciosamente o resultado de queries que
// ja rodam em producao. utf8mb4_bin mantem a semantica atual e so aumenta o
// espaco por caractere. E a mesma collation que a plataforma usa nas tabelas
// dela mais novas (INT_SERVERFUNCTIONEXECUTION, INT_SCREENCOMPONENT).
//
// RISCOS MEDIDOS ANTES DE ESCREVER ISTO:
//   - Tamanho: as 59 tabelas do app somam 5,2 MB / 34 mil linhas. Segundos.
//   - Indice: so 2 indices sobre texto no app (VARCHAR 50 e 36) = 200 e 144
//     bytes em utf8mb4, muito abaixo do limite de 3072 do InnoDB (row format
//     Dynamic em todas). Zero risco de "key too long".
//   - Mistura de charset: testado JOIN de coluna utf8mb4 com utf8mb3 no
//     proprio banco -> funciona (utf8mb4 e superset, o MySQL promove). Logo
//     converter em etapas NAO quebra as queries existentes.
//
// SEGURANCA: recusa qualquer tabela da plataforma. So tabelas do app.
// Idempotente: tabela ja convertida e pulada.
//
// USO:
//   node converter-utf8mb4.mjs               -> so as tabelas do Playground
//   node converter-utf8mb4.mjs --app         -> todas as tabelas do app
//   node converter-utf8mb4.mjs --dry         -> mostra o plano, nao executa
import 'dotenv/config';
import { configureSdkMitra, runQueryMitra, runDdlMitra } from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});
const projectId = parseInt(process.env.MITRA_PROJECT_ID);

// Prefixos gerenciados pela PLATAFORMA — nunca tocar.
const PLATAFORMA = /^(INT_|IMP_|CC_|CUBE_|CUB_|CAD_|DIM_|DATABASECHANGELOG)/;
const PLAYGROUND = ['PLAYGROUND', 'PLAYGROUND_VERSAO'];

const args = process.argv.slice(2);
const escopoApp = args.includes('--app');
const dryRun = args.includes('--dry');

const sql = async (s) => (await runQueryMitra({ projectId, sql: s })).result.rows;

async function alvos() {
  const linhas = await sql(
    `SELECT TABLE_NAME, TABLE_ROWS, TABLE_COLLATION FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME`,
  );
  const app = linhas.filter((l) => !PLATAFORMA.test(l.TABLE_NAME));
  const escolhidas = escopoApp ? app : app.filter((l) => PLAYGROUND.includes(l.TABLE_NAME));
  // rede de seguranca: se algo da plataforma escapou do filtro, aborta
  for (const t of escolhidas) {
    if (PLATAFORMA.test(t.TABLE_NAME)) throw new Error(`recusado: ${t.TABLE_NAME} e da plataforma`);
  }
  return escolhidas;
}

async function contar(tabela) {
  const r = await sql(`SELECT COUNT(*) N FROM ${tabela}`);
  return Number(r?.[0]?.N ?? -1);
}

async function main() {
  const lista = await alvos();
  console.log(`Escopo: ${escopoApp ? 'TODAS as tabelas do app' : 'somente Playground'} — ${lista.length} tabela(s)`);
  if (dryRun) {
    for (const t of lista) console.log(`  [plano] ${t.TABLE_NAME} (${t.TABLE_COLLATION}, ${t.TABLE_ROWS} linhas)`);
    return;
  }

  let convertidas = 0;
  for (const t of lista) {
    const nome = t.TABLE_NAME;
    if (String(t.TABLE_COLLATION || '').startsWith('utf8mb4')) {
      console.log(`= ${nome} ja e utf8mb4`);
      continue;
    }
    // antes/depois de linhas: conversao de charset preserva dados; se o numero
    // mudar, algo saiu muito errado e queremos saber na hora
    const antes = await contar(nome);
    await runDdlMitra({
      projectId,
      sql: `ALTER TABLE ${nome} CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`,
    });
    const depois = await contar(nome);
    if (antes !== depois) throw new Error(`${nome}: ${antes} linhas antes, ${depois} depois — ABORTANDO`);
    console.log(`+ ${nome} convertida (${depois} linhas intactas)`);
    convertidas++;
  }

  // conferencia final direto no INFORMATION_SCHEMA
  const nomes = lista.map((t) => `'${t.TABLE_NAME}'`).join(',');
  const restou = await sql(
    `SELECT TABLE_NAME, COLUMN_NAME, CHARACTER_SET_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${nomes}) AND CHARACTER_SET_NAME <> 'utf8mb4'`,
  );
  console.log(`\n${convertidas} tabela(s) convertidas.`);
  console.log(restou.length === 0
    ? 'Conferido: nenhuma coluna ficou fora do utf8mb4.'
    : `ATENCAO: ${restou.length} coluna(s) ficaram para tras: ${JSON.stringify(restou).slice(0, 500)}`);
}

await main();
