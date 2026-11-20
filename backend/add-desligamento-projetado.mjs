// Adiciona desligamentos projetados ao modelo de pessoal sem alterar o cadastro
// global do colaborador. O mes informado e o primeiro mes sem custo de folha.
import 'dotenv/config';
import {
  configureSdkMitra,
  createServerFunctionMitra,
  executeServerFunctionMitra,
  listServerFunctionsMitra,
  readServerFunctionMitra,
  runDdlMitra,
  updateServerFunctionMitra,
} from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});

const projectId = Number(process.env.MITRA_PROJECT_ID);
const QUERY_SF = 76;

async function query(sql) {
  const response = await executeServerFunctionMitra({
    projectId,
    serverFunctionId: QUERY_SF,
    input: { sql },
  });
  let output = response?.result?.output;
  if (typeof output === 'string') output = JSON.parse(output);
  return output?.rows || [];
}

async function readCode(id) {
  const response = await readServerFunctionMitra({ projectId, serverFunctionId: id });
  return response?.result || {};
}

async function updateCode(id, transform, descriptionSuffix) {
  const current = await readCode(id);
  const code = transform(String(current.code || ''));
  await updateServerFunctionMitra({
    projectId,
    serverFunctionId: id,
    code,
    description: `${current.description || ''}${descriptionSuffix || ''}`.trim(),
  });
  console.log(`SF ${id} atualizada`);
}

function insertOnce(code, marker, addition, label) {
  if (code.includes(addition.trim())) return code;
  const first = code.indexOf(marker);
  if (first < 0 || code.indexOf(marker, first + marker.length) >= 0) {
    throw new Error(`Marcador inesperado em ${label}`);
  }
  return code.slice(0, first) + addition + code.slice(first);
}

const existingTable = await query(
  "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'DESLIGAMENTO_PROJETADO'",
);

if (existingTable.length === 0) {
  await runDdlMitra({
    projectId,
    sql: `CREATE TABLE DESLIGAMENTO_PROJETADO (
      ID INT AUTO_INCREMENT PRIMARY KEY,
      CICLO_ID INT NOT NULL,
      CR_ID INT NOT NULL,
      COLABORADOR_ID INT NOT NULL,
      MES_DESLIGAMENTO INT NOT NULL,
      CRIADO_EM VARCHAR(19),
      CONSTRAINT UQ_DESLIGAMENTO_CICLO_COLAB UNIQUE (CICLO_ID, COLABORADOR_ID),
      CONSTRAINT FK_DESLIGAMENTO_CICLO FOREIGN KEY (CICLO_ID) REFERENCES CICLO(ID),
      CONSTRAINT FK_DESLIGAMENTO_CR FOREIGN KEY (CR_ID) REFERENCES CENTRO_RESULTADO(ID),
      CONSTRAINT FK_DESLIGAMENTO_COLAB FOREIGN KEY (COLABORADOR_ID) REFERENCES COLABORADOR(ID)
    );`,
  });
  console.log('Tabela DESLIGAMENTO_PROJETADO criada');
} else {
  console.log('Tabela DESLIGAMENTO_PROJETADO ja existe');
}

const existingIndex = await query(
  "SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'DESLIGAMENTO_PROJETADO' AND INDEX_NAME = 'IDX_DESLIGAMENTO_CICLO_CR'",
);
if (existingIndex.length === 0) {
  await runDdlMitra({
    projectId,
    sql: 'CREATE INDEX IDX_DESLIGAMENTO_CICLO_CR ON DESLIGAMENTO_PROJETADO (CICLO_ID, CR_ID)',
  });
  console.log('Indice IDX_DESLIGAMENTO_CICLO_CR criado');
}

const allFunctions = await listServerFunctionsMitra({ projectId });
const functions = allFunctions?.result || allFunctions?.content || allFunctions || [];
const byName = (name) => functions.find((item) => item.name === name);

const dismissalFunctions = [
  {
    name: 'pessoalSalvarDesligamento',
    code: `INSERT INTO DESLIGAMENTO_PROJETADO (CICLO_ID, CR_ID, COLABORADOR_ID, MES_DESLIGAMENTO, CRIADO_EM)
SELECT {{cicloId}}, {{crId}}, c.ID, {{mesDesligamento}}, '{{criadoEm}}'
FROM COLABORADOR c
WHERE c.ID = {{colaboradorId}} AND c.CR_ID = {{crId}} AND {{mesDesligamento}} BETWEEN 1 AND 12
ON DUPLICATE KEY UPDATE CR_ID = VALUES(CR_ID), MES_DESLIGAMENTO = VALUES(MES_DESLIGAMENTO), CRIADO_EM = VALUES(CRIADO_EM)`,
    description: 'Cria ou atualiza desligamento projetado. O mes e o primeiro sem custo. Params: cicloId, crId, colaboradorId, mesDesligamento, criadoEm.',
  },
  {
    name: 'pessoalExcluirDesligamento',
    code: `DELETE FROM DESLIGAMENTO_PROJETADO
WHERE ID = {{id}} AND CICLO_ID = {{cicloId}} AND CR_ID = {{crId}}`,
    description: 'Remove um desligamento projetado da versao e CR. Params: id, cicloId, crId.',
  },
];

const createdIds = {};
for (const definition of dismissalFunctions) {
  const found = byName(definition.name);
  if (found) {
    await updateServerFunctionMitra({
      projectId,
      serverFunctionId: found.id,
      code: definition.code,
      description: definition.description,
    });
    createdIds[definition.name] = found.id;
  } else {
    const created = await createServerFunctionMitra({
      projectId,
      name: definition.name,
      type: 'SQL',
      code: definition.code,
      description: definition.description,
    });
    createdIds[definition.name] = created?.result?.serverFunctionId || created?.result?.id;
  }
  console.log(`${definition.name}: ${createdIds[definition.name]}`);
}

await updateCode(59, (code) => {
  if (code.includes('DESLIGAMENTO_PROJETADO')) return code;
  const marker = '  WHERE c.CR_ID = {{crId}} AND c.ATIVO = \'true\'';
  const replacement = `  LEFT JOIN DESLIGAMENTO_PROJETADO dp
    ON dp.CICLO_ID = {{cicloId}} AND dp.CR_ID = {{crId}} AND dp.COLABORADOR_ID = c.ID
  WHERE c.CR_ID = {{crId}} AND c.ATIVO = 'true'
    AND m.MES < COALESCE(dp.MES_DESLIGAMENTO, 13)`;
  if (!code.includes(marker)) throw new Error('Marcador da SF 59 nao encontrado');
  return code.replace(marker, replacement);
}, ' Considera DESLIGAMENTO_PROJETADO: o mes informado e o primeiro sem custo.');

const CR_SCOPE = 'd.CICLO_ID = {{cicloId}} AND d.CR_ID = {{crId}}';
const PKG_SCOPE = `d.CICLO_ID = {{cicloId}} AND d.CR_ID IN (SELECT DISTINCT crc2.CR_ID FROM CR_CONTA crc2
 LEFT JOIN CONTA_DRIVER_EXCECAO cde2 ON cde2.CR_ID = crc2.CR_ID AND cde2.CONTA_ID = crc2.CONTA_ID AND cde2.ATIVO = true
 LEFT JOIN CONTA_DRIVER cd2 ON cd2.CONTA_ID = crc2.CONTA_ID
 WHERE crc2.ATIVO = true AND COALESCE(cde2.PACOTE_ID, cd2.PACOTE_ID, cde2.DRIVER_ID, cd2.DRIVER_ID) = {{pkgId}})`;

function dismissalBlock(scope) {
  return `COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('ID',d.ID,'CICLO_ID',d.CICLO_ID,'CR_ID',d.CR_ID,'COLABORADOR_ID',d.COLABORADOR_ID,'MES_DESLIGAMENTO',d.MES_DESLIGAMENTO,'CRIADO_EM',d.CRIADO_EM,'COLAB_NOME',c.NOME)) FROM DESLIGAMENTO_PROJETADO d JOIN COLABORADOR c ON c.ID = d.COLABORADOR_ID WHERE ${scope}),JSON_ARRAY()) AS DESLIGAMENTOS`;
}

for (const [id, scope] of [[125, CR_SCOPE], [126, PKG_SCOPE], [143, CR_SCOPE], [145, PKG_SCOPE]]) {
  await updateCode(id, (code) => {
    if (code.includes('AS DESLIGAMENTOS')) return code;
    const marker = '),JSON_ARRAY()) AS AUMENTOS,';
    const index = code.indexOf(marker);
    if (index < 0 || code.indexOf(marker, index + marker.length) >= 0) {
      throw new Error(`Marcador AUMENTOS inesperado na SF ${id}`);
    }
    const at = index + marker.length;
    return `${code.slice(0, at)}\n  ${dismissalBlock(scope)},${code.slice(at)}`;
  }, ' Inclui o bloco DESLIGAMENTOS da versao.');
}

await updateCode(147, (code) => {
  if (code.includes("op === 'desligamentoUpsert'")) return code;
  const marker = "if (op === 'pessoalRecalc') {";
  const operations = `if (op === 'desligamentoUpsert') {
  const colabId = Number(event.colaboradorId);
  const mesDesligamento = intOr0(event.mesDesligamento);
  if (!Number.isInteger(colabId)) return { ok: false, error: 'colaboradorId_invalido' };
  if (mesDesligamento < 1 || mesDesligamento > 12) return { ok: false, error: 'mes_desligamento_invalido' };
  await dml("DELETE dp FROM DESLIGAMENTO_PROJETADO dp" +
    " JOIN COLABORADOR cbk ON cbk.ID = dp.COLABORADOR_ID AND cbk.CR_ID = " + crId +
    " JOIN PREENCHIMENTO_TOKEN tkk ON tkk.CICLO_ID = dp.CICLO_ID" +
    " JOIN GESTOR_CR gck ON gck.GESTOR_ID = tkk.GESTOR_ID AND gck.CR_ID = " + crId +
    " WHERE dp.COLABORADOR_ID = " + colabId + " AND " + TK_COND);
  await dml("INSERT INTO DESLIGAMENTO_PROJETADO (CICLO_ID, CR_ID, COLABORADOR_ID, MES_DESLIGAMENTO, CRIADO_EM)" +
    " SELECT tkk.CICLO_ID, " + crId + ", " + colabId + ", " + mesDesligamento + ", '" + agora + "'" +
    " FROM " + TK_SRC +
    " JOIN COLABORADOR cbk ON cbk.ID = " + colabId + " AND cbk.CR_ID = " + crId +
    " WHERE " + TK_COND);
  return { ok: true };
}

if (op === 'desligamentoDelete') {
  const id = Number(event.id);
  if (!Number.isInteger(id)) return { ok: false, error: 'id_invalido' };
  await dml("DELETE dp FROM DESLIGAMENTO_PROJETADO dp" +
    " JOIN COLABORADOR cbk ON cbk.ID = dp.COLABORADOR_ID AND cbk.CR_ID = " + crId +
    " JOIN PREENCHIMENTO_TOKEN tkk ON tkk.CICLO_ID = dp.CICLO_ID" +
    " JOIN GESTOR_CR gck ON gck.GESTOR_ID = tkk.GESTOR_ID AND gck.CR_ID = " + crId +
    " WHERE dp.ID = " + id + " AND " + TK_COND);
  return { ok: true };
}

`;
  return insertOnce(code, marker, operations, 'SF 147');
}, ' Ops desligamentoUpsert/desligamentoDelete token-escopadas.');

await updateCode(191, (code) => {
  if (code.includes('INSERT INTO DESLIGAMENTO_PROJETADO')) return code;
  const marker = '    "INSERT INTO PROJECAO_HEADCOUNT';
  const copy = `    "INSERT INTO DESLIGAMENTO_PROJETADO (CICLO_ID, CR_ID, COLABORADOR_ID, MES_DESLIGAMENTO, CRIADO_EM) SELECT " + novoId + ", CR_ID, COLABORADOR_ID, MES_DESLIGAMENTO, '" + agora + "' FROM DESLIGAMENTO_PROJETADO WHERE CICLO_ID = " + origemId,\n`;
  return insertOnce(code, marker, copy, 'SF 191');
}, ' Duplicacoes preservam desligamentos projetados.');

const checks = await Promise.all([59, 125, 126, 143, 145, 147, 191].map(async (id) => {
  const current = await readCode(id);
  return { id, ok: String(current.code || '').includes('DESLIGAMENTO_PROJETADO') };
}));
if (checks.some((item) => !item.ok)) throw new Error(`Validacao de codigo falhou: ${JSON.stringify(checks)}`);

console.log('Validacao concluida:', JSON.stringify({ functions: createdIds, patched: checks }));
