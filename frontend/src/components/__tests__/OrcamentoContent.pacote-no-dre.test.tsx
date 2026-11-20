// O valor que o pacote rateou para um CR e orcamento DAQUELE CR — precisa aparecer
// no resultado dele, nao so na aba "Pacotes".
//
// O gestor do pacote lanca um total, o sistema divide pelo rateio e grava uma linha
// por CR em ORCAMENTO_PACOTE. O DRE do CR lia so ORCAMENTO, entao esse custo sumia
// do resultado do setor: aparecia numa aba e nao no Resumo.
//
// Regra que vem do DRE server-side (SF 86/88/90 e 127/128) e que estes testes
// travam: o pacote so entra depois de SUBMETIDO/APROVADO. Enquanto o gestor do
// pacote esta preenchendo, o numero ainda muda e o CR nem tem acesso a ele.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { readFileSync } from 'fs';

afterEach(cleanup);

const fx = (name: string) =>
  JSON.parse(readFileSync(`${process.cwd()}/src/components/__tests__/fixtures/${name}.json`, 'utf8'));
const FIX_124 = fx('sf124-hotOrcBase');

const CR = 8;
const CONTA_SOFTWARE = 33;   // 4.1.5, entra na linha "(-) CMV / CSP" (prefixo 4.1)
const PACOTE = 24;           // CUSTOS_DE_SOFTWARE
const POR_MES = 1000;        // 12 x 1000 = 12.000 no ano -> "-12.0K" (linha de custo)

// O que o rateio do pacote deixou neste CR. A conta e de pacote, entao ela NAO tem
// linha em ORCAMENTO — e exatamente por isso que o DRE a perdia.
const PKG_BUDGET = Array.from({ length: 12 }, (_, i) => ({
  DRIVER_ID: PACOTE, CONTA_ID: CONTA_SOFTWARE, MES: i + 1, CR_ID: CR, VALOR: POR_MES,
}));

const fix125 = (statusPacote: string) => ({
  CONFIGS: JSON.stringify([
    {
      CR_ID: CR, CR_CODIGO: 'CR008', CR_NOME: 'Consultoria Estratégia',
      CONTA_ID: CONTA_SOFTWARE, CODIGO: '4.1.5', CONTA_NOME: 'Despesas com Software',
      TIPO: 'DESPESA_OPERACIONAL', DRIVER_TIPO: 'CUSTOS_DE_SOFTWARE', DRIVER_ID: PACOTE,
    },
  ]),
  BUDGET: '[]', REALIZADO: '[]', REALIZADO_ATUAL: '[]', ORC_CONTROLE: '[]',
  COLABORADORES: '[]', ORCAMENTO_PESSOAL: '[]', HEADCOUNT: '[]', CONTRATACOES: '[]',
  DISSIDIOS: '[]', TURNOVERS: '[]', AUMENTOS: '[]', DESLIGAMENTOS: '[]',
  HIST_PREMISSA: '[]', CLV: '[]', OVERRIDES: '[]', IMPOSTO_CENTRAL: '[]',
  PKG_BUDGET: JSON.stringify(PKG_BUDGET),
  PACOTE_STATUS_ALL: JSON.stringify([
    { ID: 1, CICLO_ID: 132, DRIVER_ID: PACOTE, GESTOR_ID: 9, STATUS: statusPacote },
  ]),
  STATUS: JSON.stringify([
    { ID: 1, CICLO_ID: 132, CR_ID: CR, GESTOR_ID: 1, STATUS: 'PENDENTE', DRIVERS_CONFIRMADOS: '' },
  ]),
});

const { statusAtual } = vi.hoisted(() => ({ statusAtual: { valor: 'SUBMETIDO' } }));

vi.mock('../../hooks/useMitraData', () => {
  const jsonField = (v: any): any[] => {
    if (v == null) return [];
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return []; } }
    return Array.isArray(v) ? v : [];
  };
  const byId = async (id: number) => {
    if (id === 124) return [FIX_124];
    if (id === 125) return [fix125(statusAtual.valor)];
    return [];
  };
  return {
    execSF: vi.fn(byId),
    execSFCached: vi.fn(byId),
    querySQL: vi.fn(async () => []),
    jsonField,
    SF_IDS: new Proxy({ hotOrcBase: 124, hotOrcDetalheCr: 125, hotOrcDetalhePkg: 126 } as Record<string, number>, {
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
vi.mock('@handsontable/react-wrapper', () => ({
  HotTable: (props: any) => <div data-testid="hottable" data-dados={JSON.stringify(props.data)} />,
}));

import OrcamentoContent from '../OrcamentoContent';

const montarCr = () => render(
  <OrcamentoContent gestorId={1} selectedCR={CR} selectedPackage={null} />
);

// Celulas da linha do DRE: rotulo | Realizado | Realizado atual | Orcado | impacto | forecast
const orcadoDaLinha = async (rotulo: string) => {
  const linha = (await screen.findByText(rotulo, {}, { timeout: 5000 })).closest('tr')!;
  return linha.querySelectorAll('td')[3]?.textContent?.trim();
};

describe('DRE do CR — o valor rateado do pacote conta como orçamento', () => {
  it('soma no resultado do setor o que o pacote submetido rateou para ele', async () => {
    statusAtual.valor = 'SUBMETIDO';
    montarCr();
    // 12 x 1.000 numa linha de custo (SINAL -1) => -12.0K
    await waitFor(async () => expect(await orcadoDaLinha('(-) CMV / CSP')).toBe('-12.0K'), { timeout: 5000 });
  });

  it('conta também quando o pacote já foi aprovado', async () => {
    statusAtual.valor = 'APROVADO';
    montarCr();
    await waitFor(async () => expect(await orcadoDaLinha('(-) CMV / CSP')).toBe('-12.0K'), { timeout: 5000 });
  });

  it('ignora pacote ainda em preenchimento — o número mudaria embaixo do gestor', async () => {
    statusAtual.valor = 'PENDENTE';
    montarCr();
    // O CR nem tem acesso a esses valores enquanto o pacote nao e submetido.
    await waitFor(async () => expect(await orcadoDaLinha('(-) CMV / CSP')).toBe('0'), { timeout: 5000 });
  });

  it('ignora pacote apenas confirmado — confirmar não é submeter', async () => {
    statusAtual.valor = 'CONFIRMADO';
    montarCr();
    await waitFor(async () => expect(await orcadoDaLinha('(-) CMV / CSP')).toBe('0'), { timeout: 5000 });
  });

  it('não vaza para outra linha do DRE — só a conta rateada é afetada', async () => {
    statusAtual.valor = 'SUBMETIDO';
    montarCr();
    await waitFor(async () => expect(await orcadoDaLinha('(-) CMV / CSP')).toBe('-12.0K'), { timeout: 5000 });
    expect(await orcadoDaLinha('(-) Despesas com Pessoal')).toBe('0');
    expect(await orcadoDaLinha('Receita Bruta')).toBe('0');
  });
});
