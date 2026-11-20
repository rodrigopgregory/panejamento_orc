-- tipo: JAVASCRIPT | Consulta generica SELECT-only — valida server-side que o SQL e um unico SELECT (substitui a SF 18 executarConsulta)
if (/git_config/i.test(JSON.stringify(event))) throw new Error('Tabela nao permitida');
const { runQueryMitra } = require('mitra-sdk');
const projectId = parseInt(process.env.MITRA_PROJECT_ID);
const sql = String(event.sql || '');
const noComments = sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ').replace(/#[^\n]*/g, ' ').trim();
if (!/^(select|with)\b/i.test(noComments)) throw new Error('Apenas consultas SELECT sao permitidas');
const semLiterais = noComments.replace(/'(?:[^'\\]|\\.|'')*'/g, "''");
if (semLiterais.replace(/;\s*$/, '').includes(';')) throw new Error('Apenas uma instrucao por chamada');
if (/\binto\s+(outfile|dumpfile)\b/i.test(semLiterais)) throw new Error('INTO OUTFILE nao permitido');
if (/\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|rename|call|handler)\b/i.test(semLiterais)) throw new Error('Instrucao nao permitida');
const r = await runQueryMitra({ projectId, sql });
return r && r.result ? r.result : { rows: [], rowCount: 0 };