import 'dotenv/config';
import {
  configureSdkMitra,
  executeServerFunctionMitra,
  readServerFunctionMitra,
  runDmlMitra,
} from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});

const projectId = Number(process.env.MITRA_PROJECT_ID);
const invalidToken = '00000000-0000-0000-0000-000000000000';

async function exec(id, input) {
  const response = await executeServerFunctionMitra({ projectId, serverFunctionId: id, input });
  if (response?.result?.executionStatus === 'FAILED') {
    throw new Error(`SF ${id}: ${response?.result?.error}`);
  }
  let output = response?.result?.output;
  if (typeof output === 'string') output = JSON.parse(output);
  return output;
}

async function query(sql) {
  return (await exec(76, { sql }))?.rows || [];
}

function jsonField(value) {
  if (typeof value === 'string') return JSON.parse(value);
  return Array.isArray(value) ? value : [];
}

const targets = await query(`SELECT tk.TOKEN, tk.CICLO_ID, tk.GESTOR_ID, c.ANO, gc.CR_ID, cb.ID AS COLABORADOR_ID
FROM PREENCHIMENTO_TOKEN tk
JOIN CICLO c ON c.ID = tk.CICLO_ID AND c.STATUS <> 'FECHADO'
JOIN GESTOR_CR gc ON gc.GESTOR_ID = tk.GESTOR_ID
JOIN COLABORADOR cb ON cb.CR_ID = gc.CR_ID AND cb.ATIVO = 'true'
LEFT JOIN ORCAMENTO_STATUS os ON os.CICLO_ID = tk.CICLO_ID AND os.CR_ID = gc.CR_ID
WHERE tk.ATIVO = 'true'
  AND COALESCE(os.STATUS, 'PENDENTE') NOT IN ('SUBMETIDO', 'APROVADO')
  AND NOT EXISTS (SELECT 1 FROM DESLIGAMENTO_PROJETADO dp WHERE dp.CICLO_ID = tk.CICLO_ID AND dp.COLABORADOR_ID = cb.ID)
LIMIT 1`);

if (targets.length === 0) throw new Error('Sem ciclo/CR editavel para o smoke test');

const target = targets[0];
const cicloId = Number(target.CICLO_ID);
const crId = Number(target.CR_ID);
const colaboradorId = Number(target.COLABORADOR_ID);
const inputDetalhe = {
  cicloId,
  crId,
  ano: Number(target.ANO),
  anoPrev: Number(target.ANO) - 1,
  gestorId: Number(target.GESTOR_ID),
  controlCicloId: 0,
};

try {
  await exec(221, {
    cicloId,
    crId,
    colaboradorId,
    mesDesligamento: 5,
    criadoEm: new Date().toISOString().slice(0, 19),
  });
  let rows = await query(`SELECT * FROM DESLIGAMENTO_PROJETADO WHERE CICLO_ID = ${cicloId} AND COLABORADOR_ID = ${colaboradorId}`);
  if (rows.length !== 1 || Number(rows[0].MES_DESLIGAMENTO) !== 5) throw new Error('Upsert interno nao persistiu maio');

  const activeMonths = await query(`SELECT GROUP_CONCAT(m.MES ORDER BY m.MES) AS MESES
FROM (SELECT 1 AS MES UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8 UNION ALL SELECT 9 UNION ALL SELECT 10 UNION ALL SELECT 11 UNION ALL SELECT 12) m
JOIN DESLIGAMENTO_PROJETADO dp ON dp.CICLO_ID = ${cicloId} AND dp.COLABORADOR_ID = ${colaboradorId}
WHERE m.MES < dp.MES_DESLIGAMENTO`);
  if (String(activeMonths[0]?.MESES) !== '1,2,3,4') throw new Error(`Corte mensal incorreto: ${activeMonths[0]?.MESES}`);

  const internalDetail = (await exec(125, inputDetalhe))?.rows?.[0] || {};
  const internalDismissals = jsonField(internalDetail.DESLIGAMENTOS);
  if (!internalDismissals.some((item) => Number(item.COLABORADOR_ID) === colaboradorId)) {
    throw new Error('SF 125 nao retornou o desligamento');
  }

  await exec(222, { id: rows[0].ID, cicloId, crId });
  rows = await query(`SELECT ID FROM DESLIGAMENTO_PROJETADO WHERE CICLO_ID = ${cicloId} AND COLABORADOR_ID = ${colaboradorId}`);
  if (rows.length !== 0) throw new Error('Exclusao interna falhou');

  await exec(147, { token: invalidToken, op: 'desligamentoUpsert', crId, colaboradorId, mesDesligamento: 7 });
  rows = await query(`SELECT ID FROM DESLIGAMENTO_PROJETADO WHERE CICLO_ID = ${cicloId} AND COLABORADOR_ID = ${colaboradorId}`);
  if (rows.length !== 0) throw new Error('Token invalido conseguiu gravar desligamento');

  await exec(147, { token: target.TOKEN, op: 'desligamentoUpsert', crId, colaboradorId, mesDesligamento: 7 });
  rows = await query(`SELECT * FROM DESLIGAMENTO_PROJETADO WHERE CICLO_ID = ${cicloId} AND COLABORADOR_ID = ${colaboradorId}`);
  if (rows.length !== 1 || Number(rows[0].MES_DESLIGAMENTO) !== 7) throw new Error('Upsert publico nao persistiu julho');

  const publicDetail = (await exec(143, { ...inputDetalhe, token: target.TOKEN }))?.rows?.[0] || {};
  const publicDismissals = jsonField(publicDetail.DESLIGAMENTOS);
  if (!publicDismissals.some((item) => Number(item.COLABORADOR_ID) === colaboradorId)) {
    throw new Error('SF 143 nao retornou o desligamento');
  }

  await exec(147, { token: target.TOKEN, op: 'desligamentoDelete', crId, id: rows[0].ID });
  rows = await query(`SELECT ID FROM DESLIGAMENTO_PROJETADO WHERE CICLO_ID = ${cicloId} AND COLABORADOR_ID = ${colaboradorId}`);
  if (rows.length !== 0) throw new Error('Exclusao publica falhou');

  const sf59 = await readServerFunctionMitra({ projectId, serverFunctionId: 59 });
  if (!String(sf59?.result?.code || '').includes('m.MES < COALESCE(dp.MES_DESLIGAMENTO, 13)')) {
    throw new Error('SF 59 sem a regra de corte mensal');
  }

  console.log(JSON.stringify({ ok: true, cicloId, crId, colaboradorId, internal: true, public: true, activeMonths: [1, 2, 3, 4] }));
} finally {
  await runDmlMitra({
    projectId,
    sql: `DELETE FROM DESLIGAMENTO_PROJETADO WHERE CICLO_ID = ${cicloId} AND COLABORADOR_ID = ${colaboradorId}`,
  });
}
