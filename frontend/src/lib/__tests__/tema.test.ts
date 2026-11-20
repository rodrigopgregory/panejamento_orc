// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Casca de plataforma falsa: um documento same-origin acima do app, como o
// preview dentro do builder.
function montarCasca(html: { attrs?: Record<string, string>; classe?: string; fundo?: string; store?: Record<string, string> }) {
  const doc = document.implementation.createHTMLDocument('casca');
  if (html.attrs) for (const [k, v] of Object.entries(html.attrs)) doc.documentElement.setAttribute(k, v);
  if (html.classe) doc.documentElement.className = html.classe;
  const store: Record<string, string> = html.store || {};
  const chaves = () => Object.keys(store);
  const janela = {
    document: doc,
    localStorage: {
      get length() { return chaves().length; },
      key: (i: number) => chaves()[i] ?? null,
      getItem: (k: string) => store[k] ?? null,
    },
    getComputedStyle: () => ({ colorScheme: 'normal', backgroundColor: html.fundo || 'rgba(0, 0, 0, 0)' }),
  };
  Object.defineProperty(doc, 'defaultView', { value: janela, configurable: true });
  (janela as unknown as { parent: unknown }).parent = janela; // topo da cadeia
  Object.defineProperty(window, 'parent', { value: janela, configurable: true });
}

function semCasca() {
  Object.defineProperty(window, 'parent', { value: window, configurable: true });
}

function preferenciaDoSo(escuro: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: escuro && q.includes('dark'),
    addEventListener: () => {}, removeEventListener: () => {},
  }));
}

async function resolver() {
  vi.resetModules();
  const { sincronizarTemaDaPlataforma } = await import('../tema');
  sincronizarTemaDaPlataforma();
  return document.documentElement.dataset.theme;
}

describe('tema seguido do workspace', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.className = '';
    window.history.replaceState({}, '', '/');
    preferenciaDoSo(false); // SO claro: qualquer "dark" veio da plataforma
  });
  afterEach(() => { vi.unstubAllGlobals(); semCasca(); });

  it('le o data-theme da casca da plataforma', async () => {
    montarCasca({ attrs: { 'data-theme': 'dark' } });
    expect(await resolver()).toBe('dark');
  });

  it('le a classe .dark da casca', async () => {
    montarCasca({ classe: 'dark' });
    expect(await resolver()).toBe('dark');
  });

  it('le o localStorage da casca sem depender do nome exato da chave', async () => {
    montarCasca({ store: { 'mitra:ui.colorScheme': 'dark' } });
    expect(await resolver()).toBe('dark');
  });

  it('cai no fundo escuro da casca quando nao ha sinal declarado', async () => {
    montarCasca({ fundo: 'rgb(11, 12, 14)' });
    expect(await resolver()).toBe('dark');
  });

  it('nao confunde fundo claro do quadro de preview com tema claro', async () => {
    // casca clara no fundo, mas declarando dark: o declarado vence
    montarCasca({ attrs: { 'data-theme': 'dark' }, fundo: 'rgb(255, 255, 255)' });
    expect(await resolver()).toBe('dark');
  });

  it('respeita hand-off explicito na URL acima de tudo', async () => {
    montarCasca({ classe: 'dark' });
    window.history.replaceState({}, '', '/?theme=light');
    expect(await resolver()).toBe('light');
  });

  it('cross-origin (casca inacessivel): cai na preferencia do SO', async () => {
    semCasca();
    preferenciaDoSo(true);
    expect(await resolver()).toBe('dark');
  });

  it('aceita o tema anunciado por postMessage da plataforma', async () => {
    semCasca();
    vi.resetModules();
    const { sincronizarTemaDaPlataforma } = await import('../tema');
    sincronizarTemaDaPlataforma();
    expect(document.documentElement.dataset.theme).toBe('light');
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'mitra-theme', theme: 'dark' } }));
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('nao escreve preferencia de tema em localStorage', async () => {
    montarCasca({ classe: 'dark' });
    localStorage.setItem('budget-corp-theme', 'light'); // residuo do toggle antigo
    await resolver();
    expect(localStorage.getItem('budget-corp-theme')).toBeNull();
    expect(localStorage.length).toBe(0);
  });
});

describe('mensagens da plataforma (formato agnostico)', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    window.history.replaceState({}, '', '/');
    preferenciaDoSo(false);
    Object.defineProperty(window, 'parent', { value: window, configurable: true });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  const formatos: Array<[string, unknown]> = [
    ['{ theme }', { theme: 'dark' }],
    ['{ type, value }', { type: 'mitra:theme', value: 'dark' }],
    ['{ colorScheme }', { colorScheme: 'dark' }],
    ['{ mode }', { type: 'workspace-config', mode: 'dark' }],
    ['aninhado em payload', { type: 'config', payload: { ui: { theme: 'dark' } } }],
    ['string pura', 'dark'],
  ];

  for (const [nome, dado] of formatos) {
    it(`aceita ${nome}`, async () => {
      vi.resetModules();
      const { sincronizarTemaDaPlataforma } = await import('../tema');
      sincronizarTemaDaPlataforma();
      expect(document.documentElement.dataset.theme).toBe('light');
      window.dispatchEvent(new MessageEvent('message', { data: dado }));
      expect(document.documentElement.dataset.theme).toBe('dark');
    });
  }

  it('ignora mensagem sem tema e registra diagnostico', async () => {
    vi.resetModules();
    const { sincronizarTemaDaPlataforma } = await import('../tema');
    sincronizarTemaDaPlataforma();
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'outra-coisa', ok: true } }));
    expect(document.documentElement.dataset.theme).toBe('light');
    const diag = (window as unknown as Record<string, { camada: string; mensagens: unknown[] }>).__tema;
    expect(diag.camada).toBe('sistema');
    expect(diag.mensagens.length).toBe(1);
  });

  it('le o tema do fragment da URL mesmo que o initMitra limpe o hash depois', async () => {
    window.history.replaceState({}, '', '/#tokenMitra=abc&themeMitra=dark');
    vi.resetModules();
    const { sincronizarTemaDaPlataforma } = await import('../tema'); // modulo captura a URL aqui
    window.history.replaceState({}, '', '/');                        // initMitra limpa o hash
    sincronizarTemaDaPlataforma();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
