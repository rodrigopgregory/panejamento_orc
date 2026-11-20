// Refinamento do fluxo de mapeamento (turno 14/07/2026):
//   1) DRIVERS.ESCOPO ('CR' | 'PACOTE') — modelos personalizados passam a ter escopo:
//      rota CR usa modelos de CR; rota Pacote usa modelos de pacote (duas entidades:
//      o pacote continua sendo a rota, o modelo de pacote é o driver de cálculo).
//   2) Tabelas RATEIO + RATEIO_ITEM — cadastro reutilizável de rateio (quantidade
//      manual por CR, % derivado). Substitui o rateio legado por pacote
//      (RATEIO_CONFIG/RATEIO_CR, que permanecem no banco como legado sem novas leituras).
//   3) DRIVER_FORMULA.GRANULARIDADE ('CR' | NULL) + RATEIO_ID — por linha do modelo
//      de pacote: input/fórmula por CR (sanfona) ou valor único rateado.
//   4) Limpa CONTA_DRIVER_EXCECAO de contas roteadas a pacote (decisão do usuário:
//      pacote não tem personalização por CR).
//   5) Regenera SFs 131/132/133 com os novos campos + blocos RATEIOS/RATEIO_ITENS/
//      RATEIO_USOS; estende o snapshot da SF 194 (publicarModeloVersao).
// Idempotente: checa INFORMATION_SCHEMA antes de cada DDL.
import 'dotenv/config';
import {
  configureSdkMitra, runDdlMitra, runDmlMitra, executeServerFunctionMitra,
  updateServerFunctionMitra, readServerFunctionMitra,
} from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});
const projectId = parseInt(process.env.MITRA_PROJECT_ID);

async function query(sql) {
  const res = await executeServerFunctionMitra({ projectId, serverFunctionId: 76, input: { sql } });
  let output = res?.result?.output;
  if (typeof output === 'string') try { output = JSON.parse(output); } catch {}
  if (output && Array.isArray(output.rows)) return output.rows;
  if (Array.isArray(output)) return output;
  return [];
}

async function hasColumn(table, column) {
  const r = await query(`SELECT COUNT(*) AS N FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${table}' AND COLUMN_NAME = '${column}'`);
  return Number(r[0]?.N) > 0;
}
async function hasTable(table) {
  const r = await query(`SELECT COUNT(*) AS N FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${table}'`);
  return Number(r[0]?.N) > 0;
}

// ── 1. DDL ──────────────────────────────────────────────────
if (!(await hasColumn('DRIVERS', 'ESCOPO'))) {
  await runDdlMitra({ projectId, sql: `ALTER TABLE DRIVERS ADD COLUMN ESCOPO VARCHAR(10) NULL` });
  console.log('DRIVERS.ESCOPO criada');
} else console.log('DRIVERS.ESCOPO ja existe');

// Backfill: todo modelo de calculo existente e de CR (comportamento atual preservado)
await runDmlMitra({ projectId, sql: `UPDATE DRIVERS SET ESCOPO = 'CR' WHERE TIPO_DRIVER <> 'PACOTE' AND (ESCOPO IS NULL OR ESCOPO = '')` });
console.log('backfill ESCOPO=CR nos modelos existentes');

if (!(await hasColumn('DRIVER_FORMULA', 'GRANULARIDADE'))) {
  await runDdlMitra({ projectId, sql: `ALTER TABLE DRIVER_FORMULA ADD COLUMN GRANULARIDADE VARCHAR(10) NULL` });
  console.log('DRIVER_FORMULA.GRANULARIDADE criada');
} else console.log('DRIVER_FORMULA.GRANULARIDADE ja existe');

if (!(await hasColumn('DRIVER_FORMULA', 'RATEIO_ID'))) {
  await runDdlMitra({ projectId, sql: `ALTER TABLE DRIVER_FORMULA ADD COLUMN RATEIO_ID INT NULL` });
  console.log('DRIVER_FORMULA.RATEIO_ID criada');
} else console.log('DRIVER_FORMULA.RATEIO_ID ja existe');

if (!(await hasTable('RATEIO'))) {
  await runDdlMitra({ projectId, sql: `CREATE TABLE RATEIO (
    ID INT AUTO_INCREMENT PRIMARY KEY,
    NOME VARCHAR(200) NOT NULL,
    DESCRICAO VARCHAR(500),
    ATIVO BOOLEAN DEFAULT TRUE,
    CRIADO_EM VARCHAR(19)
  )` });
  console.log('tabela RATEIO criada');
} else console.log('tabela RATEIO ja existe');

if (!(await hasTable('RATEIO_ITEM'))) {
  await runDdlMitra({ projectId, sql: `CREATE TABLE RATEIO_ITEM (
    ID INT AUTO_INCREMENT PRIMARY KEY,
    RATEIO_ID INT NOT NULL,
    CR_ID INT NOT NULL,
    QUANTIDADE DECIMAL(15,4) DEFAULT 0,
    FOREIGN KEY (RATEIO_ID) REFERENCES RATEIO(ID),
    FOREIGN KEY (CR_ID) REFERENCES CENTRO_RESULTADO(ID),
    UNIQUE KEY uq_rateio_cr (RATEIO_ID, CR_ID)
  )` });
  console.log('tabela RATEIO_ITEM criada');
} else console.log('tabela RATEIO_ITEM ja existe');

// ── 2. Limpeza: excecoes por CR de contas roteadas a pacote ─
// (decisao do usuario: rota pacote nao tem personalizacao por CR — limpa as existentes)
const excs = await query(`SELECT COUNT(*) AS N FROM CONTA_DRIVER_EXCECAO WHERE CONTA_ID IN (
  SELECT CONTA_ID FROM CONTA_DRIVER
  WHERE PACOTE_ID IS NOT NULL
     OR DRIVER_ID IN (SELECT ID FROM DRIVERS WHERE TIPO_DRIVER = 'PACOTE'))`);
if (Number(excs[0]?.N) > 0) {
  await runDmlMitra({ projectId, sql: `DELETE FROM CONTA_DRIVER_EXCECAO WHERE CONTA_ID IN (
    SELECT CONTA_ID FROM CONTA_DRIVER
    WHERE PACOTE_ID IS NOT NULL
       OR DRIVER_ID IN (SELECT ID FROM DRIVERS WHERE TIPO_DRIVER = 'PACOTE'))` });
  console.log(`limpas ${excs[0].N} excecoes por CR de contas em pacote`);
} else console.log('nenhuma excecao de conta em pacote para limpar');

// ── 3. Regenerar SFs 131/132/133 (mesma geracao schema-driven do add-hot-cadastros) ──
const TABLES = ['CENTRO_RESULTADO','DRIVERS','CONTA_CONTABIL','CR_CONTA','CONTA_DRIVER','CONTA_DRIVER_EXCECAO','DRIVER_FORMULA','RATEIO','RATEIO_ITEM'];
const schemaRows = await query(`SELECT TABLE_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${TABLES.map(t=>`'${t}'`).join(',')}) ORDER BY TABLE_NAME, ORDINAL_POSITION`);
const S = {};
for (const r of schemaRows) (S[r.TABLE_NAME] ||= []).push(r.COLUMN_NAME);
for (const t of TABLES) if (!S[t]) throw new Error(`schema ausente: ${t}`);

const jo = (table, alias) => S[table].map(c => `'${c}',${alias}.${c}`).join(',');
const blk = (name, table, where) =>
  `COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT(${jo(table,'t')})) FROM ${table} t WHERE ${where}),JSON_ARRAY()) AS ${name}`;
const blkJ = (name, inner) => `COALESCE((${inner}),JSON_ARRAY()) AS ${name}`;

const CRS = blk('CRS','CENTRO_RESULTADO',`t.ATIVO = 'true'`);
const CONTAS_FULL = blk('CONTAS','CONTA_CONTABIL','1=1');
const CONTA_DRIVERS = blk('CONTA_DRIVERS','CONTA_DRIVER','1=1');
const EXCECOES = blk('EXCECOES','CONTA_DRIVER_EXCECAO','t.ATIVO = true');
const DRIVERS_ATIVOS = blk('DRIVERS','DRIVERS',`t.ATIVO = 'true'`);
const RATEIOS = blk('RATEIOS','RATEIO','t.ATIVO = true');
const RATEIO_ITENS = blk('RATEIO_ITENS','RATEIO_ITEM','1=1');
// Uso de cada rateio nas linhas de modelo (bloqueia exclusao de rateio em uso)
const RATEIO_USOS = blkJ('RATEIO_USOS', `SELECT JSON_ARRAYAGG(JSON_OBJECT('RATEIO_ID',x.RATEIO_ID,'QTD',x.QTD)) FROM (SELECT RATEIO_ID, COUNT(*) AS QTD FROM DRIVER_FORMULA WHERE RATEIO_ID IS NOT NULL GROUP BY RATEIO_ID) x`);

// 131 hotRegrasBase — ganha RATEIOS/RATEIO_ITENS/RATEIO_USOS (aba Tipos de rateio)
const CODE_REGRAS = `SELECT
  ${CRS}, ${CONTAS_FULL},
  ${blk('CR_CONTAS','CR_CONTA','t.ATIVO = true')},
  ${blkJ('GESTORES_CR',`SELECT JSON_ARRAYAGG(JSON_OBJECT('CR_ID',x.CR_ID,'GESTORES',x.GESTORES)) FROM (SELECT gc.CR_ID, GROUP_CONCAT(g.NOME ORDER BY g.NOME SEPARATOR ', ') AS GESTORES FROM GESTOR_CR gc JOIN GESTOR g ON g.ID = gc.GESTOR_ID WHERE g.ATIVO = 'true' GROUP BY gc.CR_ID) x`)},
  ${DRIVERS_ATIVOS}, ${CONTA_DRIVERS}, ${EXCECOES},
  ${RATEIOS}, ${RATEIO_ITENS}, ${RATEIO_USOS}`;

// 132 hotModelagemBase — DRIVERS agora inclui ESCOPO (schema-driven)
const CODE_MODELAGEM = `SELECT
  ${DRIVERS_ATIVOS}, ${CONTAS_FULL}, ${CRS}, ${CONTA_DRIVERS}, ${EXCECOES},
  ${blkJ('DRIVER_CONFIGS',`SELECT JSON_ARRAYAGG(JSON_OBJECT('DRIVER_ID',x.DRIVER_ID,'QTD',x.QTD)) FROM (SELECT DRIVER_ID, COUNT(*) AS QTD FROM DRIVER_FORMULA WHERE TIPO = 'FORMULA' AND FORMULA IS NOT NULL AND FORMULA <> '' GROUP BY DRIVER_ID) x`)},
  ${blkJ('CR_CONTA',`SELECT JSON_ARRAYAGG(JSON_OBJECT('ID',cc.ID,'CR_ID',cc.CR_ID,'CONTA_ID',cc.CONTA_ID)) FROM CR_CONTA cc WHERE cc.ATIVO = true`)}`;

// 133 hotFormulasModeloBase — LINHAS/DRIVER com novos campos + RATEIOS (picker do
// editor) + ULTIMA_VERSAO (preservado do add-modelo-versao.mjs)
const CODE_FORMULAS = `SELECT
  ${blk('DRIVER','DRIVERS','t.ID = {{driverId}}')},
  ${blkJ('CONTAS',`SELECT JSON_ARRAYAGG(JSON_OBJECT('ID',c.ID,'CODIGO',c.CODIGO,'NOME',c.NOME)) FROM CONTA_CONTABIL c`)},
  ${blk('LINHAS','DRIVER_FORMULA','t.DRIVER_ID = {{driverId}}')},
  ${blkJ('VINCULOS',`SELECT JSON_ARRAYAGG(JSON_OBJECT('CONTA_ID',cd.CONTA_ID)) FROM CONTA_DRIVER cd WHERE cd.DRIVER_ID = {{driverId}}`)},
  ${RATEIOS},
  COALESCE((SELECT JSON_OBJECT('ID',v.ID,'NUMERO',v.NUMERO,'CRIADO_EM',v.CRIADO_EM,'SNAPSHOT',v.SNAPSHOT) FROM DRIVER_VERSAO v WHERE v.DRIVER_ID = {{driverId}} ORDER BY v.NUMERO DESC LIMIT 1),JSON_OBJECT()) AS ULTIMA_VERSAO`;

await updateServerFunctionMitra({ projectId, serverFunctionId: 131, code: CODE_REGRAS,
  description: 'Mount de Regras Contabeis em 1 ida (CRS,CONTAS,CR_CONTAS,GESTORES_CR,DRIVERS,CONTA_DRIVERS,EXCECOES,RATEIOS,RATEIO_ITENS,RATEIO_USOS). Sem params.' });
console.log('SF 131 atualizada');
await updateServerFunctionMitra({ projectId, serverFunctionId: 132, code: CODE_MODELAGEM,
  description: 'Mount de Modelagem em 1 ida (DRIVERS c/ ESCOPO,CONTAS,CRS,CONTA_DRIVERS,EXCECOES,DRIVER_CONFIGS,CR_CONTA). Sem params.' });
console.log('SF 132 atualizada');
await updateServerFunctionMitra({ projectId, serverFunctionId: 133, code: CODE_FORMULAS,
  description: 'Mount de Formulas do Modelo em 1 ida (DRIVER,CONTAS,LINHAS c/ GRANULARIDADE+RATEIO_ID,VINCULOS,RATEIOS,ULTIMA_VERSAO). Param: driverId.' });
console.log('SF 133 atualizada');

// ── 4. SF 194 publicarModeloVersao: snapshot passa a incluir GRANULARIDADE/RATEIO_ID ──
const SNAP_OBJ = "JSON_OBJECT('CODIGO',f.CODIGO,'NOME_CUSTOM',f.NOME_CUSTOM,'CONTA_ID',f.CONTA_ID,'TIPO',f.TIPO,'FORMULA',f.FORMULA,'ORDEM',f.ORDEM,'ESCONDER',f.ESCONDER,'NEGRITO',f.NEGRITO,'FORMATO',f.FORMATO,'GRANULARIDADE',f.GRANULARIDADE,'RATEIO_ID',f.RATEIO_ID)";
await updateServerFunctionMitra({ projectId, serverFunctionId: 194,
  code: `INSERT INTO DRIVER_VERSAO (DRIVER_ID, NUMERO, SNAPSHOT, CRIADO_EM, CRIADO_POR)
SELECT
  {{driverId}},
  (SELECT COALESCE(MAX(NUMERO),0)+1 FROM (SELECT NUMERO FROM DRIVER_VERSAO WHERE DRIVER_ID = {{driverId}}) x),
  (SELECT JSON_ARRAYAGG(${SNAP_OBJ}) FROM DRIVER_FORMULA f WHERE f.DRIVER_ID = {{driverId}}),
  '{{agora}}',
  :VAR_USER`,
  description: 'Grava um snapshot do estado atual das linhas do modelo (DRIVER_FORMULA, inclui GRANULARIDADE/RATEIO_ID) como nova versao. Params: driverId, agora.' });
console.log('SF 194 atualizada');

// ── 5. Smoke test das SFs regeneradas ───────────────────────
for (const [id, input] of [[131, {}], [132, {}], [133, { driverId: 1 }]]) {
  const res = await executeServerFunctionMitra({ projectId, serverFunctionId: id, input });
  const st = res?.result?.executionStatus;
  if (st !== 'COMPLETED') throw new Error(`SF ${id} falhou: ${res?.result?.error || st}`);
  console.log(`SF ${id} OK`);
}

// Verificacao final do codigo salvo da 133 (ULTIMA_VERSAO + RATEIOS presentes)
const sf133 = await readServerFunctionMitra({ projectId, serverFunctionId: 133 });
const c133 = sf133?.result?.code || '';
if (!c133.includes('ULTIMA_VERSAO') || !c133.includes('RATEIOS')) throw new Error('SF 133 sem ULTIMA_VERSAO/RATEIOS');
console.log('done');
