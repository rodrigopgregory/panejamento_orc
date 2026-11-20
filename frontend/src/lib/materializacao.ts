// Regras da materializacao de contas calculadas.
//
// "Materializar" e gravar em ORCAMENTO o resultado de uma conta que o modelo
// calcula por formula. Isso existe porque o DRE le ORCAMENTO por SQL puro e nao
// sabe o que e formula: sem gravar, o gestor ve um numero na tela e o DRE soma
// outro.
//
// O momento e o CONFIRMAR do modelo — a mesma regra que ja vale para a folha:
// o valor conta no DRE quando o modelo esta calculado e confirmado. Aqui ficam
// so as decisoes puras (quais meses, gravar ou nao), separadas da tela para
// poderem ser testadas.

/**
 * Meses que a materializacao pode escrever.
 *
 * Mes fechado nao entra: o valor dele vem de REALIZADO_CONTABIL, e sobrescrever
 * com projecao apagaria o que de fato aconteceu.
 */
export function mesesMaterializaveis(ultimoMesRealizado: number): number[] {
  const fechadoAte = Number.isFinite(ultimoMesRealizado) && ultimoMesRealizado > 0
    ? Math.min(12, Math.floor(ultimoMesRealizado))
    : 0;
  const meses: number[] = [];
  for (let m = fechadoAte + 1; m <= 12; m++) meses.push(m);
  return meses;
}

export type DecisaoGravacao =
  | { gravar: true; valor: number }
  | { gravar: false; motivo: 'nao_finito' | 'sem_mudanca' };

/**
 * Decide se o valor calculado deve ir para o banco.
 *
 * Dois casos de recusa:
 *  - `nao_finito`: divisao por zero devolve Infinity (o guarda "|| 0" do
 *    avaliador so intercepta NaN). Gravar Infinity poe lixo no DRE — melhor
 *    manter o valor anterior e avisar quem confirmou.
 *  - `sem_mudanca`: o banco ja tem exatamente esse numero. Poupa uma rajada de
 *    escritas inuteis a cada confirmacao.
 */
export function decidirGravacao(calculado: number, valorAtual: number): DecisaoGravacao {
  if (!Number.isFinite(calculado)) return { gravar: false, motivo: 'nao_finito' };
  const valor = Math.round(calculado);
  if (valor === Math.round(valorAtual)) return { gravar: false, motivo: 'sem_mudanca' };
  return { gravar: true, valor };
}

/**
 * Aviso mostrado quando alguma conta nao pode ser calculada em algum mes.
 * Nao bloqueia a confirmacao: o valor anterior fica de pe e o gestor decide.
 */
export function avisoContasNaoCalculadas(codigos: string[]): string {
  const lista = codigos.join(', ');
  return `Nao foi possivel calcular ${lista} em algum mes (divisao por zero). O valor anterior foi mantido.`;
}
