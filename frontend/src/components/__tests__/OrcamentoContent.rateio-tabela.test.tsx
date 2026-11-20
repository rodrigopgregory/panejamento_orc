// Tela do PACOTE: o gestor lanca UM total na linha com rateio e o sistema reparte
// entre os setores. Sem uma tabela dessa divisao, ele so descobre quanto foi para
// cada CR entrando setor a setor. Estes testes travam a tabela de rateio: que ela
// aparece, que mostra os setores com o percentual certo, e que a soma das parcelas
// fecha exatamente no total lancado (nao pode sumir nem sobrar dinheiro).
//
// Fixtures REAIS (SF 124/126 capturadas do ambiente): o rateio "Pessoal" tem
// quantidade para os CRs 1..8, mas so 2,4,6,7,8 tem a conta 4.1.5 mapeada — os
// percentuais renormalizam sobre esses 5 (20+4+3+3+4 = 34).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import { readFileSync } from 'fs';

afterEach(cleanup);

const fx = (name: string) =>
  JSON.parse(readFileSync(`${process.cwd()}/src/components/__tests__/fixtures/${name}.json`, 'utf8'));
const FIX_124 = fx('sf124-hotOrcBase');
const FIX_126_BASE = fx('sf126-hotOrcDetalhePkg');

// O ciclo da fixture tem ULTIMO_MES_REALIZADO=5, entao mes 1..5 sao fechados (a
// tabela mostra realizado neles, igual a grade). Lancamos num mes ABERTO: 8.
const MES_ABERTO = 8;
const COL_MES_ABERTO = 8; // ano fiscal = ano civil nesta fixture
// Total de 3.400 ja distribuido como o sistema distribui: 20/4/3/3/4 de 34.
const TOTAL_LANCADO = 3400;
const BUDGET_ABERTO = [
  { CONTA_ID: 33, MES: MES_ABERTO, CR_ID: 2, VALOR: 2000 },
  { CONTA_ID: 33, MES: MES_ABERTO, CR_ID: 4, VALOR: 400 },
  { CONTA_ID: 33, MES: MES_ABERTO, CR_ID: 6, VALOR: 300 },
  { CONTA_ID: 33, MES: MES_ABERTO, CR_ID: 7, VALOR: 300 },
  { CONTA_ID: 33, MES: MES_ABERTO, CR_ID: 8, VALOR: 400 },
];
const FIX_126 = { ...FIX_126_BASE, BUDGET: JSON.stringify(BUDGET_ABERTO) };

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
// Stub do Handsontable que EXPOE os dados — e o conteudo da tabela que importa aqui.
vi.mock('@handsontable/react-wrapper', () => ({
  HotTable: (props: any) => (
    <div data-testid="hottable" data-cls={props.className} data-dados={JSON.stringify(props.data)} />
  ),
}));

import OrcamentoContent from '../OrcamentoContent';

const montarPacote = () => render(
  <OrcamentoContent
    gestorId={1}
    selectedCR={null}
    selectedPackage={{ ID: 24, NOME: 'CUSTOS_DE_SOFTWARE', GESTOR_ID: 1 }}
  />
);

// Acha a grade cuja primeira coluna tem os rotulos de setor (a tabela de rateio),
// diferenciando-a da grade de lancamento do modelo.
const acharTabelaRateio = () => {
  const grades = screen.getAllByTestId('hottable');
  for (const g of grades) {
    const dados = JSON.parse(g.getAttribute('data-dados') || '[]');
    if (dados.some((l: any[]) => String(l?.[0] ?? '').startsWith('CR002'))) return dados as any[][];
  }
  return null;
};

const linhaDo = (dados: any[][], crCodigo: string) =>
  dados.find((l) => String(l[0] ?? '').startsWith(crCodigo));

describe('tela do pacote — tabela do valor rateado por setor', () => {
  it('mostra a tabela identificando a conta e o rateio que a divide', async () => {
    montarPacote();
    await screen.findByText(/valor rateado por setor/i, {}, { timeout: 5000 });
    // O chip acima da tabela tambem cita o rateio — aqui basta que a tabela o nomeie.
    expect(screen.getAllByText(/rateio Pessoal/i).length).toBeGreaterThan(0);
    // A linha rateada aparece como titulo da tabela, com o mesmo rotulo que ela
    // tem na grade de lancamento (codigo da conta + nome da linha do modelo).
    const cabecalho = screen.getByText(/valor rateado por setor/i).parentElement!;
    expect(cabecalho.textContent).toContain('4.1.5 - Software');
  });

  it('lista os setores que recebem, com o percentual renormalizado', async () => {
    montarPacote();
    await screen.findByText(/valor rateado por setor/i, {}, { timeout: 5000 });
    await waitFor(() => expect(acharTabelaRateio()).toBeTruthy());
    const dados = acharTabelaRateio()!;

    // Os 5 CRs com a conta mapeada entram; os que nao tem a conta (CR001/3/5) nao.
    for (const cr of ['CR002', 'CR004', 'CR006', 'CR007', 'CR008']) {
      expect(linhaDo(dados, cr), `${cr} deveria aparecer`).toBeTruthy();
    }
    expect(linhaDo(dados, 'CR001')).toBeFalsy();

    // Percentual renormalizado sobre 34 (e nao sobre os 43 do cadastro do rateio).
    expect(String(linhaDo(dados, 'CR002')![0])).toContain('58.8%');
    expect(String(linhaDo(dados, 'CR004')![0])).toContain('11.8%');
    expect(String(linhaDo(dados, 'CR006')![0])).toContain('8.8%');
    // O nome do setor acompanha o codigo — o gestor le "quem", nao um ID.
    expect(String(linhaDo(dados, 'CR002')![0])).toContain('Diretoria de Tecnologia');
  });

  it('reparte o total lançado e fecha a soma sem perder centavo', async () => {
    montarPacote();
    await screen.findByText(/valor rateado por setor/i, {}, { timeout: 5000 });
    await waitFor(() => expect(acharTabelaRateio()).toBeTruthy());
    const dados = acharTabelaRateio()!;
    const c = COL_MES_ABERTO;

    // Cada setor recebe sua fatia do total de 3.400 lancado no mes aberto.
    expect(linhaDo(dados, 'CR002')![c]).toBe(2000);
    expect(linhaDo(dados, 'CR004')![c]).toBe(400);
    expect(linhaDo(dados, 'CR006')![c]).toBe(300);
    expect(linhaDo(dados, 'CR007')![c]).toBe(300);
    expect(linhaDo(dados, 'CR008')![c]).toBe(400);

    // A linha de total fecha exatamente no que foi lancado — dinheiro nao some
    // no arredondamento nem e criado.
    const total = dados.find((l) => String(l[0]) === 'Total rateado')!;
    expect(total[c]).toBe(TOTAL_LANCADO);
    const somaSetores = dados
      .filter((l) => String(l[0]) !== 'Total rateado')
      .reduce((s, l) => s + Number(l[c] || 0), 0);
    expect(somaSetores).toBe(TOTAL_LANCADO);
  });

  it('mês fechado mostra o realizado do próprio setor, não uma divisão do orçado', async () => {
    montarPacote();
    await screen.findByText(/valor rateado por setor/i, {}, { timeout: 5000 });
    await waitFor(() => expect(acharTabelaRateio()).toBeTruthy());
    const dados = acharTabelaRateio()!;

    // Mes 1 e fechado (ULTIMO_MES_REALIZADO=5) e nao recebeu lancamento nenhum
    // nesta fixture — se a tabela dividisse o orcado, daria 0 em todo mundo.
    const somaMes1 = dados
      .filter((l) => String(l[0]) !== 'Total rateado')
      .reduce((s, l) => s + Number(l[1] || 0), 0);
    expect(somaMes1).toBeGreaterThan(0);
  });

  it('a tabela é somente leitura — quem edita é a grade de lançamento', async () => {
    montarPacote();
    await screen.findByText(/valor rateado por setor/i, {}, { timeout: 5000 });
    await waitFor(() => expect(acharTabelaRateio()).toBeTruthy());
    // Uma linha por setor + a linha de total; nada de linha editavel extra.
    const dados = acharTabelaRateio()!;
    expect(dados.length).toBe(6);
    expect(String(dados[dados.length - 1][0])).toBe('Total rateado');
  });
});
