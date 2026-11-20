// O sino de "Pontos de atencao" do Mapeamento avisa que existe conta sem setor.
// Aviso pintado com a cor de marca some no meio da tela — quando ha o que resolver,
// ele precisa vestir a familia de alerta.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { SF } = vi.hoisted(() => ({ SF: { hotRegrasBase: 131 } }));

const CRS = [
  { ID: 1, CODIGO: 'CR001', NOME: 'COMERCIAL' },
  { ID: 2, CODIGO: 'CR002', NOME: 'LOGISTICA' },
];
const CONTAS = [
  { ID: 10, CODIGO: '4.01.001', NOME: 'SALARIOS', TIPO: 'DESPESA_PESSOAL' },
  { ID: 11, CODIGO: '4.02.001', NOME: 'FRETES', TIPO: 'DESPESA_OPERACIONAL' },
];
// Salarios esta em Comercial; Fretes nao esta em setor nenhum — logo, ha alerta.
const CR_CONTAS = [{ ID: 900, CR_ID: 1, CONTA_ID: 10, ATIVO: true }];

vi.mock('../../hooks/useMitraData', () => ({
  SF_IDS: SF,
  jsonField: (v: any) => (Array.isArray(v) ? v : []),
  useSF: vi.fn(() => ({
    data: [{
      CRS, CONTAS, CR_CONTAS,
      GESTORES_CR: [], DRIVERS: [], CONTA_DRIVERS: [],
      EXCECOES: [], RATEIOS: [], RATEIO_ITENS: [], RATEIO_USOS: [],
    }],
    loading: false,
    refetch: vi.fn(),
  })),
  createRecord: vi.fn(async () => {}),
  removeRecord: vi.fn(async () => {}),
  batchCreate: vi.fn(async () => {}),
  updateRecord: vi.fn(async () => {}),
  querySQL: vi.fn(async () => []),
  execSF: vi.fn(async () => []),
}));

// A aba "modelo" monta a Modelagem inteira; fora do escopo deste teste.
vi.mock('../../pages/ModelagemPage', () => ({ default: () => null }));

import RegraContabilPage from '../../pages/RegraContabilPage';

afterEach(cleanup);

describe('Mapeamento — "Pontos de atenção" veste a cor de atenção', () => {
  it('usa a família laranja de alerta, não a cor de marca roxa', async () => {
    render(<MemoryRouter initialEntries={['/regras-contabeis?tab=cr']}><RegraContabilPage /></MemoryRouter>);
    const botao = await screen.findByTitle('Pontos de atenção');
    const estilo = botao.getAttribute('style') || '';
    expect(estilo).toMatch(/--color-alerta/);
    expect(estilo).not.toMatch(/--color-primary/);
  });
});
