// RATEIO.TIPO ('QUANTIDADE' | 'PERCENTUAL') — o usuario escolhe na criacao se o
// rateio e informado por quantidade (ex.: pessoas por CR, % derivado) ou por
// percentual direto (digita o % de cada CR). O valor continua armazenado em
// RATEIO_ITEM.QUANTIDADE nos dois casos — a distribuicao (share = valor/soma)
// e identica, so muda a forma de entrada e exibicao.
// Regenera SFs 131/133 (schema-driven — TIPO entra automatico no bloco RATEIOS).
// Idempotente.
import 'dotenv/config';
import {
  configureSdkMitra, runDdlMitra, runDmlMitra, executeServerFunctionMitra,
  updateServerFunctionMitra,
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

// ── 1. DDL + backfill ───────────────────────────────────────
if (!(await hasColumn('RATEIO', 'TIPO'))) {
  await runDdlMitra({ projectId, sql: `ALTER TABLE RATEIO ADD COLUMN TIPO VARCHAR(15) NULL` });
  console.log('RATEIO.TIPO criada');
} else console.log('RATEIO.TIPO ja existe');

await runDmlMitra({ projectId, sql: `UPDATE RATEIO SET TIPO = 'QUANTIDADE' WHERE TIPO IS NULL OR TIPO = ''` });
console.log('backfill TIPO=QUANTIDADE nos rateios existentes');

// ── 2. Regenerar SFs 131/133 (mesma geracao schema-driven do add-rateio-refinamento) ──
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
const RATEIO_USOS = blkJ('RATEIO_USOS', `SELECT JSON_ARRAYAGG(JSON_OBJECT('RATEIO_ID',x.RATEIO_ID,'QTD',x.QTD)) FROM (SELECT RATEIO_ID, COUNT(*) AS QTD FROM DRIVER_FORMULA WHERE RATEIO_ID IS NOT NULL GROUP BY RATEIO_ID) x`);

const CODE_REGRAS = `SELECT
  ${CRS}, ${CONTAS_FULL},
  ${blk('CR_CONTAS','CR_CONTA','t.ATIVO = true')},
  ${blkJ('GESTORES_CR',`SELECT JSON_ARRAYAGG(JSON_OBJECT('CR_ID',x.CR_ID,'GESTORES',x.GESTORES)) FROM (SELECT gc.CR_ID, GROUP_CONCAT(g.NOME ORDER BY g.NOME SEPARATOR ', ') AS GESTORES FROM GESTOR_CR gc JOIN GESTOR g ON g.ID = gc.GESTOR_ID WHERE g.ATIVO = 'true' GROUP BY gc.CR_ID) x`)},
  ${DRIVERS_ATIVOS}, ${CONTA_DRIVERS}, ${EXCECOES},
  ${RATEIOS}, ${RATEIO_ITENS}, ${RATEIO_USOS}`;

const CODE_FORMULAS = `SELECT
  ${blk('DRIVER','DRIVERS','t.ID = {{driverId}}')},
  ${blkJ('CONTAS',`SELECT JSON_ARRAYAGG(JSON_OBJECT('ID',c.ID,'CODIGO',c.CODIGO,'NOME',c.NOME)) FROM CONTA_CONTABIL c`)},
  ${blk('LINHAS','DRIVER_FORMULA','t.DRIVER_ID = {{driverId}}')},
  ${blkJ('VINCULOS',`SELECT JSON_ARRAYAGG(JSON_OBJECT('CONTA_ID',cd.CONTA_ID)) FROM CONTA_DRIVER cd WHERE cd.DRIVER_ID = {{driverId}}`)},
  ${RATEIOS},
  COALESCE((SELECT JSON_OBJECT('ID',v.ID,'NUMERO',v.NUMERO,'CRIADO_EM',v.CRIADO_EM,'SNAPSHOT',v.SNAPSHOT) FROM DRIVER_VERSAO v WHERE v.DRIVER_ID = {{driverId}} ORDER BY v.NUMERO DESC LIMIT 1),JSON_OBJECT()) AS ULTIMA_VERSAO`;

await updateServerFunctionMitra({ projectId, serverFunctionId: 131, code: CODE_REGRAS,
  description: 'Mount de Regras Contabeis em 1 ida (CRS,CONTAS,CR_CONTAS,GESTORES_CR,DRIVERS,CONTA_DRIVERS,EXCECOES,RATEIOS c/ TIPO,RATEIO_ITENS,RATEIO_USOS). Sem params.' });
console.log('SF 131 atualizada');
await updateServerFunctionMitra({ projectId, serverFunctionId: 133, code: CODE_FORMULAS,
  description: 'Mount de Formulas do Modelo em 1 ida (DRIVER,CONTAS,LINHAS c/ GRANULARIDADE+RATEIO_ID,VINCULOS,RATEIOS c/ TIPO,ULTIMA_VERSAO). Param: driverId.' });
console.log('SF 133 atualizada');

// ── 3. Smoke test ───────────────────────────────────────────
for (const [id, input] of [[131, {}], [133, { driverId: 1 }]]) {
  const res = await executeServerFunctionMitra({ projectId, serverFunctionId: id, input });
  const st = res?.result?.executionStatus;
  if (st !== 'COMPLETED') throw new Error(`SF ${id} falhou: ${res?.result?.error || st}`);
  let out = res?.result?.output;
  if (typeof out === 'string') try { out = JSON.parse(out); } catch {}
  const row = out?.rows?.[0] || {};
  if (id === 131 && !String(row.RATEIOS ?? '').includes('TIPO')) {
    const rats = typeof row.RATEIOS === 'string' ? JSON.parse(row.RATEIOS) : row.RATEIOS;
    if (Array.isArray(rats) && rats.length > 0 && !('TIPO' in rats[0])) throw new Error('SF 131: bloco RATEIOS sem TIPO');
  }
  console.log(`SF ${id} OK`);
}
console.log('done');
