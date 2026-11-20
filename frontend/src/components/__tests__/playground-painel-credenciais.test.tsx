// O painel e a UNICA tela onde as duas realidades aparecem juntas. Ele precisa
// dizer, sem o usuario perguntar: o que esta valendo agora, qual e a regra, e
// (para quem administra) como ligar a credencial da empresa.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';

const manageAgentCredentialMitra = vi.fn();
const executeServerFunctionMitra = vi.fn();
const perfil = { atual: 'admin' };

vi.mock('mitra-interactions-sdk', () => ({
  manageAgentCredentialMitra: (...a: any[]) => manageAgentCredentialMitra(...a),
  executeServerFunctionMitra: (...a: any[]) => executeServerFunctionMitra(...a),
  executePublicServerFunctionMitra: vi.fn(), listRecordsMitra: vi.fn(),
  createRecordMitra: vi.fn(), patchRecordMitra: vi.fn(), deleteRecordMitra: vi.fn(),
  createRecordsBatchMitra: vi.fn(), configureSdkMitra: vi.fn(), getAgentTaskMitra: vi.fn(),
  getVariableMitra: vi.fn(async () => ({ result: { value: '' } })),
  setVariableMitra: vi.fn(), createMitraInstance: vi.fn(),
}));
// `sessao.real = false` = app rodando no token de build (nenhum login real).
// Nesse estado as credenciais PESSOAIS que a plataforma devolve sao da conta
// criadora: nao podem ser listadas, conectadas nem removidas daqui.
const sessao = { real: true };
vi.mock('../../mitra-config', () => ({
  MITRA_CONFIG: { projectId: 52483, baseURL: '', token: '' },
  initMitra: vi.fn(), configurePublicSdk: vi.fn(),
  sessaoRealAtiva: () => sessao.real,
}));
vi.mock('../../lib/auth', () => ({ getUser: () => ({ PERFIL: perfil.atual }) }));

import PainelCredenciaisIA from '../PainelCredenciaisIA';

beforeEach(() => {
  vi.clearAllMocks();
  perfil.atual = 'admin';
  sessao.real = true;
  manageAgentCredentialMitra.mockResolvedValue({ providers: [] });
  executeServerFunctionMitra.mockResolvedValue({ result: { executionStatus: 'COMPLETED', output: { rows: [{ CHAVE: 'AGENT_CONNECTION_ID', VALOR: '' }] } } });
});

// A suite nao roda com globals do testing-library: sem isto os renders se
// acumulam no mesmo DOM e as buscas encontram o painel do teste anterior.
afterEach(() => cleanup());

const abrir = (status: any) =>
  render(<PainelCredenciaisIA status={status} onConectado={() => {}} onClose={() => {}} />);

describe('painel de credencial de IA', () => {
  it('quem usa a credencial da empresa e avisado de que nao precisa fazer nada', async () => {
    abrir('empresa');
    expect(await screen.findByText(/credencial compartilhada da empresa\. Você não precisa conectar nada/i)).toBeTruthy();
  });

  it('quem usa a propria credencial ve isso declarado', async () => {
    abrir('usuario');
    expect(await screen.findByText(/Em uso agora: a credencial da sua conta/i)).toBeTruthy();
  });

  it('a regra de prioridade fica escrita, nao subentendida', async () => {
    // A compartilhada vem PRIMEIRO — e o que dispensa cada usuario de plugar
    // chave propria. O texto tem de dizer isso, senao quem le entende o inverso.
    abrir('usuario');
    expect(await screen.findByText(/o analista usa ela — e você não\s+precisa conectar nada/i)).toBeTruthy();
    expect(await screen.findByText(/só entra se a compartilhada não/i)).toBeTruthy();
  });

  it('sem credencial nenhuma, aponta os dois caminhos possiveis', async () => {
    abrir('nenhuma');
    expect(await screen.findByText(/conecte a sua conta abaixo, ou peça a quem administra/i)).toBeTruthy();
  });

  it('admin tem onde apontar a conexao compartilhada', async () => {
    abrir('nenhuma');
    // O campo fica atras de um clique para o modal nascer curto — mas o
    // caminho continua existindo para quem administra.
    const abrirCampo = await screen.findByText(/apontar uma conexão específica/i);
    fireEvent.click(abrirCampo);
    await waitFor(() => expect(screen.getByPlaceholderText(/identificador da conexão/i)).toBeTruthy());
  });

  it('quem nao administra nao ve o campo do identificador', async () => {
    perfil.atual = 'gestor';
    abrir('usuario');
    await screen.findByText(/Em uso agora/i);
    expect(screen.queryByPlaceholderText(/identificador da conexão/i)).toBeNull();
    expect(screen.queryByText(/apontar uma conexão específica/i)).toBeNull();
  });

  // Sem login real, o app fala com a plataforma pelo token da conta criadora:
  // os provedores "conectados" que apareceriam sao a assinatura real do dono —
  // e o botao Remover apagaria a assinatura de outra pessoa.
  it('sem identidade propria: nao ve nem gerencia credenciais pessoais', async () => {
    sessao.real = false;
    manageAgentCredentialMitra.mockResolvedValue({
      providers: [{ id: 'a', name: 'Anthropic', type: 'subscription', target: 'claude',
        auth: { method: 'paste_code' }, connected: true, account: { email: 'dona@empresa.com' } }],
    });

    abrir('empresa');

    expect(await screen.findByText(/login de demonstração/i)).toBeTruthy();
    expect(screen.queryByText(/Anthropic/)).toBeNull();
    expect(screen.queryByText(/dona@empresa.com/)).toBeNull();
    expect(screen.queryByText(/^Remover$/)).toBeNull();
    expect(screen.queryByText(/^Conectar$|^Reconectar$/)).toBeNull();
  });

  // O identificador vem de FABRICA como "default" (validado em producao: e o
  // alias que a plataforma resolve para a connection da aba AI). O campo
  // continua editavel para quem administra — ajuste, nao pre-requisito.
  it('identificador da conexao vem preenchido com "default" e continua editavel', async () => {
    sessao.real = false;
    perfil.atual = 'admin';

    abrir('empresa');

    await screen.findByText(/login de demonstração/i);
    // com valor salvo (o padrao de fabrica), o botao vira "trocar" em vez de "apontar"
    const abrirCampo = await screen.findByText(/trocar o identificador/i);
    fireEvent.click(abrirCampo);
    await waitFor(() => {
      const campo = screen.getByPlaceholderText(/identificador da conexão/i) as HTMLInputElement;
      expect(campo.value).toBe('default');
    });
  });

  // A queixa era exatamente esta: o conteudo abria DENTRO do chat, como se
  // fosse resposta do analista. Modal = camada propria por cima da tela.
  it('abre como modal sobreposto, nao como conteudo dentro do chat', async () => {
    const { container } = abrir('nenhuma');
    await screen.findByText(/Em uso agora|Nenhuma credencial disponível/i);
    const overlay = container.querySelector('.fixed.inset-0');
    expect(overlay).toBeTruthy();
  });
});
