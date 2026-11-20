import 'dotenv/config';
import { configureSdkMitra, executeServerFunctionMitra } from 'mitra-sdk';
configureSdkMitra({ baseURL: process.env.MITRA_BASE_URL, token: process.env.MITRA_TOKEN, integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS });
const projectId = parseInt(process.env.MITRA_PROJECT_ID);
const q = async (sql) => {
  const r = await executeServerFunctionMitra({ projectId, serverFunctionId: 76, input: { sql } });
  let o = r?.result?.output; if (typeof o === 'string') o = JSON.parse(o);
  return o?.rows || [];
};
const ex = async (id, input) => {
  const r = await executeServerFunctionMitra({ projectId, serverFunctionId: id, input });
  if (r?.result?.executionStatus === 'FAILED') throw new Error(`SF ${id}: ${r?.result?.error}`);
  let o = r?.result?.output; if (typeof o === 'string') o = JSON.parse(o);
  return o?.rows || [];
};
const jb = (v) => { if (typeof v === 'string') { try { return JSON.parse(v) || []; } catch { return []; } } return Array.isArray(v) ? v : []; };

// token valido de um gestor com CRs
const tks = await q(`SELECT t.TOKEN, t.CICLO_ID, t.GESTOR_ID, c.ANO,
  (SELECT COUNT(*) FROM GESTOR_CR gc WHERE gc.GESTOR_ID = t.GESTOR_ID) AS NCRS
  FROM PREENCHIMENTO_TOKEN t JOIN CICLO c ON c.ID = t.CICLO_ID
  WHERE t.ATIVO = 'true' HAVING NCRS > 0 ORDER BY t.ID DESC LIMIT 1`);
if (!tks.length) throw new Error('nenhum token ativo com CRs');
const { TOKEN, CICLO_ID, GESTOR_ID, ANO, NCRS } = tks[0];
console.log(`token de teste: gestor ${GESTOR_ID}, ciclo ${CICLO_ID} (${ANO}), ${NCRS} CRs`);
const crs = await q(`SELECT gc.CR_ID FROM GESTOR_CR gc WHERE gc.GESTOR_ID = ${GESTOR_ID} ORDER BY gc.CR_ID LIMIT 1`);
const crId = Number(crs[0].CR_ID);
const anoPrev = Number(ANO) - 1;

// 1) base: publico (142) vs interno (124)
const pubBase = (await ex(142, { token: TOKEN }))[0] || {};
const intBase = (await ex(124, {}))[0] || {};
for (const k of Object.keys(intBase)) {
  const a = jb(pubBase[k]).length, b = jb(intBase[k]).length;
  console.log(`BASE ${k}: pub=${a} int=${b} ${a === b ? 'OK' : '!!! DIFERENTE'}`);
}

// 2) detalhe CR: publico (143) vs interno (125)
const inputCr = { crId, cicloId: CICLO_ID, ano: ANO, anoPrev, gestorId: GESTOR_ID, controlCicloId: 0 };
const pubCr = (await ex(143, { ...inputCr, token: TOKEN }))[0] || {};
const intCr = (await ex(125, inputCr))[0] || {};
for (const k of Object.keys(intCr)) {
  const a = jb(pubCr[k]).length, b = jb(intCr[k]).length;
  console.log(`CR${crId} ${k}: pub=${a} int=${b} ${a === b ? 'OK' : '!!! DIFERENTE'}`);
}
// soma financeira do BUDGET deve bater
const sum = (rows) => rows.reduce((s, r) => s + (Number(r.VALOR) || 0), 0);
console.log(`CR${crId} BUDGET soma: pub=${sum(jb(pubCr.BUDGET))} int=${sum(jb(intCr.BUDGET))}`);

// 3) token invalido => 0 linhas
const bad = await ex(142, { token: '00000000-0000-0000-0000-000000000000' });
console.log(`token invalido base rows: ${bad.length} ${bad.length === 0 ? 'OK' : '!!! VAZOU'}`);
const badCr = await ex(143, { ...inputCr, token: '00000000-0000-0000-0000-000000000000' });
console.log(`token invalido detalheCr rows: ${badCr.length} ${badCr.length === 0 ? 'OK' : '!!! VAZOU'}`);
// gestorId errado => 0 linhas
const badG = await ex(143, { ...inputCr, gestorId: GESTOR_ID + 999, token: TOKEN });
console.log(`gestorId divergente rows: ${badG.length} ${badG.length === 0 ? 'OK' : '!!! VAZOU'}`);

// 4) pacote (se o gestor tiver)
const pkgs = await q(`SELECT ps.DRIVER_ID FROM PACOTE_STATUS ps WHERE ps.CICLO_ID = ${CICLO_ID} AND ps.GESTOR_ID = ${GESTOR_ID} LIMIT 1`);
if (pkgs.length) {
  const pkgId = Number(pkgs[0].DRIVER_ID);
  const inputPkg = { pkgId, cicloId: CICLO_ID, ano: ANO, anoPrev, controlCicloId: 0 };
  const pubPkg = (await ex(145, { ...inputPkg, token: TOKEN }))[0] || {};
  const intPkg = (await ex(126, inputPkg))[0] || {};
  for (const k of Object.keys(intPkg)) {
    const a = jb(pubPkg[k]).length, b = jb(intPkg[k]).length;
    console.log(`PKG${pkgId} ${k}: pub=${a} int=${b} ${a === b ? 'OK' : '!!! DIFERENTE'}`);
  }
} else {
  console.log('gestor sem pacote — pulei teste de pacote');
}
