// SF 79 executarConsultasSeguras — versao em LOTE da SF 76.
// Recebe event.sqls (array de strings), valida CADA um como SELECT-only (mesma
// regra da 76) e roda todos via runQueryMitra dentro de UMA unica invocacao E2B.
// Motivacao: a SF 76 (JS) sobe um sandbox por chamada (~500ms). Telas como DRE e
// kanban faziam 6+ chamadas soltas → 6 sandboxes. Agrupando em 1 chamada, paga-se
// o custo de E2B uma vez so. Retorna { results: [rows, rows, ...] } na ordem de entrada.

import 'dotenv/config';
import {
  configureSdkMitra, createServerFunctionMitra, executeServerFunctionMitra, listServerFunctionsMitra,
} from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});
const projectId = parseInt(process.env.MITRA_PROJECT_ID);

const CODE = [
  "const { runQueryMitra } = require('mitra-sdk');",
  "const projectId = parseInt(process.env.MITRA_PROJECT_ID);",
  "function assertSelect(sql) {",
  "  const s = String(sql || '');",
  "  const noComments = s.replace(/\\/\\*[\\s\\S]*?\\*\\//g, ' ').replace(/--[^\\n]*/g, ' ').replace(/#[^\\n]*/g, ' ').trim();",
  "  if (!/^(select|with)\\b/i.test(noComments)) throw new Error('Apenas consultas SELECT sao permitidas');",
  "  const semLiterais = noComments.replace(/'(?:[^'\\\\]|\\\\.|'')*'/g, \"''\");",
  "  if (semLiterais.replace(/;\\s*$/, '').includes(';')) throw new Error('Apenas uma instrucao por consulta');",
  "  if (/\\binto\\s+(outfile|dumpfile)\\b/i.test(semLiterais)) throw new Error('INTO OUTFILE nao permitido');",
  "  if (/\\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|rename|call|handler)\\b/i.test(semLiterais)) throw new Error('Instrucao nao permitida');",
  "}",
  "const sqls = Array.isArray(event.sqls) ? event.sqls : [];",
  "if (sqls.length > 25) throw new Error('Maximo de 25 consultas por lote');",
  "const results = [];",
  "for (const sql of sqls) {",
  "  assertSelect(sql);",
  "  const r = await runQueryMitra({ projectId, sql });",
  "  results.push((r && r.result && r.result.rows) ? r.result.rows : []);",
  "}",
  "return { results };",
].join('\n');

const existing = await listServerFunctionsMitra({ projectId });
const found = (existing.result || existing || []).find(f => f.name === 'executarConsultasSeguras');
let id;
if (found) {
  id = found.id;
  console.log('SF ja existe:', id);
} else {
  const r = await createServerFunctionMitra({
    projectId, name: 'executarConsultasSeguras', type: 'JAVASCRIPT', code: CODE,
    description: 'Lote de consultas SELECT-only (param sqls: array de strings) — valida cada uma server-side e roda todas em 1 invocacao. Versao batch da SF 76.',
  });
  id = r.result?.serverFunctionId ?? r.result?.id;
  console.log('SF criada:', id);
}

// ── Validacoes ──
async function exec(input) {
  const r = await executeServerFunctionMitra({ projectId, serverFunctionId: id, input });
  const res = r?.result; let out = res?.output; if (typeof out === 'string') { try { out = JSON.parse(out); } catch {} }
  return { status: res?.executionStatus, error: res?.error, out };
}
let v = await exec({ sqls: ['SELECT COUNT(*) AS N FROM CICLO', 'SELECT COUNT(*) AS N FROM ORCAMENTO'] });
console.log('Lote 2 SELECTs:', v.status, JSON.stringify(v.out).slice(0, 120));

v = await exec({ sqls: ['SELECT 1 AS A', 'DELETE FROM ORCAMENTO'] });
console.log('Lote com DELETE (deve FAILED):', v.status, String(v.error).slice(0, 50));

v = await exec({ sqls: ['SELECT 1 AS A; UPDATE ORCAMENTO SET VALOR=0'] });
console.log('Lote com multi-statement (deve FAILED):', v.status, String(v.error).slice(0, 50));

console.log('\nID batch para o frontend:', id);
