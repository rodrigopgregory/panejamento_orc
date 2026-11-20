-- tipo: JAVASCRIPT | Grava a projecao de folha calculada na tela em 1 chamada: limpa ORCAMENTO_PESSOAL do ciclo/CR, insere os registros em lote e regrava as contas de pessoal do ORCAMENTO (chama SFs 60 e 61). Substitui SF 58 + createRecordsBatch + 60 + 61 no botao Recalcular folha. Params: cicloId, crId, records[{COLABORADOR_ID, MES, SALARIO, BENEFICIOS, ENCARGOS, TOTAL}]

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

const buildInsert = (cicloId, crId, chunk) =>
  'INSERT INTO ORCAMENTO_PESSOAL (CICLO_ID, CR_ID, COLABORADOR_ID, MES, SALARIO, BENEFICIOS, ENCARGOS, TOTAL) VALUES ' +
  chunk.map(r => '(' + cicloId + ', ' + crId + ', ' + r.colab + ', ' + r.mes + ', ' + r.sal + ', ' + r.ben + ', ' + r.enc + ', ' + r.tot + ')').join(', ');

// 1) limpar a projecao anterior (mesma SQL da SF 58)
await runDmlMitra({ projectId, sql: 'DELETE FROM ORCAMENTO_PESSOAL WHERE CICLO_ID = ' + cicloId + ' AND CR_ID = ' + crId });

// 2) inserir a projecao nova em lotes de 200 linhas por statement
for (let i = 0; i < recs.length; i += 200) {
  await runDmlMitra({ projectId, sql: buildInsert(cicloId, crId, recs.slice(i, i + 200)) });
}

// 3) regravar as contas de pessoal do ORCAMENTO (SFs 60 e 61, sem duplicar SQL)
for (const id of [60, 61]) {
  const r = await executeServerFunctionMitra({ projectId, serverFunctionId: id, input: { cicloId, crId } });
  const st = r && r.result ? r.result.executionStatus : r && r.executionStatus;
  if (st && st !== 'COMPLETED') throw new Error('SF ' + id + ' falhou: ' + ((r.result && r.result.error) || r.error || st));
}

return { ok: true, inserted: recs.length };
