// Protege o contrato de carregamento das telas do fluxo.
// Complemento do skeleton-loading: aqui a rede JA RESPONDEU e o resultado e
// genuinamente vazio. O estado vazio REAL tem que aparecer e o skeleton tem que
// sair — senao trocamos "mentira de vazio" por "skeleton eterno".
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

afterEach(cleanup);

const empty = async () => [] as any[];

vi.mock('../../hooks/useMitraData', () => {
  const jsonField = (v: any): any[] => {
    if (v == null) return [];
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return []; } }
    return Array.isArray(v) ? v : [];
  };
  return {
    // Rede concluida, sem dado nenhum.
    useSF: () => ({ data: [], loading: false, refetch: vi.fn() }),
    useList: () => ({ data: [], loading: false, refetch: vi.fn() }),
    execSF: vi.fn(empty),
    execSFCached: vi.fn(empty),
    querySQL: vi.fn(empty),
    createRecord: vi.fn(empty),
    updateRecord: vi.fn(empty),
    removeRecord: vi.fn(empty),
    batchCreate: vi.fn(empty),
    gerenciarModelo: vi.fn(empty),
    avaliarWorkflow: vi.fn(async () => ({ ok: true })),
    publicOrcWrite: vi.fn(empty),
    flushPublicOrcQueue: vi.fn(async () => {}),
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

// [tela, import, texto do estado vazio REAL que deve aparecer]
const CASOS: Array<[string, () => Promise<any>, string]> = [
  ['Gestores', () => import('../../pages/GestoresPage'), 'Nenhum gestor cadastrado'],
  ['Versoes', () => import('../../pages/VersoesPage'), 'Nenhuma versão cadastrada'],
  // A tabela de aliquotas por conta saiu da tela; o vazio agora e o da tabela
  // de premissas livres, que e todo o conteudo da pagina.
  ['Premissas', () => import('../../pages/PremissasPage'), 'Nenhuma premissa cadastrada'],
  ['Folha', () => import('../../pages/FolhaPage'), 'Nenhum colaborador encontrado'],
  ['Mapeamento', () => import('../../pages/RegraContabilPage'), 'Nenhum setor cadastrado ainda'],
  ['Modelagem', () => import('../../pages/ModelagemPage'), 'Nenhum modelo encontrado'],
  // usuario mockado e ADMIN, entao a visao renderizada e o kanban (vazio real = "Nenhum item")
  ['Workflow', () => import('../../pages/WorkflowPage'), 'Nenhum item'],
];

describe('rede respondida e vazia: estado real aparece, skeleton sai', () => {
  for (const [nome, imp, textoReal] of CASOS) {
    it(`${nome}: mostra o estado vazio real`, async () => {
      const Page = (await imp()).default;
      const { container } = shell(<Page />);
      await waitFor(() => {
        expect(screen.queryAllByText(new RegExp(textoReal, 'i')).length, `"${textoReal}" nunca apareceu — skeleton preso?`).toBeGreaterThan(0);
      }, { timeout: 3000 });
      expect(container.querySelectorAll('.pg-skeleton').length, 'skeleton continuou na tela apos a resposta').toBe(0);
    });
  }

  it('Preenchimento: sai do skeleton apos a resposta', async () => {
    const Page = (await import('../../pages/PreenchimentoPage')).default;
    const { container } = shell(<Page />);
    await waitFor(() => {
      expect(container.querySelectorAll('.pg-skeleton').length, 'skeleton preso apos resposta vazia').toBe(0);
    }, { timeout: 3000 });
  });

  it('ResultadoContabil: sai do skeleton apos a resposta', async () => {
    const Page = (await import('../../pages/ResultadoContabilPage')).default;
    const { container } = shell(<Page />);
    await waitFor(() => {
      expect(container.querySelectorAll('.pg-skeleton').length, 'skeleton preso apos resposta vazia').toBe(0);
    }, { timeout: 3000 });
  });
});
