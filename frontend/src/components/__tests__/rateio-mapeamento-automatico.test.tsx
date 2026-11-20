// Rateio de pacote manda no vinculo conta x setor.
//
// Antes, quem "recebia" a divisao era decidido pelo Mapeamento (CR_CONTA): setor
// com quantidade cadastrada no rateio, mas sem a conta mapeada, era descartado e os
// percentuais renormalizavam entre os demais — o setor ficava com zero e nao via o
// pacote em tela nenhuma, sem aviso. Agora dar quantidade a um setor JA o coloca no
// rateio: a sincronizacao cria o vinculo da conta.
//
// Estes testes travam o gatilho: mexer na quantidade dispara a sincronizacao, e ela
// roda DEPOIS de a quantidade estar gravada (senao sincronizaria o estado velho).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { chamadas, SF } = vi.hoisted(() => ({
  chamadas: [] as string[],
  SF: { hotRegrasBase: 131, sincronizarCrContaRateio: 243 },
}));

const CRS = [
  { ID: 1, CODIGO: 'CR001', NOME: 'COMERCIAL' },
  { ID: 2, CODIGO: 'CR002', NOME: 'LOGISTICA' },
];
const RATEIOS = [{ ID: 2, NOME: 'Pessoal', TIPO: 'QUANTIDADE', ATIVO: true }];
// CR002 ja tem quantidade; CR001 ainda nao — e nele que o teste digita.
const RATEIO_ITENS = [{ ID: 90, RATEIO_ID: 2, CR_ID: 2, QUANTIDADE: 20 }];

vi.mock('../../hooks/useMitraData', () => ({
  SF_IDS: SF,
  jsonField: (v: any) => (Array.isArray(v) ? v : []),
  useSF: vi.fn(() => ({
    data: [{
      CRS, RATEIOS, RATEIO_ITENS,
      CONTAS: [], CR_CONTAS: [], GESTORES_CR: [], DRIVERS: [], CONTA_DRIVERS: [],
      EXCECOES: [], RATEIO_USOS: [],
    }],
    loading: false,
    refetch: vi.fn(async () => { chamadas.push('refetch'); }),
  })),
  createRecord: vi.fn(async (tabela: string) => { chamadas.push(`create:${tabela}`); }),
  updateRecord: vi.fn(async (tabela: string) => { chamadas.push(`update:${tabela}`); }),
  removeRecord: vi.fn(async () => {}),
  batchCreate: vi.fn(async () => {}),
  querySQL: vi.fn(async () => []),
  execSF: vi.fn(async (id: number) => { chamadas.push(`sf:${id}`); return []; }),
}));

vi.mock('../../pages/ModelagemPage', () => ({ default: () => null }));

import RegraContabilPage from '../../pages/RegraContabilPage';

const montar = () => render(
  <MemoryRouter initialEntries={['/regras-contabeis?tab=rateio']}><RegraContabilPage /></MemoryRouter>
);

// As quantidades so aparecem com o rateio expandido. O input de um (rateio, setor)
// e o campo de texto na linha daquele setor.
const inputDoSetor = async (crCodigo: string) => {
  fireEvent.click(await screen.findByRole('button', { name: /Expandir Pessoal/i }));
  const linha = (await screen.findByText(crCodigo)).closest('tr')!;
  return linha.querySelector('input[inputmode="decimal"]') as HTMLInputElement;
};

afterEach(cleanup);
beforeEach(() => { chamadas.length = 0; });

describe('rateio — dar quantidade a um setor cria o vínculo da conta', () => {
  it('sincroniza o mapeamento ao salvar a quantidade de um setor novo', async () => {
    montar();
    const input = await inputDoSetor('CR001');
    fireEvent.change(input, { target: { value: '4' } });
    fireEvent.blur(input);

    await waitFor(() => expect(chamadas).toContain(`sf:${SF.sincronizarCrContaRateio}`));
    // A quantidade e gravada ANTES: sincronizar antes leria o estado velho e o
    // setor continuaria de fora da divisao.
    expect(chamadas.indexOf('create:RATEIO_ITEM'))
      .toBeLessThan(chamadas.indexOf(`sf:${SF.sincronizarCrContaRateio}`));
  });

  it('sincroniza também ao alterar a quantidade de um setor que já participava', async () => {
    montar();
    const input = await inputDoSetor('CR002');
    fireEvent.change(input, { target: { value: '25' } });
    fireEvent.blur(input);

    await waitFor(() => expect(chamadas).toContain(`sf:${SF.sincronizarCrContaRateio}`));
    expect(chamadas.indexOf('update:RATEIO_ITEM'))
      .toBeLessThan(chamadas.indexOf(`sf:${SF.sincronizarCrContaRateio}`));
  });

  it('não sincroniza quando a quantidade não mudou — nada a propagar', async () => {
    montar();
    const input = await inputDoSetor('CR002');
    fireEvent.change(input, { target: { value: '20' } });
    fireEvent.blur(input);

    await waitFor(() => expect(chamadas).toEqual([]));
  });

  it('a lista é recarregada depois da sincronização, para a tela já mostrar o vínculo novo', async () => {
    montar();
    const input = await inputDoSetor('CR001');
    fireEvent.change(input, { target: { value: '4' } });
    fireEvent.blur(input);

    await waitFor(() => expect(chamadas).toContain('refetch'));
    expect(chamadas.indexOf(`sf:${SF.sincronizarCrContaRateio}`))
      .toBeLessThan(chamadas.indexOf('refetch'));
  });
});
