// ──────────────────────────────────────────────────────────────────────
// Espacamento das barras do grafico "Evolucao mensal" (Resultado Contabil).
//
// Usar barSize e proposital, NAO maxBarSize. Com maxBarSize o Recharts calcula
// o passo entre as barras com a largura ORIGINAL da fatia e depois desenha a
// barra ja limitada, centralizada nessa fatia (ChartUtils.getBarPosition):
//
//   offset = _offset + (originalSize + barGap) * i + (originalSize - size) / 2
//
// Ou seja, o vao entre receita e despesa vira barGap + (originalSize - limite),
// que cresce quanto mais larga a tela e quanto menos meses houver. Num ano com
// poucos meses realizados isso separava as duas barras em dezenas de pixels.
//
// Com barSize o Recharts usa o outro ramo do calculo: soma as barras, aplica
// barGap entre elas e centraliza o conjunto na faixa do mes. O vao passa a ser
// exatamente barGap, independente da largura ou da quantidade de meses. Se a
// faixa ficar estreita demais, o proprio Recharts zera o gap e encolhe as
// barras para caberem.
//
// Fica neste arquivo, e nao dentro do componente, para o teste rodar a
// matematica real do Recharts sobre exatamente os valores que a tela usa.
// ──────────────────────────────────────────────────────────────────────
export const BARRAS_EVOLUCAO_MENSAL = {
  barSize: 38,
  barGap: 2,
  barCategoryGap: '22%',
} as const;
