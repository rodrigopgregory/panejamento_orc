// Protege contra a regressao inversa do skeleton: refetch nao pode apagar a tela.
// Aqui a rede esta EM VOO mas a tela JA TEM dado (exatamente o estado de um
// refetch pos-salvamento). O conteudo tem que continuar visivel — se virar
// skeleton, o usuario perde a posicao de rolagem a cada gravacao.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

afterEach(cleanup);

const pending = () => new Promise<any>(() => {});

vi.mock('../../hooks/useMitraData', () => {
  const jsonField = (v: any): any[] => {
    if (v == null) return [];
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return []; } }
    return Array.isArray(v) ? v : [];
  };
  // Uma linha de resposta ja presente + loading true = refetch em andamento.
  const row = [{ COLABORADORES: '[]', CRS: '[]', EMPRESAS: '[]', CARGOS: '[]', CICLOS: '[]', BENEFICIOS: '[]', ENCARGOS: '[]', DISSIDIOS: '[]', TURNOVERS: '[]', VERSOES: '[]', GESTORES: '[]' }];
  return {
    useSF: () => ({ data: row, loading: true, refetch: vi.fn() }),
    useList: () => ({ data: row, loading: true, refetch: vi.fn() }),
    execSF: vi.fn(pending),
    execSFCached: vi.fn(pending),
    querySQL: vi.fn(pending),
    createRecord: vi.fn(pending),
    updateRecord: vi.fn(pending),
    removeRecord: vi.fn(pending),
    batchCreate: vi.fn(pending),
    gerenciarModelo: vi.fn(pending),
    avaliarWorkflow: vi.fn(pending),
    publicOrcWrite: vi.fn(pending),
    flushPublicOrcQueue: vi.fn(pending),
    enablePublicOrcMode: vi.fn(),
    avaliarErroMsg: () => '',
    jsonField,
    sqlEscape: (s: string) => s,
    formatCurrency: (v: number) => `R$ ${Math.round(v)}`,
    MONTHS: ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'],
    SF_IDS: new Proxy({} as Record<string, number>, { get: () => 0 }),
  };
});

vi.mock('../../lib/auth', () => ({
  getUser: () => ({ ID: 1, NOME: 'Teste', PERFIL: 'ADMIN', EMAIL: 't@t.com' }),
  PERFIL_TO_GESTOR_ID: {} as Record<string, number>,
  canAccessPath: () => true,
  getLandingPath: () => '/',
  logout: vi.fn(),
  isAdmin: () => true,
  getDemoGestorId: () => null,
}));

const CASOS: Array<[string, () => Promise<any>]> = [
  ['Folha', () => import('../../pages/FolhaPage')],
  ['Versoes', () => import('../../pages/VersoesPage')],
  ['Gestores', () => import('../../pages/GestoresPage')],
  ['Mapeamento', () => import('../../pages/RegraContabilPage')],
];

describe('refetch com dado em tela nao vira skeleton', () => {
  for (const [nome, imp] of CASOS) {
    it(`${nome}: mantem o conteudo durante o refetch`, async () => {
      const Page = (await imp()).default;
      const { container } = render(<MemoryRouter><Page /></MemoryRouter>);
      expect(
        container.querySelectorAll('.pg-skeleton').length,
        'tela virou skeleton durante refetch — usuario perde contexto a cada salvamento',
      ).toBe(0);
    });
  }
});
