// A tela de Auditoria deixou de ser um feed pra virar ferramenta de
// investigacao. Estes testes travam o que essa mudanca precisa entregar:
// achar o evento (busca e filtros que viram chips removiveis), entender o que
// aconteceu (painel com autor, origem, situacao anterior/nova e motivo),
// seguir o fluxo relacionado do mesmo objeto, e exportar o resultado filtrado.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent, within } from '@testing-library/react';

afterEach(cleanup);

// vi.mock e icado pro topo do arquivo, entao tudo que a factory le precisa
// nascer aqui dentro — inclusive o mapa de IDs.
const { chamadas, csvBaixado, SF } = vi.hoisted(() => ({
  chamadas: [] as { sfId: number; input: any }[],
  csvBaixado: [] as { nome: string; linhas: unknown[][] }[],
  SF: { baseCiclos: 80, auditoriaGeral: 174, auditoriaFluxo: 232, auditoriaAutores: 233 },
}));

// Trilha minima que cobre o caso de investigacao: o CR 5 foi submetido pelo
// portal externo, reprovado com motivo, reaberto e reenviado.
const EVENTOS = [
  {
    ID: 40, CICLO_ID: 133, CICLO_NOME: 'Orçamento 2026: 0+12', TIPO: 'CR', EVENTO: 'SUBMETIDO',
    STATUS_DE: 'REABERTO', STATUS_PARA: 'SUBMETIDO', COMENTARIO: null, AUTOR: 'Juliana Costa',
    ORIGEM: 'LINK', CRIADO_EM: '2026-07-15T11:20:00', CR_ID: 5, DRIVER_ID: null,
    ALVO: 'CR005 - Marketing', TOTAL_FILTRADO: 3,
  },
  {
    ID: 39, CICLO_ID: 133, CICLO_NOME: 'Orçamento 2026: 0+12', TIPO: 'CR', EVENTO: 'REPROVADO',
    STATUS_DE: 'SUBMETIDO', STATUS_PARA: 'REPROVADO',
    COMENTARIO: 'Benefícios acima do teto aprovado para 2026 — revisar as premissas.',
    AUTOR: 'Paula', ORIGEM: 'APP', CRIADO_EM: '2026-07-14T10:15:00', CR_ID: 5, DRIVER_ID: null,
    ALVO: 'CR005 - Marketing', TOTAL_FILTRADO: 3,
  },
  {
    ID: 38, CICLO_ID: 133, CICLO_NOME: 'Orçamento 2026: 0+12', TIPO: 'PACOTE', EVENTO: 'SUBMETIDO',
    STATUS_DE: 'CONFIRMADO', STATUS_PARA: 'SUBMETIDO', COMENTARIO: null, AUTOR: 'Aliny Ferreira',
    ORIGEM: 'LINK', CRIADO_EM: '2026-07-14T09:00:00', CR_ID: null, DRIVER_ID: 24,
    ALVO: 'Pacote Viagens', TOTAL_FILTRADO: 3,
  },
];

const FLUXO_CR5 = [
  { ID: 37, EVENTO: 'SUBMETIDO', STATUS_DE: 'CONFIRMADO', STATUS_PARA: 'SUBMETIDO', COMENTARIO: null, AUTOR: 'Juliana Costa', ORIGEM: 'LINK', CRIADO_EM: '2026-07-13T08:00:00' },
  { ID: 39, EVENTO: 'REPROVADO', STATUS_DE: 'SUBMETIDO', STATUS_PARA: 'REPROVADO', COMENTARIO: 'Benefícios acima do teto aprovado para 2026 — revisar as premissas.', AUTOR: 'Paula', ORIGEM: 'APP', CRIADO_EM: '2026-07-14T10:15:00' },
  { ID: 40, EVENTO: 'SUBMETIDO', STATUS_DE: 'REABERTO', STATUS_PARA: 'SUBMETIDO', COMENTARIO: null, AUTOR: 'Juliana Costa', ORIGEM: 'LINK', CRIADO_EM: '2026-07-15T11:20:00' },
];

vi.mock('../../hooks/useMitraData', () => ({
  SF_IDS: SF,
  sqlEscape: (v: string) => String(v ?? '').replace(/\\/g, '').replace(/'/g, "''"),
  execSFCached: vi.fn(async (sfId: number, input: any = {}) => {
    chamadas.push({ sfId, input });
    if (sfId === SF.baseCiclos) return [{ ID: 133, NOME: 'Orçamento 2026: 0+12' }];
    if (sfId === SF.auditoriaAutores) return [{ AUTOR: 'Aliny Ferreira' }, { AUTOR: 'Juliana Costa' }, { AUTOR: 'Paula' }];
    return [];
  }),
  execSF: vi.fn(async (sfId: number, input: any = {}) => {
    chamadas.push({ sfId, input });
    if (sfId === SF.auditoriaFluxo) return FLUXO_CR5;
    if (sfId === SF.auditoriaGeral) {
      let rows = EVENTOS;
      if (input.evento) rows = rows.filter((r) => r.EVENTO === input.evento);
      if (input.tipo) rows = rows.filter((r) => r.TIPO === input.tipo);
      if (input.origem) rows = rows.filter((r) => r.ORIGEM === input.origem);
      if (input.autor) rows = rows.filter((r) => r.AUTOR === input.autor);
      if (input.busca) {
        const b = input.busca.toLowerCase();
        rows = rows.filter((r) => [r.ALVO, r.AUTOR, r.COMENTARIO].some((c) => (c || '').toLowerCase().includes(b)));
      }
      return rows.map((r) => ({ ...r, TOTAL_FILTRADO: rows.length }));
    }
    return [];
  }),
}));

vi.mock('../../lib/csv', () => ({
  baixarCsv: vi.fn((nome: string, linhas: unknown[][]) => { csvBaixado.push({ nome, linhas }); }),
}));

import AuditoriaPage from '../../pages/AuditoriaPage';

const ultimaConsulta = () => [...chamadas].reverse().find((c) => c.sfId === SF.auditoriaGeral)!;

beforeEach(() => { chamadas.length = 0; csvBaixado.length = 0; });

describe('Auditoria — localizar o evento', () => {
  it('mostra a contagem de eventos encontrados no cabeçalho', async () => {
    render(<AuditoriaPage />);
    expect(await screen.findByText('3 eventos')).toBeTruthy();
    expect(screen.getByText(/Histórico de eventos, decisões e alterações/)).toBeTruthy();
  });

  it('agrupa a lista por dia em vez de repetir a data em cada linha', async () => {
    render(<AuditoriaPage />);
    // O CR aparece em duas linhas — é justamente por isso que a data não pode
    // se repetir linha a linha.
    expect((await screen.findAllByText('CR005 - Marketing')).length).toBe(2);
    // Dois dias distintos na trilha (15/07 e 14/07) => dois cabeçalhos.
    expect(screen.getAllByText(/de julho de 2026/).length).toBe(2);
  });

  it('a busca chega na consulta e vira chip removível', async () => {
    render(<AuditoriaPage />);
    await screen.findByText('3 eventos');

    fireEvent.change(screen.getByLabelText('Buscar eventos'), { target: { value: 'benefícios' } });
    await waitFor(() => expect(ultimaConsulta().input.busca).toBe('benefícios'), { timeout: 2000 });
    await screen.findByText('1 evento');

    const chip = await screen.findByText('benefícios');
    fireEvent.click(within(chip.parentElement!).getByLabelText('Remover filtro Busca'));
    await waitFor(() => expect(ultimaConsulta().input.busca).toBe(''), { timeout: 2000 });
    await screen.findByText('3 eventos');
  });

  it('filtro de evento reduz o resultado e "Limpar tudo" devolve ao estado inicial', async () => {
    render(<AuditoriaPage />);
    await screen.findByText('3 eventos');

    fireEvent.click(screen.getByText('Todos os eventos'));
    fireEvent.click(await screen.findByText('Reprovações'));
    await waitFor(() => expect(ultimaConsulta().input.evento).toBe('REPROVADO'));
    expect(await screen.findByText('1 evento')).toBeTruthy();

    fireEvent.click(screen.getByText('Limpar tudo'));
    await waitFor(() => expect(ultimaConsulta().input.evento).toBe(''));
    expect(await screen.findByText('3 eventos')).toBeTruthy();
  });

  it('origem e responsável ficam em "Mais filtros" e também viram chips', async () => {
    render(<AuditoriaPage />);
    await screen.findByText('3 eventos');

    // Escondidos até abrir o painel avançado.
    expect(screen.queryByText('Todas as origens')).toBeNull();
    fireEvent.click(screen.getByText('Mais filtros'));

    fireEvent.click(await screen.findByText('Todas as origens'));
    // "Portal externo" também rotula a origem nas linhas da lista; pegar a
    // ocorrência que é opção do dropdown.
    const opcao = (await screen.findAllByText('Portal externo'))
      .map((el) => el.closest('button[data-opt-idx]'))
      .find(Boolean)!;
    fireEvent.click(opcao);
    await waitFor(() => expect(ultimaConsulta().input.origem).toBe('LINK'));
    expect(await screen.findByText('2 eventos')).toBeTruthy();
  });

  it('um período sem eventos mostra o estado vazio com saída para limpar', async () => {
    render(<AuditoriaPage />);
    await screen.findByText('3 eventos');

    fireEvent.change(screen.getByLabelText('Buscar eventos'), { target: { value: 'não existe' } });
    expect(await screen.findByText(/Nenhum evento encontrado com os filtros aplicados/)).toBeTruthy();
    expect(screen.getByText('Limpar os filtros')).toBeTruthy();
  });
});

describe('Auditoria — entender e investigar o evento', () => {
  it('o painel abre com autor, origem, transição de situação e motivo', async () => {
    render(<AuditoriaPage />);
    fireEvent.click(await screen.findByText('Reprovado'));

    const painel = await screen.findByText('Motivo da reprovação');
    const corpo = painel.closest('div')!.parentElement!;
    expect(within(corpo).getByText(/Benefícios acima do teto/)).toBeTruthy();
    expect(within(corpo).getByText('Paula')).toBeTruthy();
    expect(within(corpo).getByText('Aplicativo')).toBeTruthy();
    // Situação anterior -> nova, o par que a auditoria precisa ver.
    expect(within(corpo).getByText('Alteração de situação')).toBeTruthy();
    expect(within(corpo).getAllByText('Submetido').length).toBeGreaterThan(0);
    // CRIADO_EM e gravado em UTC ('2026-07-14T10:15:00') e a tela mostra o relogio
    // de quem esta olhando — 07:15 no fuso da suite (America/Sao_Paulo).
    expect(within(corpo).getByText('14 de julho de 2026, 07:15')).toBeTruthy();
    expect(within(corpo).getByText('#39')).toBeTruthy();
  });

  it('o painel traz o fluxo completo do mesmo objeto no ciclo', async () => {
    render(<AuditoriaPage />);
    fireEvent.click(await screen.findByText('Reprovado'));

    await screen.findByText('Fluxo relacionado');
    await waitFor(() => expect(chamadas.some((c) => c.sfId === SF.auditoriaFluxo)).toBe(true));
    // Consulta o objeto (CR 5 no ciclo 133), não o evento isolado.
    const fx = chamadas.find((c) => c.sfId === SF.auditoriaFluxo)!;
    expect(fx.input).toEqual({ cicloId: 133, tipo: 'CR', crId: 5, driverId: 0 });
    expect(await screen.findByText(/3 eventos de CR005 - Marketing/)).toBeTruthy();
  });

  it('navegar pelo fluxo troca o evento exibido sem reconsultar o fluxo', async () => {
    render(<AuditoriaPage />);
    fireEvent.click(await screen.findByText('Reprovado'));
    await screen.findByText(/3 eventos de CR005 - Marketing/);
    const consultasFluxo = chamadas.filter((c) => c.sfId === SF.auditoriaFluxo).length;

    // A primeira submissão do fluxo (13/07) não está na lista da página.
    fireEvent.click(screen.getAllByText('Submissão')[0]);
    expect(await screen.findByText('#37')).toBeTruthy();
    expect(chamadas.filter((c) => c.sfId === SF.auditoriaFluxo).length).toBe(consultasFluxo);
  });

  it('pacote consulta o fluxo pelo driver, não pelo CR', async () => {
    render(<AuditoriaPage />);
    fireEvent.click(await screen.findByText('Pacote Viagens'));
    await waitFor(() => expect(chamadas.some((c) => c.sfId === SF.auditoriaFluxo)).toBe(true));
    const fx = chamadas.find((c) => c.sfId === SF.auditoriaFluxo)!;
    expect(fx.input).toEqual({ cicloId: 133, tipo: 'PACOTE', crId: 0, driverId: 24 });
  });

  it('clicar de novo no mesmo evento fecha o painel', async () => {
    render(<AuditoriaPage />);
    const linha = await screen.findByText('Reprovado');
    fireEvent.click(linha);
    await screen.findByText('Motivo da reprovação');
    fireEvent.click(linha);
    await waitFor(() => expect(screen.queryByText('Motivo da reprovação')).toBeNull());
  });
});

describe('Auditoria — exportar', () => {
  it('exporta o resultado filtrado, não só a página visível', async () => {
    render(<AuditoriaPage />);
    await screen.findByText('3 eventos');

    fireEvent.click(screen.getByText('Todos os eventos'));
    fireEvent.click(await screen.findByText('Reprovações'));
    await screen.findByText('1 evento');

    fireEvent.click(screen.getByText('Exportar CSV'));
    await waitFor(() => expect(csvBaixado.length).toBe(1));

    const consultaExport = ultimaConsulta();
    expect(consultaExport.input.offset).toBe(0);
    expect(consultaExport.input.limit).toBeGreaterThan(25);
    expect(consultaExport.input.evento).toBe('REPROVADO');

    const { nome, linhas } = csvBaixado[0];
    expect(nome.startsWith('auditoria-')).toBe(true);
    expect(linhas[0]).toEqual([
      'ID', 'Data e hora', 'Ciclo', 'Objeto', 'Natureza', 'Evento',
      'Situação anterior', 'Nova situação', 'Responsável', 'Origem', 'Comentário',
    ]);
    // Valores traduzidos para leitura humana, não os códigos do banco — inclusive
    // a hora, exportada no fuso do usuário e não no UTC cru do banco (10:15 -> 07:15).
    expect(linhas[1]).toEqual([
      39, '14/07/2026 07:15', 'Orçamento 2026: 0+12', 'CR005 - Marketing',
      'Centro de resultado', 'Reprovado', 'Submetido', 'Reprovado', 'Paula',
      'Aplicativo', 'Benefícios acima do teto aprovado para 2026 — revisar as premissas.',
    ]);
  });
});

describe('Auditoria — ajuda da tela', () => {
  it('lista os eventos que a trilha registra e orienta como pedir um novo', async () => {
    render(<AuditoriaPage />);
    await screen.findByText('3 eventos');

    // Nasce fechada: a ajuda nao pode competir com o conteudo da tela.
    expect(screen.queryByText('O que a auditoria registra')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Ajuda/ }));

    const painel = (await screen.findByText('O que a auditoria registra')).closest('div')!.parentElement!;
    // Os seis eventos que o sistema grava hoje, com o mesmo rotulo do filtro.
    for (const rotulo of [
      'Submetido para aprovação', 'Aprovado', 'Reprovado',
      'Reaberto para avaliação', 'Modelo confirmado', 'Confirmação desfeita',
    ]) {
      expect(within(painel).getByText(rotulo)).toBeTruthy();
    }
    expect(within(painel).getByText(/IA de desenvolvimento/)).toBeTruthy();
  });

  it('fecha a ajuda com Escape', async () => {
    render(<AuditoriaPage />);
    await screen.findByText('3 eventos');
    fireEvent.click(screen.getByRole('button', { name: /Ajuda/ }));
    await screen.findByText('O que a auditoria registra');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByText('O que a auditoria registra')).toBeNull());
  });
});
