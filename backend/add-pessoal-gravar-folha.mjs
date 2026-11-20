// Migracao aditiva: cria a SF JAVASCRIPT `pessoalGravarFolha`, que grava a
// projecao de folha calculada na tela em UMA chamada.
//
// Por que: o botao "Recalcular folha" da tela interna fazia
//   SF 58 (limpar) -> createRecordsBatchMitra em lotes de 50 (REST, sequencial,
//   1 INSERT por linha no servidor) -> SF 60 -> SF 61
// Com 20 colaboradores sao 240 linhas = 5 chamadas REST + 240 inserts individuais,
// e e isso que deixava o recalculo lento. O REST CRUD em tela tambem devolve 403
// para usuario business. O link publico do gestor (op pessoalRecalc da SF 147)
// ja resolve o mesmo fluxo com INSERT em lote dentro de uma SF; esta SF replica
// esse padrao para a rota interna autenticada.
//
// A SF NAO duplica as SQLs de 60/61: chama as proprias SFs (SF chamada por SF
// nao conta no rate limit), entao qualquer correcao futura nelas vale aqui.
// Nao altera nem remove nada existente.
import 'dotenv/config';
import {
  configureSdkMitra,
  createServerFunctionMitra,
  listServerFunctionsMitra,
  executeServerFunctionMitra,
} from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});
const projectId = parseInt(process.env.MITRA_PROJECT_ID);

const SF_LIMPAR_ORCAMENTO = 60;
const SF_GRAVAR_ORCAMENTO = 61;

// Monta o INSERT multi-linha a partir de registros JA validados (numeros puros).
// Injetado no codigo da SF.
const buildInsertSql = `
const buildInsert = (cicloId, crId, chunk) =>
  'INSERT INTO ORCAMENTO_PESSOAL (CICLO_ID, CR_ID, COLABORADOR_ID, MES, SALARIO, BENEFICIOS, ENCARGOS, TOTAL) VALUES ' +
  chunk.map(r => '(' + cicloId + ', ' + crId + ', ' + r.colab + ', ' + r.mes + ', ' + r.sal + ', ' + r.ben + ', ' + r.enc + ', ' + r.tot + ')').join(', ');
`;

const CODE = `
const { runDmlMitra, executeServerFunctionMitra } = require('mitra-sdk');
const projectId = parseInt(process.env.MITRA_PROJECT_ID);

const cicloId = Number(event.cicloId);
const crId = Number(event.crId);
if (!Number.isInteger(cicloId) || !Number.isInteger(crId) || cicloId < 0 || crId < 0) throw new Error('params_invalidos');

// Todo valor entra no SQL por texto: so passa numero validado (mesmo criterio do op publico).
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const intOr0 = (v) => { const n = Number(v); return Number.isInteger(n) ? n : 0; };
const raw = Array.isArray(event.records) ? event.records : [];
const recs = [];
for (const r of raw) {
  const mes = Number(r.MES);
  if (!Number.isInteger(mes) || mes < 1 || mes > 12) continue;
  const colab = r.COLABORADOR_ID == null ? 'NULL' : intOr0(r.COLABORADOR_ID);
  recs.push({ colab, mes, sal: num(r.SALARIO), ben: num(r.BENEFICIOS), enc: num(r.ENCARGOS), tot: num(r.TOTAL) });
}
${buildInsertSql}
// 1) limpar a projecao anterior (mesma SQL da SF 58)
await runDmlMitra({ projectId, sql: 'DELETE FROM ORCAMENTO_PESSOAL WHERE CICLO_ID = ' + cicloId + ' AND CR_ID = ' + crId });

// 2) inserir a projecao nova em lotes de 200 linhas por statement
for (let i = 0; i < recs.length; i += 200) {
  await runDmlMitra({ projectId, sql: buildInsert(cicloId, crId, recs.slice(i, i + 200)) });
}

// 3) regravar as contas de pessoal do ORCAMENTO (SFs 60 e 61, sem duplicar SQL)
for (const id of [${SF_LIMPAR_ORCAMENTO}, ${SF_GRAVAR_ORCAMENTO}]) {
  const r = await executeServerFunctionMitra({ projectId, serverFunctionId: id, input: { cicloId, crId } });
  const st = r && r.result ? r.result.executionStatus : r && r.executionStatus;
  if (st && st !== 'COMPLETED') throw new Error('SF ' + id + ' falhou: ' + ((r.result && r.result.error) || r.error || st));
}

return { ok: true, inserted: recs.length };
`;

async function upsertSF() {
  const existing = await listServerFunctionsMitra({ projectId });
  const list = existing?.result || existing || [];
  const found = list.find((f) => f.name === 'pessoalGravarFolha');
  if (found) { console.log(`= ja existe: pessoalGravarFolha (id ${found.id})`); return found.id; }
  const res = await createServerFunctionMitra({
    projectId,
    name: 'pessoalGravarFolha',
    type: 'JAVASCRIPT',
    code: CODE,
    description: 'Grava a projecao de folha calculada na tela em 1 chamada: limpa ORCAMENTO_PESSOAL do ciclo/CR, insere os registros em lote e regrava as contas de pessoal do ORCAMENTO (chama SFs 60 e 61). Substitui SF 58 + createRecordsBatch + 60 + 61 no botao Recalcular folha. Params: cicloId, crId, records[{COLABORADOR_ID, MES, SALARIO, BENEFICIOS, ENCARGOS, TOTAL}]',
  });
  const id = res?.result?.serverFunctionId ?? res?.result?.id;
  console.log(`+ criada: pessoalGravarFolha (id ${id})`);
  return id;
}

async function main() {
  const id = await upsertSF();

  // Smoke — SF inteira com ciclo/CR 0 e sem registros: valida o encadeamento
  // (DELETE inerte + SF 60 + SF 61 inertes) sem tocar em dado real.
  const r = await executeServerFunctionMitra({ projectId, serverFunctionId: id, input: { cicloId: 0, crId: 0, records: [] } });
  if (r?.result?.executionStatus !== 'COMPLETED') throw new Error(`Smoke SF ${id} falhou: ${JSON.stringify(r?.result?.error || r)}`);
  console.log(`Smoke SF ${id}: OK ->`, r.result.output);

  console.log('\n=== ID para o frontend ===');
  console.log(`SF_PESSOAL.gravarFolha = ${id}`);
}

main().catch((e) => { console.error('ERRO:', e?.message || e); process.exit(1); });
