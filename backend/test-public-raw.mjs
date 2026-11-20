import 'dotenv/config';
import { configureSdkMitra, executeServerFunctionMitra } from 'mitra-sdk';
configureSdkMitra({ baseURL: process.env.MITRA_BASE_URL, token: process.env.MITRA_TOKEN, integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS });
const projectId = parseInt(process.env.MITRA_PROJECT_ID);
const q = async (sql) => {
  const r = await executeServerFunctionMitra({ projectId, serverFunctionId: 76, input: { sql } });
  let o = r?.result?.output; if (typeof o === 'string') o = JSON.parse(o);
  return o?.rows || [];
};
const base = 'https://newmitra.mitrasheet.com:8080';
const pubRaw = async (sfId, input) => {
  const res = await fetch(`${base}/public/serverFunction/${projectId}/${sfId}/execute`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  });
  const txt = await res.text();
  return { status: res.status, body: txt.slice(0, 600) };
};
const tks = await q(`SELECT t.TOKEN, t.CICLO_ID, t.GESTOR_ID, c.ANO, gc.CR_ID FROM PREENCHIMENTO_TOKEN t JOIN CICLO c ON c.ID=t.CICLO_ID JOIN GESTOR_CR gc ON gc.GESTOR_ID=t.GESTOR_ID WHERE t.ATIVO='true' ORDER BY t.ID DESC LIMIT 1`);
const { TOKEN, CR_ID } = tks[0];
console.log('=== 140 (funciona hoje) ==='); console.log(JSON.stringify(await pubRaw(140, { token: TOKEN, crId: CR_ID })));
console.log('=== 142 (nova base) ==='); console.log(JSON.stringify(await pubRaw(142, { token: TOKEN })));
console.log('=== 147 (write vazio) ==='); console.log(JSON.stringify(await pubRaw(147, { token: TOKEN, op: 'orcCells', crId: Number(CR_ID), cells: [] })));
