// O turno TEM de ser encerrado, venha o evento que vier.
//
// A queixa real: "o chat não gravou o resultado que o agente tava rodando e não
// atualizou a tela quando ficou pronta — ficou parecendo que travou". A causa
// era o encerramento estar amarrado a UM evento (`turnEnd`). Quando a sessao
// terminava por outro caminho — `statusChange: idle` sem turnEnd, queda de
// WebSocket, aba dormindo — nada gravava a conversa e nada mandava recarregar
// o canvas: a tela velha ficava na frente do usuario e a resposta sumia.
//
// Estes testes cobrem os DOIS caminhos de saida. Sao o tipo de bug que build e
// typecheck nunca pegam: tudo compila, so nao termina.
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
import { SF_PG } from '../../lib/playground';

// Sessao controlavel: guarda os handlers para o teste disparar os eventos na
// ordem que quiser, imitando a plataforma.
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

const conversasGravadas = () =>
  executeServerFunctionMitra.mock.calls.filter(
    ([arg]: any) => arg?.serverFunctionId === SF_PG.salvarConversa,
  );

beforeEach(() => {
  vi.clearAllMocks();
  manageAgentCredentialMitra.mockResolvedValue({ providers: [] });
  executeServerFunctionMitra.mockResolvedValue({
    result: { executionStatus: 'COMPLETED', output: { rows: [] } },
  });
});

describe('encerramento do turno do analista', () => {
  it('statusChange idle SEM turnEnd grava a conversa e manda recarregar a tela', async () => {
    const sessao = sessaoControlavel();
    getAgentTaskMitra.mockReturnValue(sessao);
    const onTurnEnd = vi.fn();

    const hook = renderHook(() => usePlaygroundChat({ estudoId: 7, onTurnEnd }));
    await act(async () => { await hook.result.current.send('resuma as despesas'); });

    // o analista respondeu…
    await act(async () => {
      sessao.handlers.statusChange?.({ status: 'streaming' });
      sessao.handlers.delta?.({ delta: 'As despesas somam 1,2 mi', kind: 'text' });
    });
    const gravadasAntes = conversasGravadas().length;

    // …e a sessao terminou SEM turnEnd (o caminho que ficava no limbo)
    await act(async () => { sessao.handlers.statusChange?.({ status: 'idle' }); });

    await waitFor(() => expect(onTurnEnd).toHaveBeenCalled());
    expect(conversasGravadas().length).toBeGreaterThan(gravadasAntes);
    expect(hook.result.current.status).toBe('idle');
  });

  it('o texto que ja tinha chegado nao se perde no encerramento', async () => {
    const sessao = sessaoControlavel();
    getAgentTaskMitra.mockReturnValue(sessao);

    const hook = renderHook(() => usePlaygroundChat({ estudoId: 7 }));
    await act(async () => { await hook.result.current.send('resuma as despesas'); });
    await act(async () => {
      sessao.handlers.turnStart?.({});
      sessao.handlers.delta?.({ delta: 'Conclusão: caiu 8%', kind: 'text' });
      sessao.handlers.statusChange?.({ status: 'idle' });
    });

    await waitFor(() => {
      const agente = hook.result.current.msgs.filter((m: any) => m.role === 'agent');
      const texto = agente.flatMap((m: any) => m.segments)
        .filter((s: any) => s.t === 'md').map((s: any) => s.c).join('');
      expect(texto).toContain('Conclusão: caiu 8%');
    });
  });

  it('encerra UMA vez só — turnEnd depois de statusChange nao duplica o trabalho', async () => {
    const sessao = sessaoControlavel();
    getAgentTaskMitra.mockReturnValue(sessao);
    const onTurnEnd = vi.fn();

    const hook = renderHook(() => usePlaygroundChat({ estudoId: 7, onTurnEnd }));
    await act(async () => { await hook.result.current.send('resuma as despesas'); });
    await act(async () => {
      sessao.handlers.turnStart?.({});
      sessao.handlers.statusChange?.({ status: 'idle' });
      sessao.handlers.turnEnd?.({ content: 'ok' });
    });

    await waitFor(() => expect(onTurnEnd).toHaveBeenCalledTimes(1));
  });
});
