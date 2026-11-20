// O turno que "termina bem" mas nunca tocou a plataforma.
//
// O modo de falha invisível: a task perde o token da plataforma, o modelo
// responde em prosa que está "sem acesso", o turno encerra com sucesso — e o
// app confirmava a credencial de IA como boa, sem oferecer saída nenhuma.
// Como o estudo reusa o TASK_ID para sempre, ficava preso à sessão morta.
//
// Aqui se protege o fio completo: detecção no fim do turno → card de erro com
// a ação certa → renovarSessao desvincula a task e a próxima pergunta abre
// uma sessão NOVA (com o contexto completo, por ser "primeira" de novo).
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
import { SF_PG, MARCADOR_SEM_PLATAFORMA } from '../../lib/playground';

function sessaoControlavel() {
  const handlers: Record<string, any> = {};
  return {
    handlers,
    on: (ev: string, h: any) => { handlers[ev] = h; return () => {}; },
    send: vi.fn(),
    cancel: vi.fn(),
    close: vi.fn(),
    loadHistory: async () => [],
  };
}

const chamadasSetTask = () =>
  executeServerFunctionMitra.mock.calls.filter(
    ([arg]: any) => arg?.serverFunctionId === SF_PG.setTask,
  );

const segmentosErro = (hook: any) =>
  hook.result.current.msgs
    .filter((m: any) => m.role === 'agent')
    .flatMap((m: any) => m.segments)
    .filter((s: any) => s.t === 'erro');

beforeEach(() => {
  vi.clearAllMocks();
  manageAgentCredentialMitra.mockResolvedValue({ providers: [] });
  executeServerFunctionMitra.mockResolvedValue({
    result: { executionStatus: 'COMPLETED', output: { rows: [] } },
  });
});

describe('turno sem plataforma (task com token morto)', () => {
  it('prosa de "sem acesso" + zero SFs no turno → card de erro de plataforma, credencial NÃO confirmada', async () => {
    const sessao = sessaoControlavel();
    getAgentTaskMitra.mockReturnValue(sessao);

    const hook = renderHook(() => usePlaygroundChat({ estudoId: 21 }));
    await act(async () => { await hook.result.current.send('Quais contas mais cresceram?'); });
    await act(async () => {
      sessao.handlers.turnStart?.({});
      sessao.handlers.delta?.({
        delta: 'O acesso desta tarefa à plataforma Mitra continua bloqueado (a credencial segue inválida/expirada).',
        kind: 'text',
      });
      sessao.handlers.turnEnd?.({ content: 'ok' });
    });

    await waitFor(() => {
      const erros = segmentosErro(hook);
      expect(erros).toHaveLength(1);
      expect(erros[0].plataforma).toBe(true);
    });
    // NÃO pode ter "confirmado" a credencial: o turno não provou nada sobre dados
    expect(hook.result.current.credStatus).toBe('nenhuma');
  });

  it('o marcador que o contexto instrui também dispara', async () => {
    const sessao = sessaoControlavel();
    getAgentTaskMitra.mockReturnValue(sessao);

    const hook = renderHook(() => usePlaygroundChat({ estudoId: 21 }));
    await act(async () => { await hook.result.current.send('resuma as despesas'); });
    await act(async () => {
      sessao.handlers.turnStart?.({});
      sessao.handlers.delta?.({ delta: `Não consegui consultar os dados. ${MARCADOR_SEM_PLATAFORMA}`, kind: 'text' });
      sessao.handlers.statusChange?.({ status: 'idle' });
    });

    await waitFor(() => expect(segmentosErro(hook).some((s: any) => s.plataforma)).toBe(true));
  });

  it('turno que EXECUTOU uma SF não dispara, mesmo se a fala citar "acesso bloqueado"', async () => {
    const sessao = sessaoControlavel();
    getAgentTaskMitra.mockReturnValue(sessao);

    const hook = renderHook(() => usePlaygroundChat({ estudoId: 21 }));
    await act(async () => { await hook.result.current.send('analise os acessos'); });
    await act(async () => {
      sessao.handlers.turnStart?.({});
      sessao.handlers.tool?.({
        tool: 'mcp__mitra-business__executeServerFunction',
        input: `{"serverFunctionId":${SF_PG.consultaLivre},"params":{"consulta":"SELECT 1"}}`,
      });
      sessao.handlers.delta?.({ delta: 'O acesso ao módulo ficou bloqueado para a plataforma de vendas em maio.', kind: 'text' });
      sessao.handlers.turnEnd?.({ content: 'ok' });
    });

    await waitFor(() => expect(hook.result.current.status).toBe('idle'));
    expect(segmentosErro(hook)).toHaveLength(0);
  });

  it('reabrir um estudo cuja conversa termina em "sem acesso" já mostra a saída (sem exigir outro turno falho)', async () => {
    const sessao = sessaoControlavel();
    getAgentTaskMitra.mockReturnValue(sessao);
    const conversa = JSON.stringify([
      { role: 'user', segments: [{ t: 'md', c: 'Quais contas mais cresceram?' }] },
      { role: 'agent', segments: [{ t: 'md', c: 'O acesso desta tarefa à plataforma Mitra continua bloqueado (a credencial segue inválida/expirada).' }] },
    ]);

    const hook = renderHook(() => usePlaygroundChat({ estudoId: 21, taskId: 'task-morta', conversaInicial: conversa }));

    await waitFor(() => {
      const erros = segmentosErro(hook);
      expect(erros).toHaveLength(1);
      expect(erros[0].plataforma).toBe(true);
    });
  });

  it('renovarSessao desvincula a task (TASK_ID vazio) e a próxima pergunta abre sessão NOVA', async () => {
    const sessao = sessaoControlavel();
    getAgentTaskMitra.mockReturnValue(sessao);

    // estudo já preso a uma task antiga. O mount NÃO pode reconectar esse id:
    // ele pode carregar credencial/sandbox de outro usuário.
    const hook = renderHook(() => usePlaygroundChat({ estudoId: 21, taskId: 'task-morta' }));
    expect(getAgentTaskMitra).not.toHaveBeenCalledWith({ taskId: 'task-morta' });

    await act(async () => { await hook.result.current.renovarSessao(); });

    // 1. TASK_ID limpo no banco
    expect(chamadasSetTask().some(([arg]: any) => arg?.input?.taskId === '')).toBe(true);

    // 2. próxima pergunta NÃO reusa a task morta: cria sessão nova (create: true)
    const sessaoNova = sessaoControlavel();
    getAgentTaskMitra.mockReturnValue(sessaoNova);
    await act(async () => { await hook.result.current.send('tenta de novo'); });
    const criacoes = getAgentTaskMitra.mock.calls.filter(([arg]: any) => arg?.create === true);
    expect(criacoes).toHaveLength(1);
    // e por ser "primeira" mensagem da sessão nova, o contexto completo vai junto
    expect(String(sessaoNova.send.mock.calls[0][0])).toContain('[CONTEXTO DO ESTUDO');
  });
});
