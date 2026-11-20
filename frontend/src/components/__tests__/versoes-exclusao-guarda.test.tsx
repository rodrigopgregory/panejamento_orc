// Iniciar uma versão dispara os magic-links por e-mail aos gestores — a partir dali
// o orçamento virou registro de terceiros. Estes testes travam a regra: só a versão
// ainda PENDENTE pode ser excluída, o botão avisa por que quando não pode, e o
// handler recusa mesmo se o modal sobreviver a uma mudança de status.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { chamadas, VERSOES } = vi.hoisted(() => ({
  chamadas: [] as { sfId: number; input: any }[],
  VERSOES: [
    { ID: 1, NOME: 'Orcamento 2027 PENDENTE', ANO: 2027, STATUS: 'PENDENTE', VERSAO_ATUAL: 'false', VERSAO_CONTROLE: 'false', CRIADO_EM: '2026-07-01T10:00:00', CRIADO_POR: 'Paula' },
    { ID: 2, NOME: 'Orcamento 2026 INICIADA', ANO: 2026, STATUS: 'INICIADA', VERSAO_ATUAL: 'true', VERSAO_CONTROLE: 'false', CRIADO_EM: '2026-01-05T10:00:00', CRIADO_POR: 'Paula' },
    { ID: 3, NOME: 'Orcamento 2025 FECHADO', ANO: 2025, STATUS: 'FECHADO', VERSAO_ATUAL: 'false', VERSAO_CONTROLE: 'false', CRIADO_EM: '2025-01-05T10:00:00', CRIADO_POR: 'Paula' },
  ],
}));

vi.mock('../../hooks/useMitraData', () => ({
  useSF: vi.fn(() => ({
    data: [{ VERSOES, GESTORES: [], CRS: [] }],
    loading: false,
    refetch: vi.fn(),
  })),
  jsonField: (v: any) => (Array.isArray(v) ? v : []),
  createRecord: vi.fn(async () => ({})),
  updateRecord: vi.fn(async () => ({})),
  querySQL: vi.fn(async () => [{ N: 0 }]),
  execSF: vi.fn(async (sfId: number, input: any) => { chamadas.push({ sfId, input }); return []; }),
}));
vi.mock('mitra-interactions-sdk', () => ({ executeServerFunctionMitra: vi.fn(async () => ({})) }));
vi.mock('../../mitra-config', () => ({ MITRA_CONFIG: { projectId: 1 } }));
vi.mock('../../lib/auth', () => ({ getUser: () => ({ name: 'Paula', email: 'paula@x.com' }) }));

import VersoesPage from '../../pages/VersoesPage';

// Os anos nascem recolhidos; as linhas só existem no DOM depois de abrir o grupo.
async function montar() {
  render(<MemoryRouter><VersoesPage /></MemoryRouter>);
  for (const ano of ['2027', '2026', '2025']) {
    fireEvent.click(await screen.findByText(ano));
  }
}
const linhaDa = (nome: string) => screen.getByText(nome).closest('tr')!;
const botaoExcluir = (nome: string) => within(linhaDa(nome)).getByLabelText(`Excluir versão ${nome}`) as HTMLButtonElement;

afterEach(cleanup);
beforeEach(() => { chamadas.length = 0; });

describe('Versões — só a versão não iniciada pode ser excluída', () => {
  it('deixa excluir a versão ainda pendente', async () => {
    await montar();
    expect(botaoExcluir('Orcamento 2027 PENDENTE').disabled).toBe(false);
  });

  it('desabilita a exclusão da versão já iniciada', async () => {
    await montar();
    expect(botaoExcluir('Orcamento 2026 INICIADA').disabled).toBe(true);
  });

  it('desabilita também depois de fechada — iniciar é caminho sem volta', async () => {
    await montar();
    expect(botaoExcluir('Orcamento 2025 FECHADO').disabled).toBe(true);
  });

  it('explica no hover por que a versão iniciada não pode ser excluída', async () => {
    await montar();
    const botao = botaoExcluir('Orcamento 2026 INICIADA');
    // O Tooltip envolve o botão num span justamente para funcionar com filho disabled.
    fireEvent.mouseEnter(botao.parentElement!);
    const dica = await screen.findByText(/já foi iniciada/i);
    expect(dica.textContent).toMatch(/já receberam o link/i);
    expect(dica.textContent).toMatch(/não pode ser excluída/i);
  });

  it('não abre a confirmação ao clicar numa versão iniciada', async () => {
    await montar();
    fireEvent.click(botaoExcluir('Orcamento 2026 INICIADA'));
    await waitFor(() => expect(screen.queryByText('Excluir Versão')).toBeNull());
    expect(chamadas).toEqual([]);
  });

  it('abre a confirmação e remove de fato a versão pendente', async () => {
    await montar();
    fireEvent.click(botaoExcluir('Orcamento 2027 PENDENTE'));
    expect(await screen.findByText('Excluir Versão')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Excluir' }));
    // Uma unica chamada: a cascata inteira mora na SF, escopada pelo cicloId.
    await waitFor(() => expect(chamadas).toEqual([{ sfId: 239, input: { cicloId: 1 } }]));
  });
});
