// Valida a ordenacao server-side da SF 101 (realizadoLancamentos) contra os
// dados reais do projeto. Somente leitura — nao altera nada.
import 'dotenv/config';
import { configureSdkMitra, executeServerFunctionMitra } from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_SPACE || process.env.MITRA_BASE_URL_INTEGRATIONS,
});

const projectId = Number(process.env.MITRA_PROJECT_ID);
const SF_LANC = 101;
const ANO = process.argv[2] || String(new Date().getFullYear());

const base = { ano: ANO, empresaId: '', crIds: '', meses: '', tipos: '', busca: '', limit: 20, offset: 0 };

async function buscar(extra) {
  const res = await executeServerFunctionMitra({ projectId, serverFunctionId: SF_LANC, input: { ...base, ...extra } });
  if (res?.result?.executionStatus === 'FAILED') throw new Error(res.result.error || 'SF falhou');
  let out = res?.result?.output;
  if (typeof out === 'string') out = JSON.parse(out);
  return out?.rows || [];
}

function ordenado(valores, dir) {
  for (let i = 1; i < valores.length; i++) {
    const a = valores[i - 1];
    const b = valores[i];
    const cmp = typeof a === 'number' ? a - b : String(a).localeCompare(String(b), 'pt-BR');
    if (dir === 'asc' && cmp > 0) return false;
    if (dir === 'desc' && cmp < 0) return false;
  }
  return true;
}

const CASOS = [
  { campo: 'valor', coluna: (r) => Number(r.VALOR), rotulo: 'Valor' },
  { campo: 'empresa', coluna: (r) => r.EMPRESA_NOME, rotulo: 'Empresa' },
  { campo: 'conta', coluna: (r) => r.CONTA_CODIGO, rotulo: 'Conta' },
  { campo: 'setor', coluna: (r) => r.CR_CODIGO, rotulo: 'Setor' },
  { campo: 'tipo', coluna: (r) => r.CONTA_TIPO, rotulo: 'Tipo' },
  { campo: 'periodo', coluna: (r) => Number(r.ANO) * 100 + Number(r.MES), rotulo: 'Periodo' },
];

let falhas = 0;

const padrao = await buscar({});
console.log(`Ano ${ANO} — ${padrao.length} linhas na primeira pagina\n`);
if (padrao.length === 0) {
  console.log('SEM DADOS para este ano; rode com outro ano: node validate-lancamentos-ordenacao.mjs 2026');
  process.exit(0);
}

// 1) Sem parametro de ordenacao o retorno tem de ser o de sempre (retrocompatibilidade).
const semParam = await buscar({ ordemCampo: '', ordemDir: '' });
const igual = JSON.stringify(padrao.map((r) => r.ID)) === JSON.stringify(semParam.map((r) => r.ID));
console.log(`${igual ? 'OK  ' : 'FALHA'} ordem padrao preservada quando nao se pede ordenacao`);
if (!igual) falhas++;

// 2) Cada coluna, nas duas direcoes.
for (const caso of CASOS) {
  for (const dir of ['asc', 'desc']) {
    const linhas = await buscar({ ordemCampo: caso.campo, ordemDir: dir });
    const valores = linhas.map(caso.coluna);
    const ok = linhas.length > 0 && ordenado(valores, dir);
    console.log(`${ok ? 'OK  ' : 'FALHA'} ${caso.rotulo} ${dir} — ${linhas.length} linhas | inicio: ${JSON.stringify(valores.slice(0, 3))}`);
    if (!ok) falhas++;
  }
}

// 3) Paginacao estavel: pagina 1 e 2 nao podem repetir registro.
const p1 = await buscar({ ordemCampo: 'valor', ordemDir: 'desc', limit: 10, offset: 0 });
const p2 = await buscar({ ordemCampo: 'valor', ordemDir: 'desc', limit: 10, offset: 10 });
const repetidos = p1.map((r) => String(r.ID)).filter((id) => p2.some((r) => String(r.ID) === id));
console.log(`${repetidos.length === 0 ? 'OK  ' : 'FALHA'} paginacao sem repetir registro entre paginas (${repetidos.length} repetidos)`);
if (repetidos.length) falhas++;

// 4) O filtro continua valendo junto com a ordenacao.
const comFiltro = await buscar({ ordemCampo: 'valor', ordemDir: 'desc', tipos: 'CMV' });
const soCmv = comFiltro.every((r) => r.CONTA_TIPO === 'CMV');
console.log(`${soCmv ? 'OK  ' : 'FALHA'} filtro de tipo respeitado com ordenacao ativa (${comFiltro.length} linhas)`);
if (!soCmv) falhas++;

console.log(falhas === 0 ? '\nTudo passou.' : `\n${falhas} verificacao(oes) falharam.`);
process.exit(falhas === 0 ? 0 : 1);
