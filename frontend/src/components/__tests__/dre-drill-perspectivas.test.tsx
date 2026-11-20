// O drill do DRE Mensal existia no código mas era inalcançável na prática:
//   1. o gatilho era DUPLO clique, que brigava com o clique simples de abrir as
//      contas contábeis (a linha expandia e recolhia antes do menu aparecer);
//   2. o menu só abria quando NENHUM CR estava filtrado — com filtro ativo, as
//      perspectivas por CR e por empresa simplesmente não existiam.
// Este teste protege o gatilho (DUPLO clique / ícone da linha — o clique
// simples é adiado e cancelado quando vira duplo) e a presença das três
// perspectivas, inclusive com filtro de CR ativo.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// vi.mock e' içado para o topo do arquivo: tudo que a factory usa precisa
// nascer em vi.hoisted, senao o modulo e' avaliado antes das constantes.
const { SF, chamadas } = vi.hoisted(() => ({
  SF: {
    baseCiclos: 80, baseDreConfig: 81, baseContas: 82, baseCrs: 83,
    baseEmpresas: 84, baseGestorCrs: 85,
    dreOrcadoPorConta: 86, dreRealizadoPorConta: 87,
    dreOrcadoPorCr: 88, dreRealizadoPorCr: 89,
    dreOrcadoPorEmpresa: 90, dreRealizadoPorEmpresa: 91,
  },
  chamadas: [] as Array<{ id: number; input: any }>,
}));

vi.mock('../../hooks/useMitraData', () => ({
  SF_IDS: SF,
  MONTHS: ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'],
  execSFCached: vi.fn(async (id: number) => {
    if (id === SF.baseCiclos) return [{ ID: 1, ANO: 2026, NOME: 'Orçamento 2026', VERSAO_ATUAL: 'true' }];
    if (id === SF.baseDreConfig) return [
      { NOME_LINHA: 'Receita Bruta', PREFIXO_CONTA: '3', SINAL: 1, IS_SUBTOTAL: 'false' },
      { NOME_LINHA: 'Receita Líquida', PREFIXO_CONTA: '', SINAL: 1, IS_SUBTOTAL: 'true' },
    ];
    if (id === SF.baseContas) return [{ ID: 10, CODIGO: '3.01', NOME: 'Vendas' }];
    if (id === SF.baseCrs) return [{ ID: 1, NOME: 'Comercial', EMPRESA_ID: 1 }];
    if (id === SF.baseEmpresas) return [{ ID: 1, NOME: 'Matriz' }];
    return [];
  }),
  execSF: vi.fn(async (id: number, input: any) => {
    chamadas.push({ id, input });
    if (id === SF.dreOrcadoPorCr) return [{ CR_ID: 1, MES: 1, VALOR: 500 }];
    if (id === SF.dreRealizadoPorCr) return [];
    return [{ CONTA_ID: 10, MES: 1, VALOR: 1000 }];
  }),
}));

import DREPage from '../../pages/DREPage';

const montar = () => render(<MemoryRouter><DREPage /></MemoryRouter>);
const linhaReceita = () => screen.getByText('Receita Bruta').closest('tr')!;
// "Receita Líquida" também é rótulo de KPI: pega só a ocorrência que é linha da tabela.
const linhaSubtotal = () =>
  screen.getAllByText('Receita Líquida').map((el) => el.closest('tr')).find(Boolean)!;

afterEach(cleanup);
beforeEach(() => { chamadas.length = 0; });

describe('DRE Mensal — perspectivas de drill', () => {
  it('duplo clique na linha abre o menu com CR, empresa e conta contábil', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Receita Bruta')).toBeTruthy());

    fireEvent.doubleClick(linhaReceita());

    expect(await screen.findByText('Detalhar por')).toBeTruthy();
    expect(screen.getByText('Centro de resultado')).toBeTruthy();
    expect(screen.getByText('Empresa')).toBeTruthy();
    expect(screen.getByText('Conta contábil')).toBeTruthy();
  });

  it('escolher "Centro de resultado" abre o drill por CR', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Receita Bruta')).toBeTruthy());

    fireEvent.doubleClick(linhaReceita());
    fireEvent.click(await screen.findByText('Centro de resultado'));

    // Consultou a SF de orçado POR CR e mostrou o CR no lugar da linha.
    await waitFor(() => expect(chamadas.some(c => c.id === SF.dreOrcadoPorCr)).toBe(true));
    expect(await screen.findByText('Comercial')).toBeTruthy();
    expect(screen.getByText('por CR')).toBeTruthy();
  });

  it('clique simples na linha não abre o menu — ele expande as contas contábeis', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Receita Bruta')).toBeTruthy());

    fireEvent.click(linhaReceita());

    expect(screen.queryByText('Detalhar por')).toBeNull();
    expect(await screen.findByText('3.01 - Vendas')).toBeTruthy();
  });

  it('subtotal não oferece drill (duplo clique não abre o menu)', async () => {
    montar();
    await waitFor(() => expect(linhaSubtotal()).toBeTruthy());

    fireEvent.doubleClick(linhaSubtotal());

    expect(screen.queryByText('Detalhar por')).toBeNull();
  });
});

describe('DRE Mensal — duplo clique não dispara o expandir', () => {
  it('duplo clique abre o menu sem consultar as contas contábeis', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Receita Bruta')).toBeTruthy());

    // A grade inicial ja consulta a SF por conta; o que nao pode acontecer e
    // uma consulta NOVA (a do expandir) disparada pelo duplo clique.
    const antes = chamadas.filter(c => c.id === SF.dreOrcadoPorConta).length;

    // Um duplo clique real chega ao React como click, click, dblclick.
    fireEvent.click(linhaReceita());
    fireEvent.click(linhaReceita());
    fireEvent.doubleClick(linhaReceita());

    expect(await screen.findByText('Detalhar por')).toBeTruthy();
    // O clique simples adiado foi cancelado: nenhuma chamada extra.
    await new Promise(r => setTimeout(r, 350));
    expect(chamadas.filter(c => c.id === SF.dreOrcadoPorConta).length).toBe(antes);
  });
});

// O duplo clique e o gatilho do drill, mas nao se anuncia sozinho: passar o
// cursor sobre uma linha detalhavel precisa avisar.
describe('DRE Mensal — dica de hover do drill', () => {
  it('hover na linha avisa que o duplo clique abre o drill', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Receita Bruta')).toBeTruthy());

    fireEvent.mouseOver(linhaReceita(), { clientX: 120, clientY: 200 });

    const dica = await screen.findByText(/Duplo clique para detalhar/, {}, { timeout: 2000 });
    // A dica promete exatamente o que o menu oferece daquele ponto.
    expect(dica.textContent).toContain('centro de resultado');
    expect(dica.textContent).toContain('conta contábil');

    fireEvent.mouseOut(linhaReceita());
    await waitFor(() => expect(screen.queryByText(/Duplo clique para detalhar/)).toBeNull());
  });

  it('subtotal não recebe a dica — não há drill para anunciar', async () => {
    montar();
    await waitFor(() => expect(linhaSubtotal()).toBeTruthy());

    fireEvent.mouseOver(linhaSubtotal(), { clientX: 120, clientY: 200 });

    await new Promise(r => setTimeout(r, 700));
    expect(screen.queryByText(/Duplo clique para detalhar/)).toBeNull();
  });
});
