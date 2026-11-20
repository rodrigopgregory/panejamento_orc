// Smoke somente-leitura do link do gestor: bate no MESMO endpoint publico que o
// navegador do gestor usa (sem auth) e confere que as SFs de detalhe respondem com
// os modelos do CR. Nasceu do bug em que o bloco PREMISSAS caiu depois do LIMIT 1
// e derrubou a SF 143 com "bad SQL grammar" — a tela ficava sem aba de modelo.
import 'dotenv/config';
import { configureSdkMitra, executeServerFunctionMitra } from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});
const projectId = parseInt(process.env.MITRA_PROJECT_ID);
const BASE = 'https://newmitra.mitrasheet.com:8080';

const q = async (sql) => {
  const r = await executeServerFunctionMitra({ projectId, serverFunctionId: 76, input: { sql } });
  let o = r?.result?.output; if (typeof o === 'string') o = JSON.parse(o);
  return o?.rows || [];
};

const pub = async (sfId, input) => {
  const res = await fetch(`${BASE}/public/serverFunction/${projectId}/${sfId}/execute`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  });
  const txt = await res.text();
  if (!res.ok) return { erro: `HTTP ${res.status}`, detalhe: txt.slice(0, 300) };
  const j = JSON.parse(txt);
  if (j?.error) return { erro: 'SQL', detalhe: String(j.error).slice(0, 300) };
  let o = j?.result?.output ?? j?.output; if (typeof o === 'string') o = JSON.parse(o);
  return o;
};

const jb = (v) => { if (typeof v === 'string') { try { return JSON.parse(v) || []; } catch { return []; } } return Array.isArray(v) ? v : []; };

const tks = await q(`SELECT t.TOKEN, t.CICLO_ID, t.GESTOR_ID, c.ANO, gc.CR_ID
  FROM PREENCHIMENTO_TOKEN t
  JOIN CICLO c ON c.ID = t.CICLO_ID
  JOIN GESTOR_CR gc ON gc.GESTOR_ID = t.GESTOR_ID
  WHERE t.ATIVO = 'true' ORDER BY t.ID DESC LIMIT 1`);
if (!tks.length) { console.log('nenhum token de preenchimento ativo — nada a validar'); process.exit(0); }

const { TOKEN, CICLO_ID, GESTOR_ID, ANO, CR_ID } = tks[0];
console.log(`gestor ${GESTOR_ID} · CR ${CR_ID} · ciclo ${CICLO_ID}`);

let falhou = false;

const d = await pub(143, { token: TOKEN, crId: CR_ID, cicloId: CICLO_ID, ano: ANO, anoPrev: ANO - 1, gestorId: GESTOR_ID, controlCicloId: 0 });
if (d?.erro) { console.log(`FALHOU  SF 143 (modelos do CR): ${d.erro} -> ${d.detalhe}`); falhou = true; }
else {
  const configs = jb(d?.rows?.[0]?.CONFIGS).length;
  const premissas = jb(d?.rows?.[0]?.PREMISSAS).length;
  console.log(`ok      SF 143: CONFIGS=${configs} PREMISSAS=${premissas}`);
  // CONFIGS e o que vira aba de modelo no CR. Zero aqui = gestor sem modelo.
  if (configs === 0) { console.log('FALHOU  CONFIGS vazio — o gestor nao veria nenhum modelo neste CR'); falhou = true; }
}

// Token invalido nao pode vazar dado — o gate continua de pe depois da correcao.
const bad = await pub(143, { token: 'deadbeef-0000-0000-0000-000000000000', crId: CR_ID, cicloId: CICLO_ID, ano: ANO, anoPrev: ANO - 1, gestorId: GESTOR_ID, controlCicloId: 0 });
if (bad?.erro) { console.log(`FALHOU  SF 143 com token invalido: ${bad.erro} -> ${bad.detalhe}`); falhou = true; }
else {
  const linhas = (bad?.rows || []).length;
  console.log(`${linhas === 0 ? 'ok     ' : 'FALHOU '} SF 143 token invalido: rows=${linhas}${linhas === 0 ? '' : ' — VAZOU'}`);
  if (linhas !== 0) falhou = true;
}

// SF 145 e o espelho do modo pacote; so valida sintaxe (exige posse do pacote).
const p = await pub(145, { token: TOKEN, pkgId: 0, cicloId: CICLO_ID, ano: ANO, anoPrev: ANO - 1, controlCicloId: 0 });
if (p?.erro) { console.log(`FALHOU  SF 145 (modo pacote): ${p.erro} -> ${p.detalhe}`); falhou = true; }
else console.log(`ok      SF 145: sintaxe valida, rows=${(p?.rows || []).length}`);

process.exit(falhou ? 1 : 0);
