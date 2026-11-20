// Imposto no modelo de Receita: a regra virou fórmula do modelo, com a alíquota
// numa linha do tipo PREMISSA (`[P1]`) — ver backend/imposto-no-modelo-receita.mjs.
//
// O que o gestor precisa ver ao preencher:
//   1. a linha da alíquota, com o percentual que está sendo aplicado;
//   2. a linha do imposto já calculada a partir dela.
//
// Estes testes montam o modelo EXATO de produção (duas alíquotas, duas fórmulas
// de imposto sobre a soma das receitas) e travam a cadeia inteira: premissa do
// ciclo -> linha PREMISSA do modelo -> fórmula do imposto -> valor na grade.
// A cadeia tem três elos frágeis, cada um já quebrado uma vez: o bloco PREMISSAS
// da SF de detalhe, o vínculo por NOME entre linha e premissa, e a resolução de
// `[Pn]` dentro da fórmula.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { readFileSync } from 'fs';

afterEach(cleanup);

const fx = (name: string) =>
  JSON.parse(readFileSync(`${process.cwd()}/src/components/__tests__/fixtures/${name}.json`, 'utf8'));
const FIX_124_BASE = fx('sf124-hotOrcBase');

const CR = 2;
const RECEITA_DRIVER = 3;
const ISS = 'Alíquota ISS sobre Serviços';
const PIS = 'Alíquota PIS/COFINS';
const PCT_ISS = 5;
const PCT_PIS = 10;
const RECEITA_MES = 1000;  // meses abertos (6..12): ULTIMO_MES_REALIZADO = 5

const FORMULAS = [
  { ID: 60, TIPO: 'INPUT', ORDEM: 1, CODIGO: 'L2', FORMULA: '', CONTA_ID: null, DRIVER_ID: RECEITA_DRIVER, NOME_CUSTOM: 'Ticket Médio', FORMATO: 'SEM_PREFIXO', ESCONDER: 0, NEGRITO: 0 },
  { ID: 59, TIPO: 'INPUT', ORDEM: 2, CODIGO: 'L1', FORMULA: '', CONTA_ID: null, DRIVER_ID: RECEITA_DRIVER, NOME_CUSTOM: 'Volume de vendas', FORMATO: 'SEM_PREFIXO', ESCONDER: 0, NEGRITO: 0 },
  { ID: 49, TIPO: 'FORMULA', ORDEM: 3, CODIGO: 'L3', FORMULA: '[L2]*[L1]', CONTA_ID: 2, DRIVER_ID: RECEITA_DRIVER, CONTA_CODIGO: '3.1.02', CONTA_NOME: 'Receita de Produtos', NOME_CUSTOM: null, FORMATO: 'MONETARIO', ESCONDER: 0, NEGRITO: 1 },
  { ID: 54, TIPO: 'INPUT', ORDEM: 4, CODIGO: 'L6', FORMULA: '', CONTA_ID: 1, DRIVER_ID: RECEITA_DRIVER, CONTA_CODIGO: '3.1.01', CONTA_NOME: 'Receita de Serviços', NOME_CUSTOM: null, FORMATO: 'MONETARIO', ESCONDER: 0, NEGRITO: 0 },
  { ID: 71, TIPO: 'PREMISSA', ORDEM: 6, CODIGO: 'P1', FORMULA: '', CONTA_ID: null, DRIVER_ID: RECEITA_DRIVER, NOME_CUSTOM: ISS, PREMISSA_NOME: ISS, FORMATO: 'SEM_PREFIXO', ESCONDER: 0, NEGRITO: 0 },
  { ID: 51, TIPO: 'FORMULA', ORDEM: 7, CODIGO: 'L5', FORMULA: '({3.1.02} + {3.1.01} + {3.1.04}) * [P1] / 100', CONTA_ID: 5, DRIVER_ID: RECEITA_DRIVER, CONTA_CODIGO: '3.2.01', CONTA_NOME: 'ISS sobre Serviços', NOME_CUSTOM: null, FORMATO: 'SEM_PREFIXO', ESCONDER: 0, NEGRITO: 0 },
  { ID: 72, TIPO: 'PREMISSA', ORDEM: 9, CODIGO: 'P2', FORMULA: '', CONTA_ID: null, DRIVER_ID: RECEITA_DRIVER, NOME_CUSTOM: PIS, PREMISSA_NOME: PIS, FORMATO: 'SEM_PREFIXO', ESCONDER: 0, NEGRITO: 0 },
  { ID: 41, TIPO: 'FORMULA', ORDEM: 10, CODIGO: 'L7', FORMULA: '({3.1.02} + {3.1.01} + {3.1.04}) * [P2] / 100', CONTA_ID: 6, DRIVER_ID: RECEITA_DRIVER, CONTA_CODIGO: '3.2.02', CONTA_NOME: 'PIS/COFINS', NOME_CUSTOM: null, FORMATO: 'SEM_PREFIXO', ESCONDER: 0, NEGRITO: 0 },
];

const FIX_124 = { ...FIX_124_BASE, FORMULAS: JSON.stringify(FORMULAS) };

const BUDGET = [6, 7, 8, 9, 10, 11, 12].map((MES) => ({
  ID: 900 + MES, CICLO_ID: 132, CR_ID: CR, CONTA_ID: 1, MES, VALOR: RECEITA_MES,
}));

// Bloco PREMISSAS da SF de detalhe: uma linha por (premissa, mês).
const PREMISSAS = [
  ...Array.from({ length: 12 }, (_, i) => ({ ID: 3, NOME: ISS, ORDEM: 6, MES: i + 1, VALOR: PCT_ISS })),
  ...Array.from({ length: 12 }, (_, i) => ({ ID: 4, NOME: PIS, ORDEM: 9, MES: i + 1, VALOR: PCT_PIS })),
];

const fix125 = (premissas: any[]) => ({
  CONFIGS: JSON.stringify([
    { CR_ID: CR, CR_CODIGO: 'CR002', CONTA_ID: 1, CODIGO: '3.1.01', CONTA_NOME: 'Receita de Serviços', TIPO: 'RECEITA', DRIVER_TIPO: 'RECEITA', DRIVER_ID: RECEITA_DRIVER },
    { CR_ID: CR, CR_CODIGO: 'CR002', CONTA_ID: 2, CODIGO: '3.1.02', CONTA_NOME: 'Receita de Produtos', TIPO: 'RECEITA', DRIVER_TIPO: 'RECEITA', DRIVER_ID: RECEITA_DRIVER },
    { CR_ID: CR, CR_CODIGO: 'CR002', CONTA_ID: 5, CODIGO: '3.2.01', CONTA_NOME: 'ISS sobre Serviços', TIPO: 'IMPOSTO', DRIVER_TIPO: 'RECEITA', DRIVER_ID: RECEITA_DRIVER },
    { CR_ID: CR, CR_CODIGO: 'CR002', CONTA_ID: 6, CODIGO: '3.2.02', CONTA_NOME: 'PIS/COFINS', TIPO: 'IMPOSTO', DRIVER_TIPO: 'RECEITA', DRIVER_ID: RECEITA_DRIVER },
  ]),
  BUDGET: JSON.stringify(BUDGET),
  PREMISSAS: JSON.stringify(premissas),
  REALIZADO: '[]', REALIZADO_ATUAL: '[]', ORC_CONTROLE: '[]',
  COLABORADORES: '[]', ORCAMENTO_PESSOAL: '[]', HEADCOUNT: '[]', CONTRATACOES: '[]',
  DISSIDIOS: '[]', TURNOVERS: '[]', AUMENTOS: '[]', DESLIGAMENTOS: '[]',
  HIST_PREMISSA: '[]', CLV: '[]', OVERRIDES: '[]', IMPOSTO_CENTRAL: '[]',
  PACOTE_STATUS_ALL: '[]', PKG_BUDGET: '[]',
  STATUS: JSON.stringify([{ ID: 1, CICLO_ID: 132, CR_ID: CR, GESTOR_ID: 1, STATUS: 'PENDENTE', DRIVERS_CONFIRMADOS: '' }]),
});

const { estado, gravados } = vi.hoisted(() => ({
  estado: { premissas: [] as any[] },
  gravados: [] as any[],
}));

vi.mock('../../hooks/useMitraData', () => {
  const jsonField = (v: any): any[] => {
    if (v == null) return [];
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return []; } }
    return Array.isArray(v) ? v : [];
  };
  const byId = async (id: number) => {
    if (id === 124) return [FIX_124];
    if (id === 125) return [fix125(estado.premissas)];
    return [];
  };
  return {
    execSF: vi.fn(byId),
    execSFCached: vi.fn(byId),
    querySQL: vi.fn(async () => []),
    jsonField,
    SF_IDS: new Proxy({ hotOrcBase: 124, hotOrcDetalheCr: 125 } as Record<string, number>, {
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
  patchRecordMitra: vi.fn(async (a: any) => { gravados.push(a); return {}; }),
  createRecordMitra: vi.fn(async (a: any) => { gravados.push(a); return { ID: 5000 + gravados.length }; }),
  deleteRecordMitra: vi.fn(async () => ({})),
  createRecordsBatchMitra: vi.fn(async () => ({})),
  getVariableMitra: vi.fn(async () => ({ result: { value: null } })),
  setVariableMitra: vi.fn(async () => ({})),
}));
vi.mock('../../mitra-config', () => ({ MITRA_CONFIG: { projectId: 1 }, sessaoRealAtiva: () => true }));
vi.mock('../../lib/auth', () => ({ getUser: () => ({ NOME: 'Teste', PERFIL: 'admin' }) }));
vi.mock('../WorkflowHistorico', () => ({ default: () => null }));
vi.mock('handsontable/registry', () => ({ registerAllModules: vi.fn() }));
vi.mock('@handsontable/react-wrapper', () => ({
  HotTable: (props: any) => <div data-testid="hottable" data-dados={JSON.stringify(props.data)} />,
}));

import OrcamentoContent from '../OrcamentoContent';

const abrirReceita = async () => {
  render(<OrcamentoContent gestorId={1} selectedCR={CR} selectedPackage={null} />);
  fireEvent.click(await screen.findByRole('button', { name: /^Receita\d*%?$/ }, { timeout: 5000 }));
};

// Linhas da grade do modelo, achadas pelo rótulo da primeira coluna.
const grade = async () => {
  let dados: any[][] = [];
  await waitFor(() => {
    for (const el of screen.getAllByTestId('hottable')) {
      const d = JSON.parse(el.getAttribute('data-dados') || '[]');
      if (d.some((l: any[]) => String(l?.[0] ?? '').startsWith('3.2.01'))) { dados = d; return; }
    }
    throw new Error('grade da receita ainda não montada');
  }, { timeout: 5000 });
  return dados;
};

const linha = (dados: any[][], rotulo: string) =>
  dados.find((l) => String(l[0] ?? '').startsWith(rotulo));

// Coluna 6 = junho, primeiro mês aberto (ULTIMO_MES_REALIZADO = 5).
const COL_ABERTO = 6;

describe('Receita — a alíquota aparece como linha do modelo', () => {
  it('mostra o percentual de cada alíquota, mês a mês', async () => {
    estado.premissas = PREMISSAS;
    await abrirReceita();
    const dados = await grade();
    expect(linha(dados, ISS)![COL_ABERTO]).toBe(PCT_ISS);
    expect(linha(dados, PIS)![COL_ABERTO]).toBe(PCT_PIS);
  });

  it('calcula o imposto a partir da alíquota, sem esperar confirmação', async () => {
    estado.premissas = PREMISSAS;
    await abrirReceita();
    const dados = await grade();
    // Base = soma das receitas do CR (1.000). ISS 5% = 50; PIS/COFINS 10% = 100.
    expect(linha(dados, '3.2.01')![COL_ABERTO]).toBe(50);
    expect(linha(dados, '3.2.02')![COL_ABERTO]).toBe(100);
  });

  it('mês fechado não recebe projeção — vem do realizado', async () => {
    estado.premissas = PREMISSAS;
    await abrirReceita();
    const dados = await grade();
    expect(linha(dados, '3.2.01')![1]).toBe(0);
  });
});

describe('Receita — quando a premissa não chega, o sintoma é alíquota zerada', () => {
  it('sem o bloco PREMISSAS, a alíquota vira 0 e o imposto some', async () => {
    // Foi exatamente este o efeito do bloco PREMISSAS mal posicionado na SF do
    // link do gestor: a linha continua na tela, mas zerada, e o imposto sai 0 —
    // sem erro nenhum a denunciar a causa.
    estado.premissas = [];
    await abrirReceita();
    const dados = await grade();
    expect(linha(dados, ISS)![COL_ABERTO]).toBe(0);
    expect(linha(dados, '3.2.01')![COL_ABERTO]).toBe(0);
  });
});

describe('Receita — confirmar grava o imposto calculado', () => {
  it('materializa o valor da fórmula nos meses abertos', async () => {
    estado.premissas = PREMISSAS;
    gravados.length = 0;
    await abrirReceita();
    await grade();
    fireEvent.click(await screen.findByRole('button', { name: /Confirmar Receita/ }));

    await waitFor(() => {
      const doIss = gravados.filter((g) => g?.data && Number(g.data.CONTA_ID) === 5);
      // 7 meses abertos (6..12), todos com 50 — e nada nos meses fechados.
      expect(doIss.length).toBe(7);
      expect(new Set(doIss.map((g) => Number(g.data.VALOR)))).toEqual(new Set([50]));
    }, { timeout: 5000 });
  });
});
