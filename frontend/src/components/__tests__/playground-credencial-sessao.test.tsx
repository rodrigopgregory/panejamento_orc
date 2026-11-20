// O que REALMENTE chega na plataforma ao abrir a sessao do analista.
//
// A decisao pura ja e coberta em playground-credencial-origem; aqui o que se
// protege e o fio inteiro: list_models -> escolha -> getAgentTaskMitra. O
// detalhe que decide tudo e o `connectionId`: OMITIR e o que faz a plataforma
// usar a credencial pessoal de quem esta logado; ENVIAR e o que faz usar a
// conexao compartilhada do projeto. Trocar um pelo outro nao quebra o build,
// nao quebra teste de unidade — so aparece como "nao funciona pra mim".
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
}));
vi.mock('../../mitra-config', () => ({
  MITRA_CONFIG: { projectId: 52483, baseURL: '', token: '' },
  initMitra: vi.fn(), configurePublicSdk: vi.fn(),
  // Estes casos sao de usuario logado de verdade: a credencial pessoal dele e
  // legitimamente dele. (Sem sessao real, a pessoal seria a da conta criadora
  // e ficaria proibida — cenario coberto em playground-credencial-demo.)
  sessaoRealAtiva: () => true,
}));

import { usePlaygroundChat } from '../../hooks/usePlaygroundChat';
const MODELO_PESSOAL = 'subscription:anthropic:pessoal';

const MODELO_EMPRESA = 'subscription:anthropic:claude-opus-4-8';
const grupos = (modelId: string) => ({ providers: [{ type: 'subscription', models: [{ modelId }] }] });

function sessaoFalsa() {
  return { on: () => () => {}, send: vi.fn(), cancel: vi.fn(), close: vi.fn(), loadHistory: async () => [] };
}

// SF 237 = leitura da config; devolve o identificador da conexao compartilhada
function mockConfig(connectionId: string) {
  executeServerFunctionMitra.mockImplementation(async ({ serverFunctionId }: any) => {
    if (serverFunctionId === 237) {
      return { result: { executionStatus: 'COMPLETED', output: { rows: [{ CHAVE: 'AGENT_CONNECTION_ID', VALOR: connectionId }] } } };
    }
    return { result: { executionStatus: 'COMPLETED', output: { rows: [] } } };
  });
}

async function perguntar() {
  const hook = renderHook(() => usePlaygroundChat({ estudoId: 1 }));
  await act(async () => { await hook.result.current.send('quanto gastamos com pessoal?'); });
  return hook;
}

beforeEach(() => {
  vi.clearAllMocks();
  getAgentTaskMitra.mockReturnValue(sessaoFalsa());
});

describe('qual credencial abre a sessao do analista', () => {
  it('usuario COM credencial propria: envia connectionId da empresa quando ela existe', async () => {
    mockConfig('conn-empresa');   // a compartilhada existe...
    manageAgentCredentialMitra.mockImplementation(async (arg: any) =>
      arg.connectionId ? grupos(MODELO_EMPRESA) : grupos(MODELO_PESSOAL)); // ...e ele tambem tem a dele

    const hook = await perguntar();

    expect(getAgentTaskMitra).toHaveBeenCalledTimes(1);
    const arg = getAgentTaskMitra.mock.calls[0][0];
    expect(arg.create).toBe(true);
    expect(arg.modelId).toBe(MODELO_EMPRESA);
    expect(arg.connectionId).toBe('conn-empresa');
    await waitFor(() => expect(hook.result.current.credStatus).toBe('empresa'));
  });

  it('nao reutiliza TASK_ID salvo: cria task nova para nao herdar credencial antiga', async () => {
    mockConfig('conn-empresa');
    manageAgentCredentialMitra.mockImplementation(async (arg: any) =>
      arg.connectionId ? grupos(MODELO_EMPRESA) : grupos(MODELO_PESSOAL));

    const hook = renderHook(() => usePlaygroundChat({
      estudoId: 1,
      taskId: 'task-criada-pela-dev',
      conversaInicial: JSON.stringify([{ role: 'agent', segments: [{ t: 'md', c: 'histórico salvo' }] }]),
    }));
    await act(async () => { await hook.result.current.send('nova pergunta'); });

    expect(getAgentTaskMitra).toHaveBeenCalledTimes(1);
    expect(getAgentTaskMitra).not.toHaveBeenCalledWith({ taskId: 'task-criada-pela-dev' });
    const arg = getAgentTaskMitra.mock.calls[0][0];
    expect(arg.create).toBe(true);
    expect(arg.connectionId).toBe('conn-empresa');
    expect(arg.modelId).toBe(MODELO_EMPRESA);
  });

  it('usuario SEM credencial e empresa com a compartilhada: envia o connectionId dela', async () => {
    mockConfig('conn-empresa');
    manageAgentCredentialMitra.mockImplementation(async (arg: any) =>
      arg.connectionId ? grupos(MODELO_EMPRESA) : { providers: [] });

    const hook = await perguntar();

    const arg = getAgentTaskMitra.mock.calls[0][0];
    expect(arg.connectionId).toBe('conn-empresa');
    expect(arg.modelId).toBe(MODELO_EMPRESA);
    await waitFor(() => expect(hook.result.current.credStatus).toBe('empresa'));
  });

  // O app NAO e a autoridade sobre quem tem acesso. list_models vazio nao prova
  // ausencia de credencial (nao enumera acesso resolvido no servidor), e barrar
  // o envio nesse palpite deixava o usuario travado sem recurso nenhum.
  it('nenhuma das duas confirmada: tenta assim mesmo em vez de barrar o acesso', async () => {
    mockConfig('');                                        // empresa nao ativou
    manageAgentCredentialMitra.mockResolvedValue({ providers: [] }); // usuario nao conectou

    const hook = await perguntar();

    expect(getAgentTaskMitra).toHaveBeenCalledTimes(1);
    // sem modelo confirmado, NAO cravar um: a plataforma usa o default dela.
    expect('modelId' in getAgentTaskMitra.mock.calls[0][0]).toBe(false);
    // o aviso continua (rotulo), mas como aviso — a pergunta foi enviada
    await waitFor(() => expect(hook.result.current.credStatus).toBe('nenhuma'));
  });

  it('turno que responde corrige o rotulo — ninguem le "conecte uma credencial" depois de ser atendido', async () => {
    mockConfig('');
    manageAgentCredentialMitra.mockResolvedValue({ providers: [] });
    // sessao que dispara turnEnd assim que o send acontece
    const handlers: Record<string, any> = {};
    getAgentTaskMitra.mockReturnValue({
      on: (ev: string, h: any) => { handlers[ev] = h; return () => {}; },
      send: vi.fn(() => handlers.turnEnd?.({ content: 'ok' })),
      cancel: vi.fn(), close: vi.fn(), loadHistory: async () => [],
    });

    const hook = await perguntar();

    // Sem id configurado o app tenta o padrao de fabrica ("default"): a task
    // nasce com esse connectionId e, quando o turno responde, o rotulo que se
    // confirma e o da credencial DA EMPRESA — foi por ela que a task passou.
    expect(getAgentTaskMitra.mock.calls[0][0].connectionId).toBe('default');
    await waitFor(() => expect(hook.result.current.credStatus).toBe('empresa'));
    expect(hook.result.current.precisaCredencial).toBe(false);
  });

  it('falha SEM credencial confirmada instrui a conectar, nao a "assinatura expirada"', async () => {
    mockConfig('');
    manageAgentCredentialMitra.mockResolvedValue({ providers: [] });
    const handlers: Record<string, any> = {};
    getAgentTaskMitra.mockReturnValue({
      on: (ev: string, h: any) => { handlers[ev] = h; return () => {}; },
      send: vi.fn(() => handlers.error?.({ error: 'unauthorized' })),
      cancel: vi.fn(), close: vi.fn(), loadHistory: async () => [],
    });

    const hook = await perguntar();

    await waitFor(() => expect(hook.result.current.precisaCredencial).toBe(true));
    const erro = hook.result.current.msgs.at(-1)?.segments.find((s: any) => s.t === 'erro') as any;
    expect(erro?.cred).toBe('sem');
  });

  it('list_models indisponivel (rede/ambiente) nao vira "falta credencial"', async () => {
    // Distincao critica: consulta que FALHA nao e o mesmo que conta VAZIA.
    // Tratar igual foi o que travava o chat fora do ambiente publicado.
    mockConfig('');
    manageAgentCredentialMitra.mockRejectedValue(new Error('websocket indisponivel'));

    await perguntar();

    expect(getAgentTaskMitra).toHaveBeenCalledTimes(1);
    expect('modelId' in getAgentTaskMitra.mock.calls[0][0]).toBe(false);
  });

  // Quem tem Claude conectado, mas nao EXATAMENTE o modelo preferido do
  // codigo, levava "model not available" em todo turno. O modelo tem de sair
  // da lista real da credencial — nunca de uma constante nossa.
  it('usa o modelo que a credencial oferece, mesmo nao sendo o preferido do codigo', async () => {
    mockConfig('');
    manageAgentCredentialMitra.mockResolvedValue(grupos(MODELO_EMPRESA));
    const sessao = sessaoFalsa();
    getAgentTaskMitra.mockReturnValue(sessao);

    await perguntar();

    expect(getAgentTaskMitra.mock.calls[0][0].modelId).toBe(MODELO_EMPRESA);
    expect(getAgentTaskMitra.mock.calls[0][0].modelId).not.toBe(MODELO_PESSOAL);
    expect(sessao.send.mock.calls[0][1]).toEqual({ modelId: MODELO_EMPRESA });
  });

  it('sem modelo confirmado, o send tambem nao crava modelo nenhum', async () => {
    mockConfig('');
    manageAgentCredentialMitra.mockResolvedValue({ providers: [] });
    const sessao = sessaoFalsa();
    getAgentTaskMitra.mockReturnValue(sessao);

    await perguntar();

    expect(sessao.send).toHaveBeenCalledTimes(1);
    expect(sessao.send.mock.calls[0][1]).toBeUndefined();
  });

  it('o modelo escolhido tambem vai no send — estudo antigo nao fica preso no modelo velho', async () => {
    mockConfig('');
    manageAgentCredentialMitra.mockResolvedValue(grupos(MODELO_EMPRESA));
    const sessao = sessaoFalsa();
    getAgentTaskMitra.mockReturnValue(sessao);

    await perguntar();

    expect(sessao.send).toHaveBeenCalledTimes(1);
    expect(sessao.send.mock.calls[0][1]).toEqual({ modelId: MODELO_EMPRESA });
  });
});
