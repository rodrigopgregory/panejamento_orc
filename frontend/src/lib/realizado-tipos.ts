// ──────────────────────────────────────────────────────────────────────
// Classificacao dos tipos de conta do realizado contabil.
// Fonte unica de verdade: os KPIs e os graficos da tela Resultado Contabil
// consomem estas duas funcoes. Se a regra divergir entre eles, os cards e o
// dashboard passam a contar coisas diferentes para o mesmo filtro.
//
// RESULTADO_FINANCEIRO fica de fora dos dois lados — nao entra em receita
// nem em despesa, e portanto nao afeta o resultado apresentado.
// ──────────────────────────────────────────────────────────────────────
export function isReceitaTipo(tipo: string | null | undefined): boolean {
  return tipo === 'RECEITA';
}

export function isDespesaTipo(tipo: string | null | undefined): boolean {
  return tipo !== 'RECEITA' && tipo !== 'RESULTADO_FINANCEIRO';
}
