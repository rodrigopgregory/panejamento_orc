// A credencial do analista NUNCA sai da hierarquia: compartilhada do projeto
// ou a do proprio usuario logado. Nada mais — em especial, nunca a da conta
// que desenvolveu a aplicacao.
//
// O que decide qual das duas e possivel nao e o rotulo mostrado na tela, e a
// SESSAO. Sem sessao real, quem responde pelo app e o token de build (conta
// criadora): ai "credencial pessoal" seria a assinatura do dono, e so a
// compartilhada e aceitavel. Com sessao real, vale a hierarquia inteira —
// inclusive se a pessoa estiver navegando sob uma persona de demonstracao,
// que e papel de tela e nao troca de identidade.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const getAgentTaskMitra = vi.fn();
const manageAgentCredentialMitra = vi.fn();
const executeServerFunctionMitra = vi.fn();

vi.mock('mitra-interactions-sdk', () => ({
  getAgentTaskMitra: (...a: any[]) => getAgentTaskMitra(...a),
  manageAgentCredentialMitra: (...a: any[]) => manageAgentCredentialMitra(...a),
  executeServerFunctionMitra: (...a: any[]) => executeServerFunctionMitra(...a),
  executePublicServerFunctionMitra: vi.fn(),
  listRecordsMitra: vi.fn(), createRecordMitra: vi.fn(), patchRecordMitra: vi.fn(),
  deleteRecordMitra: vi.fn(), createRecordsBatchMitra: vi.fn(), configureSdkMitra: vi.fn(),
  getVariableMitra: vi.fn(async () => ({ result: { value: '' } })),
  setVariableMitra: vi.fn(), createMitraInstance: vi.fn(),
  closeChatMitra: vi.fn(),
}));
const sessao = { real: false };
vi.mock('../../mitra-config', () => ({
  MITRA_CONFIG: { projectId: 52483, baseURL: '', token: '' },
  initMitra: vi.fn(), configurePublicSdk: vi.fn(),
  sessaoRealAtiva: () => sessao.real,
}));

import { usePlaygroundChat } from '../../hooks/usePlaygroundChat';

const MODELO_DO_DONO = 'subscription:anthropic:claude-opus-4-8';
const MODELO_COMPARTILHADO = 'openai/gpt-5.5:medium';
const grupos = (modelId: string) => ({ providers: [{ type: 'subscription', models: [{ modelId }] }] });

function sessaoFalsa() {
  return { on: () => () => {}, send: vi.fn(), cancel: vi.fn(), close: vi.fn(), loadHistory: async () => [] };
}

function mockConfig(connectionId: string) {
  executeServerFunctionMitra.mockImplementation(async ({ serverFunctionId }: any) => {
    if (serverFunctionId === 237) {
      return { result: { executionStatus: 'COMPLETED', output: { rows: [{ CHAVE: 'AGENT_CONNECTION_ID', VALOR: connectionId }] } } };
    }
    return { result: { executionStatus: 'COMPLETED', output: { rows: [] } } };
  });
}

// Papel mostrado na tela (persona) — deliberadamente separado da sessao.
function personaNaTela(email: string) {
  localStorage.setItem('planej-user', JSON.stringify({
    ID: 999, EMAIL: email, NOME: 'Paula', PERFIL: 'admin', AREA: '', AVATAR: '',
  }));
}

async function perguntar() {
  const hook = renderHook(() => usePlaygroundChat({ estudoId: 1 }));
  await act(async () => { await hook.result.current.send('quanto gastamos com pessoal?'); });
  return hook;
}

function textoDasMensagens(hook: any): string {
  return hook.result.current.msgs
    .flatMap((m: any) => m.segments)
    .map((s: any) => s.c || '')
    .join(' ');
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessao.real = false;
  getAgentTaskMitra.mockReturnValue(sessaoFalsa());
});

describe('a credencial do analista nunca sai da hierarquia', () => {
  it('sem sessao real: usa a compartilhada e nunca a do dono', async () => {
    personaNaTela('paula@orcaflow.demo');
    mockConfig('conn-empresa');
    // A plataforma responde a lista do DONO quando nao ha connectionId.
    manageAgentCredentialMitra.mockImplementation(async (arg: any) =>
      arg.connectionId ? grupos(MODELO_COMPARTILHADO) : grupos(MODELO_DO_DONO));

    const hook = await perguntar();

    const arg = getAgentTaskMitra.mock.calls[0][0];
    expect(arg.connectionId).toBe('conn-empresa');
    expect(arg.modelId).toBe(MODELO_COMPARTILHADO);
    expect(arg.modelId).not.toBe(MODELO_DO_DONO);
    await waitFor(() => expect(hook.result.current.credStatus).toBe('empresa'));
  });

  // O caso que motivou tudo: sem compartilhada, o comportamento anterior era
  // "segue assim mesmo" — e a plataforma atendia pela assinatura do dono.
  it('sem sessao real e SEM compartilhada: nao abre task nenhuma e explica', async () => {
    personaNaTela('paula@orcaflow.demo');
    mockConfig('');                                              // ninguem ativou a compartilhada
    manageAgentCredentialMitra.mockResolvedValue(grupos(MODELO_DO_DONO)); // mas a do dono responderia

    const hook = await perguntar();

    expect(getAgentTaskMitra).not.toHaveBeenCalled();
    expect(textoDasMensagens(hook)).toContain('login de demonstração');
  });

  // Um connectionId invalido nao da erro: o servidor o descarta e atende pela
  // credencial pessoal — que aqui e a do dono. Lista identica = id recusado.
  it('connectionId recusado (mesma lista do dono): bloqueia em vez de passar disfarcado', async () => {
    personaNaTela('paula@orcaflow.demo');
    mockConfig('conn-que-nao-existe');
    manageAgentCredentialMitra.mockResolvedValue(grupos(MODELO_DO_DONO)); // com ou sem id, a mesma lista

    const hook = await perguntar();

    expect(getAgentTaskMitra).not.toHaveBeenCalled();
    expect(textoDasMensagens(hook)).toContain('login de demonstração');
  });

  // O caso relatado: a pessoa entrou de VERDADE como usuaria business e, ja
  // dentro do app, clicou na persona Paula para navegar. A persona e papel de
  // tela; a identidade continua sendo a dela. Antes, assumir a persona
  // derrubava a sessao real e o app passava a ser atendido como a conta
  // criadora — era assim que as chaves de quem desenvolveu a aplicacao
  // apareciam no Playground de outra pessoa.
  it('login real navegando sob persona: hierarquia normal, credencial dela', async () => {
    sessao.real = true;                      // entrou de verdade...
    personaNaTela('paula@orcaflow.demo');    // ...e assumiu a persona na tela
    mockConfig('');                          // empresa nao ativou a compartilhada
    const MODELO_DELA = 'openai/gpt-5.5:low';
    manageAgentCredentialMitra.mockResolvedValue(grupos(MODELO_DELA));

    const hook = await perguntar();

    expect(getAgentTaskMitra).toHaveBeenCalledTimes(1);
    expect(getAgentTaskMitra.mock.calls[0][0].modelId).toBe(MODELO_DELA);
    await waitFor(() => expect(hook.result.current.credStatus).toBe('usuario'));
  });

  it('login real sob persona COM compartilhada: a compartilhada vence', async () => {
    sessao.real = true;
    personaNaTela('paula@orcaflow.demo');
    mockConfig('conn-empresa');
    manageAgentCredentialMitra.mockImplementation(async (arg: any) =>
      arg.connectionId ? grupos(MODELO_COMPARTILHADO) : grupos('openai/gpt-5.5:low'));

    const hook = await perguntar();

    const arg = getAgentTaskMitra.mock.calls[0][0];
    expect(arg.connectionId).toBe('conn-empresa');
    expect(arg.modelId).toBe(MODELO_COMPARTILHADO);
    await waitFor(() => expect(hook.result.current.credStatus).toBe('empresa'));
  });

  it('login real sem compartilhada continua podendo usar a propria credencial', async () => {
    sessao.real = true;
    personaNaTela('pessoa@empresa.com.br');
    mockConfig('');
    manageAgentCredentialMitra.mockResolvedValue(grupos(MODELO_DO_DONO));

    const hook = await perguntar();

    expect(getAgentTaskMitra).toHaveBeenCalledTimes(1);
    expect(getAgentTaskMitra.mock.calls[0][0].modelId).toBe(MODELO_DO_DONO);
    await waitFor(() => expect(hook.result.current.credStatus).toBe('usuario'));
  });
});
