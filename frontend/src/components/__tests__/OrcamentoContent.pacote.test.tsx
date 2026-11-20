// TESTE DE RENDERIZAÇÃO — aba do pacote segue o design system das nativas.
// Renderiza o OrcamentoContent em MODO PACOTE com fixtures REAIS das SFs
// (124 hotOrcBase / 126 hotOrcDetalhePkg, capturadas do ambiente) e verifica
// o que o usuário de fato vê:
//   1. A aba do pacote existe na barra (e a aba consolidada "Pacotes" NÃO —
//      regressão que fazia cair no grid legado com células roxas)
//   2. A aba renderiza a seção padronizada: badge "Modelo de pacote",
//      Handsontable com classes 'ht-bz-table ht-bz-embedded' e o gráfico
//      mensal padrão "Comparativo: Realizado e Orçado"
// Roda com: npm test  (vitest, jsdom)
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';

afterEach(cleanup);
import { readFileSync } from 'fs';

const fx = (name: string) =>
  JSON.parse(readFileSync(`${process.cwd()}/src/components/__tests__/fixtures/${name}.json`, 'utf8'));
const FIX_124 = fx('sf124-hotOrcBase');
const FIX_126 = fx('sf126-hotOrcDetalhePkg');
const FIX_125 = {
  CONFIGS: JSON.stringify([
    { CR_ID: 2, CR_CODIGO: 'CR002', CR_NOME: 'Tecnologia', CONTA_ID: 10, CODIGO: '5.1.01', CONTA_NOME: 'Salários e Ordenados', TIPO: 'DESPESA_PESSOAL', DRIVER_TIPO: 'PESSOAL', DRIVER_ID: 4 },
  ]),
  BUDGET: '[]', REALIZADO: '[]', REALIZADO_ATUAL: '[]', ORC_CONTROLE: '[]',
  COLABORADORES: JSON.stringify([{ ID: 5, NOME: 'Rafael Oliveira', CARGO: 'CTO', CR_ID: 2, EMPRESA_ID: 1, SALARIO: 25000, TIPO_CONTRATO: 'CLT', ATIVO: 'true' }]),
  ORCAMENTO_PESSOAL: '[]', HEADCOUNT: '[]', CONTRATACOES: '[]', DISSIDIOS: '[]', TURNOVERS: '[]', AUMENTOS: '[]', DESLIGAMENTOS: '[]',
  HIST_PREMISSA: '[]', CLV: '[]', OVERRIDES: '[]', IMPOSTO_CENTRAL: '[]', PACOTE_STATUS_ALL: '[]', PKG_BUDGET: '[]',
  STATUS: JSON.stringify([{ ID: 1, CICLO_ID: 132, CR_ID: 2, GESTOR_ID: 1, STATUS: 'PENDENTE', DRIVERS_CONFIRMADOS: '' }]),
};

vi.mock('../../hooks/useMitraData', () => {
  const jsonField = (v: any): any[] => {
    if (v == null) return [];
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return []; } }
    return Array.isArray(v) ? v : [];
  };
  const byId = async (id: number) => {
    if (id === 124) return [FIX_124];
    if (id === 125) return [FIX_125];
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
    getPublicOrcToken: () => null,
    publicOrcWrite: vi.fn(async () => ({})),
    queuePublicOrcCell: vi.fn(),
    queuePublicFormulaCell: vi.fn(),
    flushPublicOrcQueue: vi.fn(async () => {}),
    avaliarWorkflow: vi.fn(async () => ({ ok: true })),
    avaliarErroMsg: () => '',
    invalidateSFCache: vi.fn(),
  };
});

vi.mock('mitra-interactions-sdk', () => ({
  configureSdkMitra: vi.fn(),
  patchRecordMitra: vi.fn(async () => ({})),
  createRecordMitra: vi.fn(async () => ({})),
  deleteRecordMitra: vi.fn(async () => ({})),
  createRecordsBatchMitra: vi.fn(async () => ({})),
  getVariableMitra: vi.fn(async () => ({ result: { value: null } })),
  setVariableMitra: vi.fn(async () => ({})),
}));
vi.mock('../../mitra-config', () => ({ MITRA_CONFIG: { projectId: 1 } }));
vi.mock('../../lib/auth', () => ({ getUser: () => ({ NOME: 'Teste', PERFIL: 'admin' }) }));
vi.mock('../WorkflowHistorico', () => ({ default: () => null }));
vi.mock('handsontable/registry', () => ({ registerAllModules: vi.fn() }));
// Stub do Handsontable: captura as props de design (className) sem montar o grid real
vi.mock('@handsontable/react-wrapper', () => ({
  HotTable: (props: any) => (
    <div data-testid="hottable" data-cls={props.className} data-rowheights={String(props.rowHeights)} data-fixedcols={String(props.fixedColumnsStart)} />
  ),
}));

import OrcamentoContent from '../OrcamentoContent';
import { MODEL_ROW_H } from '../../lib/model-grid';

describe('aba do pacote (modo pacote) — design system', () => {
  it('mostra a aba do pacote (sem aba legada "Pacotes") e renderiza grid + gráfico padronizados', async () => {
    render(
      <OrcamentoContent
        gestorId={1}
        selectedCR={null}
        selectedPackage={{ ID: 24, NOME: 'CUSTOS_DE_SOFTWARE', GESTOR_ID: 1 }}
      />
    );

    // 1. Barra de abas: a aba do pacote precisa existir (ela é a aba INICIAL —
    //    /custos de software/i também casa com o botão "Confirmar Custos De
    //    Software" do header do grid, então usamos findAll)…
    const pacoteBtns = await screen.findAllByRole('button', { name: /custos de software/i }, { timeout: 5000 });
    expect(pacoteBtns.length).toBeGreaterThan(0);
    // …e a aba consolidada "Pacotes" (visão legada de CR) NÃO pode aparecer em modo pacote
    expect(screen.queryByRole('button', { name: /^Pacotes/ })).toBeNull();

    // 2. A seção padronizada já está visível (aba inicial é o modelo do pacote).
    //    A âncora é o gráfico da seção — o badge "Modelo de pacote" que servia
    //    de âncora aqui foi removido de propósito no commit edebdfe (ajuste
    //    visual do header), então esperar por ele só dava timeout.
    await screen.findByText('Comparativo: Realizado e Orçado', {}, { timeout: 5000 });

    // Handsontable com o visual das abas nativas (ht-bz)
    await waitFor(() => {
      const hots = screen.getAllByTestId('hottable');
      const pkgGrid = hots.find((h) => (h.getAttribute('data-cls') || '').includes('ht-bz-table'));
      expect(pkgGrid, 'grid do pacote deve usar ht-bz-table ht-bz-embedded').toBeTruthy();
      expect(pkgGrid!.getAttribute('data-cls')).toContain('ht-bz-embedded');
      // Altura vem do token compartilhado das grades (MODEL_ROW_H), nao de um
      // numero solto: o que importa e o pacote usar a MESMA altura das abas
      // nativas. Antes estava fixo em '32' e quebrava a cada ajuste de estilo
      // (o token virou 36 no commit 3d08e73).
      expect(pkgGrid!.getAttribute('data-rowheights')).toBe(String(MODEL_ROW_H));
      expect(pkgGrid!.getAttribute('data-fixedcols')).toBe('1');
    });

    // Gráfico mensal padronizado (Realizado anterior x Vigente) fecha a aba
    expect(screen.getByText('Comparativo: Realizado e Orçado')).toBeTruthy();
  });

  it('modo pacote NÃO tem aba Resumo e abre direto no modelo do pacote', async () => {
    render(
      <OrcamentoContent
        gestorId={1}
        selectedCR={null}
        selectedPackage={{ ID: 24, NOME: 'CUSTOS_DE_SOFTWARE', GESTOR_ID: 1 }}
      />
    );

    // Abre direto na aba do modelo do pacote (grid padronizado visível sem
    // clique). A âncora é o próprio grid ht-bz — é isso que "abrir direto no
    // modelo" significa na tela. O badge "Modelo de pacote" saiu no edebdfe.
    await waitFor(() => {
      const hots = screen.getAllByTestId('hottable');
      const pkgGrid = hots.find((h) => (h.getAttribute('data-cls') || '').includes('ht-bz-table'));
      expect(pkgGrid, 'grid do modelo do pacote deve abrir sem clique').toBeTruthy();
    }, { timeout: 5000 });

    // A aba Resumo não existe em modo pacote (nem o DRE do CR nem o resumo antigo)
    expect(screen.queryByRole('button', { name: /resumo/i })).toBeNull();
    expect(screen.queryByText('DRE do CR')).toBeNull();
    expect(screen.queryByText('Vigente no ciclo')).toBeNull();
  });
});

describe('pessoal — desligamento projetado', () => {
  it('oferece demissão no quadro atual e explica o corte de custos', async () => {
    render(<OrcamentoContent gestorId={1} selectedCR={2} selectedPackage={null} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Pessoal' }, { timeout: 5000 }));
    fireEvent.click(await screen.findByText('Quadro Atual'));
    fireEvent.click(await screen.findByRole('button', { name: 'Demissão' }));

    expect(screen.getByText('Custo zerado a partir de')).toBeTruthy();
    expect(screen.getByText('Salário, benefícios e encargos serão zerados deste mês em diante.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Salvar e recalcular' })).toBeTruthy();
  });
});
