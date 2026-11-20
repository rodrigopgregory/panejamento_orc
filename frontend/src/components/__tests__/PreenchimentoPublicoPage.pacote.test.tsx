// TESTE DE RENDERIZAÇÃO — link público do gestor com PACOTE DESTRAVADO.
// Renderiza a PreenchimentoPublicoPage com o token na URL e fixtures REAIS
// (SF 139 home sintetizada + SFs 124/126 capturadas do ambiente) e valida o
// que o gestor de fato vê ao orçar o pacote pelo link:
//   1. Card do pacote PENDENTE convida a "Preencher" (não "Visualizar")
//   2. Abrir o pacote NÃO mostra o banner de "modo visualização" e traz o
//      botão "Submeter Pacote" no header (fluxo igual ao dos CRs)
//   3. O grid do modelo renderiza a seção padronizada ("Modelo de pacote")
//      com o controle "Confirmar" ativo — prova de que está editável e de que
//      as linhas do modelo (fórmulas/linhas personalizadas) estão presentes
// Red-green: com o readOnly hardcoded antigo, (2) e (3) falham.
// Roda com: npm test  (vitest, jsdom)
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

afterEach(cleanup);
import { readFileSync } from 'fs';

const fx = (name: string) =>
  JSON.parse(readFileSync(`${process.cwd()}/src/components/__tests__/fixtures/${name}.json`, 'utf8'));
const FIX_124 = fx('sf124-hotOrcBase');
const FIX_126 = fx('sf126-hotOrcDetalhePkg');

const TOKEN = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

// Home do link (SF 139): 1 pacote PENDENTE do gestor 1 — mesmo shape dos blocos reais
const FIX_139 = {
  CTX: JSON.stringify([{ CICLO_ID: 132, GESTOR_ID: 1, GESTOR_NOME: 'Ana Silva', CICLO_NOME: 'Orçamento 2026', CICLO_ANO: 2026 }]),
  CRS: JSON.stringify([]),
  PACOTES: JSON.stringify([{ STATUS_ID: 157, DRIVER_ID: 24, NOME: 'CUSTOS_DE_SOFTWARE', DESCRICAO: null, STATUS: 'PENDENTE', COMENTARIO: null, FILLED: 0, TOTAL: 1 }]),
};

vi.mock('../../hooks/useMitraData', () => {
  const jsonField = (v: any): any[] => {
    if (v == null) return [];
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return []; } }
    return Array.isArray(v) ? v : [];
  };
  const byId = async (id: number) => {
    if (id === 124) return [FIX_124];
    if (id === 126) return [FIX_126];
    return [];
  };
  return {
    execSF: vi.fn(byId),
    execSFCached: vi.fn(byId),
    querySQL: vi.fn(async () => []),
    jsonField,
    SF_IDS: new Proxy({ hotOrcBase: 124, hotOrcDetalhePkg: 126, hotOrcDetalheCr: 125, driversOrdem: 198, upsertFormulaValorPkg: 200 } as Record<string, number>, {
      get: (t, k: string) => (k in t ? t[k] : 0),
    }),
    MONTHS: ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'],
    formatCurrency: (v: number) => `R$ ${Math.round(v)}`,
    // Link do gestor: modo público ATIVO
    getPublicOrcToken: () => TOKEN,
    enablePublicOrcMode: vi.fn(),
    publicOrcWrite: vi.fn(async () => ({ ok: true })),
    queuePublicOrcCell: vi.fn(),
    queuePublicFormulaCell: vi.fn(),
    queuePublicPkgCell: vi.fn(),
    queuePublicPkgLineCell: vi.fn(),
    flushPublicOrcQueue: vi.fn(async () => {}),
    avaliarWorkflow: vi.fn(async () => ({ ok: true })),
    avaliarErroMsg: () => '',
    invalidateSFCache: vi.fn(),
  };
});

vi.mock('mitra-interactions-sdk', () => ({
  configureSdkMitra: vi.fn(),
  // SF 139 (home do link) — única chamada pública direta da página no boot
  executePublicServerFunctionMitra: vi.fn(async () => ({
    result: { executionStatus: 'COMPLETED', output: { rows: [FIX_139] } },
  })),
  patchRecordMitra: vi.fn(async () => ({})),
  createRecordMitra: vi.fn(async () => ({})),
  deleteRecordMitra: vi.fn(async () => ({})),
  createRecordsBatchMitra: vi.fn(async () => ({})),
  getVariableMitra: vi.fn(async () => ({ result: { value: null } })),
  setVariableMitra: vi.fn(async () => ({})),
}));
vi.mock('../../mitra-config', () => ({ MITRA_CONFIG: { projectId: 1 }, configurePublicSdk: vi.fn() }));
vi.mock('../../lib/auth', () => ({ getUser: () => null }));
vi.mock('../../components/PublicDreGestor', () => ({ default: () => null }));
vi.mock('../WorkflowHistorico', () => ({ default: () => null }));
vi.mock('handsontable/registry', () => ({ registerAllModules: vi.fn() }));
vi.mock('@handsontable/react-wrapper', () => ({
  HotTable: (props: any) => (
    <div data-testid="hottable" data-cls={props.className} />
  ),
}));

import PreenchimentoPublicoPage from '../../pages/PreenchimentoPublicoPage';

describe('link do gestor — pacote destravado para orçar', () => {
  it('card PENDENTE convida a Preencher; abrir traz Submeter Pacote, sem banner de visualização, com grid do modelo editável', async () => {
    window.history.replaceState({}, '', `/?token=${TOKEN}`);
    render(<PreenchimentoPublicoPage />);

    // Home carregou com o card do pacote
    const cardTitle = await screen.findByText(/custos de software/i, {}, { timeout: 5000 });
    // 1. Pacote PENDENTE = ação "Preencher" (regressão: mostrava sempre "Visualizar")
    expect(screen.getByText('Preencher')).toBeTruthy();
    expect(screen.queryByText('Visualizar')).toBeNull();

    // 2. Abre o pacote
    fireEvent.click(cardTitle);
    await screen.findByRole('button', { name: /submeter pacote/i }, { timeout: 5000 });
    // …sem o banner antigo de somente-visualização
    expect(screen.queryByText(/modo visualização/i)).toBeNull();

    // 3. Grid do modelo renderiza a seção padronizada direto (a aba inicial em
    //    modo pacote é o próprio modelo — sem aba Resumo) e está editável
    //    ("Confirmar" só aparece quando readOnly=false — red-green do destrave)
    //    Âncora: o grid ht-bz da seção padronizada. O badge "Modelo de pacote"
    //    usado antes foi removido no commit edebdfe (ajuste visual do header).
    await waitFor(() => {
      const hots = screen.getAllByTestId('hottable');
      const pkgGrid = hots.find((h) => (h.getAttribute('data-cls') || '').includes('ht-bz-table'));
      expect(pkgGrid, 'grid do modelo do pacote deve renderizar no link publico').toBeTruthy();
    }, { timeout: 5000 });
    expect(screen.queryByRole('button', { name: /resumo/i })).toBeNull();
    await screen.findByRole('button', { name: /confirmar/i }, { timeout: 5000 });

    // 4. Sem barra de abas no pacote público (fluxo de tela única): o único
    //    botão com o nome do pacote é o "Confirmar" do header do grid — a aba
    //    de navegação não existe
    const pacoteBtns = screen.getAllByRole('button', { name: /custos de software/i });
    expect(pacoteBtns).toHaveLength(1);
    expect(pacoteBtns[0].textContent).toMatch(/confirmar/i);
  });
});
