// O aperto de mao com o involucro (workspace): o app PEDE a sessao e o
// involucro responde com um token deste app. Sem o pedido nada chega — era
// esse o buraco que fazia a tela de login aparecer para quem ja estava logada
// no workspace.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { pedirSessaoAoInvolucro, PEDIDO_SESSAO, RESPOSTA_SESSAO } from '../sessao-involucro';

const ORIGEM_WORKSPACE = 'https://workspace.mitralab.io';
const SESSAO_BOA = { baseURL: 'https://beta.mitralab.io/legacy', token: 'tok-do-app' };

// Faz o app pensar que esta embutido: window.parent vira uma janela "de fora"
// que registra o que recebe e sabe responder.
function embutir() {
  const recebidas: any[] = [];
  const pai = { postMessage: (dado: any) => { recebidas.push(dado); } } as unknown as Window;
  vi.spyOn(window, 'parent', 'get').mockReturnValue(pai);
  return { pai, recebidas };
}

function responder(origem: string, fonte: Window | null, dado: any) {
  const e = new MessageEvent('message', { data: dado, origin: origem });
  Object.defineProperty(e, 'source', { value: fonte });
  window.dispatchEvent(e);
}

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('pedirSessaoAoInvolucro', () => {
  it('pede a sessao a quem embutiu o app', async () => {
    vi.useFakeTimers();
    const { pai, recebidas } = embutir();
    const p = pedirSessaoAoInvolucro(1000);
    await vi.advanceTimersByTimeAsync(1);

    expect(recebidas[0]).toEqual({ type: PEDIDO_SESSAO });

    responder(ORIGEM_WORKSPACE, pai, { type: RESPOSTA_SESSAO, session: SESSAO_BOA });
    expect(await p).toEqual({ token: 'tok-do-app', baseURL: 'https://beta.mitralab.io/legacy' });
    vi.useRealTimers();
  });

  it('fora do involucro (aba propria) nem pergunta', async () => {
    vi.spyOn(window, 'parent', 'get').mockReturnValue(window);
    expect(await pedirSessaoAoInvolucro(1000)).toBeNull();
  });

  it('ninguem responde: desiste no prazo e o app segue para os outros caminhos', async () => {
    vi.useFakeTimers();
    embutir();
    const p = pedirSessaoAoInvolucro(1000);
    await vi.advanceTimersByTimeAsync(1100);
    expect(await p).toBeNull();
    vi.useRealTimers();
  });

  it('insiste algumas vezes — o iframe pode nao estar no mapa do involucro ainda', async () => {
    vi.useFakeTimers();
    const { recebidas } = embutir();
    const p = pedirSessaoAoInvolucro(5000);
    await vi.advanceTimersByTimeAsync(3000);
    expect(recebidas.length).toBeGreaterThan(1);
    await vi.advanceTimersByTimeAsync(2100);
    await p;
    vi.useRealTimers();
  });

  it('ignora resposta de origem que nao e da plataforma', async () => {
    vi.useFakeTimers();
    const { pai } = embutir();
    const p = pedirSessaoAoInvolucro(1000);
    responder('https://site-malicioso.example', pai, { type: RESPOSTA_SESSAO, session: SESSAO_BOA });
    await vi.advanceTimersByTimeAsync(1100);
    expect(await p).toBeNull();
    vi.useRealTimers();
  });

  it('ignora resposta que nao vem de uma janela acima do app', async () => {
    vi.useFakeTimers();
    embutir();
    const p = pedirSessaoAoInvolucro(1000);
    responder(ORIGEM_WORKSPACE, null, { type: RESPOSTA_SESSAO, session: SESSAO_BOA });
    await vi.advanceTimersByTimeAsync(1100);
    expect(await p).toBeNull();
    vi.useRealTimers();
  });

  it('recusa backend fora da plataforma — nao passamos a obedecer endereco qualquer', async () => {
    vi.useFakeTimers();
    const { pai } = embutir();
    const p = pedirSessaoAoInvolucro(1000);
    responder(ORIGEM_WORKSPACE, pai, {
      type: RESPOSTA_SESSAO,
      session: { baseURL: 'https://api.atacante.example', token: 'tok' },
    });
    responder(ORIGEM_WORKSPACE, pai, {
      type: RESPOSTA_SESSAO,
      session: { baseURL: 'http://beta.mitralab.io/legacy', token: 'tok' },
    });
    await vi.advanceTimersByTimeAsync(1100);
    expect(await p).toBeNull();
    vi.useRealTimers();
  });

  it('recusa sessao sem token ou sem endereco', async () => {
    vi.useFakeTimers();
    const { pai } = embutir();
    const p = pedirSessaoAoInvolucro(1000);
    responder(ORIGEM_WORKSPACE, pai, { type: RESPOSTA_SESSAO, session: { baseURL: SESSAO_BOA.baseURL } });
    responder(ORIGEM_WORKSPACE, pai, { type: RESPOSTA_SESSAO, session: { token: 'tok' } });
    await vi.advanceTimersByTimeAsync(1100);
    expect(await p).toBeNull();
    vi.useRealTimers();
  });
});
