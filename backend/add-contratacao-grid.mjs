// Migracao aditiva: contratacoes projetadas em GRADE (cargo x mes) com justificativa.
//
// O que muda:
//   1. CONTRATACAO_PROJETADA ganha a coluna JUSTIFICATIVA VARCHAR(500) (texto livre
//      por cargo — a tela grava o mesmo texto em todas as linhas do cargo no ciclo/CR).
//   2. As SFs SQL que serializam CONTRATACAO_PROJETADA (125, 126, 143, 145) passam a
//      devolver JUSTIFICATIVA no JSON; a SF 191 (criarVersaoOrcamento) copia a coluna
//      ao versionar.
//   3. Novas SFs SQL para a tela interna (1 statement cada, sem sandbox):
//        contratLimparCelula   — DELETE da celula (ciclo, CR, cargo, mes)
//        contratInserirCelula  — INSERT da celula com a qtd informada
//        contratJustificativa  — UPDATE da justificativa do cargo no ciclo/CR
//   4. SF 147 (publicOrcWrite) ganha as ops token-escopadas contratSetCell e
//      contratJustificativa para o link publico do gestor.
// Nada existente e removido; o script e idempotente.
import 'dotenv/config';
import {
  configureSdkMitra,
  runDdlMitra,
  createServerFunctionMitra,
  listServerFunctionsMitra,
  readServerFunctionMitra,
  updateServerFunctionMitra,
  executeServerFunctionMitra,
} from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});
const projectId = parseInt(process.env.MITRA_PROJECT_ID);

const readCode = async (id) => {
  const fn = await readServerFunctionMitra({ projectId, serverFunctionId: id });
  return { code: fn?.result?.code || '', description: fn?.result?.description || '' };
};

// 1) coluna JUSTIFICATIVA
async function addColumn() {
  try {
    await runDdlMitra({ projectId, sql: 'ALTER TABLE CONTRATACAO_PROJETADA ADD COLUMN JUSTIFICATIVA VARCHAR(500)' });
    console.log('+ coluna CONTRATACAO_PROJETADA.JUSTIFICATIVA criada');
  } catch (e) {
    const msg = String(e?.message || e);
    if (/duplicate|already exists|Duplicate column/i.test(msg)) console.log('= coluna JUSTIFICATIVA ja existe');
    else throw e;
  }
}

// 2) SFs de leitura: incluir JUSTIFICATIVA no JSON_OBJECT
async function patchReaders() {
  const OLD = "'QTD_VAGAS',cp.QTD_VAGAS,'CARGO_NOME'";
  const NEW = "'QTD_VAGAS',cp.QTD_VAGAS,'JUSTIFICATIVA',cp.JUSTIFICATIVA,'CARGO_NOME'";
  for (const id of [125, 126, 143, 145]) {
    const { code, description } = await readCode(id);
    if (!code) { console.log(`! SF ${id} sem codigo — pulada`); continue; }
    if (code.includes("'JUSTIFICATIVA',cp.JUSTIFICATIVA")) { console.log(`= SF ${id} ja devolve JUSTIFICATIVA`); continue; }
    if (!code.includes(OLD)) { console.log(`! SF ${id}: anchor de QTD_VAGAS nao encontrado — pulada`); continue; }
    await updateServerFunctionMitra({ projectId, serverFunctionId: id, code: code.split(OLD).join(NEW), description });
    console.log(`~ SF ${id} atualizada (JUSTIFICATIVA no JSON)`);
  }
}

// 3) SF 191 criarVersaoOrcamento: copiar JUSTIFICATIVA ao versionar
async function patchVersionar() {
  const id = 191;
  const { code, description } = await readCode(id);
  if (!code) { console.log('! SF 191 sem codigo — pulada'); return; }
  if (code.includes('QTD_VAGAS, JUSTIFICATIVA, CRIADO_EM')) { console.log('= SF 191 ja copia JUSTIFICATIVA'); return; }
  const OLD = "MOTIVO, QTD_VAGAS, CRIADO_EM) SELECT \" + novoId + \", CR_ID, CARGO_ID, MES_ENTRADA, MOTIVO, QTD_VAGAS, '";
  const NEW = "MOTIVO, QTD_VAGAS, JUSTIFICATIVA, CRIADO_EM) SELECT \" + novoId + \", CR_ID, CARGO_ID, MES_ENTRADA, MOTIVO, QTD_VAGAS, JUSTIFICATIVA, '";
  if (!code.includes(OLD)) { console.log('! SF 191: anchor do INSERT de CONTRATACAO_PROJETADA nao encontrado — pulada (revisar manualmente)'); return; }
  await updateServerFunctionMitra({ projectId, serverFunctionId: id, code: code.replace(OLD, NEW), description });
  console.log('~ SF 191 atualizada (copia JUSTIFICATIVA)');
}

// 4) SFs SQL da tela interna
const SQL_SFS = [
  {
    name: 'contratLimparCelula',
    code: 'DELETE FROM CONTRATACAO_PROJETADA WHERE CICLO_ID = {{cicloId}} AND CR_ID = {{crId}} AND CARGO_ID = {{cargoId}} AND MES_ENTRADA = {{mes}}',
    description: 'Grade de contratacoes: limpa a celula (ciclo, CR, cargo, mes) antes de regravar. Params numericos: cicloId, crId, cargoId, mes',
  },
  {
    name: 'contratInserirCelula',
    code: "INSERT INTO CONTRATACAO_PROJETADA (CICLO_ID, CR_ID, CARGO_ID, MES_ENTRADA, MOTIVO, QTD_VAGAS, JUSTIFICATIVA, CRIADO_EM) VALUES ({{cicloId}}, {{crId}}, {{cargoId}}, {{mes}}, 'AUMENTO_QUADRO', {{qtd}}, '{{justificativa}}', '{{criadoEm}}')",
    description: 'Grade de contratacoes: grava a qtd de vagas da celula (ciclo, CR, cargo, mes). Params: cicloId, crId, cargoId, mes, qtd (numericos), justificativa (texto escapado), criadoEm (YYYY-MM-DDTHH:mm:ss)',
  },
  {
    name: 'contratJustificativa',
    code: "UPDATE CONTRATACAO_PROJETADA SET JUSTIFICATIVA = '{{justificativa}}' WHERE CICLO_ID = {{cicloId}} AND CR_ID = {{crId}} AND CARGO_ID = {{cargoId}}",
    description: 'Grade de contratacoes: atualiza a justificativa de todas as contratacoes do cargo no ciclo/CR. Params: cicloId, crId, cargoId (numericos), justificativa (texto escapado)',
  },
];

async function upsertSqlSfs() {
  const existing = await listServerFunctionsMitra({ projectId });
  const list = existing?.result || existing || [];
  const ids = {};
  for (const sf of SQL_SFS) {
    const found = list.find((f) => f.name === sf.name);
    if (found) { ids[sf.name] = found.id; console.log(`= ja existe: ${sf.name} (id ${found.id})`); continue; }
    const res = await createServerFunctionMitra({ projectId, name: sf.name, type: 'SQL', code: sf.code, description: sf.description });
    const id = res?.result?.serverFunctionId ?? res?.result?.id;
    ids[sf.name] = id;
    console.log(`+ criada: ${sf.name} (id ${id})`);
  }
  return ids;
}

// 5) SF 147: ops publicas contratSetCell / contratJustificativa
const PUBLIC_BLOCK = `
if (op === 'contratSetCell') {
  const cargoId = Number(event.cargoId);
  const mes = Number(event.mes);
  if (!Number.isInteger(cargoId) || !Number.isInteger(mes) || mes < 1 || mes > 12) return { ok: false, error: 'params_invalidos' };
  const qtd = Math.max(0, intOr0(event.qtd));
  const just = esc(event.justificativa, 500);
  await dml("DELETE cp FROM CONTRATACAO_PROJETADA cp" +
    " JOIN PREENCHIMENTO_TOKEN tkk ON tkk.CICLO_ID = cp.CICLO_ID" +
    " JOIN GESTOR_CR gck ON gck.GESTOR_ID = tkk.GESTOR_ID AND gck.CR_ID = cp.CR_ID" +
    " WHERE cp.CR_ID = " + crId + " AND cp.CARGO_ID = " + cargoId + " AND cp.MES_ENTRADA = " + mes + " AND " + TK_COND);
  if (qtd > 0) {
    await dml("INSERT INTO CONTRATACAO_PROJETADA (CICLO_ID, CR_ID, CARGO_ID, MES_ENTRADA, MOTIVO, QTD_VAGAS, JUSTIFICATIVA, CRIADO_EM)" +
      " SELECT DISTINCT tkk.CICLO_ID, " + crId + ", " + cargoId + ", " + mes + ", 'AUMENTO_QUADRO', " + qtd + ", '" + just + "', '" + agora + "'" +
      " FROM " + TK_SRC + " WHERE " + TK_COND);
  }
  return { ok: true };
}

if (op === 'contratJustificativa') {
  const cargoId = Number(event.cargoId);
  if (!Number.isInteger(cargoId)) return { ok: false, error: 'cargoId_invalido' };
  const just = esc(event.justificativa, 500);
  await dml("UPDATE CONTRATACAO_PROJETADA cp" +
    " JOIN PREENCHIMENTO_TOKEN tkk ON tkk.CICLO_ID = cp.CICLO_ID" +
    " JOIN GESTOR_CR gck ON gck.GESTOR_ID = tkk.GESTOR_ID AND gck.CR_ID = cp.CR_ID" +
    " SET cp.JUSTIFICATIVA = '" + just + "'" +
    " WHERE cp.CR_ID = " + crId + " AND cp.CARGO_ID = " + cargoId + " AND " + TK_COND);
  return { ok: true };
}

`;

async function patchPublic() {
  const id = 147;
  const { code, description } = await readCode(id);
  if (!code) throw new Error('SF 147 sem codigo');
  if (code.includes("op === 'contratSetCell'")) { console.log('= SF 147 ja contem contratSetCell'); return; }
  const TAIL = "return { ok: false, error: 'op_desconhecida' };";
  if (!code.includes(TAIL)) throw new Error('SF 147: anchor TAIL nao encontrado');
  const desc = description.includes('contratSetCell') ? description
    : description.replace('contratCreate/Delete', 'contratCreate/Delete/SetCell/Justificativa');
  await updateServerFunctionMitra({ projectId, serverFunctionId: id, code: code.replace(TAIL, PUBLIC_BLOCK + TAIL), description: desc });
  console.log('~ SF 147 atualizada (ops contratSetCell/contratJustificativa)');
}

async function smoke(ids) {
  // ciclo/CR 0 nao existem: valida sintaxe/params sem tocar em dado real
  const r1 = await executeServerFunctionMitra({ projectId, serverFunctionId: ids.contratLimparCelula, input: { cicloId: 0, crId: 0, cargoId: 0, mes: 1 } });
  if (r1?.result?.executionStatus !== 'COMPLETED') throw new Error('Smoke contratLimparCelula falhou: ' + JSON.stringify(r1?.result?.error || r1));
  const r2 = await executeServerFunctionMitra({ projectId, serverFunctionId: ids.contratJustificativa, input: { cicloId: 0, crId: 0, cargoId: 0, justificativa: 'smoke' } });
  if (r2?.result?.executionStatus !== 'COMPLETED') throw new Error('Smoke contratJustificativa falhou: ' + JSON.stringify(r2?.result?.error || r2));
  // SF 125 precisa continuar valida apos o patch
  const r3 = await executeServerFunctionMitra({ projectId, serverFunctionId: 125, input: { crId: 0, cicloId: 0, ano: 2026, anoPrev: 2025, gestorId: 0, controlCicloId: 0 } });
  if (r3?.result?.executionStatus !== 'COMPLETED') throw new Error('Smoke SF 125 falhou: ' + JSON.stringify(r3?.result?.error || r3));
  console.log('Smoke: OK');
}

async function main() {
  await addColumn();
  await patchReaders();
  await patchVersionar();
  const ids = await upsertSqlSfs();
  await patchPublic();
  await smoke(ids);
  console.log('\n=== IDs para o frontend (SF_PESSOAL) ===');
  console.log(`limparCelulaContrat: ${ids.contratLimparCelula}, inserirCelulaContrat: ${ids.contratInserirCelula}, justificativaContrat: ${ids.contratJustificativa}`);
}

main().catch((e) => { console.error('ERRO:', e?.message || e); process.exit(1); });
