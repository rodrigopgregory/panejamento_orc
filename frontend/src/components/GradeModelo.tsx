/* eslint-disable react-hooks/refs -- ver "Por que refs no render", no fim do bloco abaixo. */
import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { HotTable } from '@handsontable/react-wrapper';
import {
  MODEL_ROW_H, MODEL_GRID_CLASS, colunasModelo14, nestedHeadersModelo, ROTULO_ORCADO_EDITAVEL,
  criarAfterGetColHeaderModelo, criarCellsModelo, criarRendererRotuloModelo,
  colunasModeloRealOrcado, nestedHeadersModeloRealOrcado,
  criarAfterGetColHeaderModeloRealOrcado, criarCellsModeloRealOrcado,
  decidirAtualizacaoExterna,
} from '../lib/model-grid';
import { useModelGridScroll } from '../hooks/useModelGridScroll';
import { useAlturaGradeModelo } from '../hooks/useAlturaGradeModelo';

// ──────────────────────────────────────────────────────────────────────
// Grade de modelo que NAO pisca a cada celula preenchida.
//
// Sintoma: preencher uma celula fazia a tabela inteira piscar; num arrasto de 12
// meses, 12 vezes seguidas.
//
// Causa: o array de dados era remontado no corpo do render do pai. O wrapper
// React do Handsontable manda TODAS as props para updateSettings a cada render,
// e `data` presente ali cai em replaceData(): destroi o dataMap, cria outro,
// reinicia os index mappers, redimensiona e repinta a tabela toda. Como salvar
// uma celula chama setBudgetData, todo save disparava esse ciclo.
// (O useModelGridScroll ja tratava outro sintoma da mesma causa: o salto do
// scroll horizontal. Aqui a causa some, mas ele fica — cobre o reload legitimo.)
//
// Correcao: o Handsontable vira dono do array. O array entregue a ele tem
// identidade estavel e so e trocado quando a ESTRUTURA muda (linhas, rotulos,
// meses travados, leitura). Enquanto a estrutura e a mesma, valor que chega de
// fora e escrito in-place e a tela e atualizada com render(), que repinta apenas
// o que esta visivel sem tocar em dataMap nem em index mapper.
//
// Para o render() do pai nao chegar ao HotTable, a grade em si e memoizada e
// so re-renderiza quando estrutura ou altura mudam. Por isso TODA funcao passada
// a ela precisa ser estavel e ler o valor corrente de um ref — se fosse recriada
// a cada render do pai, ou a memoizacao cairia, ou a funcao congelaria valores
// velhos.
//
// Por que refs no render (react-hooks/refs desligado neste arquivo): a regra
// pediria atualizar esses refs num efeito. Nao serve. Efeito de filho roda ANTES
// de efeito de pai, e o updateSettings do HotTable acontece num efeito do filho —
// os refs ainda teriam o valor do render anterior quando `cells` e o renderer
// fossem remontados, e a grade apareceria com os rotulos e as travas velhos.
// Atribuir no corpo do render e o que garante o valor certo no mesmo commit.
// ──────────────────────────────────────────────────────────────────────

// Tipos declarados aqui de proposito: o tsconfig usa verbatimModuleSyntax e
// importar tipo de outro arquivo quebra em runtime.
type MetaLinha = {
  kind: 'premise' | 'formula' | 'account' | 'total';
  label: string;
  formulaLabel?: string;
  isOverride?: boolean;
  bloqueada?: boolean;
  /** Espelha ModelRowMeta.formato do lib/model-grid: prefixo da coluna "Formato"
   *  do mapeamento (SEM_PREFIXO | MONETARIO | UNIDADES | PERCENTUAL | TEXTO). */
  formato?: string;
};

type PropsGrade = {
  /** Recalculado a cada render do pai. Serve de FONTE; quem manda na tela e o array interno. */
  dados: any[][];
  rowMeta: MetaLinha[];
  /**
   * 'meses' (padrao): Conta | Jan..Dez | Total.
   * 'real-orcado': Conta | (Real, Orcado) x 12 | Total Real, Total Orcado — o
   * Detalhe Mensal da base historica. So o desenho muda; o resto do componente
   * (identidade estavel do array, edicao em voo, altura medida) e o mesmo.
   */
  layout?: 'meses' | 'real-orcado';
  /**
   * Por padrao a grade desenha a propria moldura (borda + cantos). Dentro de um
   * Card isso vira caixa dentro de caixa, com um vao entre as duas bordas —
   * nesse caso passe false e deixe o Card ser a unica moldura, com a grade
   * encostada nas bordas dele.
   */
  moldura?: boolean;
  colHeaders: string[];
  colunaTravada: (col: number) => boolean;
  somenteLeitura?: boolean;
  /**
   * Texto da faixa de Orcado no cabecalho (ver rotuloOrcadoPorStatus). So o
   * rotulo muda com o status do orcamento — quem trava a celula continua sendo
   * `somenteLeitura`/`colunaTravada`.
   */
  rotuloOrcado?: string;
  /**
   * Recebe tambem o array vivo do Handsontable. Use-o (e nao o array do render)
   * para atualizar totais na hora: e ele que esta na tela, e a resposta do
   * backend so chega alguns instantes depois.
   */
  aoAlterar: (changes: any, source: string, dadosVivos: any[][]) => void;
};

/** Espelha PendenciaCelula do lib/model-grid — tipo importado quebra em runtime. */
type Pendencia = { local: any; base: any };

const chaveCelula = (linha: number, coluna: number) => `${linha}:${coluna}`;

export default function GradeModelo(props: PropsGrade) {
  const { dados, rowMeta, colHeaders, colunaTravada, somenteLeitura = false, aoAlterar, layout = 'meses', moldura = true, rotuloOrcado = ROTULO_ORCADO_EDITAVEL } = props;

  // Assinatura da estrutura. Comparada por VALOR porque tudo aqui chega como
  // literal novo a cada render do pai — comparar identidade acusaria mudanca
  // sempre e a memoizacao nao valeria nada.
  const estrutura = JSON.stringify([
    layout,
    somenteLeitura,
    colHeaders,
    // Entra na assinatura porque o cabecalho sai dela: sem isso a memoizacao de
    // GradeModeloHot seguraria o rotulo antigo quando o status do orcamento mudar.
    rotuloOrcado,
    Array.from({ length: 12 }, (_, i) => colunaTravada(i + 1)),
    // `formato` entra na assinatura porque o pattern da celula sai dele (ver
    // numericFormatDaLinha). Sem isso, trocar o Formato no mapeamento nao
    // remontaria o `cells` e o prefixo novo so apareceria por acidente.
    rowMeta.map(m => [m.kind, m.label, m.formulaLabel ?? '', m.isOverride ? 1 : 0, m.bloqueada ? 1 : 0, m.formato ?? '']),
  ]);

  const raizRef = useRef<HTMLDivElement>(null);
  const hotRef = useRef<any>(null);
  const dadosRef = useRef<any[][]>([]);
  const estruturaRef = useRef<string | null>(null);
  const pendentes = useRef(new Map<string, Pendencia>());

  // Derivar durante o render (e nao num efeito) e o que garante que o array
  // entregue ao HotTable ja seja o certo no MESMO commit em que a estrutura muda.
  if (estruturaRef.current !== estrutura) {
    estruturaRef.current = estrutura;
    dadosRef.current = dados.map(linha => linha.slice());
    // A grade foi remontada: nao ha mais celula em voo que faca sentido guardar.
    pendentes.current.clear();
  }

  // Valores correntes para as funcoes estaveis lerem.
  const rowMetaRef = useRef(rowMeta); rowMetaRef.current = rowMeta;
  const travadaRef = useRef(colunaTravada); travadaRef.current = colunaTravada;
  const aoAlterarRef = useRef(aoAlterar); aoAlterarRef.current = aoAlterar;
  const somenteLeituraRef = useRef(somenteLeitura); somenteLeituraRef.current = somenteLeitura;

  const metaDaLinha = useCallback((linha: number) => rowMetaRef.current[linha], []);
  const travada = useCallback((coluna: number) => travadaRef.current(coluna), []);
  const guardarInstancia = useCallback((el: any) => { hotRef.current = el; }, []);

  const aoAlterarInterno = useCallback((changes: any, source: string) => {
    if (!changes || source === 'loadData') return;
    for (const [linha, coluna, anterior, novo] of changes) {
      // Guardar o valor anterior junto: e ele que diz, mais tarde, se o dado que
      // chegou de fora e a confirmacao desta edicao ou so o estado velho.
      pendentes.current.set(chaveCelula(linha, coluna), { local: novo, base: anterior });
    }
    aoAlterarRef.current(changes, source, dadosRef.current);
    // O handler acima costuma mexer em totais direto no array vivo; sem render()
    // essas celulas so mudariam na proxima repintura por outro motivo.
    hotRef.current?.hotInstance?.render();
  }, []);

  // Sem lista de dependencias de proposito: roda a cada render do pai, que e
  // exatamente quando pode ter chegado valor novo de fora.
  useEffect(() => {
    const hot = hotRef.current?.hotInstance;
    const alvo = dadosRef.current;
    if (!hot) return;

    let mudou = false;
    for (let linha = 0; linha < alvo.length; linha++) {
      const origem = dados[linha];
      const destino = alvo[linha];
      if (!origem || !destino) continue;
      for (let coluna = 0; coluna < destino.length; coluna++) {
        const chave = chaveCelula(linha, coluna);
        const decisao = decidirAtualizacaoExterna(destino[coluna], origem[coluna], pendentes.current.get(chave));
        if (decisao.encerrarPendencia) pendentes.current.delete(chave);
        if (!decisao.escrever) continue;
        destino[coluna] = origem[coluna];
        mudou = true;
      }
    }
    // render() repinta so a viewport e preserva dataMap, index mappers, selecao
    // e scroll — e a diferenca entre atualizar a celula e piscar a tabela toda.
    if (mudou) hot.render();
  });

  const altura = useAlturaGradeModelo(raizRef, dados.length);

  return (
    <div
      ref={raizRef}
      className={moldura ? 'overflow-hidden rounded-lg' : undefined}
      style={moldura ? { border: '1px solid var(--color-border)' } : undefined}
    >
      <GradeModeloHot
        estrutura={estrutura}
        layout={layout}
        altura={altura}
        dados={dadosRef.current}
        colHeaders={colHeaders}
        rotuloOrcado={rotuloOrcado}
        totalRowIdx={rowMeta.length - 1}
        somenteLeitura={somenteLeitura}
        metaDaLinha={metaDaLinha}
        colunaTravada={travada}
        aoAlterar={aoAlterarInterno}
        guardarInstancia={guardarInstancia}
      />
    </div>
  );
}

type PropsHot = {
  estrutura: string;
  layout: 'meses' | 'real-orcado';
  altura: number;
  dados: any[][];
  colHeaders: string[];
  rotuloOrcado: string;
  totalRowIdx: number;
  somenteLeitura: boolean;
  metaDaLinha: (linha: number) => MetaLinha | undefined;
  colunaTravada: (coluna: number) => boolean;
  aoAlterar: (changes: any, source: string) => void;
  guardarInstancia: (el: any) => void;
};

/**
 * So re-renderiza quando estrutura, altura ou o proprio array mudam. Qualquer
 * outro render do pai para aqui — e e isso que impede o updateSettings ->
 * replaceData que repintava a tabela inteira.
 */
const GradeModeloHot = memo(function GradeModeloHot(props: PropsHot) {
  const scroll = useModelGridScroll();
  const pareado = props.layout === 'real-orcado';
  const colunas = useMemo(() => (pareado ? colunasModeloRealOrcado() : colunasModelo14()), [pareado]);
  const opcoesCelula = {
    metaDaLinha: props.metaDaLinha,
    totalRowIdx: props.totalRowIdx,
    colunaTravada: props.colunaTravada,
    somenteLeitura: props.somenteLeitura,
    rendererRotulo: criarRendererRotuloModelo(props.metaDaLinha),
  };

  return (
    <HotTable
      ref={props.guardarInstancia}
      data={props.dados}
      // No pareado quem desenha o cabecalho inteiro e o nestedHeaders: passar
      // 12 rotulos para 27 colunas so confundiria quem for ler isto depois.
      colHeaders={pareado ? true : props.colHeaders}
      nestedHeaders={(pareado
        // No pareado o colHeaders traz so os 12 rotulos de mes: o resto do
        // cabecalho (Conta, Real/Orcado, Total) e fixo e sai do proprio padrao.
        ? nestedHeadersModeloRealOrcado(props.colHeaders)
        : nestedHeadersModelo(props.colHeaders, props.colunaTravada, props.rotuloOrcado)) as any}
      columns={colunas}
      rowHeaders={false} wordWrap={false} manualRowResize={false}
      rowHeights={MODEL_ROW_H} fixedColumnsStart={1}
      height={props.altura}
      stretchH="all" licenseKey="non-commercial-and-evaluation"
      className={MODEL_GRID_CLASS}
      {...scroll}
      afterGetColHeader={(pareado
        ? criarAfterGetColHeaderModeloRealOrcado(props.colunaTravada)
        : criarAfterGetColHeaderModelo(props.colunaTravada))}
      cells={(pareado ? criarCellsModeloRealOrcado(opcoesCelula) : criarCellsModelo(opcoesCelula)) as any}
      afterChange={props.aoAlterar}
    />
  );
}, (anterior, atual) =>
  anterior.estrutura === atual.estrutura &&
  anterior.altura === atual.altura &&
  anterior.dados === atual.dados,
);
