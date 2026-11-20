// Protege o contrato de carregamento das telas do fluxo.
// Simula a rede EM VOO (promises que nunca resolvem, hooks com loading=true) e
// verifica o que o usuario ve no primeiro frame de cada tela:
//   1. o texto de estado vazio/concluido FALSO nao aparece
//   2. o shimmer (.pg-skeleton) aparece
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

afterEach(cleanup);

const pending = () => new Promise<any>(() => {});

vi.mock('../../hooks/useMitraData', () => {
  const jsonField = (v: any): any[] => {
    if (v == null) return [];
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return []; } }
    return Array.isArray(v) ? v : [];
  };
  return {
    // Hooks: rede em voo = loading true, data vazia (exatamente o estado que
    // fazia as telas afirmarem "nao existe nada").
    useSF: () => ({ data: [], loading: true, refetch: vi.fn() }),
    useList: () => ({ data: [], loading: true, refetch: vi.fn() }),
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

const shell = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

// [tela, import, textos falsos que NAO podem aparecer durante o carregamento]
const CASOS: Array<[string, () => Promise<any>, string[]]> = [
  ['Gestores', () => import('../../pages/GestoresPage'), ['Nenhum gestor cadastrado']],
  ['Versoes', () => import('../../pages/VersoesPage'), ['Nenhuma versão cadastrada']],
  ['Premissas', () => import('../../pages/PremissasPage'), ['Nenhuma conta adicionada']],
  ['Folha', () => import('../../pages/FolhaPage'), ['Nenhum colaborador encontrado']],
  ['Mapeamento', () => import('../../pages/RegraContabilPage'), ['Nenhum setor cadastrado ainda', '0 de 0 contas']],
  ['Modelagem', () => import('../../pages/ModelagemPage'), ['Nenhum modelo encontrado']],
  ['ResultadoContabil', () => import('../../pages/ResultadoContabilPage'), ['Nenhum dado de realizado encontrado']],
  ['Workflow', () => import('../../pages/WorkflowPage'), ['Nenhum CR ou pacote', 'Nenhum item']],
  ['Preenchimento', () => import('../../pages/PreenchimentoPage'), ['Tudo pronto', 'Orçamento submetido por completo', 'Tudo submetido']],
];

describe('skeleton cobre o primeiro frame (rede em voo)', () => {
  for (const [nome, imp, falsos] of CASOS) {
    it(`${nome}: mostra shimmer e nao afirma vazio/concluido`, async () => {
      const Page = (await imp()).default;
      const { container } = shell(<Page />);
      for (const txt of falsos) {
        expect(screen.queryByText(new RegExp(txt, 'i')), `"${txt}" vazou durante o carregamento`).toBeNull();
      }
      expect(container.querySelectorAll('.pg-skeleton').length, 'nenhum shimmer renderizado').toBeGreaterThan(0);
    });
  }

  it('DRE: nao mostra KPI zerado durante o carregamento', async () => {
    const Page = (await import('../../pages/DREPage')).default;
    const { container } = shell(<Page />);
    expect(container.querySelectorAll('.pg-skeleton').length).toBeGreaterThan(0);
    expect(screen.queryByText(/^0[.,]0\s*%$/)).toBeNull();
  });
});
