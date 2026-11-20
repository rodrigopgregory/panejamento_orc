// Garante que erro de render vira mensagem com saida, nunca tela branca.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import ErrorBoundary from '../ErrorBoundary';

afterEach(() => { cleanup(); sessionStorage.clear(); vi.restoreAllMocks(); });

// O boundary loga o erro no console; silencia para nao poluir a saida do teste.
beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}); });

function Explode({ mensagem }: { mensagem: string }): never {
  throw new Error(mensagem);
}

describe('ErrorBoundary', () => {
  it('deixa passar o conteudo quando nao ha erro', () => {
    render(<ErrorBoundary><p>conteudo normal</p></ErrorBoundary>);

    expect(screen.getByText('conteudo normal')).toBeTruthy();
  });

  it('troca a tela branca por mensagem com botao de recarregar', () => {
    render(<ErrorBoundary><Explode mensagem="quebrou no render" /></ErrorBoundary>);

    expect(screen.getByText(/Nao foi possivel abrir esta tela/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Recarregar/i })).toBeTruthy();
    // A mensagem tecnica ajuda o suporte a identificar o bug.
    expect(screen.getByText(/quebrou no render/)).toBeTruthy();
  });

  it('chunk desatualizado: recarrega sozinho uma vez', () => {
    const reload = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload },
    });

    render(
      <ErrorBoundary>
        <Explode mensagem="Failed to fetch dynamically imported module: /assets/FolhaPage-abc.js" />
      </ErrorBoundary>,
    );

    expect(reload).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem('mitra:recarregou-por-chunk')).toBe('1');
  });

  it('chunk desatualizado: nao entra em loop se o reload nao resolveu', () => {
    const reload = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload },
    });
    sessionStorage.setItem('mitra:recarregou-por-chunk', '1');

    render(
      <ErrorBoundary>
        <Explode mensagem="Failed to fetch dynamically imported module: /assets/FolhaPage-abc.js" />
      </ErrorBoundary>,
    );

    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByText(/Esta tela foi atualizada/i)).toBeTruthy();
  });
});
