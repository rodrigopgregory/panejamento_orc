// Persiste a instrucao permanente do projeto: design system obrigatorio para
// abas de preenchimento (pacote/modelo personalizado) + guarda automatica.
import 'dotenv/config';
import { configureSdkMitra, getProjectContextMitra, updateAdditionalInstructionsMitra } from 'mitra-sdk';
configureSdkMitra({ baseURL: process.env.MITRA_BASE_URL, token: process.env.MITRA_TOKEN, integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS });
const projectId = parseInt(process.env.MITRA_PROJECT_ID);

const ctx = await getProjectContextMitra({ projectId });
const atual = String(ctx?.result?.additionalInstructions || ctx?.result?.instructions || '');
const MARCA = '## DESIGN SYSTEM OBRIGATORIO — abas de preenchimento';
if (atual.includes(MARCA)) { console.log('Instrucao ja existe — atualizando bloco'); }

const bloco = `
${MARCA} (pacote ou modelo personalizado)
Sempre que criar ou alterar uma aba de driver no preenchimento (OrcamentoContent) — nativa, modelo personalizado ou pacote — ela DEVE ser fiel ao padrao das abas nativas (BASE_ZERO/BASE_HISTORICO). Isso ja falhou 3x; e INEGOCIAVEL:
- Estrutura: Card > CardHeader (CardTitle + subtitulo fontSize 14px cor var(--color-text-secondary) + renderConfirmControl(aba, label)) > CardContent com o grid; e FORA do Card, fechar a aba com <ComparisonChart .../> — o grafico de barras mensal padronizado (Realizado anterior x Vigente = realizado + orcado; em pacote, passar pkgCrs/pkgBudgetRows/pkgRealAtualRows para habilitar o toggle Total/Por CR). NUNCA criar grafico proprio (ComposedChart/BarChart direto) nem tabela HTML custom para lancamento mensal.
- Handsontable: data com linha 'Total' ao final; colunas Conta + 12 meses + Total (colHeaders14/cols14Num, numericFormat '0,0' culture pt-BR); rowHeaders=false, wordWrap=false, manualRowResize=false, rowHeights=32, fixedColumnsStart=1, height=Math.min(linhas*32+50, 550), stretchH='all', className 'ht-bz-table ht-bz-embedded'.
- Classes de celula padronizadas: 'ht-bz-account' (coluna de conta), 'ht-bz-total' (coluna Total), 'ht-bz-totalizer' (linha Total), 'ht-bz-editable' (meses editaveis), 'ht-realized-lock' (meses realizados travados via isColLocked e modo readOnly), 'ht-formula-account' (linhas calculadas por formula), 'ht-custom-input' (inputs de linhas personalizadas).
- Formulas exibidas como chips (icone Calculator, borda var(--color-border)); avisos em banner ambar padrao (#fffbeb / #fcd34d / texto #92400e com icone AlertCircle).
- VALIDACAO OBRIGATORIA (2 testes, ambos precisam passar antes de finalizar): (1) node frontend/scripts/check-design-system-abas.mjs — guarda estatica de paridade; ao criar nova secao de aba, adicionar o marcador {/* ===== NOME ===== */} no JSX e registrar em TOP_LEVEL + REQUIREMENTS com GRID_FULL. (2) cd frontend && npm test — teste de RENDERIZACAO (vitest/jsdom) que monta o OrcamentoContent em modo pacote com fixtures reais e verifica o que o usuario ve: aba do pacote presente, sem aba legada 'Pacotes', grid ht-bz e grafico Comparativo. O check estatico sozinho NAO basta — ja deixou passar um bug em que a aba certa existia no codigo mas nao era a renderizada.
`.trim();

let novo;
if (atual.includes(MARCA)) {
  // substitui o bloco antigo (do marcador ate o proximo ## ou fim)
  const re = new RegExp(MARCA.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[\\s\\S]*?(?=\\n## |$)');
  novo = atual.replace(re, bloco);
} else {
  novo = (atual ? atual.trimEnd() + '\n\n' : '') + bloco;
}
await updateAdditionalInstructionsMitra({ projectId, instructions: novo });
console.log('Instrucoes do projeto atualizadas. Tamanho:', novo.length);
