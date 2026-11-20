// GUARDA DE DESIGN SYSTEM — abas de preenchimento (OrcamentoContent).
// Toda aba de driver (nativa, modelo personalizado ou pacote) DEVE seguir o
// mesmo padrao visual das nativas. Este check roda estaticamente sobre o codigo
// e falha se uma aba fugir do padrao. Rode com:  node scripts/check-design-system-abas.mjs
//
// Padrao exigido por aba (extraido das nativas BASE_ZERO/BASE_HISTORICO):
//   - Card > CardHeader > CardTitle + subtitulo + renderConfirmControl
//   - HotTable com className 'ht-bz-table ht-bz-embedded', rowHeights 32,
//     fixedColumnsStart 1, stretchH 'all', linha Total 'ht-bz-totalizer',
//     meses realizados travados com 'ht-realized-lock'
//   - Fecha com <ComparisonChart .../> (grafico mensal padronizado:
//     Realizado anterior x Vigente (realizado + orcado), decomposto por CR em pacote)
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '../src/components/OrcamentoContent.tsx'), 'utf8');

// Fatia o arquivo pelas secoes marcadas com {/* ===== NOME ===== */}
// So marcadores de TOPO delimitam secoes — marcadores aninhados (ex.: "Impostos
// sobre Receita" dentro da RECEITA) nao cortam a secao pai.
const TOP_LEVEL = [
  'RESUMO', 'BASE_ZERO', 'BASE_HISTORICO',
  'RECEITA (apenas quando o driver RECEITA é realmente nativo)', 'PESSOAL',
  'MODELO DE PACOTE — linhas com granularidade por CR e rateio aplicado',
  'NORMAL DRIVERS (with formula support + custom lines + override)',
  'PACOTES (aba consolidada — lista todos os pacotes do CR)',
];
const marker = /\{\/\* =====\s*([^=]+?)\s*=====\s*\*\/\}/g;
const found = [];
let m;
while ((m = marker.exec(src)) !== null) {
  if (TOP_LEVEL.includes(m[1].trim())) found.push({ nome: m[1].trim(), idx: m.index });
}
const sections = found.map((f, i) => ({ nome: f.nome, corpo: src.slice(f.idx, found[i + 1]?.idx ?? src.length) }));

// Requisitos por aba. Abas com grid de lancamento mensal exigem o pacote completo.
const GRID_FULL = ['ComparisonChart', 'ht-bz-table ht-bz-embedded', 'rowHeights={32}', 'fixedColumnsStart={1}', "stretchH=\"all\"", 'ht-bz-totalizer', 'ht-realized-lock', 'renderConfirmControl', 'CardTitle'];
const REQUIREMENTS = {
  'BASE_ZERO': GRID_FULL,
  // BASE_HISTORICO tem premissas + grid por conta com coluna Total (sem linha Total)
  'BASE_HISTORICO': GRID_FULL.filter((r) => r !== 'ht-bz-totalizer'),
  // RECEITA nativa tem grid proprio (ticket x volume) mas exige o grafico e o padrao de card
  'RECEITA (apenas quando o driver RECEITA é realmente nativo)': ['ComparisonChart', 'renderConfirmControl', 'CardTitle', 'ht-realized-lock'],
  // PESSOAL e 100% calculado (sem lancamento manual) — exige so o padrao de card
  'PESSOAL': ['CardTitle'],
  // ABAS PERSONALIZADAS: mesmo padrao completo das nativas — este e o ponto critico
  'MODELO DE PACOTE — linhas com granularidade por CR e rateio aplicado': GRID_FULL,
  'NORMAL DRIVERS (with formula support + custom lines + override)': GRID_FULL,
};

let fails = 0;
for (const [nome, reqs] of Object.entries(REQUIREMENTS)) {
  const sec = sections.find((s) => s.nome === nome);
  if (!sec) { console.log(`FAIL  secao nao encontrada: ${nome}`); fails++; continue; }
  const faltando = reqs.filter((r) => !sec.corpo.includes(r));
  if (faltando.length === 0) console.log(`PASS  ${nome}`);
  else { console.log(`FAIL  ${nome} — faltam: ${faltando.join(', ')}`); fails++; }
}

// Guardas anti-regressao: nenhuma aba de grid pode criar grafico proprio fora do
// ComparisonChart (ComposedChart direto so dentro do proprio ComparisonChart e do RESUMO)
for (const s of sections) {
  if (!(s.nome in REQUIREMENTS) || s.nome === 'RESUMO') continue;
  // PESSOAL tem grafico proprio de headcount/folha (bloco padrao do modulo Pessoal)
  if (s.nome === 'PESSOAL') continue;
  if (/<ComposedChart|<ShadcnBarChart|<BarChart[^3]/.test(s.corpo)) {
    console.log(`FAIL  ${s.nome} — grafico fora do padrao (use ComparisonChart)`);
    fails++;
  }
}

console.log(fails === 0 ? '\nOK: todas as abas seguem o design system.' : `\n${fails} problema(s) de design system.`);
process.exit(fails === 0 ? 0 : 1);
