// Trava as regras do padrao de grade de modelo. Vale mais do que testar a aba
// Receita isolada: e este modulo que as outras telas de lancamento vao consumir,
// entao um erro aqui se propaga para todas.
//
// O Handsontable em si nao renderiza sem navegador, mas tudo o que decide
// aparencia e trava mora fora dele — e testavel direto.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  MODEL_ROW_H, alturaGradeModelo, colunasModelo14, faixasDePeriodo,
  colunasComDivisor, nestedHeadersModelo, criarCellsModelo, rotuloOrcadoPorStatus,
  criarRendererRotuloModelo, criarAfterGetColHeaderModelo,
  decidirAtualizacaoExterna,
  posDoMesRealOrcado, ehColunaRealizado, colunasModeloRealOrcado,
  nestedHeadersModeloRealOrcado, colunasComDivisorRealOrcado,
  criarCellsModeloRealOrcado, COL_TOTAL_REAL, COL_TOTAL_ORCADO,
  numericFormatDaLinha,
} from '../../lib/model-grid';
import numbro from 'numbro';
// @ts-ignore — o arquivo de idioma do numbro nao tem declaracao de tipos
import numbroPtBR from 'numbro/languages/pt-BR';

const CABECALHOS = ['Conta', 'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez', 'Total'];

/** Realizado ate o mes N (o caso comum: primeiros N meses fechados). */
const ateOMes = (n: number) => (col: number) => col >= 1 && col <= n;

describe('grade de modelo — faixas de periodo', () => {
  it('separa realizado de orcado quando ha meses fechados', () => {
    expect(faixasDePeriodo(ateOMes(5))).toEqual([
      { travada: true, inicio: 1, fim: 5 },
      { travada: false, inicio: 6, fim: 12 },
    ]);
  });

  it('ano inteiro em aberto vira uma faixa so de orcado', () => {
    expect(faixasDePeriodo(ateOMes(0))).toEqual([{ travada: false, inicio: 1, fim: 12 }]);
  });

  it('ano inteiro fechado vira uma faixa so de realizado', () => {
    expect(faixasDePeriodo(ateOMes(12))).toEqual([{ travada: true, inicio: 1, fim: 12 }]);
  });

  it('realizado partido em duas pontas continua correto', () => {
    // Acontece se a ordem dos meses deixar de ser Jan..Dez (ano fiscal):
    // o realizado deixa de ser um prefixo. O cabecalho tem de acompanhar.
    const partido = (col: number) => col <= 2 || col >= 11;
    expect(faixasDePeriodo(partido)).toEqual([
      { travada: true, inicio: 1, fim: 2 },
      { travada: false, inicio: 3, fim: 10 },
      { travada: true, inicio: 11, fim: 12 },
    ]);
  });
});

describe('grade de modelo — cabecalho de dois niveis', () => {
  it('monta faixa de realizado com cadeado e faixa de orcado, mais as pontas vazias', () => {
    const [topo, meses] = nestedHeadersModelo(CABECALHOS, ateOMes(5)) as any;
    expect(meses).toEqual(CABECALHOS);
    expect(topo.map((t: any) => t.colspan)).toEqual([1, 5, 7, 1]);
    expect(topo[1].label).toContain('Realizado · Bloqueado');
    expect(topo[1].label).toContain('<svg');
    expect(topo[2].label).toBe('Orçado · Editável');
    // Cadeado so no cabecalho do realizado.
    expect(topo[2].label).not.toContain('<svg');
  });

  it('nao cria faixa de realizado quando nao ha mes fechado', () => {
    const [topo] = nestedHeadersModelo(CABECALHOS, ateOMes(0)) as any;
    expect(topo.map((t: any) => t.colspan)).toEqual([1, 12, 1]);
    expect(topo[1].label).toBe('Orçado · Editável');
  });

  it('a faixa de orcado assume o rotulo do status, sem mexer no cadeado do realizado', () => {
    const [topo] = nestedHeadersModelo(CABECALHOS, ateOMes(5), 'Orçado · Submetido') as any;
    expect(topo[2].label).toBe('Orçado · Submetido');
    expect(topo[1].label).toContain('Realizado · Bloqueado');
  });

  it('o SVG do cadeado carrega o proprio display inline', () => {
    // Sem isso o preflight do Tailwind (svg { display: block }) derruba o
    // icone de linha dentro do cabecalho.
    const [topo] = nestedHeadersModelo(CABECALHOS, ateOMes(3)) as any;
    expect(topo[1].label).toContain('display:inline-block');
  });
});

describe('grade de modelo — rotulo do orcado por status', () => {
  // O cabecalho dizia "Editável" mesmo depois de submetido, quando as celulas ja
  // estao bloqueadas. Devolvido para ajustes (REPROVADO) volta a ser editavel.
  it('traduz cada status do orcamento', () => {
    expect(rotuloOrcadoPorStatus('PENDENTE')).toBe('Orçado · Editável');
    expect(rotuloOrcadoPorStatus('CONFIRMADO')).toBe('Orçado · Editável');
    expect(rotuloOrcadoPorStatus('SUBMETIDO')).toBe('Orçado · Submetido');
    expect(rotuloOrcadoPorStatus('APROVADO')).toBe('Orçado · Aprovado');
    expect(rotuloOrcadoPorStatus('REPROVADO')).toBe('Orçado · Editável');
  });

  it('sem status ainda carregado, assume editavel', () => {
    expect(rotuloOrcadoPorStatus(undefined)).toBe('Orçado · Editável');
    expect(rotuloOrcadoPorStatus(null)).toBe('Orçado · Editável');
  });
});

describe('grade de modelo — divisor Realizado | Orcado', () => {
  it('marca a primeira coluna orcada', () => {
    expect([...colunasComDivisor(ateOMes(5))]).toEqual([6]);
  });

  it('nao desenha divisor na coluna 1 — ali seria borda da tabela', () => {
    expect([...colunasComDivisor(ateOMes(0))]).toEqual([]);
  });

  it('marca cada retomada de orcado quando o realizado e partido', () => {
    expect([...colunasComDivisor((col) => col <= 2 || col >= 11)]).toEqual([3]);
  });
});

describe('grade de modelo — classes e travas de celula', () => {
  const rowMeta: any[] = [
    { kind: 'account', label: 'Conta A' },
    { kind: 'premise', label: 'Ticket Medio' },
    { kind: 'formula', label: 'Receita Liquida', formulaLabel: '[1] - [2]' },
    { kind: 'total', label: 'Total' },
  ];
  const cells = criarCellsModelo({
    metaDaLinha: (row) => rowMeta[row],
    totalRowIdx: 3,
    colunaTravada: ateOMes(5),
  });

  it('mes realizado fica bloqueado; mes orcado fica editavel', () => {
    expect(cells(0, 3)).toMatchObject({ readOnly: true });
    expect(cells(0, 3).className).toContain('cell-locked');
    expect(cells(0, 3).className).toContain('period-actual');
    expect(cells(0, 8).readOnly).toBeUndefined();
    expect(cells(0, 8).className).toContain('cell-editable');
    expect(cells(0, 8).className).toContain('period-budget');
  });

  it('premissa continua editavel em mes fechado — nao e lancamento contabil', () => {
    expect(cells(1, 3).readOnly).toBeUndefined();
    expect(cells(1, 3).className).toContain('cell-editable');
    // A faixa continua marcando que o mes e realizado; so a trava nao se aplica.
    expect(cells(1, 3).className).toContain('period-actual');
    expect(cells(1, 3).className).toContain('row-premise');
  });

  it('linha bloqueada pela tela nao convida a digitar', () => {
    // Caso do pacote: conta com rateio ainda nao configurado. Deixar o campo
    // com cara de editavel convidaria a digitar num lugar que nao grava.
    const comBloqueio = criarCellsModelo({
      metaDaLinha: () => ({ kind: 'account', label: 'Conta rateada', bloqueada: true }),
      totalRowIdx: 9, colunaTravada: ateOMes(0),
    });
    expect(comBloqueio(0, 8)).toMatchObject({ readOnly: true });
    expect(comBloqueio(0, 8).className).toContain('cell-locked');
    expect(comBloqueio(0, 8).className).not.toContain('cell-editable');
  });

  it('linha de formula fica travada tambem no orcado', () => {
    expect(cells(2, 8)).toMatchObject({ readOnly: true });
    expect(cells(2, 8).className).toContain('cell-calculated');
    expect(cells(2, 8).className).toContain('row-formula');
  });

  it('coluna de total e linha de total nunca sao editaveis', () => {
    expect(cells(0, 13)).toMatchObject({ readOnly: true });
    expect(cells(3, 8)).toMatchObject({ readOnly: true });
    expect(cells(3, 8).className).toContain('row-total');
  });

  it('a primeira coluna recebe o renderer de rotulo e o tipo da linha', () => {
    const marcador = () => {};
    const comRenderer = criarCellsModelo({
      metaDaLinha: (row) => rowMeta[row], totalRowIdx: 3,
      colunaTravada: ateOMes(5), rendererRotulo: marcador,
    });
    expect(comRenderer(1, 0).renderer).toBe(marcador);
    expect(comRenderer(1, 0).className).toContain('model-label-cell');
    expect(comRenderer(1, 0).className).toContain('row-premise');
  });

  it('so o primeiro mes orcado leva a marca do divisor', () => {
    expect(cells(0, 6).className).toContain('period-budget-start');
    expect(cells(0, 7).className).not.toContain('period-budget-start');
  });

  it('tela em somente leitura nao deixa nenhum mes editavel', () => {
    const travada = criarCellsModelo({
      metaDaLinha: (row) => rowMeta[row], totalRowIdx: 3,
      colunaTravada: ateOMes(5), somenteLeitura: true,
    });
    expect(travada(0, 8)).toMatchObject({ readOnly: true });
    expect(travada(0, 8).className).toContain('cell-locked');
  });

  it('classifica pelo metadado da linha, nao pela posicao', () => {
    // A mesma linha 2 muda de classe quando o metadado muda, sem mexer no indice.
    const meta: any[] = [{ kind: 'account', label: 'X' }];
    const dinamico = criarCellsModelo({ metaDaLinha: (r) => meta[r], totalRowIdx: 9, colunaTravada: ateOMes(0) });
    expect(dinamico(0, 8).className).toContain('row-account');
    meta[0] = { kind: 'formula', label: 'X' };
    expect(dinamico(0, 8).className).toContain('row-formula');
    expect(dinamico(0, 8).readOnly).toBe(true);
  });
});

describe('grade de modelo — renderer da primeira coluna', () => {
  const criarTd = () => document.createElement('td');

  it('poe icone e nome dentro do MESMO span', () => {
    const render = criarRendererRotuloModelo(() => ({ kind: 'formula', label: 'Receita Liquida', formulaLabel: '[1]-[2]' }));
    const td = criarTd();
    render(null, td, 0);
    const nome = td.querySelector('.model-label-name');
    // O icone e conteudo inline do span do nome: com flex e irmaos, o icone cai
    // de linha quando o preflight do Tailwind vence.
    expect(nome?.querySelector('.model-ico')).not.toBeNull();
    expect(td.querySelectorAll('.model-label-name').length).toBe(1);
    expect(nome?.textContent).toContain('Receita Liquida');
  });

  it('separa icone e palavra sem depender da folha de estilo', () => {
    // A coluna congelada e um clone sobreposto: se a regra de CSS nao vencer
    // ali, o texto encosta no icone. O respiro tem de estar no elemento.
    for (const kind of ['premise', 'formula'] as const) {
      const render = criarRendererRotuloModelo(() => ({ kind, label: 'Ticket Medio' }));
      const td = criarTd();
      render(null, td, 0);
      const icone = td.querySelector('.model-ico') as HTMLElement;
      expect(icone.style.marginRight).toBe('8px');
      // E um espaco de texto de verdade, para sobrar folga mesmo sem a margem.
      expect(td.textContent?.endsWith(' Ticket Medio')).toBe(true);
    }
  });

  it('a formula legivel vai para o title, nunca para uma segunda linha', () => {
    const render = criarRendererRotuloModelo(() => ({ kind: 'formula', label: 'Receita Liquida', formulaLabel: '[1]-[2]' }));
    const td = criarTd();
    render(null, td, 0);
    expect(td.getAttribute('title')).toBe('Receita Liquida  =  [1]-[2]');
    expect(td.textContent).toBe('ƒ Receita Liquida');
  });

  it('nao reconstroi o DOM quando nada mudou — e o que evita o piscar', () => {
    const render = criarRendererRotuloModelo(() => ({ kind: 'account', label: 'Conta A' }));
    const td = criarTd();
    render(null, td, 0);
    const antes = td.querySelector('.model-label-name');
    render(null, td, 0);
    render(null, td, 0);
    expect(td.querySelector('.model-label-name')).toBe(antes);
  });

  it('reconstroi quando o rotulo muda de verdade', () => {
    let meta: any = { kind: 'account', label: 'Conta A' };
    const render = criarRendererRotuloModelo(() => meta);
    const td = criarTd();
    render(null, td, 0);
    const antes = td.querySelector('.model-label-name');
    meta = { kind: 'account', label: 'Conta B' };
    render(null, td, 0);
    expect(td.querySelector('.model-label-name')).not.toBe(antes);
    expect(td.textContent).toBe('Conta B');
  });

  it('nao confunde rotulos que so diferem na fronteira dos campos', () => {
    // Rotulo 'Receita A' com formula 'B' e rotulo 'Receita' com formula 'A B'
    // colidem se a assinatura juntar os campos sem separador proprio (ou com
    // espaco, que aparece dentro de rotulo). Ai a celula mostra o texto velho.
    let meta: any = { kind: 'formula', label: 'Receita A', formulaLabel: 'B' };
    const render = criarRendererRotuloModelo(() => meta);
    const td = criarTd();
    render(null, td, 0);
    expect(td.textContent).toBe('ƒ Receita A');
    meta = { kind: 'formula', label: 'Receita', formulaLabel: 'A B' };
    render(null, td, 0);
    expect(td.textContent).toBe('ƒ Receita');
    expect(td.getAttribute('title')).toBe('Receita  =  A B');
  });

  it('linha comum nao ganha icone', () => {
    const render = criarRendererRotuloModelo(() => ({ kind: 'account', label: 'Conta A' }));
    const td = criarTd();
    render(null, td, 0);
    expect(td.querySelector('.model-ico')).toBeNull();
  });
});

describe('grade de modelo — cabecalho das colunas de mes', () => {
  it('pinta realizado, orcado e o divisor', () => {
    const aplicar = criarAfterGetColHeaderModelo(ateOMes(5));
    const th = document.createElement('th');
    aplicar(3, th);
    expect([...th.classList]).toContain('period-actual-h');
    aplicar(6, th);
    expect([...th.classList]).toEqual(['period-budget-h', 'period-budget-start']);
  });

  it('ignora a coluna de rotulo e a de total', () => {
    const aplicar = criarAfterGetColHeaderModelo(ateOMes(5));
    const th = document.createElement('th');
    aplicar(0, th);
    aplicar(13, th);
    expect([...th.classList]).toEqual([]);
  });
});

describe('grade de modelo — metricas', () => {
  it('altura da linha e constante, nunca funcao', () => {
    expect(MODEL_ROW_H).toBe(36);
  });

  it('altura da grade cresce com as linhas ate o teto', () => {
    expect(alturaGradeModelo(5)).toBe(5 * MODEL_ROW_H + 76);
    expect(alturaGradeModelo(100)).toBe(620);
  });

  it('sao 14 colunas, com rotulo e total travados', () => {
    const cols = colunasModelo14();
    expect(cols.length).toBe(14);
    expect(cols[0]).toMatchObject({ readOnly: true, width: 260 });
    expect(cols[1]).toMatchObject({ type: 'numeric', width: 96 });
    expect(cols[13]).toMatchObject({ readOnly: true, width: 108 });
  });
});

describe('grade de modelo — layout Real+Orcado (27 colunas)', () => {
  const cells = criarCellsModeloRealOrcado({
    metaDaLinha: (r) => [
      { kind: 'account' as const, label: 'Conta A' },
      { kind: 'formula' as const, label: 'Conta B' },
      { kind: 'total' as const, label: 'Total' },
    ][r],
    totalRowIdx: 2,
    colunaTravada: ateOMes(3),
  });

  it('cada mes ocupa duas colunas, na ordem Real depois Orcado', () => {
    // Errar por um aqui desloca a grade inteira sem dar erro nenhum.
    expect(posDoMesRealOrcado(1)).toBe(1);
    expect(posDoMesRealOrcado(2)).toBe(1);
    expect(posDoMesRealOrcado(3)).toBe(2);
    expect(posDoMesRealOrcado(24)).toBe(12);
    expect(ehColunaRealizado(1)).toBe(true);
    expect(ehColunaRealizado(2)).toBe(false);
    expect(ehColunaRealizado(23)).toBe(true);
    expect(ehColunaRealizado(24)).toBe(false);
  });

  it('rotulo e totais ficam fora da conta de meses', () => {
    expect(posDoMesRealOrcado(0)).toBe(0);
    expect(posDoMesRealOrcado(COL_TOTAL_REAL)).toBe(0);
    expect(posDoMesRealOrcado(COL_TOTAL_ORCADO)).toBe(0);
    expect(ehColunaRealizado(COL_TOTAL_REAL)).toBe(false);
  });

  it('sao 27 colunas e so as de Orcado ficam abertas', () => {
    const cols = colunasModeloRealOrcado();
    expect(cols.length).toBe(27);
    expect(cols[0]).toMatchObject({ readOnly: true });
    expect(cols[1]).toMatchObject({ data: 1 });        // Real de janeiro
    expect(cols[26]).toMatchObject({ data: COL_TOTAL_ORCADO, readOnly: true });
  });

  it('Real nunca aceita edicao — e historico, ja aconteceu', () => {
    expect(cells(0, 1).readOnly).toBe(true);   // Real de janeiro
    expect(cells(0, 23).readOnly).toBe(true);  // Real de dezembro
    expect(cells(0, 1).className).toContain('period-actual');
  });

  it('Orcado de mes aberto e editavel; de mes fechado, nao', () => {
    expect(cells(0, 8).readOnly).toBeUndefined();      // abril (mes 4) esta aberto
    expect(cells(0, 8).className).toContain('cell-editable');
    expect(cells(0, 6).readOnly).toBe(true);           // marco esta fechado
    expect(cells(0, 6).className).toContain('cell-locked');
  });

  it('linha de formula fica travada tambem no Orcado', () => {
    expect(cells(1, 8).readOnly).toBe(true);
    expect(cells(1, 8).className).toContain('cell-calculated');
  });

  it('a linha de Total nao aceita edicao em coluna nenhuma', () => {
    for (const col of [1, 8, COL_TOTAL_REAL, COL_TOTAL_ORCADO]) {
      expect(cells(2, col).readOnly).toBe(true);
      expect(cells(2, col).className).toContain('row-total');
    }
  });

  it('o divisor abre cada mes, menos o primeiro, e o bloco de totais', () => {
    const div = colunasComDivisorRealOrcado();
    expect(div.has(1)).toBe(false);              // janeiro nao abre divisor
    expect(div.has(3)).toBe(true);               // fevereiro
    expect(div.has(23)).toBe(true);              // dezembro
    expect(div.has(COL_TOTAL_REAL)).toBe(true);  // totais
    expect(div.size).toBe(12);
  });

  it('o cabecalho tem o mes em cima do par e Real/Orcado embaixo', () => {
    const [topo, base] = nestedHeadersModeloRealOrcado(['jan', 'fev']);
    expect(topo[0]).toEqual({ label: '', colspan: 1 });
    expect(topo[1]).toEqual({ label: 'jan', colspan: 2 });
    expect(topo[3]).toEqual({ label: 'Total', colspan: 2 });
    expect(base).toEqual(['Conta', 'Real', 'Orçado', 'Real', 'Orçado', 'Real', 'Orçado']);
  });
});

describe('grade de modelo — Formato da linha (prefixo) na celula', () => {
  // O Formato e escolhido linha a linha no mapeamento, e uma coluna do
  // Handsontable so tem um formato — por isso o pattern sai do metadado da LINHA
  // e e entregue celula a celula. Enquanto morou so em `columns`, o prefixo
  // escolhido no mapeamento nunca aparecia na visao de preenchimento.
  numbro.registerLanguage(numbroPtBR);
  numbro.setLanguage('pt-BR');
  const formatoDe = (formato?: string) =>
    numericFormatDaLinha(formato === undefined ? undefined : { kind: 'account', label: 'X', formato });
  const exibir = (formato: string | undefined, valor: number) =>
    numbro(valor).format(formatoDe(formato).pattern as any);

  it('sem formato, SEM_PREFIXO, UNIDADES, TEXTO ou valor desconhecido: nada muda', () => {
    // Zero regressao: a esmagadora maioria das linhas cai aqui e tem de render
    // exatamente o que o pattern '0,0' rendia antes.
    for (const formato of [undefined, 'SEM_PREFIXO', 'UNIDADES', 'TEXTO', 'ALGO_NOVO_NO_BANCO']) {
      expect(formatoDe(formato).pattern).toBe('0,0');
      expect(exibir(formato, 1234.5)).toBe('1.234,5');
      expect(exibir(formato, -1234.5)).toBe('-1.234,5');
    }
  });

  it('MONETARIO prefixa a moeda e PERCENTUAL sufixa o sinal', () => {
    expect(exibir('MONETARIO', 1234.5)).toBe('R$ 1.234,5');
    expect(exibir('PERCENTUAL', 15)).toBe('15 %');
  });

  it('PERCENTUAL nao multiplica o valor por 100', () => {
    // Com '%' dentro do pattern o numbro multiplicaria: 15 sairia '1.500 %'. O
    // sinal tem de ser so decoracao — o valor gravado e a soma nao mudam.
    expect(exibir('PERCENTUAL', 15)).not.toContain('1.500');
  });

  it('MONETARIO mantem o sinal de negativo junto do numero', () => {
    // Com 'R$ ' dentro do pattern o numbro devolveria '- R$1.234,5'.
    expect(exibir('MONETARIO', -1234.5)).toBe('R$ -1.234,5');
  });

  it('a celula sempre carrega o numericFormat, inclusive no default', () => {
    // O Handsontable guarda o cellMeta e mescla nele o retorno do `cells`: se o
    // default omitisse a chave, a celula que uma vez recebeu prefixo ficaria com
    // ele para sempre depois de o Formato voltar para "Sem prefixo".
    const meta: any[] = [{ kind: 'account', label: 'A', formato: 'MONETARIO' }, { kind: 'total', label: 'Total' }];
    const cells = criarCellsModelo({ metaDaLinha: (r) => meta[r], totalRowIdx: 1, colunaTravada: ateOMes(0) });
    const monetario = { pattern: { thousandSeparated: true, prefix: 'R$ ' }, culture: 'pt-BR' };
    expect(cells(0, 8).numericFormat).toEqual(monetario);
    expect(cells(0, 13).numericFormat).toEqual(monetario);
    meta[0] = { kind: 'account', label: 'A' };
    expect(cells(0, 8).numericFormat).toEqual({ pattern: '0,0', culture: 'pt-BR' });
  });

  it('o layout Real+Orcado usa a mesma regra', () => {
    const cells = criarCellsModeloRealOrcado({
      metaDaLinha: () => ({ kind: 'account', label: 'A', formato: 'PERCENTUAL' }),
      totalRowIdx: 9, colunaTravada: ateOMes(0),
    });
    const percentual = { pattern: { thousandSeparated: true, postfix: ' %' }, culture: 'pt-BR' };
    expect(cells(0, 8).numericFormat).toEqual(percentual);
    expect(cells(0, COL_TOTAL_ORCADO).numericFormat).toEqual(percentual);
  });
});

describe('grade de modelo — valor externo x edicao em voo', () => {
  it('adota o valor externo quando nao ha edicao pendente', () => {
    expect(decidirAtualizacaoExterna(10, 20, undefined)).toEqual({ escrever: true, encerrarPendencia: false });
  });

  it('nao reescreve o que ja esta igual', () => {
    expect(decidirAtualizacaoExterna(20, 20, undefined)).toEqual({ escrever: false, encerrarPendencia: false });
  });

  it('segura o valor velho enquanto a gravacao esta em voo', () => {
    // O usuario digitou 500 sobre 100 e o save ainda nao voltou; o render trouxe
    // o 100 de antes. Escrever aqui apagaria o 500 debaixo do dedo dele.
    const decisao = decidirAtualizacaoExterna(500, 100, { local: 500, base: 100 });
    expect(decisao).toEqual({ escrever: false, encerrarPendencia: false });
  });

  it('encerra a pendencia quando o backend confirma o valor digitado', () => {
    expect(decidirAtualizacaoExterna(500, 500, { local: 500, base: 100 }))
      .toEqual({ escrever: false, encerrarPendencia: true });
  });

  it('aceita numero diferente do digitado — rateio e arredondamento mandam', () => {
    // Em modo pacote o valor volta dividido entre CRs: quem manda e o backend.
    expect(decidirAtualizacaoExterna(500, 167, { local: 500, base: 100 }))
      .toEqual({ escrever: true, encerrarPendencia: true });
  });
});

describe('grade de modelo — premissa na faixa de Realizado', () => {
  const css = readFileSync('src/index.css', 'utf-8');

  it('nao herda o fundo azul do Orcado', () => {
    // A celula e editavel (premissa nao trava em mes fechado), e sem uma regra
    // mais especifica ela pegaria o azul de .cell-editable — dizendo que um mes
    // fechado esta em aberto.
    const regra = css.match(/\.handsontable\.ht-model-grid td\.period-actual\.cell-editable\s*\{[^}]*\}/);
    expect(regra).not.toBeNull();
    expect(regra![0]).toContain('--color-surface');
    expect(regra![0]).not.toContain('--model-budget-bg');
  });
});
