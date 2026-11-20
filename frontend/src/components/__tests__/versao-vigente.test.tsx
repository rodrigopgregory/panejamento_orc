// O botao "Tornar atual" nao valia nada nas telas que mostram dado: Dashboard e DRE
// liam a marca VERSAO_ATUAL, mas Orcamento, Preenchimento, Folha e Workflow pegavam
// "a primeira versao nao fechada". Quando nenhuma versao ficava aberta (criar versao
// fecha a anterior, e excluir a nova nao reabre ninguem) essas telas recebiam lista
// vazia e renderizavam em branco.
//
// Estes testes travam as duas metades da regra nova: a marca decide qual versao abre,
// e versao fechada entra somente para consulta.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { escolherVersaoVigente, versaoEhFechada, rotuloVersao } from '../../lib/versao-vigente';

const FECHADA_ATUAL = { ID: 133, NOME: 'Forecast 2026 (5+7)', ANO: 2026, STATUS: 'FECHADO', VERSAO_ATUAL: 'true' };
const ABERTA = { ID: 140, NOME: 'Orcamento 2027', ANO: 2027, STATUS: 'PENDENTE', VERSAO_ATUAL: 'false' };
const FECHADA = { ID: 49, NOME: 'Versao 2025', ANO: 2025, STATUS: 'FECHADO', VERSAO_ATUAL: 'false' };

describe('escolherVersaoVigente', () => {
  it('prefere a versao marcada como atual, mesmo que nao seja a primeira da lista', () => {
    expect(escolherVersaoVigente([ABERTA, FECHADA_ATUAL, FECHADA])).toBe(133);
  });

  it('abre a versao marcada como atual mesmo quando ela esta fechada', () => {
    // O caso que quebrou: so restavam versoes fechadas e as telas nao abriam nenhuma.
    expect(escolherVersaoVigente([FECHADA_ATUAL, FECHADA])).toBe(133);
  });

  it('sem nenhuma marcada, cai na primeira da lista', () => {
    expect(escolherVersaoVigente([ABERTA, FECHADA])).toBe(140);
  });

  it('sem versao nenhuma devolve null em vez de estourar', () => {
    expect(escolherVersaoVigente([])).toBeNull();
    expect(escolherVersaoVigente(undefined as any)).toBeNull();
  });
});

describe('versaoEhFechada', () => {
  it('acusa fechada a versao atual fechada', () => {
    expect(versaoEhFechada([FECHADA_ATUAL, ABERTA], 133)).toBe(true);
  });

  it('nao acusa fechada uma versao em andamento', () => {
    expect(versaoEhFechada([FECHADA_ATUAL, ABERTA], 140)).toBe(false);
  });

  it('sem versao selecionada nao trava nada', () => {
    expect(versaoEhFechada([FECHADA_ATUAL], null)).toBe(false);
  });

  it('id que nao esta na lista nao e tratado como fechado', () => {
    expect(versaoEhFechada([ABERTA], 999)).toBe(false);
  });
});

describe('rotuloVersao', () => {
  it('marca a fechada para o usuario saber que e consulta', () => {
    expect(rotuloVersao(FECHADA_ATUAL)).toBe('Forecast 2026 (5+7) (Fechada)');
  });

  it('deixa a versao em andamento com o nome limpo', () => {
    expect(rotuloVersao(ABERTA)).toBe('Orcamento 2027');
  });
});

// --- Workflow: a versao atual fechada abre para consulta, sem acao de aprovacao ---

const { baseCiclos, avaliar } = vi.hoisted(() => ({
  baseCiclos: [] as any[],
  avaliar: vi.fn(async () => ({ ok: true })),
}));

vi.mock('../../hooks/useMitraData', () => ({
  SF_IDS: { baseCiclos: 80, kanbanGestores: 92, kanbanStatusCrs: 93, kanbanStatusPacotes: 94, kanbanModelosPorCiclo: 95, kanbanPacoteTotais: 96, auditoriaWorkflow: 173 },
  execSFCached: vi.fn(async (sfId: number) => (sfId === 80 ? baseCiclos : [])),
  execSF: vi.fn(async () => []),
  avaliarWorkflow: avaliar,
  avaliarErroMsg: () => 'erro',
}));
vi.mock('../../lib/auth', () => ({ getUser: () => ({ NOME: 'Paula', PERFIL: 'admin' }), PERFIL_TO_GESTOR_ID: {} }));

import WorkflowPage from '../../pages/WorkflowPage';

describe('WorkflowPage com a versao atual fechada', () => {
  beforeEach(() => {
    baseCiclos.length = 0;
    avaliar.mockClear();
  });
  afterEach(cleanup);

  it('abre a versao atual fechada em vez de ficar sem versao nenhuma', async () => {
    // Antes, o filtro client-side descartava toda versao FECHADO e a tela ficava vazia.
    baseCiclos.push(FECHADA_ATUAL, FECHADA);
    render(<MemoryRouter><WorkflowPage /></MemoryRouter>);
    await waitFor(() => {
      expect(screen.getByText(/Forecast 2026 \(5\+7\) \(Fechada\)/)).toBeTruthy();
    });
  });

  it('continua descartando versoes fechadas que nao sao a atual', async () => {
    // A fechada e a mais recente e vem primeiro (a SF ordena por ANO desc). Se o
    // filtro passasse a aceitar qualquer fechada, ela seria a escolhida e o badge
    // diria "(Fechada)". A tela tem que pular direto para a versao em andamento.
    const FECHADA_RECENTE = { ID: 150, NOME: 'Encerrada 2028', ANO: 2028, STATUS: 'FECHADO', VERSAO_ATUAL: 'false' };
    baseCiclos.push(FECHADA_RECENTE, ABERTA);
    render(<MemoryRouter><WorkflowPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText(/Orcamento 2027/)).toBeTruthy());
    expect(screen.queryByText(/Encerrada 2028/)).toBeNull();
    expect(screen.queryByText(/\(Fechada\)/)).toBeNull();
  });
});
