// Protege os tres controles de coluna da tabela de lancamentos contabeis:
// reordenar (arrastar cabecalho), ocultar (menu "Colunas") e redimensionar
// (alca na borda direita). O estado e de sessao — nada e persistido.
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { TabelaLancamentos, ColunasMenu } from '../TabelaLancamentos';
import { useColunasLancamentos, useOrdenacaoLancamentos } from '../../hooks/useColunasLancamentos';

afterEach(cleanup);

const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const MESES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const LABELS = { CMV: 'CMV' };

const LANCAMENTOS = [
  {
    id: 1, ano: 2026, mes: 3, empresaNome: 'Empresa Alpha',
    crCodigo: 'CR1', crNome: 'Comercial',
    codigo: '4.01', nome: 'Mercadorias', tipo: 'CMV', valor: 1234,
  },
];

// Reproduz o wiring da tela: hook no topo, menu na barra do card, tabela no corpo.
let ultimaOrdem: { campo: string; dir: string } | null = null;

function Tela() {
  const estado = useColunasLancamentos();
  const ordenacao = useOrdenacaoLancamentos();
  // A ordenacao vira params da SF; o teste observa o que a tela enviaria.
  ultimaOrdem = ordenacao.ordem;
  return (
    <>
      <ColunasMenu estado={estado} />
      <TabelaLancamentos
        lancamentos={LANCAMENTOS}
        estado={estado}
        ordenacao={ordenacao}
        monthsShort={MONTHS}
        fiscalMonthNumbers={MESES}
        tipoLabels={LABELS}
      />
    </>
  );
}

function cabecalhos(): string[] {
  return screen.getAllByRole('columnheader')
    .map((th) => th.textContent?.trim() || '')
    .filter(Boolean);
}

function th(nome: string): HTMLElement {
  return screen.getByRole('columnheader', { name: new RegExp(nome) });
}

function abrirMenu() {
  fireEvent.click(screen.getByRole('button', { name: /Colunas/ }));
}

const dt = () => ({ dataTransfer: { effectAllowed: '', dropEffect: '', setData: () => {}, getData: () => '' } });

describe('TabelaLancamentos — ordem das colunas', () => {
  it('comeca na ordem padrao', () => {
    render(<Tela />);
    expect(cabecalhos()).toEqual(['Período', 'Empresa', 'Setor', 'Conta contábil', 'Tipo', 'Valor']);
  });

  it('move a coluna arrastada para a posicao da coluna alvo', () => {
    render(<Tela />);
    fireEvent.dragStart(th('Valor'), dt());
    fireEvent.dragOver(th('Empresa'), dt());
    fireEvent.drop(th('Empresa'), dt());
    expect(cabecalhos()).toEqual(['Período', 'Valor', 'Empresa', 'Setor', 'Conta contábil', 'Tipo']);
  });

  it('mantem a ordem quando a coluna e solta sobre ela mesma', () => {
    render(<Tela />);
    const antes = cabecalhos();
    fireEvent.dragStart(th('Setor'), dt());
    fireEvent.drop(th('Setor'), dt());
    expect(cabecalhos()).toEqual(antes);
  });

  it('leva os valores da linha junto com a coluna movida', () => {
    render(<Tela />);
    fireEvent.dragStart(th('Valor'), dt());
    fireEvent.dragOver(th('Período'), dt());
    fireEvent.drop(th('Período'), dt());
    const celulas = within(screen.getAllByRole('row')[1]).getAllByRole('cell');
    // "Valor" virou a primeira coluna, entao a primeira celula traz o numero
    expect(celulas[0].textContent).toContain('1.234');
    expect(celulas[1].textContent).toContain('Mar');
  });
});

describe('TabelaLancamentos — visibilidade das colunas', () => {
  it('oculta a coluna escolhida no menu', () => {
    render(<Tela />);
    abrirMenu();
    fireEvent.click(screen.getByRole('button', { name: /^Empresa$/ }));
    expect(cabecalhos()).toEqual(['Período', 'Setor', 'Conta contábil', 'Tipo', 'Valor']);
    expect(screen.queryByText('Empresa Alpha')).toBeNull();
  });

  it('reexibe a coluna ao clicar de novo', () => {
    render(<Tela />);
    abrirMenu();
    const alvo = screen.getByRole('button', { name: /^Empresa$/ });
    fireEvent.click(alvo);
    expect(cabecalhos()).not.toContain('Empresa');
    fireEvent.click(alvo);
    expect(cabecalhos()).toContain('Empresa');
  });

  it('nunca deixa a tabela sem nenhuma coluna', () => {
    render(<Tela />);
    abrirMenu();
    for (const nome of ['Período', 'Empresa', 'Setor', 'Conta contábil', 'Tipo', 'Valor']) {
      fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${nome}$`) }));
    }
    expect(cabecalhos().length).toBe(1);
  });
});

describe('TabelaLancamentos — largura das colunas', () => {
  function larguraDe(container: HTMLElement, indice: number): string {
    return (container.querySelectorAll('col')[indice] as HTMLElement).style.width;
  }

  it('aplica a largura arrastada na alca do cabecalho', () => {
    const { container } = render(<Tela />);
    expect(larguraDe(container, 0)).toBe('110px');

    const alca = screen.getByRole('separator', { name: /Ajustar largura da coluna Período/ });
    fireEvent.mouseDown(alca, { clientX: 200 });
    fireEvent.mouseMove(document, { clientX: 260 });
    fireEvent.mouseUp(document);

    expect(larguraDe(container, 0)).toBe('170px');
  });

  it('respeita a largura minima ao encolher demais', () => {
    const { container } = render(<Tela />);
    const alca = screen.getByRole('separator', { name: /Ajustar largura da coluna Período/ });
    fireEvent.mouseDown(alca, { clientX: 200 });
    fireEvent.mouseMove(document, { clientX: 0 });
    fireEvent.mouseUp(document);

    expect(larguraDe(container, 0)).toBe('80px');
  });

  it('nao reordena a coluna quando o arrasto comeca em cima da alca', () => {
    const { container } = render(<Tela />);
    const alca = screen.getByRole('separator', { name: /Ajustar largura da coluna Período/ });

    fireEvent.mouseDown(alca, { clientX: 200 });
    // O navegador pode disparar dragstart no th enquanto a largura esta sendo
    // ajustada; a ordem das colunas nao pode mudar por causa disso.
    fireEvent.dragStart(th('Período'), dt());
    fireEvent.dragOver(th('Tipo'), dt());
    fireEvent.drop(th('Tipo'), dt());
    fireEvent.mouseMove(document, { clientX: 240 });
    fireEvent.mouseUp(document);

    expect(cabecalhos()).toEqual(['Período', 'Empresa', 'Setor', 'Conta contábil', 'Tipo', 'Valor']);
    expect(larguraDe(container, 0)).toBe('150px');
  });

  it('para de redimensionar depois de soltar o mouse', () => {
    const { container } = render(<Tela />);
    const alca = screen.getByRole('separator', { name: /Ajustar largura da coluna Período/ });
    fireEvent.mouseDown(alca, { clientX: 200 });
    fireEvent.mouseMove(document, { clientX: 250 });
    fireEvent.mouseUp(document);
    fireEvent.mouseMove(document, { clientX: 900 });

    expect(larguraDe(container, 0)).toBe('160px');
  });
});

describe('TabelaLancamentos — restaurar padrao', () => {
  it('desfaz ordem, visibilidade e largura de uma vez', () => {
    const { container } = render(<Tela />);

    fireEvent.dragStart(th('Valor'), dt());
    fireEvent.dragOver(th('Período'), dt());
    fireEvent.drop(th('Período'), dt());
    const alca = screen.getByRole('separator', { name: /Ajustar largura da coluna Valor/ });
    fireEvent.mouseDown(alca, { clientX: 100 });
    fireEvent.mouseMove(document, { clientX: 200 });
    fireEvent.mouseUp(document);
    abrirMenu();
    fireEvent.click(screen.getByRole('button', { name: /^Setor$/ }));
    expect(cabecalhos()).toEqual(['Valor', 'Período', 'Empresa', 'Conta contábil', 'Tipo']);

    // O menu continua aberto depois de alternar uma coluna.
    fireEvent.click(screen.getByRole('button', { name: /Restaurar padrão/ }));

    expect(cabecalhos()).toEqual(['Período', 'Empresa', 'Setor', 'Conta contábil', 'Tipo', 'Valor']);
    expect(larguraDe(container, 0)).toBe('110px');
  });

  function larguraDe(container: HTMLElement, indice: number): string {
    return (container.querySelectorAll('col')[indice] as HTMLElement).style.width;
  }
});

describe('TabelaLancamentos — ordenacao das linhas', () => {
  it('comeca sem ordenacao, deixando a ordem padrao do banco', () => {
    render(<Tela />);
    expect(ultimaOrdem).toBeNull();
    expect(th('Valor').getAttribute('aria-sort')).toBe('none');
  });

  it('ordena texto de A a Z no primeiro clique', () => {
    render(<Tela />);
    fireEvent.click(th('Empresa'));
    expect(ultimaOrdem).toEqual({ campo: 'empresa', dir: 'asc' });
    expect(th('Empresa').getAttribute('aria-sort')).toBe('ascending');
  });

  it('ordena numero do maior para o menor no primeiro clique', () => {
    render(<Tela />);
    fireEvent.click(th('Valor'));
    expect(ultimaOrdem).toEqual({ campo: 'valor', dir: 'desc' });
    expect(th('Valor').getAttribute('aria-sort')).toBe('descending');
  });

  it('inverte no segundo clique e volta ao padrao no terceiro', () => {
    render(<Tela />);
    fireEvent.click(th('Valor'));
    fireEvent.click(th('Valor'));
    expect(ultimaOrdem).toEqual({ campo: 'valor', dir: 'asc' });
    fireEvent.click(th('Valor'));
    expect(ultimaOrdem).toBeNull();
    expect(th('Valor').getAttribute('aria-sort')).toBe('none');
  });

  it('troca de coluna recomeca pela direcao inicial da nova coluna', () => {
    render(<Tela />);
    fireEvent.click(th('Valor'));
    fireEvent.click(th('Valor'));
    expect(ultimaOrdem).toEqual({ campo: 'valor', dir: 'asc' });
    fireEvent.click(th('Empresa'));
    expect(ultimaOrdem).toEqual({ campo: 'empresa', dir: 'asc' });
    expect(th('Valor').getAttribute('aria-sort')).toBe('none');
  });

  it('nao ordena quando o clique e na alca de redimensionar', () => {
    render(<Tela />);
    const alca = screen.getByRole('separator', { name: /Ajustar largura da coluna Valor/ });
    fireEvent.click(alca);
    expect(ultimaOrdem).toBeNull();
  });

  it('nao ordena ao terminar um ajuste de largura', () => {
    render(<Tela />);
    const alca = screen.getByRole('separator', { name: /Ajustar largura da coluna Valor/ });
    fireEvent.mouseDown(alca, { clientX: 100 });
    fireEvent.mouseMove(document, { clientX: 160 });
    fireEvent.click(th('Valor'));
    fireEvent.mouseUp(document);
    expect(ultimaOrdem).toBeNull();
  });

  it('mantem a ordenacao quando as colunas sao reordenadas', () => {
    render(<Tela />);
    fireEvent.click(th('Valor'));
    fireEvent.dragStart(th('Valor'), dt());
    fireEvent.dragOver(th('Período'), dt());
    fireEvent.drop(th('Período'), dt());
    expect(ultimaOrdem).toEqual({ campo: 'valor', dir: 'desc' });
    expect(th('Valor').getAttribute('aria-sort')).toBe('descending');
  });
});
