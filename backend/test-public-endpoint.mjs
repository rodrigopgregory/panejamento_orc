// Testa o MESMO endpoint publico que o navegador do gestor usa (sem auth)
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
const pub = async (sfId, input) => {
  const res = await fetch(`${base}/public/serverFunction/${projectId}/${sfId}/execute`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  let o = j?.result?.output ?? j?.output; if (typeof o === 'string') o = JSON.parse(o);
  return o;
};
const jb = (v) => { if (typeof v === 'string') { try { return JSON.parse(v) || []; } catch { return []; } } return Array.isArray(v) ? v : []; };

const tks = await q(`SELECT t.TOKEN, t.CICLO_ID, t.GESTOR_ID, c.ANO, gc.CR_ID FROM PREENCHIMENTO_TOKEN t JOIN CICLO c ON c.ID=t.CICLO_ID JOIN GESTOR_CR gc ON gc.GESTOR_ID=t.GESTOR_ID WHERE t.ATIVO='true' ORDER BY t.ID DESC LIMIT 1`);
const { TOKEN, CICLO_ID, GESTOR_ID, ANO, CR_ID } = tks[0];
console.log(`endpoint publico, gestor ${GESTOR_ID}, CR ${CR_ID}`);

const b = await pub(142, { token: TOKEN });
console.log(`142 base (sem auth): CICLOS=${jb(b?.rows?.[0]?.CICLOS).length} CONTAS=${jb(b?.rows?.[0]?.CONTAS).length}`);
const d = await pub(143, { token: TOKEN, crId: CR_ID, cicloId: CICLO_ID, ano: ANO, anoPrev: ANO - 1, gestorId: GESTOR_ID, controlCicloId: 0 });
console.log(`143 detalhe (sem auth): CONFIGS=${jb(d?.rows?.[0]?.CONFIGS).length} STATUS=${jb(d?.rows?.[0]?.STATUS).length}`);
const w = await pub(147, { token: TOKEN, op: 'orcCells', crId: Number(CR_ID), cells: [] });
console.log(`147 write vazio (sem auth): ${JSON.stringify(w)}`);
const bad = await pub(143, { token: 'deadbeef-0000-0000-0000-000000000000', crId: CR_ID, cicloId: CICLO_ID, ano: ANO, anoPrev: ANO - 1, gestorId: GESTOR_ID, controlCicloId: 0 });
console.log(`143 token invalido: rows=${(bad?.rows || []).length} ${(bad?.rows || []).length === 0 ? 'OK' : '!!! VAZOU'}`);
