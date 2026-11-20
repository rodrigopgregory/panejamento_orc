// A assinatura [simbolo] mitra | [PRODUTO] tem de trocar sozinha para o
// lettering oficial no dia em que public/mitra-lettering.svg entrar no projeto,
// e derivar todas as medidas da altura do lettering.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.resetModules(); });

// Cada caso precisa de um modulo novo: a deteccao do asset e cacheada em nivel
// de modulo (uma unica leitura por sessao).
async function carregarLockup() {
  vi.resetModules();
  return (await import('../MitraProductLockup')).default;
}

// Image de mentira: dispara onload/onerror conforme o cenario.
function stubImage(resultado: { w: number; h: number } | 'erro') {
  class FakeImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = 0;
    naturalHeight = 0;
    set src(_v: string) {
      queueMicrotask(() => {
        if (resultado === 'erro') { this.onerror?.(); return; }
        this.naturalWidth = resultado.w;
        this.naturalHeight = resultado.h;
        this.onload?.();
      });
    }
  }
  vi.stubGlobal('Image', FakeImage);
}

describe('MitraProductLockup', () => {
  it('cai no texto de reserva quando o lettering oficial nao existe', async () => {
    stubImage('erro');
    const MitraProductLockup = await carregarLockup();

    render(<MitraProductLockup product="FP&A" wordmarkHeight={20} />);

    await waitFor(() => expect(screen.getByTestId('mitra-lettering-fallback')).toBeTruthy());
    expect(screen.queryByTestId('mitra-lettering-oficial')).toBeNull();
    expect(screen.getByTestId('mitra-lockup-produto').textContent).toBe('FP&A');
    expect(screen.getByTestId('mitra-lockup-divisor')).toBeTruthy();
  });

  it('usa o lettering oficial e tira a largura da proporcao real do arquivo', async () => {
    stubImage({ w: 300, h: 100 }); // proporcao 3:1
    const MitraProductLockup = await carregarLockup();

    render(<MitraProductLockup product="FP&A" wordmarkHeight={20} />);

    const lettering = await screen.findByTestId('mitra-lettering-oficial');
    expect(screen.queryByTestId('mitra-lettering-fallback')).toBeNull();
    expect(lettering.style.height).toBe('20px');
    expect(lettering.style.width).toBe('60px'); // 20 x 300/100
    expect(lettering.style.maskImage).toContain('mitra-lettering.svg');
    expect(lettering.style.backgroundColor).toBe('currentcolor');
  });

  it('deriva simbolo e divisor da altura do lettering', async () => {
    stubImage('erro');
    const MitraProductLockup = await carregarLockup();

    render(<MitraProductLockup product="FP&A" wordmarkHeight={20} />);

    const simbolo = screen.getByTestId('mitra-symbol');
    expect(simbolo.style.width).toBe('27px');  // 1.35 x 20
    expect(simbolo.style.height).toBe('27px');
    expect(simbolo.style.maskImage).toContain('logo.svg');
    expect(simbolo.style.backgroundColor).toBe('currentcolor');

    const divisor = screen.getByTestId('mitra-lockup-divisor');
    expect(divisor.style.width).toBe('1px');
    expect(divisor.style.height).toBe('17px'); // 0.85 x 20
  });

  it('mantem o descritor subordinado a marca: sem negrito e menor que o lettering', async () => {
    stubImage('erro');
    const MitraProductLockup = await carregarLockup();

    render(<MitraProductLockup product="FP&A" wordmarkHeight={20} />);

    const produto = screen.getByTestId('mitra-lockup-produto');
    expect(produto.style.fontWeight).toBe('400');
    expect(produto.style.fontSize).toBe('18px'); // 0.9 x 20

    // A reserva textual e dimensionada pela altura de TINTA, senao o "mitra"
    // sai menor que o descritor e a hierarquia da marca se perde.
    const reserva = await screen.findByTestId('mitra-lettering-fallback');
    expect(reserva.style.fontSize).toBe('27px'); // 20 / 0.73
    expect(Number(produto.style.fontSize.replace('px', '')))
      .toBeLessThan(Number(reserva.style.fontSize.replace('px', '')));
  });

  it('apoia o descritor na linha de base da marca e o mantem colado ao divisor', async () => {
    stubImage('erro');
    const MitraProductLockup = await carregarLockup();

    render(<MitraProductLockup product="FP&A" wordmarkHeight={20} />);

    // Baseline, nao centro geometrico: centralizado, o descritor (mais baixo)
    // flutuava no meio da altura do lettering.
    const cauda = screen.getByTestId('mitra-lockup-cauda');
    expect(cauda.className).toContain('items-end');

    // O divisor respira mais do lado da marca do que do lado do produto.
    const gapProduto = Number(cauda.style.gap.replace('px', ''));
    const extraDaMarca = Number(
      screen.getByTestId('mitra-lockup-divisor').style.marginLeft.replace('px', ''),
    );
    expect(gapProduto).toBe(6);        // 0.32 x 20
    expect(extraDaMarca).toBe(4);      // 0.5 x 20 - 6
    expect(extraDaMarca).toBeGreaterThan(0);

    // Caixas de texto aparadas ate a tinta, senao a folga da fonte entra na
    // conta do alinhamento como se fosse desenho.
    const produto = screen.getByTestId('mitra-lockup-produto');
    expect(produto.style.marginBottom).toBe('-7px'); // 0.136 x 18 + respiro 5
    expect(produto.style.paddingBottom).toBe('5px'); // nao corta descendentes

    const reserva = await screen.findByTestId('mitra-lettering-fallback');
    expect(reserva.style.marginBottom).toBe('-4px'); // 0.136 x 27
  });

  it('no modo compacto mantem so o simbolo', async () => {
    stubImage('erro');
    const MitraProductLockup = await carregarLockup();

    render(<MitraProductLockup product="FP&A" symbolOnly />);

    expect(screen.getByTestId('mitra-symbol')).toBeTruthy();
    expect(screen.queryByTestId('mitra-lockup-produto')).toBeNull();
    expect(screen.queryByTestId('mitra-lockup-divisor')).toBeNull();
  });

  it('anuncia marca e produto como uma unica identidade', async () => {
    stubImage('erro');
    const MitraProductLockup = await carregarLockup();

    render(<MitraProductLockup product="FP&A" />);

    expect(screen.getByRole('img', { name: 'Mitra — FP&A' })).toBeTruthy();
  });
});
