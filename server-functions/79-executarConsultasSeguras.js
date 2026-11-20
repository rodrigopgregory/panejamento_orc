-- tipo: JAVASCRIPT | Lote de consultas SELECT-only (param sqls: array de strings) — valida cada uma server-side e roda todas em 1 invocacao. Versao batch da SF 76.
if (/git_config/i.test(JSON.stringify(event))) throw new Error('Tabela nao permitida');
const { runQueryMitra } = require('mitra-sdk');
const projectId = parseInt(process.env.MITRA_PROJECT_ID);
function assertSelect(sql) {
  const s = String(sql || '');
  const noComments = s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ').replace(/#[^\n]*/g, ' ').trim();
  if (!/^(select|with)\b/i.test(noComments)) throw new Error('Apenas consultas SELECT sao permitidas');
  const semLiterais = noComments.replace(/'(?:[^'\\]|\\.|'')*'/g, "''");
  if (semLiterais.replace(/;\s*$/, '').includes(';')) throw new Error('Apenas uma instrucao por consulta');
  if (/\binto\s+(outfile|dumpfile)\b/i.test(semLiterais)) throw new Error('INTO OUTFILE nao permitido');
  if (/\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|rename|call|handler)\b/i.test(semLiterais)) throw new Error('Instrucao nao permitida');
}
const sqls = Array.isArray(event.sqls) ? event.sqls : [];
if (sqls.length > 25) throw new Error('Maximo de 25 consultas por lote');
const results = [];
for (const sql of sqls) {
  assertSelect(sql);
  const r = await runQueryMitra({ projectId, sql });
  results.push((r && r.result && r.result.rows) ? r.result.rows : []);
}
return { results };