// Experiencia guiada na lista de estudos: quem chega ao Playground sem a
// credencial compartilhada da empresa precisa saber ANTES de criar um estudo.
// Sem o aviso o caminho era: criar o estudo, escrever a pergunta, esperar, e so
// entao descobrir que o analista nao responde — sem pista de onde se resolve.
//
// O destino e a Governanca de IA, que exige sessao de login real. Por isso o
// aviso muda de forma: quem esta logado ganha o atalho; sem identidade, o aviso
// vira a instrucao de acionar quem administra — em vez de um botao que so
// devolveria a pessoa para a tela inicial.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { estado, navegou } = vi.hoisted(() => ({
  estado: {
    usuario: { EMAIL: 'ana@empresa.com' } as { EMAIL: string } | null,
    diagnostico: { temCompartilhada: false, temPessoal: false } as
      { temCompartilhada: boolean; temPessoal: boolean },
  },
  navegou: [] as string[],
}));

vi.mock('react-router-dom', async () => {
  const real = await vi.importActual<any>('react-router-dom');
  return { ...real, useNavigate: () => (destino: string) => { navegou.push(destino); } };
});

vi.mock('../../lib/auth', () => ({
  getUser: () => estado.usuario,
}));

vi.mock('../../lib/playground', () => ({
  diagnosticarCredencial: vi.fn(async () => estado.diagnostico),
  pgListar: vi.fn(async () => []),
  pgCriar: vi.fn(async () => 1),
  pgRenomear: vi.fn(async () => {}),
  pgExcluir: vi.fn(async () => {}),
  fmtDataHora: () => 'agora',
}));

import PlaygroundPage from '../../pages/PlaygroundPage';

const montar = () => render(<MemoryRouter><PlaygroundPage /></MemoryRouter>);

afterEach(cleanup);
beforeEach(() => {
  navegou.length = 0;
  estado.usuario = { EMAIL: 'ana@empresa.com' };
  estado.diagnostico = { temCompartilhada: false, temPessoal: false };
});

describe('Playground — aviso antes de criar o primeiro estudo', () => {
  it('sem credencial nenhuma, avisa que o analista não vai responder', async () => {
    montar();
    expect(await screen.findByText(/o analista ainda não tem uma credencial de ia/i)).toBeTruthy();
  });

  it('com credencial só pessoal, avisa que o custo vai para a conta do usuário', async () => {
    estado.diagnostico = { temCompartilhada: false, temPessoal: true };
    montar();
    expect(await screen.findByText(/seus estudos vão rodar na credencial da sua conta/i)).toBeTruthy();
    // Nao e o mesmo caso do "sem nada": aqui o analista funciona.
    expect(screen.queryByText(/não tem uma credencial de ia/i)).toBeNull();
  });

  it('com a compartilhada ativa, não interrompe ninguém', async () => {
    estado.diagnostico = { temCompartilhada: true, temPessoal: true };
    montar();
    await waitFor(() => expect(screen.getByText('Nenhum estudo ainda')).toBeTruthy());
    expect(screen.queryByText(/credencial/i)).toBeNull();
  });

  it('leva quem está logado para a Governança de IA', async () => {
    montar();
    const botao = await screen.findByRole('button', { name: /governança de ia/i });
    botao.click();
    await waitFor(() => expect(navegou).toEqual(['/governanca-ia']));
  });

  it('sem identidade, recebe a orientação em vez de um botão que o barraria', async () => {
    // A Governanca de IA exige sessao real — mandar clicar ali sem identidade
    // so devolveria a pessoa para a tela inicial.
    estado.usuario = null;
    montar();
    expect(await screen.findByText(/peça a quem administra o sistema/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /governança de ia/i })).toBeNull();
  });

  it('não pisca alarme falso enquanto ainda está verificando', async () => {
    let liberar: (v: any) => void = () => {};
    const { diagnosticarCredencial } = await import('../../lib/playground');
    (diagnosticarCredencial as any).mockImplementationOnce(
      () => new Promise((res) => { liberar = res; }));
    montar();
    // Enquanto a verificacao nao volta, nenhum aviso de credencial na tela.
    expect(screen.queryByText(/credencial/i)).toBeNull();
    liberar({ temCompartilhada: false, temPessoal: false });
    expect(await screen.findByText(/o analista ainda não tem uma credencial de ia/i)).toBeTruthy();
  });
});
