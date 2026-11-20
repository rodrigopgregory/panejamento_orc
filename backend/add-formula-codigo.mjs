// Codigo alfanumerico estavel por linha de modelo (DRIVER_FORMULA.CODIGO):
// - ALTER TABLE aditivo + backfill L1..Ln por driver (ORDEM, ID)
// - Atualiza as SFs que serializam DRIVER_FORMULA para incluir o CODIGO
//   (patch ancorado em 'NOME_CUSTOM',<alias>.NOME_CUSTOM — nao toca em nada alem)
import 'dotenv/config';
import {
  configureSdkMitra, executeServerFunctionMitra, runDdlMitra, runDmlMitra,
  listServerFunctionsMitra, readServerFunctionMitra, updateServerFunctionMitra,
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

// 1. Coluna CODIGO (aditivo, idempotente)
const has = await query("SELECT COUNT(*) AS N FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'DRIVER_FORMULA' AND COLUMN_NAME = 'CODIGO'");
if (Number(has[0]?.N) === 0) {
  await runDdlMitra({ projectId, sql: 'ALTER TABLE DRIVER_FORMULA ADD COLUMN CODIGO VARCHAR(20) NULL' });
  console.log('coluna CODIGO criada');
} else {
  console.log('coluna CODIGO ja existe');
}

// 2. Backfill L1..Ln por driver (so onde falta)
await runDmlMitra({ projectId, sql: `
  UPDATE DRIVER_FORMULA df
  JOIN (
    SELECT ID, CONCAT('L', ROW_NUMBER() OVER (PARTITION BY DRIVER_ID ORDER BY ORDEM, ID)) AS NOVO
    FROM DRIVER_FORMULA
  ) x ON x.ID = df.ID
  SET df.CODIGO = x.NOVO
  WHERE df.CODIGO IS NULL OR df.CODIGO = ''
` });
const filled = await query("SELECT DRIVER_ID, COUNT(*) AS N, GROUP_CONCAT(CODIGO ORDER BY ORDEM, ID) AS CODIGOS FROM DRIVER_FORMULA GROUP BY DRIVER_ID");
console.log('backfill:', JSON.stringify(filled));

// 3. Patch das SFs que serializam DRIVER_FORMULA
const list = await listServerFunctionsMitra({ projectId });
const sfs = list?.result || list || [];
const candidates = sfs.filter((s) => /orc|formula|modelagem/i.test(s.name || ''));
console.log('candidatas:', candidates.map((s) => `${s.id}:${s.name}`).join(', '));

for (const sf of candidates) {
  const detail = await readServerFunctionMitra({ projectId, serverFunctionId: sf.id });
  const code = detail?.result?.code || '';
  if (typeof code !== 'string' || !code.includes('NOME_CUSTOM')) continue;
  if (/'CODIGO',(t|df)\.CODIGO/.test(code)) { console.log(`SF ${sf.id} (${sf.name}): ja tem CODIGO`); continue; }
  const patched = code
    .replace(/'NOME_CUSTOM',t\.NOME_CUSTOM/g, "'NOME_CUSTOM',t.NOME_CUSTOM,'CODIGO',t.CODIGO")
    .replace(/'NOME_CUSTOM',df\.NOME_CUSTOM/g, "'NOME_CUSTOM',df.NOME_CUSTOM,'CODIGO',df.CODIGO");
  if (patched === code) { console.log(`SF ${sf.id} (${sf.name}): sem ancora NOME_CUSTOM em blocos DRIVER_FORMULA`); continue; }
  await updateServerFunctionMitra({ projectId, serverFunctionId: sf.id, code: patched });
  console.log(`SF ${sf.id} (${sf.name}): CODIGO adicionado`);
}

// 4. Verificacao — SF 133 (LINHAS) e SF 124 (FORMULAS) devolvem CODIGO
const drv = await query('SELECT ID FROM DRIVER WHERE ID IN (SELECT DRIVER_ID FROM DRIVER_FORMULA) LIMIT 1');
if (drv[0]) {
  const r133 = await executeServerFunctionMitra({ projectId, serverFunctionId: 133, input: { driverId: drv[0].ID } });
  let o = r133?.result?.output; if (typeof o === 'string') o = JSON.parse(o);
  const linhas = JSON.parse(o?.rows?.[0]?.LINHAS ?? '[]');
  console.log('SF133 LINHAS[0]:', JSON.stringify(linhas[0] ?? null));
}
const r124 = await executeServerFunctionMitra({ projectId, serverFunctionId: 124, input: {} });
let o124 = r124?.result?.output; if (typeof o124 === 'string') o124 = JSON.parse(o124);
const formulas = JSON.parse(o124?.rows?.[0]?.FORMULAS ?? '[]');
console.log('SF124 FORMULAS[0]:', JSON.stringify(formulas[0] ?? null));
