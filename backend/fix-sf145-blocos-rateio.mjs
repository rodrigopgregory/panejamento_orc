/**
 * Corrige a SF 145 (publicHotOrcDetalhePkg) — espelho publico da SF 126 usado
 * pelo GESTOR no link de preenchimento do pacote.
 *
 * PROBLEMA: a SF 145 nunca ganhou os blocos RATEIOS/RATEIO_ITENS (tabelas
 * RATEIO/RATEIO_ITEM) que a SF 126 tem. Ela so devolve RATEIO_CONFIG/RATEIO_CR/
 * PKG_RATEIO_CONFIG, que sao as tabelas LEGADAS.
 *
 * O OrcamentoContent le `row.RATEIOS` e `row.RATEIO_ITENS`; na rota publica esses
 * campos vinham undefined -> rateioItensPkg = [] -> rateioSharesFor() sempre
 * devolvia Map vazio -> `rateioOk = false` em TODA linha de conta agregada. Efeitos:
 *   1) aviso falso "linha sem rateio aplicado" (o rateio existe e esta correto)
 *   2) `bloqueada: true` -> as 12 celulas de mes ficavam readOnly mesmo com o
 *      pacote PENDENTE (o gestor nao conseguia preencher)
 *
 * CORRECAO: acrescenta os dois blocos ao SELECT, identicos aos da SF 126. Os
 * blocos legados sao mantidos (nada e removido) para nao quebrar quem os leia.
 */
import 'dotenv/config';
import { configureSdkMitra, readServerFunctionMitra, updateServerFunctionMitra, executeServerFunctionMitra } from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});
const projectId = parseInt(process.env.MITRA_PROJECT_ID);
const SF_PUB_PKG = 145;

const BLOCO_RATEIOS =
  "COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('ID',t.ID,'NOME',t.NOME,'DESCRICAO',t.DESCRICAO,'ATIVO',t.ATIVO,'CRIADO_EM',t.CRIADO_EM,'TIPO',t.TIPO)) FROM RATEIO t WHERE t.ATIVO = true),JSON_ARRAY()) AS RATEIOS";
const BLOCO_RATEIO_ITENS =
  "COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('ID',t.ID,'RATEIO_ID',t.RATEIO_ID,'CR_ID',t.CR_ID,'QUANTIDADE',t.QUANTIDADE)) FROM RATEIO_ITEM t WHERE 1=1),JSON_ARRAY()) AS RATEIO_ITENS";

const ANCORA = '\nFROM PREENCHIMENTO_TOKEN tk';

async function main() {
  const cur = await readServerFunctionMitra({ projectId, serverFunctionId: SF_PUB_PKG });
  const code = cur?.result?.code || '';
  if (!code) throw new Error('SF 145 sem codigo — abortando');

  if (code.includes('AS RATEIO_ITENS') && code.includes('AS RATEIOS')) {
    console.log('SF 145 ja possui os blocos RATEIOS/RATEIO_ITENS — nada a fazer.');
    return;
  }
  const idx = code.indexOf(ANCORA);
  if (idx === -1) throw new Error('Ancora "FROM PREENCHIMENTO_TOKEN tk" nao encontrada — abortando sem alterar');

  const novo = code.slice(0, idx) + ',\n  ' + BLOCO_RATEIOS + ',\n  ' + BLOCO_RATEIO_ITENS + code.slice(idx);

  await updateServerFunctionMitra({
    projectId,
    serverFunctionId: SF_PUB_PKG,
    code: novo,
    description: 'Espelho publico da SF 126 (driver modo pacote) escopado por token+posse do pacote. Inclui RATEIOS/RATEIO_ITENS p/ distribuicao on-the-fly. Params: token,pkgId,cicloId,ano,anoPrev,controlCicloId',
  });
  console.log(`SF 145 atualizada: ${code.length} -> ${novo.length} chars`);

  // Smoke: a SF exige token valido; params zerados devolvem 0 linhas, mas o
  // parser do banco valida a sintaxe do SQL — se houver erro, estoura aqui.
  const res = await executeServerFunctionMitra({
    projectId, serverFunctionId: SF_PUB_PKG,
    input: { token: '__smoke__', pkgId: 0, cicloId: 0, ano: 2026, anoPrev: 2025, controlCicloId: 0 },
  });
  const st = res?.result?.executionStatus;
  if (st !== 'COMPLETED') throw new Error('Smoke falhou: ' + st + ' — ' + (res?.result?.error || ''));
  console.log('Smoke OK (SQL valido, executionStatus=COMPLETED).');

  const check = await readServerFunctionMitra({ projectId, serverFunctionId: SF_PUB_PKG });
  const c = check?.result?.code || '';
  console.log('Verificacao — AS RATEIOS:', c.includes('AS RATEIOS'), '| AS RATEIO_ITENS:', c.includes('AS RATEIO_ITENS'));
}

main().catch(e => { console.error('ERRO:', e?.message || e); process.exit(1); });
