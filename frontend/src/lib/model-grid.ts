// ──────────────────────────────────────────────────────────────────────
// Grade de modelo orcamentario: 14 colunas (Conta | Jan..Dez | Total), com
// Realizado bloqueado e Orcado editavel.
//
// Este modulo e a FONTE do padrao — a aba Receita e a primeira a usar, e as
// demais telas de lancamento devem consumir daqui em vez de recriar. Por isso
// tudo o que da para decidir sem o Handsontable mora aqui: cabecalho de
// periodos, classes de celula, alturas e o renderer da primeira coluna.
//
// Cada regra abaixo com nota "CRITICO" corrige um defeito concreto — nao sao
// preferencias de estilo.
// ──────────────────────────────────────────────────────────────────────

export type ModelRowKind = 'premise' | 'formula' | 'account' | 'total';

export type ModelRowMeta = {
  kind: ModelRowKind;
  label: string;
  /** Formula legivel. Vai para o title (hover), nunca para uma segunda linha. */
  formulaLabel?: string;
  isOverride?: boolean;
  /**
   * Linha que a tela trava por regra propria, mesmo no Orcado — por exemplo a
   * conta de pacote cujo rateio ainda nao foi configurado. Fica com a cara de
   * bloqueada em vez de convidar a digitar num campo que nao grava.
   */
  bloqueada?: boolean;
  /**
   * Coluna "Formato" da grade de calculos do modelo (DRIVER_FORMULA.FORMATO):
   * SEM_PREFIXO | MONETARIO | UNIDADES | PERCENTUAL | TEXTO. Decide so a
   * APRESENTACAO do numero na celula — o valor gravado, a soma e o recalculo das
   * formulas continuam iguais.
   *
   * Fica como `string` de proposito, e nao como uniao fechada: o valor vem do
   * banco e quem monta o rowMeta repassa cru. Formato desconhecido cai no
   * default, entao um enum novo no banco nunca quebra a tela.
   */
  formato?: string;
};

/** CRITICO: numero constante. Como funcao, a coluna congelada
 *  (fixedColumnsStart) dessincroniza da tabela mestre. */
export const MODEL_ROW_H = 36;

export const MODEL_GRID_CLASS = 'ht-bz-table ht-bz-embedded ht-model-grid';

export const LARGURAS_MODELO = { rotulo: 260, mes: 96, total: 108 };

const SVG_ESTILO_INLINE = 'display:inline-block;vertical-align:middle';

// CRITICO: os SVGs carregam display/vertical-align no atributo style. O
// preflight do Tailwind aplica `svg { display: block }`, e a coluna congelada e
// desenhada num clone sobreposto — se uma regra de CSS nossa nao vencer ali, o
// icone cai de linha. Com o style inline funciona ate se todo o CSS falhar.
export const LOCK_SVG = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="${SVG_ESTILO_INLINE};vertical-align:-1px;margin-right:5px"><rect x="3" y="11" width="18" height="11" rx="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`;

export const PENCIL_SVG = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="${SVG_ESTILO_INLINE}"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>`;

/** Teto da grade. Acima disso ela rola por dentro em vez de crescer na pagina. */
export const ALTURA_MAX_GRADE_MODELO = 620;

/**
 * Altura estimada, usada como ponto de partida ate a medicao real chegar (e como
 * valor final nas grades que ainda nao usam useAlturaGradeModelo).
 *
 * O 76 e uma aposta sobre a altura dos dois cabecalhos e NAO reserva a barra de
 * rolagem horizontal — as colunas somam 1520px, entao ela quase sempre aparece e
 * come o rodape, cortando a ultima linha (a do Total). Quem precisa da altura
 * certa deve medir o DOM: ver hooks/useAlturaGradeModelo.
 */
export function alturaGradeModelo(nLinhas: number): number {
  return Math.min(nLinhas * MODEL_ROW_H + 76, ALTURA_MAX_GRADE_MODELO);
}

/**
 * Celula editada cuja gravacao ainda nao voltou do backend.
 * `local` e o que o usuario digitou; `base` e o que havia ali antes.
 */
export type PendenciaCelula = { local: any; base: any };

/**
 * Decide o que fazer quando um valor recalculado pelo estado do React chega numa
 * grade que o Handsontable ja esta desenhando.
 *
 * CRITICO: gravar celula e assincrono. Entre a tecla e a resposta do backend, um
 * save de OUTRA celula re-renderiza o pai, e o valor que vem no render ainda e o
 * de ANTES da edicao. Escrever isso de volta apagaria o numero debaixo do dedo de
 * quem digitou — e num arrasto de 12 meses isso acontece 12 vezes.
 *
 * A pendencia so termina quando o valor externo deixa de ser o `base`: pode ser a
 * confirmacao (igual ao `local`) ou um numero diferente, quando o backend
 * arredonda ou rateia. Nos dois casos quem manda passa a ser o backend.
 */
export function decidirAtualizacaoExterna(
  valorNaGrade: any,
  valorExterno: any,
  pendencia?: PendenciaCelula,
): { escrever: boolean; encerrarPendencia: boolean } {
  if (pendencia) {
    if (Object.is(valorExterno, pendencia.base)) return { escrever: false, encerrarPendencia: false };
    if (Object.is(valorExterno, pendencia.local)) return { escrever: false, encerrarPendencia: true };
    return { escrever: !Object.is(valorNaGrade, valorExterno), encerrarPendencia: true };
  }
  return { escrever: !Object.is(valorNaGrade, valorExterno), encerrarPendencia: false };
}

/** Cultura do numbro. Milhar com ponto, decimal com virgula. */
const CULTURA_MODELO = 'pt-BR';

/** Formato numerico de sempre: e o default e o fallback de FORMATO desconhecido. */
const PATTERN_PADRAO = '0,0';

/**
 * numericFormat de UMA celula, decidido pelo FORMATO da LINHA.
 *
 * CRITICO — por que por celula e nao por coluna: o Formato e escolhido linha a
 * linha na grade de calculos do modelo, e uma coluna do Handsontable so tem um
 * formato. Enquanto o pattern morou apenas em `columns`, o prefixo escolhido no
 * mapeamento simplesmente nao aparecia na visao de preenchimento. O `cells` ja e
 * consultado celula a celula — e ali que o pattern tem de ser decidido.
 *
 * O prefixo/sufixo vai como OPCAO do numbro (prefix/postfix) e nao como texto
 * dentro do pattern, por dois motivos concretos: com '%' no pattern o numbro
 * MULTIPLICA o valor por 100 (15 viraria "1.500 %"), e com 'R$ ' no pattern o
 * sinal de negativo escapa para fora do simbolo ("- R$1.234"). Como opcao, o
 * numero e apenas decorado.
 *
 * UNIDADES, TEXTO, SEM_PREFIXO, ausente ou desconhecido caem no pattern padrao.
 * TEXTO segue NUMERICO de proposito: trocar o `type` da celula para 'text'
 * tiraria o editor numerico e faria a coluna de Total e a linha de Total somarem
 * string. O Formato foi pedido como prefixo de apresentacao, nao como troca de
 * tipo de dado.
 */
export function numericFormatDaLinha(meta?: ModelRowMeta): { pattern: string | Record<string, unknown>; culture: string } {
  if (meta?.formato === 'MONETARIO') return { pattern: { thousandSeparated: true, prefix: 'R$ ' }, culture: CULTURA_MODELO };
  if (meta?.formato === 'PERCENTUAL') return { pattern: { thousandSeparated: true, postfix: ' %' }, culture: CULTURA_MODELO };
  return { pattern: PATTERN_PADRAO, culture: CULTURA_MODELO };
}

export function colunasModelo14() {
  const numero = { type: 'numeric' as const, numericFormat: { pattern: PATTERN_PADRAO, culture: CULTURA_MODELO } };
  return [
    { data: 0, readOnly: true, width: LARGURAS_MODELO.rotulo },
    ...Array.from({ length: 12 }, (_, i) => ({ data: i + 1, ...numero, width: LARGURAS_MODELO.mes })),
    { data: 13, readOnly: true, ...numero, width: LARGURAS_MODELO.total },
  ];
}

export type FaixaPeriodo = { travada: boolean; inicio: number; fim: number };

/**
 * Agrupa as 12 colunas de mes em faixas contiguas de mesmo estado.
 *
 * O detalhamento do padrao assume um corte unico ("primeiros N meses
 * realizados"), que e o caso hoje — a ordem dos meses e Jan..Dez. Derivar por
 * faixas custa o mesmo e continua correto se o ano fiscal voltar a comecar fora
 * de janeiro: ai o realizado deixa de ser um prefixo e vira duas pontas.
 */
export function faixasDePeriodo(colunaTravada: (col: number) => boolean): FaixaPeriodo[] {
  const faixas: FaixaPeriodo[] = [];
  for (let col = 1; col <= 12; col++) {
    const travada = colunaTravada(col);
    const ultima = faixas[faixas.length - 1];
    if (ultima && ultima.travada === travada) ultima.fim = col;
    else faixas.push({ travada, inicio: col, fim: col });
  }
  return faixas;
}

/** Colunas que abrem uma faixa de Orcado e por isso recebem o divisor de 1px.
 *  A coluna 1 fica de fora: ali a linha encostaria na coluna congelada e
 *  pareceria borda da tabela, nao divisor de periodo. */
export function colunasComDivisor(colunaTravada: (col: number) => boolean): Set<number> {
  const cols = new Set<number>();
  for (const faixa of faixasDePeriodo(colunaTravada)) {
    if (!faixa.travada && faixa.inicio > 1) cols.add(faixa.inicio);
  }
  return cols;
}

export const ROTULO_ORCADO_EDITAVEL = 'Orçado · Editável';

/**
 * Rotulo da faixa de Orcado conforme o STATUS do orcamento.
 *
 * O cabecalho dizia sempre "Editável", inclusive depois de submetido — momento
 * em que as celulas ja estao bloqueadas (ver isLockedStatus no OrcamentoContent).
 * Aqui so muda o TEXTO: quem trava a edicao continua sendo o readOnly/colunaTravada.
 *
 * REPROVADO (devolvido para ajustes) volta a ser editavel, entao cai no padrao
 * junto com PENDENTE/CONFIRMADO.
 */
export function rotuloOrcadoPorStatus(status?: string | null): string {
  if (status === 'SUBMETIDO') return 'Orçado · Submetido';
  if (status === 'APROVADO') return 'Orçado · Aprovado';
  return ROTULO_ORCADO_EDITAVEL;
}

/** Cabecalho de 2 niveis: faixa de periodo em cima, meses embaixo. O cadeado
 *  aparece SO aqui — nunca repetido celula a celula. */
export function nestedHeadersModelo(
  colHeaders14: string[],
  colunaTravada: (col: number) => boolean,
  rotuloOrcado: string = ROTULO_ORCADO_EDITAVEL,
) {
  const topo: { label: string; colspan: number }[] = [{ label: '', colspan: 1 }];
  for (const faixa of faixasDePeriodo(colunaTravada)) {
    topo.push({
      label: faixa.travada ? `${LOCK_SVG}Realizado · Bloqueado` : rotuloOrcado,
      colspan: faixa.fim - faixa.inicio + 1,
    });
  }
  topo.push({ label: '', colspan: 1 });
  return [topo, colHeaders14];
}

/**
 * Renderer da primeira coluna: icone + nome numa unica caixa de linha.
 *
 * CRITICO — idempotencia: o Handsontable chama o renderer a cada scroll,
 * selecao e passo do arrasto de preenchimento. Sem a assinatura, o DOM da
 * celula e reconstruido toda vez e a celula pisca.
 */
export function criarRendererRotuloModelo(metaDaLinha: (row: number) => ModelRowMeta | undefined) {
  return (_instancia: any, td: HTMLElement, row: number) => {
    const meta = metaDaLinha(row);
    if (!meta) { td.innerHTML = ''; return; }

    // Separador que nao aparece em rotulo, escrito como escape para nao deixar
    // byte NUL no arquivo. Sem separador (ou com espaco) combinacoes diferentes
    // colidem: rotulo 'A' + formula 'B C' da a mesma assinatura que rotulo
    // 'A B' + formula 'C', e a celula fica mostrando o texto velho.
    const assinatura = [meta.kind, meta.isOverride ? '1' : '0', meta.label, meta.formulaLabel || ''].join('\u0000');
    if ((td as any).__modelSig === assinatura) return;
    (td as any).__modelSig = assinatura;

    td.innerHTML = '';
    // CRITICO: o icone e conteudo inline DENTRO do span do nome, e nao irmao
    // dele num flex. Assim divide a mesma caixa de linha do texto por
    // construcao, sem depender de CSS que pode nao vencer no clone da coluna
    // congelada.
    const nome = document.createElement('span');
    nome.className = 'model-label-name';
    if (meta.kind === 'premise' || meta.kind === 'formula') {
      const icone = document.createElement('span');
      icone.className = `model-ico model-ico-${meta.kind}`;
      // O respiro entre icone e palavra vai no PROPRIO elemento, e nao so na
      // folha de estilo: a coluna congelada e desenhada num clone sobreposto, e
      // basta uma regra nossa nao vencer ali para o texto encostar no icone.
      // Mesmo motivo pelo qual os SVGs carregam display no atributo style.
      icone.style.marginRight = '8px';
      if (meta.kind === 'premise') icone.innerHTML = PENCIL_SVG;
      else icone.textContent = 'ƒ';
      nome.appendChild(icone);
      // Espaco de texto alem da margem: some com a margem, sobra o espaco.
      nome.appendChild(document.createTextNode(' '));
    }
    nome.appendChild(document.createTextNode(meta.label));
    td.appendChild(nome);
    td.setAttribute('title', meta.label + (meta.formulaLabel ? `  =  ${meta.formulaLabel}` : ''));
  };
}

export function criarAfterGetColHeaderModelo(colunaTravada: (col: number) => boolean) {
  const divisores = colunasComDivisor(colunaTravada);
  return (col: number, TH: HTMLElement) => {
    if (!TH || !TH.classList) return;
    TH.classList.remove('period-actual-h', 'period-budget-h', 'period-budget-start');
    if (col < 1 || col > 12) return;
    TH.classList.add(colunaTravada(col) ? 'period-actual-h' : 'period-budget-h');
    if (divisores.has(col)) TH.classList.add('period-budget-start');
  };
}

// ──────────────────────────────────────────────────────────────────────
// Layout Real+Orcado (27 colunas): rotulo | (Real, Orcado) x 12 | Total Real,
// Total Orcado.
//
// E o "Detalhe Mensal" da base historica, onde o Real e o do ANO ANTERIOR — a
// referencia contra a qual se orca. Nao confundir com os meses fechados do ano
// corrente, que no layout de meses aparecem na faixa "Realizado · Bloqueado".
//
// A conta de coluna mora aqui, e nao no componente, porque errar por um faz a
// grade inteira escorregar de casa sem dar erro nenhum — de fora, so parece que
// os numeros estao no mes errado.
// ──────────────────────────────────────────────────────────────────────

export const COL_TOTAL_REAL = 25;
export const COL_TOTAL_ORCADO = 26;

export const LARGURAS_MODELO_REAL = { rotulo: 260, celula: 84, total: 92 };

/** Posicao do mes (1..12) de uma coluna de dado; 0 nas colunas de rotulo/total. */
export function posDoMesRealOrcado(col: number): number {
  if (col < 1 || col > 24) return 0;
  return Math.ceil(col / 2);
}

/** Colunas impares (1, 3, ... 23) sao Real; as pares (2, 4, ... 24) sao Orcado. */
export function ehColunaRealizado(col: number): boolean {
  return col >= 1 && col <= 24 && col % 2 === 1;
}

export function colunasModeloRealOrcado() {
  const numero = { type: 'numeric' as const, numericFormat: { pattern: PATTERN_PADRAO, culture: CULTURA_MODELO } };
  return [
    { data: 0, readOnly: true, width: LARGURAS_MODELO_REAL.rotulo },
    ...Array.from({ length: 24 }, (_, i) => ({ data: i + 1, ...numero, width: LARGURAS_MODELO_REAL.celula })),
    { data: COL_TOTAL_REAL, readOnly: true, ...numero, width: LARGURAS_MODELO_REAL.total },
    { data: COL_TOTAL_ORCADO, readOnly: true, ...numero, width: LARGURAS_MODELO_REAL.total },
  ];
}

/** Cabecalho de 2 niveis: mes em cima (sobre o par), Real/Orcado embaixo. */
export function nestedHeadersModeloRealOrcado(mesesCurtos: string[]) {
  return [
    [{ label: '', colspan: 1 }, ...mesesCurtos.map(m => ({ label: m, colspan: 2 })), { label: 'Total', colspan: 2 }],
    ['Conta', ...mesesCurtos.flatMap(() => ['Real', 'Orçado']), 'Real', 'Orçado'],
  ];
}

/** Divisor de 1px abrindo cada mes (menos o primeiro) e o bloco de totais —
 *  sem ele os 24 numeros viram uma faixa unica e some a nocao de par. */
export function colunasComDivisorRealOrcado(): Set<number> {
  const cols = new Set<number>([COL_TOTAL_REAL]);
  for (let mes = 2; mes <= 12; mes++) cols.add(mes * 2 - 1);
  return cols;
}

export function criarAfterGetColHeaderModeloRealOrcado(colunaTravada: (col: number) => boolean) {
  const divisores = colunasComDivisorRealOrcado();
  return (col: number, TH: HTMLElement) => {
    if (!TH || !TH.classList) return;
    TH.classList.remove('period-actual-h', 'period-budget-h', 'period-budget-start');
    const pos = posDoMesRealOrcado(col);
    if (pos === 0) return;
    // O cabecalho do mes segue o estado do mes no ano corrente: mes fechado nao
    // se orca, e o par inteiro se veste de Realizado.
    TH.classList.add(colunaTravada(pos) || ehColunaRealizado(col) ? 'period-actual-h' : 'period-budget-h');
    if (divisores.has(col)) TH.classList.add('period-budget-start');
  };
}

export function criarCellsModeloRealOrcado(opcoes: {
  metaDaLinha: (row: number) => ModelRowMeta | undefined;
  totalRowIdx: number;
  colunaTravada: (col: number) => boolean;
  somenteLeitura?: boolean;
  rendererRotulo?: any;
}) {
  const divisores = colunasComDivisorRealOrcado();
  return (row: number, col: number): CelulaModelo => {
    const meta = opcoes.metaDaLinha(row);
    const pos = posDoMesRealOrcado(col);
    const ehReal = ehColunaRealizado(col);
    // Coluna de Real e sempre "periodo realizado", venha do ano anterior ou nao.
    const periodo = pos === 0 ? '' :
      (ehReal || opcoes.colunaTravada(pos) ? 'period-actual' : 'period-budget') +
      (divisores.has(col) ? ' period-budget-start' : '');
    const classes = (extra: string) => [meta ? `row-${meta.kind}` : '', periodo, extra].filter(Boolean).join(' ');
    const numericFormat = numericFormatDaLinha(meta);

    if (row === opcoes.totalRowIdx) return { className: classes('row-total'), readOnly: true, numericFormat };
    if (col === 0) return { className: classes('model-label-cell'), readOnly: true, renderer: opcoes.rendererRotulo, numericFormat };
    if (col === COL_TOTAL_REAL || col === COL_TOTAL_ORCADO) return { className: classes('cell-calculated'), readOnly: true, numericFormat };
    // Real e historico: nunca se digita por cima do que ja aconteceu.
    if (ehReal) return { className: classes('cell-locked'), readOnly: true, numericFormat };
    if (meta?.kind === 'formula') return { className: classes('cell-calculated'), readOnly: true, numericFormat };
    if (opcoes.somenteLeitura || meta?.bloqueada || opcoes.colunaTravada(pos)) {
      return { className: classes('cell-locked'), readOnly: true, numericFormat };
    }
    return { className: classes('cell-editable'), numericFormat };
  };
}

export type CelulaModelo = {
  className: string;
  readOnly?: boolean;
  renderer?: any;
  /**
   * Vai em TODA celula, inclusive quando e o formato padrao. O Handsontable
   * guarda o cellMeta da celula e o resultado do `cells` e mesclado nele: se o
   * default omitisse a chave, a celula que uma vez recebeu prefixo ficaria com
   * ele para sempre depois de o Formato voltar para "Sem prefixo".
   */
  numericFormat?: { pattern: string | Record<string, unknown>; culture: string };
};

/**
 * Classes e travas de cada celula. A classificacao sai do METADADO da linha,
 * nunca do indice — linha some, entra e troca de ordem conforme o modelo.
 */
export function criarCellsModelo(opcoes: {
  metaDaLinha: (row: number) => ModelRowMeta | undefined;
  totalRowIdx: number;
  colunaTravada: (col: number) => boolean;
  /** Tela inteira em leitura (link publico, ciclo fechado): nada fica editavel. */
  somenteLeitura?: boolean;
  rendererRotulo?: any;
}) {
  const divisores = colunasComDivisor(opcoes.colunaTravada);
  return (row: number, col: number): CelulaModelo => {
    const meta = opcoes.metaDaLinha(row);
    const ehMes = col >= 1 && col <= 12;
    const periodo = ehMes
      ? (opcoes.colunaTravada(col) ? 'period-actual' : 'period-budget') +
        (divisores.has(col) ? ' period-budget-start' : '')
      : '';
    const classes = (extra: string) => [meta ? `row-${meta.kind}` : '', periodo, extra].filter(Boolean).join(' ');
    const numericFormat = numericFormatDaLinha(meta);

    if (row === opcoes.totalRowIdx) return { className: classes('row-total'), readOnly: true, numericFormat };
    if (col === 0) return { className: classes('model-label-cell'), readOnly: true, renderer: opcoes.rendererRotulo, numericFormat };
    // Linha de formula e calculada: travada tambem no Orcado.
    if (meta?.kind === 'formula') return { className: classes('cell-calculated'), readOnly: true, numericFormat };
    if (col === 13) return { className: classes('cell-calculated'), readOnly: true, numericFormat };
    if (ehMes && (opcoes.somenteLeitura || meta?.bloqueada)) {
      return { className: classes('cell-locked'), readOnly: true, numericFormat };
    }
    // Premissa (ticket, volume) e insumo do modelo, nao lancamento contabil: o
    // mes fechado nao a trava. Travar junto com o Realizado tiraria a chance de
    // refazer a conta de um mes ja fechado, que e uso normal de premissa.
    if (ehMes && meta?.kind === 'premise') return { className: classes('cell-editable'), numericFormat };
    if (ehMes && opcoes.colunaTravada(col)) return { className: classes('cell-locked'), readOnly: true, numericFormat };
    if (ehMes) return { className: classes('cell-editable'), numericFormat };
    return { className: classes('cell-locked'), readOnly: true, numericFormat };
  };
}
