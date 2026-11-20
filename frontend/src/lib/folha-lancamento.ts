// Regra de conferencia do lancamento da folha no orcamento.
//
// O calculo da folha grava em duas etapas: a projecao por colaborador vai para
// ORCAMENTO_PESSOAL e, em seguida, um INSERT..SELECT (SF 61) agrega essa
// projecao em tres contas do ORCAMENTO — salario, encargos e beneficios.
//
// O destino de cada bloco sai do cruzamento CR_CONTA x driver PESSOAL. Quando a
// conta de um bloco nao esta vinculada naquele CR, o INSERT..SELECT nao acha
// destino e grava ZERO linhas — sem erro, sem aviso. O efeito e traicoeiro: a
// tela de Projecao Mensal continua correta (ela le ORCAMENTO_PESSOAL, que foi
// gravado), mas o orcamento e o DRE simplesmente nao enxergam aquele valor.
//
// A conferencia antiga olhava so o total lancado (`total === 0`), entao uma
// falha PARCIAL passava batido: bastava um dos tres blocos encontrar destino
// para o total ficar > 0 e a tela declarar sucesso. Foi assim que um setor
// ficou com os encargos lancados e salario + beneficios descartados em
// silencio. Por isso a conferencia aqui e bloco a bloco.

/**
 * A folha é a dona do grupo de contas de pessoal (5.1) de um CR: o valor que
 * chega ao orçamento e ao DRE sai do cálculo, não da mão do gestor. Confirmar o
 * driver PESSOAL sem ter calculado deixa o CR seguir para submissão/aprovação
 * com despesa de pessoal sem lastro na projeção — foi assim que dois setores
 * chegaram a APROVADO/SUBMETIDO carregando saldo que nenhuma folha gerou.
 *
 * O aviso não bloqueia: há casos legítimos (CR sem quadro próprio, por
 * exemplo). Ele só obriga o gestor a decidir conscientemente.
 */
export function precisaAvisarFolhaNaoCalculada(
  driver: string,
  projecaoPessoal: unknown[] | null | undefined,
): boolean {
  return driver === 'PESSOAL' && (projecaoPessoal?.length ?? 0) === 0;
}

export const AVISO_CONFIRMAR_SEM_FOLHA =
  'Você não calculou a folha deste centro de resultado. Sem o cálculo, a despesa de pessoal entra no orçamento e no DRE sem lastro na projeção. Tem certeza que deseja prosseguir?';

export const BLOCOS_FOLHA = [
  { campo: 'SALARIO', codigo: '5.1.01.01', rotulo: 'Salários' },
  { campo: 'ENCARGOS', codigo: '5.1.02', rotulo: 'Encargos' },
  { campo: 'BENEFICIOS', codigo: '5.1.03', rotulo: 'Benefícios' },
];

/**
 * Blocos da folha que têm valor projetado mas não têm conta de destino
 * vinculada ao driver PESSOAL neste CR — ou seja, que serão descartados
 * silenciosamente pela gravação no orçamento.
 *
 * Um bloco sem valor projetado nunca é apontado: não ter destino para um valor
 * que não existe não é problema.
 */
export function blocosFolhaNaoLancados(
  records: any[],
  codigosVinculados: Iterable<string>,
): { campo: string; codigo: string; rotulo: string }[] {
  const vinculados = new Set(Array.from(codigosVinculados, (c) => String(c ?? '')));
  return BLOCOS_FOLHA.filter((bloco) => {
    const projetado = (records || []).reduce(
      (soma: number, r: any) => soma + (Number(r?.[bloco.campo]) || 0),
      0,
    );
    return projetado > 0 && !vinculados.has(bloco.codigo);
  });
}

/**
 * Mensagem de erro para o usuário, ou string vazia quando está tudo lançado.
 * Nomeia a conta faltante — é o dado que o administrador precisa para corrigir
 * o vínculo.
 */
export function avisoFolhaNaoLancada(
  records: any[],
  codigosVinculados: Iterable<string>,
): string {
  const perdidos = blocosFolhaNaoLancados(records, codigosVinculados);
  if (!perdidos.length) return '';
  const lista = perdidos.map((b) => `${b.rotulo} (conta ${b.codigo})`).join(' e ');
  return `Folha calculada, mas ${lista} não foi lançado no orçamento: a conta não está vinculada ao driver PESSOAL neste setor. O valor aparece na Projeção Mensal mas NÃO entra no orçamento nem no DRE — acione o administrador.`;
}
