// A Folha carregava em DUAS idas a rede: a primeira trazia os ciclos, um efeito
// reescolhia o ciclo no cliente e isso mudava a chave do useSF, refazendo a SF 129
// inteira — com um pedido equivalente ao primeiro. Este teste trava a correcao
// contando as execucoes reais da SF.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

afterEach(cleanup);

const { chamadas } = vi.hoisted(() => ({ chamadas: [] as any[] }));

vi.mock('../../hooks/useMitraData', async () => {
  const { useState, useEffect, useCallback } = await import('react');
  const jsonField = (v: any): any[] => {
    if (v == null) return [];
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return []; } }
    return Array.isArray(v) ? v : [];
  };
  // Dois ciclos abertos: o sort do cliente (ANO desc, ID desc) elege o ID 7, que e
  // o mesmo que o CASE do SQL elegeria. Se a tela voltar a refazer a query com o
  // ciclo "escolhido", aparece uma segunda chamada aqui.
  const CICLOS = [
    { ID: 3, NOME: 'Orcamento 2025', ANO: 2025, STATUS: 'INICIADA' },
    { ID: 7, NOME: 'Orcamento 2026', ANO: 2026, STATUS: 'INICIADA' },
  ];
  const linha = {
    COLABORADORES: '[]', CRS: '[]', EMPRESAS: '[]', CARGOS: '[]',
    CICLOS: JSON.stringify(CICLOS),
    BENEFICIOS: '[]', ENCARGOS: '[]', DISSIDIOS: '[]', TURNOVERS: '[]',
  };
  // Reimplementa o useSF real (mesmo ciclo de vida: key derivada do input,
  // refetch no useEffect), so que registrando cada execucao.
  const useSF = (sfId: number, input: Record<string, any> = {}) => {
    const [data, setData] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const key = sfId + ':' + JSON.stringify(input);
    const refetch = useCallback(async () => {
      chamadas.push({ sfId, input });
      setData([linha]);
      setLoading(false);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]);
    useEffect(() => { refetch(); }, [refetch]);
    return { data, loading, refetch };
  };
  return {
    useSF,
    useList: () => ({ data: [], loading: false, refetch: vi.fn() }),
    execSF: vi.fn(async () => []),
    execSFCached: vi.fn(async () => []),
    querySQL: vi.fn(async () => []),
    createRecord: vi.fn(async () => ({})),
    updateRecord: vi.fn(async () => ({})),
    removeRecord: vi.fn(async () => ({})),
    jsonField,
    SF_IDS: new Proxy({ hotFolhaBase: 129 } as Record<string, number>, {
      get: (t, k: string) => (k in t ? t[k] : 0),
    }),
    formatCurrency: (v: number) => `R$ ${Math.round(v)}`,
  };
});

vi.mock('../../lib/auth', () => ({
  getUser: () => ({ ID: 1, NOME: 'Teste', PERFIL: 'ADMIN', EMAIL: 't@t.com' }),
  getDemoGestorId: () => null,
  canAccessPath: () => true,
  getLandingPath: () => '/',
  logout: vi.fn(),
  isAdmin: () => true,
}));

describe('Folha: uma unica ida a rede na montagem', () => {
  it('executa a SF 129 exatamente uma vez', async () => {
    chamadas.length = 0;
    const Page = (await import('../../pages/FolhaPage')).default;
    render(<MemoryRouter><Page /></MemoryRouter>);

    // Espera a tela estabilizar — se houvesse cascata, a 2a chamada cairia aqui.
    await waitFor(() => {
      expect(chamadas.length).toBeGreaterThan(0);
    });
    await new Promise((r) => setTimeout(r, 50));

    const sf129 = chamadas.filter((c) => c.sfId === 129);
    expect(sf129.length, `SF 129 executada ${sf129.length}x: ${JSON.stringify(sf129.map((c) => c.input))}`).toBe(1);
    expect(sf129[0].input).toEqual({ cicloId: 0 });
  });
});
