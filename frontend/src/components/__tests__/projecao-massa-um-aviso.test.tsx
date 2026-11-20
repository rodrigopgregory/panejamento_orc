// UMA acao do gestor -> UM aviso na tela.
//
// A projecao da Base Historica grava um mes por vez, com await entre eles, e o
// botao "Aplicar % Unico" repete isso para TODAS as contas do modelo. Uma unica
// clicada percorria dezenas de gravacoes, e cada uma soltava a sua mensagem: o
// gestor recebia a mesma frase empilhada N vezes e a tela sumia atras dos avisos.
//
// Sao duas fontes de repeticao, e este arquivo tranca as duas:
//
//   1. "voltou a pendente" — o aviso de que editar desfez a confirmacao. Ele e o
//      efeito de UMA transicao (confirmado -> pendente) e nao pode sair de novo a
//      cada mes gravado. A trava e o confirmedDriversRef, atualizado na hora: o
//      laco roda inteiro dentro da MESMA closure, entao o state ainda traria o
//      driver confirmado por todo o percurso. So o ref responde a tempo.
//
//   2. "Projeção aplicada" — o aviso de sucesso, que era por conta. Quem aplica em
//      lote silencia as parciais e resume no fim.
//
// O teste dirige o botao de verdade, nao o metodo: e a clicada do gestor que tem
// de produzir um aviso, independente de por onde o codigo passe para chegar la.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { readFileSync } from 'fs';

afterEach(cleanup);

const fx = (n: string) => JSON.parse(readFileSync(`${process.cwd()}/src/components/__tests__/fixtures/${n}.json`, 'utf8'));
const F124 = fx('prod-cr007-sf124');
const F125_BASE = fx('prod-cr007-sf125');

// CR007 entra como PENDENTE com a Base Historica ja confirmada — o estado em que
// a projecao dispara a desconfirmacao.
const F125 = {
  ...F125_BASE,
  STATUS: JSON.stringify([{ ID: 1089, CICLO_ID: 133, CR_ID: 7, GESTOR_ID: 4, STATUS: 'PENDENTE', COMENTARIO: '', DRIVERS_CONFIRMADOS: 'BASE_HISTORICO', TOTAL_MODELOS: 4 }]),
};

const { patches } = vi.hoisted(() => ({ patches: [] as any[] }));

vi.mock('../../hooks/useMitraData', () => {
  const jsonField = (v: any): any[] => {
    if (v == null) return [];
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return []; } }
    return Array.isArray(v) ? v : [];
  };
  const byId = async (id: number) => (id === 124 ? [F124] : id === 125 ? [F125] : []);
  return {
    execSF: vi.fn(byId), execSFCached: vi.fn(byId), querySQL: vi.fn(async () => []), jsonField,
    SF_IDS: new Proxy({ hotOrcBase: 124, hotOrcDetalheCr: 125 } as Record<string, number>, { get: (t, k: string) => (k in t ? t[k] : 0) }),
    MONTHS: ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'],
    formatCurrency: (v: number) => `R$ ${Math.round(v)}`,
    getPublicOrcToken: () => null, publicOrcWrite: vi.fn(async () => ({})),
    queuePublicOrcCell: vi.fn(), queuePublicFormulaCell: vi.fn(), flushPublicOrcQueue: vi.fn(async () => {}),
    avaliarWorkflow: vi.fn(async () => ({ ok: true })), avaliarErroMsg: () => '', invalidateSFCache: vi.fn(),
  };
});
vi.mock('mitra-interactions-sdk', () => ({
  configureSdkMitra: vi.fn(),
  patchRecordMitra: vi.fn(async (a: any) => { patches.push(a); return {}; }),
  createRecordMitra: vi.fn(async () => ({ ID: 1 })), deleteRecordMitra: vi.fn(async () => ({})),
  createRecordsBatchMitra: vi.fn(async () => ({})),
  getVariableMitra: vi.fn(async () => ({ result: { value: null } })), setVariableMitra: vi.fn(async () => ({})),
}));
vi.mock('../../mitra-config', () => ({ MITRA_CONFIG: { projectId: 1 }, sessaoRealAtiva: () => true }));
vi.mock('../../lib/auth', () => ({ getUser: () => ({ NOME: 'Teste', PERFIL: 'admin' }) }));
vi.mock('../WorkflowHistorico', () => ({ default: () => null }));
vi.mock('handsontable/registry', () => ({ registerAllModules: vi.fn() }));
vi.mock('@handsontable/react-wrapper', () => ({ HotTable: () => <div data-testid="hottable" /> }));

import OrcamentoContent from '../OrcamentoContent';

const abrirBaseHistorica = async () => {
  patches.length = 0;
  render(<OrcamentoContent gestorId={4} selectedCR={7} selectedPackage={null} />);
  const aba = await screen.findByRole('button', { name: /Base Hist[oó]rica\d*%?$/ }, { timeout: 8000 });
  fireEvent.click(aba);
  // A tela so esta pronta quando as linhas de projecao aparecem.
  await waitFor(() => { expect(screen.getAllByRole('button', { name: /^Aplicar$/ }).length).toBeGreaterThan(0); }, { timeout: 8000 });
};

const patchesDeStatus = () => patches.filter((p) => p.tableName === 'ORCAMENTO_STATUS');
const avisos = (re: RegExp) => screen.queryAllByText(re).length;

describe('projecao historica em massa avisa uma vez so', () => {
  it('parte da Base Historica confirmada', async () => {
    await abrirBaseHistorica();
    expect(await screen.findByText(/Base Hist[oó]rica confirmado/)).toBeTruthy();
  });

  it('aplicar em UMA conta grava 12 meses e desconfirma uma vez', async () => {
    await abrirBaseHistorica();
    fireEvent.click(screen.getAllByRole('button', { name: /^Aplicar$/ })[0]);

    await waitFor(() => { expect(patchesDeStatus().length).toBeGreaterThan(0); }, { timeout: 8000 });
    await new Promise((r) => setTimeout(r, 400));

    // Um mes por vez, com await entre eles — mas o status e escrito UMA vez.
    expect(patchesDeStatus().length).toBe(1);
    expect(avisos(/voltou a pendente/i)).toBe(1);
  });

  it('aplicar em TODAS as contas de uma vez tambem avisa uma vez so', async () => {
    await abrirBaseHistorica();
    fireEvent.click(await screen.findByRole('button', { name: /Aplicar % [UÚ]nico/ }, { timeout: 8000 }));

    await waitFor(() => { expect(avisos(/Projeção aplicada/i)).toBeGreaterThan(0); }, { timeout: 10000 });
    await new Promise((r) => setTimeout(r, 400));

    // 3 contas x 12 meses numa clicada: um aviso de sucesso, um de desconfirmacao.
    expect(avisos(/Projeção aplicada/i)).toBe(1);
    expect(avisos(/voltou a pendente/i)).toBe(1);
    expect(patchesDeStatus().length).toBe(1);
  });
});
