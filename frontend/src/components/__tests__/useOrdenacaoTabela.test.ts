// Regras de comparacao da ordenacao compartilhada. Sao decisoes de produto
// escondidas num comparador: campo em branco e ausencia de dado (vai para o
// fim nas duas direcoes) e numero guardado como texto ordena como numero.
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useOrdenacaoTabela } from '../../hooks/useOrdenacaoTabela';

const COLUNAS = [
  { key: 'nome', dirInicial: 'asc' as const, valor: (l: Record<string, unknown>) => l.nome },
  { key: 'valor', dirInicial: 'desc' as const, valor: (l: Record<string, unknown>) => l.valor },
  { key: 'semAcessor', dirInicial: 'asc' as const },
];

function usar() {
  return renderHook(() => useOrdenacaoTabela(COLUNAS));
}

describe('ciclo do clique', () => {
  it('percorre direcao inicial, inversa e sem ordenacao', () => {
    const { result } = usar();
    expect(result.current.ordem).toBeNull();
    act(() => result.current.alternarOrdem('valor'));
    expect(result.current.ordem).toEqual({ campo: 'valor', dir: 'desc' });
    act(() => result.current.alternarOrdem('valor'));
    expect(result.current.ordem).toEqual({ campo: 'valor', dir: 'asc' });
    act(() => result.current.alternarOrdem('valor'));
    expect(result.current.ordem).toBeNull();
  });

  it('ignora campo que nao existe na tabela', () => {
    const { result } = usar();
    act(() => result.current.alternarOrdem('inventado'));
    expect(result.current.ordem).toBeNull();
  });
});

describe('comparacao', () => {
  it('joga campo em branco para o fim nas DUAS direcoes', () => {
    const { result } = usar();
    const linhas = [{ nome: 'Carlos' }, { nome: '' }, { nome: 'Ana' }, { nome: null }];

    act(() => result.current.alternarOrdem('nome'));
    expect(result.current.ordenar(linhas).map((l) => l.nome)).toEqual(['Ana', 'Carlos', '', null]);

    act(() => result.current.alternarOrdem('nome'));
    expect(result.current.ordenar(linhas).map((l) => l.nome)).toEqual(['Carlos', 'Ana', '', null]);
  });

  it('ordena numero guardado como texto pelo valor, nao pelo alfabeto', () => {
    const { result } = usar();
    const linhas = [{ valor: '9' }, { valor: '100' }, { valor: '20' }];
    act(() => result.current.alternarOrdem('valor'));
    expect(result.current.ordenar(linhas).map((l) => l.valor)).toEqual(['100', '20', '9']);
  });

  it('ignora acento e caixa ao comparar texto', () => {
    const { result } = usar();
    const linhas = [{ nome: 'ávila' }, { nome: 'Abreu' }, { nome: 'Azevedo' }];
    act(() => result.current.alternarOrdem('nome'));
    expect(result.current.ordenar(linhas).map((l) => l.nome)).toEqual(['Abreu', 'ávila', 'Azevedo']);
  });

  it('nao altera a lista original', () => {
    const { result } = usar();
    const linhas = [{ nome: 'Zeca' }, { nome: 'Ana' }];
    act(() => result.current.alternarOrdem('nome'));
    const ordenada = result.current.ordenar(linhas);
    expect(linhas.map((l) => l.nome)).toEqual(['Zeca', 'Ana']);
    expect(ordenada.map((l) => l.nome)).toEqual(['Ana', 'Zeca']);
  });

  it('devolve a lista intacta quando a coluna nao sabe extrair valor', () => {
    const { result } = usar();
    const linhas = [{ nome: 'Zeca' }, { nome: 'Ana' }];
    act(() => result.current.alternarOrdem('semAcessor'));
    expect(result.current.ordenar(linhas)).toBe(linhas);
  });
});

describe('params para ordenacao no servidor', () => {
  it('sai vazio quando nao ha ordenacao e preenchido quando ha', () => {
    const { result } = usar();
    expect(result.current.ordemCampo).toBe('');
    expect(result.current.ordemDir).toBe('');
    act(() => result.current.alternarOrdem('valor'));
    expect(result.current.ordemCampo).toBe('valor');
    expect(result.current.ordemDir).toBe('desc');
  });
});
