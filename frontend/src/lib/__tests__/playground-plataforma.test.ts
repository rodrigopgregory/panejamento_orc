// Bloqueio de PLATAFORMA ≠ falta de credencial de IA.
//
// O caso real (estudo #21): o modelo respondia normalmente (credencial de IA
// ok), mas NENHUMA server function aparecia em INT_SERVERFUNCTIONEXECUTION —
// a task tinha perdido o token que a liga à plataforma. O "sem acesso" que o
// usuário via era prosa do próprio modelo, então nenhuma detecção disparava,
// e o estudo ficava preso à task morta para sempre (o TASK_ID é reusado).
//
// Estes testes protegem as três pontas da cura:
//   1. a detecção da prosa/marcador (pareceBloqueioPlataforma);
//   2. o contrato do contexto — o agente é INSTRUÍDO a emitir o marcador;
//   3. o desvínculo da task morta (pgLimparTask grava TASK_ID = '').
import { describe, it, expect, vi, beforeEach } from 'vitest';

const execSF = vi.fn();
vi.mock('../../hooks/useMitraData', () => ({ execSF: (...a: unknown[]) => execSF(...a) }));

import {
  pareceBloqueioPlataforma, MARCADOR_SEM_PLATAFORMA,
  buildContexto, suffixTurno, pgLimparTask, SF_PG,
} from '../playground';

beforeEach(() => {
  vi.clearAllMocks();
  execSF.mockResolvedValue([]);
});

describe('pareceBloqueioPlataforma', () => {
  it('detecta o marcador literal que o contexto pede ao agente', () => {
    expect(pareceBloqueioPlataforma(`Não consegui consultar os dados. ${MARCADOR_SEM_PLATAFORMA}`)).toBe(true);
  });

  it('detecta a prosa REAL do estudo #21 (sem marcador)', () => {
    const prosa = 'Só um aviso rápido: acabei de reverificar e o acesso desta tarefa à plataforma '
      + 'Mitra continua bloqueado (a credencial segue inválida/expirada). Por isso, a análise '
      + 'que você pediu antes continua pendente.';
    expect(pareceBloqueioPlataforma(prosa)).toBe(true);
  });

  it('detecta variações comuns de "sem acesso às ferramentas"', () => {
    expect(pareceBloqueioPlataforma('Estou sem acesso às server functions no momento.')).toBe(true);
    expect(pareceBloqueioPlataforma('Não consigo acessar o banco de dados: a chamada retorna 403.')).toBe(true);
  });

  it('NÃO dispara em análise normal que fala de "acesso" do domínio', () => {
    expect(pareceBloqueioPlataforma('O acesso dos gestores ao pacote foi liberado em março.')).toBe(false);
    expect(pareceBloqueioPlataforma('As despesas com plataforma de streaming subiram 12%.')).toBe(false);
  });

  it('NÃO dispara em erro de credencial de IA puro (outra causa, outra cura)', () => {
    expect(pareceBloqueioPlataforma('A credencial da OpenAI expirou.')).toBe(false);
  });

  it('vazio/nulo não dispara', () => {
    expect(pareceBloqueioPlataforma('')).toBe(false);
    expect(pareceBloqueioPlataforma(undefined as unknown as string)).toBe(false);
  });
});

describe('contrato do contexto — o agente é instruído a emitir o marcador', () => {
  it('buildContexto (1a mensagem) inclui a instrução do marcador', async () => {
    const ctx = await buildContexto(21, 'Quais contas mais cresceram?');
    expect(ctx).toContain(MARCADOR_SEM_PLATAFORMA);
    expect(ctx).toMatch(/autentica/i);
  });

  // O antigo "token permanente da plataforma" (contingência) foi removido:
  // o contexto do analista NUNCA pode voltar a carregar uma chave permanente.
  it('buildContexto não injeta acesso de contingência nem token algum', async () => {
    const ctx = await buildContexto(21, 'Quais contas mais cresceram?');
    expect(ctx).not.toContain('ACESSO DE CONTINGÊNCIA');
    expect(ctx).not.toMatch(/token: '/);
  });

  it('suffixTurno (mensagens seguintes) também inclui', () => {
    expect(suffixTurno(21, 'oi')).toContain(MARCADOR_SEM_PLATAFORMA);
  });
});

describe('pgLimparTask — desvincula a task morta do estudo', () => {
  it('grava TASK_ID vazio via playground_set_task', async () => {
    await pgLimparTask(21);
    expect(execSF).toHaveBeenCalledWith(SF_PG.setTask, { id: 21, taskId: '' });
  });
});
