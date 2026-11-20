// Corrige a duplicacao de HIST_PREMISSA na visao do gestor.
//
// PROBLEMA
// O save da tela de orcamento fazia SELECT e so entao decidia entre patch e
// create (OrcamentoContent.saveHistPremissa). Dois saves quase simultaneos leem
// "nao existe" ao mesmo tempo e ambos inserem — os timestamps a 1 segundo de
// distancia no banco entregam a causa. A tabela nao tinha nenhuma restricao de
// unicidade, entao o banco aceitava a segunda linha sem reclamar.
//
// A leitura monta um mapa por CONTA_ID (vence a ultima linha da query) e o save
// so atualizava existing[0]. Enquanto as duplicatas tem valores iguais o estrago
// e invisivel; no momento em que divergirem, o gestor ve percentual instavel.
//
// CORRECAO EM 3 CAMADAS (esta e a ordem obrigatoria — o indice unico so pode ser
// criado depois que as duplicatas existentes sairem)
//   1. consolida duplicatas mantendo a linha mais recente do grupo
//   2. UNIQUE KEY (CICLO_ID, CR_ID, CONTA_ID) — torna a duplicata impossivel
//   3. SF upsertHistPremissa com INSERT ... ON DUPLICATE KEY UPDATE, que resolve
//      a corrida dentro do proprio engine do banco, em uma unica instrucao
//
// Idempotente: pode rodar de novo sem efeito colateral.

import 'dotenv/config';
import {
  configureSdkMitra, runDdlMitra, runDmlMitra, runQueryMitra,
  createServerFunctionMitra, updateServerFunctionMitra, listServerFunctionsMitra,
} from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});
const projectId = parseInt(process.env.MITRA_PROJECT_ID);

const q = async (sql) => {
  const r = await runQueryMitra({ projectId, sql });
  return (r && r.result && r.result.rows) ? r.result.rows : [];
};

const DUP_SQL =
  'SELECT CICLO_ID, CR_ID, CONTA_ID, COUNT(*) AS N FROM HIST_PREMISSA' +
  ' GROUP BY CICLO_ID, CR_ID, CONTA_ID HAVING COUNT(*) > 1';

// --- 1. Consolidar duplicatas -----------------------------------------------
// Self-join: apaga toda linha que tenha, no mesmo grupo, outra mais recente.
// Sobrevive o maior (CRIADO_EM, ID) — ou seja, o ultimo save do gestor, que e a
// semantica que a tela sempre quis. Deliberadamente escrito sem ID hardcoded:
// como isto vira migration e roda no banco de cada copia do projeto, precisa
// consolidar corretamente qualquer duplicata que exista la, nao as daqui.
console.log('1/3 Consolidando duplicatas de HIST_PREMISSA...');
const antes = await q(DUP_SQL);
console.log(`  grupos duplicados antes: ${antes.length}`);
if (antes.length) console.log('  ', JSON.stringify(antes));

await runDmlMitra({
  projectId,
  sql:
    'DELETE hp FROM HIST_PREMISSA hp' +
    ' JOIN HIST_PREMISSA manter' +
    '   ON manter.CICLO_ID = hp.CICLO_ID' +
    '  AND manter.CR_ID = hp.CR_ID' +
    '  AND manter.CONTA_ID = hp.CONTA_ID' +
    ' WHERE COALESCE(hp.CRIADO_EM, \'\') < COALESCE(manter.CRIADO_EM, \'\')' +
    '    OR (COALESCE(hp.CRIADO_EM, \'\') = COALESCE(manter.CRIADO_EM, \'\')' +
    '        AND hp.ID < manter.ID)',
});

const depois = await q(DUP_SQL);
console.log(`  grupos duplicados depois: ${depois.length}`);
if (depois.length) throw new Error('Ainda ha duplicatas — abortando antes do indice unico');

// --- 2. Travar no schema ----------------------------------------------------
console.log('2/3 Criando UNIQUE KEY (CICLO_ID, CR_ID, CONTA_ID)...');
try {
  await runDdlMitra({
    projectId,
    sql: 'ALTER TABLE HIST_PREMISSA' +
         ' ADD UNIQUE KEY UK_HIST_PREMISSA_CICLO_CR_CONTA (CICLO_ID, CR_ID, CONTA_ID)',
  });
  console.log('  indice criado');
} catch (e) {
  const msg = String(e?.message || e);
  if (/duplicate key name|already exists|Duplicate key/i.test(msg)) console.log('  indice ja existia');
  else throw e;
}

const idx = await q(
  "SELECT INDEX_NAME, NON_UNIQUE, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS COLS" +
  " FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE()" +
  " AND TABLE_NAME = 'HIST_PREMISSA' GROUP BY INDEX_NAME, NON_UNIQUE"
);
console.log('  indices agora:', JSON.stringify(idx));

// --- 3. SF de upsert atomico ------------------------------------------------
// ON DUPLICATE KEY UPDATE: uma unica instrucao, a corrida e resolvida pelo
// proprio banco. Substitui o SELECT-entao-decide do frontend. Como SF SQL,
// tambem funciona para userType=business (o REST createRecordMitra/patchRecordMitra
// que estava ali retorna 403 para business).
const CODE_UPSERT =
  'INSERT INTO HIST_PREMISSA (CICLO_ID, CR_ID, CONTA_ID, PERCENTUAL, MODO, JUSTIFICATIVA, CRIADO_EM)' +
  " VALUES ({{cicloId}}, {{crId}}, {{contaId}}, {{percentual}}, '{{modo}}', '{{justificativa}}', '{{agora}}')" +
  ' ON DUPLICATE KEY UPDATE' +
  ' PERCENTUAL = VALUES(PERCENTUAL), MODO = VALUES(MODO),' +
  ' JUSTIFICATIVA = VALUES(JUSTIFICATIVA), CRIADO_EM = VALUES(CRIADO_EM)';

async function upsertSF({ name, type, code, description }) {
  const all = await listServerFunctionsMitra({ projectId });
  const list = all?.result || all?.content || all || [];
  const existing = Array.isArray(list) ? list.find((s) => s.name === name) : null;
  if (existing) {
    await updateServerFunctionMitra({ projectId, serverFunctionId: existing.id, code, description });
    console.log(`  ~ atualizada ${name} (id ${existing.id})`);
    return existing.id;
  }
  const res = await createServerFunctionMitra({ projectId, name, type, code, description });
  const id = res?.result?.serverFunctionId || res?.serverFunctionId || res?.id;
  console.log(`  + criada ${name} (id ${id})`);
  return id;
}

console.log('3/3 Criando SF upsertHistPremissa...');
const sfId = await upsertSF({
  name: 'upsertHistPremissa',
  type: 'SQL',
  code: CODE_UPSERT,
  description: 'Grava a premissa historica do gestor (percentual/modo/justificativa) por ' +
    'CICLO+CR+CONTA. INSERT ... ON DUPLICATE KEY UPDATE: atomico, imune a save ' +
    'concorrente. Params: cicloId, crId, contaId, percentual, modo, justificativa, agora',
});

console.log('\n=== ID para o frontend ===');
console.log(JSON.stringify({ upsertHistPremissa: sfId }));
