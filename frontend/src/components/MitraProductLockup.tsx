import { useSyncExternalStore } from 'react';

/**
 * Assinatura de arquitetura de marca:  [simbolo] mitra | [PRODUTO]
 *
 * Regras que este componente centraliza (nao replicar em telas):
 * - O simbolo e o lettering "mitra" sao ASSETS oficiais. Nenhum dos dois e
 *   desenhado aqui: ambos entram como mascara CSS do arquivo original, pintados
 *   por `currentColor`. Isso preserva desenho, kerning, proporcoes e permite que
 *   a cor acompanhe o tema (claro/escuro) sem fill fixo dentro do SVG.
 * - "mitra" e a marca; o nome do produto e apenas um DESCRITOR, por isso o
 *   divisor vertical entre os dois.
 * - Todas as medidas derivam de UMA medida: a altura visual do lettering
 *   (`wordmarkHeight`, tambem exposta como --mitra-wordmark-height). Nada e
 *   dimensionado isoladamente, para o lockup escalar inteiro.
 *
 * Alinhamento: a cauda (lettering | produto) e apoiada na LINHA DE BASE, nao
 * centralizada. Centrado geometricamente, o descritor — mais baixo que a marca —
 * flutua no meio da altura do lettering e le como um segundo bloco solto. Como o
 * "mitra" nao tem descendentes, a base da tinta do lettering E a linha de base:
 * o descritor e o divisor se apoiam nela. As caixas de texto sao aparadas ate a
 * tinta por margens negativas calculadas com as metricas da fonte, para nenhuma
 * folga invisivel entrar na conta. O simbolo segue centrado na tinta da marca.
 */

const SYMBOL_SRC = '/logo.svg';
const LETTERING_SRC = '/mitra-lettering.svg';

/** Proporcoes do lockup, todas relativas a altura visual do lettering. */
const RATIO = {
  symbol: 1.35,      // simbolo tem massa visual menor: fica um pouco maior
  gapSymbol: 0.4,    // simbolo -> lettering (parte da mesma marca: gap curto)
  gapMark: 0.5,      // lettering -> divisor (respiro da marca)
  gapProduct: 0.32,  // divisor -> produto (mais colado: a haste do descritor abre espaco otico)
  divider: 0.85,     // altura da linha divisoria, apoiada na linha de base
  product: 0.9,      // font-size do descritor (~65% de altura visual)
} as const;

const DIVIDER_OPACITY = 0.3;

/**
 * Altura da tinta de "mitra" (topo do 't' ate a base) em relacao ao font-size,
 * na fonte do sistema. O asset oficial tem viewBox colado ao desenho, entao
 * `wordmarkHeight` e altura de TINTA; para a reserva textual casar com essa
 * mesma altura o font-size precisa ser maior que ela. Sem isso o "mitra" de
 * reserva sai pequeno demais e o descritor rouba a hierarquia da marca.
 */
const FALLBACK_INK = 0.73;

/**
 * Metricas da fonte da interface (Inter) com `line-height: 1`, em fracao do
 * font-size. Com a entrelinha zerada a caixa do texto mede exatamente 1em e a
 * linha de base cai a BASELINE_FROM_BOTTOM do fundo dessa caixa (ascender 0.969
 * + descender 0.241 = 1.21em => meia-entrelinha negativa de 0.105em). Sao esses
 * numeros que permitem apoiar marca e descritor na mesma linha de base sem
 * nudge chutado.
 */
const BASELINE_FROM_BOTTOM = 0.136;
const CAP_HEIGHT = 0.727;

// ─────────────────────────────────────────────────────────────────────────────
// Deteccao do lettering oficial em runtime (cache em nivel de modulo)
// ─────────────────────────────────────────────────────────────────────────────

type LetteringAsset =
  | { status: 'pending' }
  | { status: 'missing' }
  | { status: 'ok'; aspect: number }; // aspect = naturalWidth / naturalHeight

let cache: LetteringAsset = { status: 'pending' };
let probe: Promise<LetteringAsset> | null = null;
const listeners = new Set<() => void>();

/**
 * Testa uma unica vez se `/mitra-lettering.svg` existe e, se existir, extrai a
 * proporcao REAL do arquivo. A largura do lettering nunca e chutada: sai de
 * `altura x naturalWidth / naturalHeight`.
 */
function detectLettering(): Promise<LetteringAsset> {
  if (probe) return probe;
  probe = new Promise<LetteringAsset>((resolve) => {
    if (typeof window === 'undefined' || typeof Image === 'undefined') {
      resolve({ status: 'missing' });
      return;
    }
    const image = new Image();
    image.onload = () => {
      const w = image.naturalWidth;
      const h = image.naturalHeight;
      // SVG sem dimensao intrinseca utilizavel: sem proporcao confiavel, o
      // fallback textual e preferivel a deformar o desenho.
      resolve(w > 0 && h > 0 ? { status: 'ok', aspect: w / h } : { status: 'missing' });
    };
    image.onerror = () => resolve({ status: 'missing' });
    image.src = LETTERING_SRC;
  }).then((result) => {
    cache = result;
    listeners.forEach((notify) => notify());
    return result;
  });
  return probe;
}

// Dispara a deteccao assim que o modulo carrega, para o primeiro render ja
// chegar com o resultado quando possivel.
void detectLettering();

// O resultado da deteccao e um store externo (uma unica leitura por sessao,
// compartilhada por todas as instancias do lockup).
function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  void detectLettering();
  return () => { listeners.delete(notify); };
}

function getSnapshot(): LetteringAsset {
  return cache;
}

function useLetteringAsset(): LetteringAsset {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// ─────────────────────────────────────────────────────────────────────────────
// Pecas
// ─────────────────────────────────────────────────────────────────────────────

function maskStyle(src: string): React.CSSProperties {
  return {
    WebkitMaskImage: `url('${src}')`,
    maskImage: `url('${src}')`,
    WebkitMaskRepeat: 'no-repeat',
    maskRepeat: 'no-repeat',
    WebkitMaskSize: 'contain',
    maskSize: 'contain',
    WebkitMaskPosition: 'center',
    maskPosition: 'center',
    backgroundColor: 'currentColor',
  };
}

/** Simbolo oficial (public/logo.svg) aplicado como mascara — herda a cor. */
function MitraSymbol({ size }: { size: number }) {
  return (
    <span
      aria-hidden
      data-testid="mitra-symbol"
      className="block shrink-0"
      style={{ width: size, height: size, ...maskStyle(SYMBOL_SRC) }}
    />
  );
}

/** Lettering oficial (public/mitra-lettering.svg) como mascara. */
function OfficialMitraLettering({ height, aspect }: { height: number; aspect: number }) {
  return (
    <span
      aria-hidden
      data-testid="mitra-lettering-oficial"
      className="block shrink-0"
      style={{ height, width: height * aspect, ...maskStyle(LETTERING_SRC) }}
    />
  );
}

/**
 * Reserva textual — SOMENTE operacional, enquanto o asset oficial nao existe no
 * projeto. Nao imita o logotipo: usa a tipografia do sistema, discreta.
 */
function MitraTextFallback({ height }: { height: number }) {
  const fontSize = Math.round(height / FALLBACK_INK);
  return (
    <span
      aria-hidden
      data-testid="mitra-lettering-fallback"
      className="block shrink-0"
      style={{
        fontSize,
        lineHeight: 1,
        fontWeight: 500,
        letterSpacing: '-0.01em',
        whiteSpace: 'nowrap',
        // Apara a caixa da fonte ate a tinta: o que sobra em cima e embaixo e
        // folga da fonte, e entraria na conta do alinhamento como se fosse
        // desenho. Aparada, a caixa passa a valer o mesmo que o asset oficial.
        marginTop: -Math.round(fontSize * (1 - BASELINE_FROM_BOTTOM - FALLBACK_INK)),
        marginBottom: -Math.round(fontSize * BASELINE_FROM_BOTTOM),
      }}
    >
      mitra
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Lockup
// ─────────────────────────────────────────────────────────────────────────────

interface MitraProductLockupProps {
  /** Nome do produto ja na grafia oficial (ex.: "FP&A", "Profit Guard"). */
  product?: string;
  /** Altura visual do lettering "mitra", em px. Comanda todo o lockup. */
  wordmarkHeight?: number;
  /**
   * Modo compacto: so o simbolo. Usar apenas onde a navegacao ja opera
   * deliberadamente compacta (ex.: sidebar retraida).
   */
  symbolOnly?: boolean;
  /**
   * Quando a cauda (mitra | produto) deve aparecer:
   * 'always' (padrao) ou 'lg' (aparece a partir do breakpoint lg).
   */
  tailVisibility?: 'always' | 'lg';
  /** Largura maxima do descritor; acima disso ele trunca (a marca nunca trunca). */
  productMaxWidth?: number;
  /** Rotulo para leitor de tela. Padrao: "Mitra — <produto>". */
  label?: string;
  /** Marca o lockup como decorativo (quando o produto ja e lido em outro lugar). */
  decorative?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export default function MitraProductLockup({
  product,
  wordmarkHeight = 20,
  symbolOnly = false,
  tailVisibility = 'always',
  productMaxWidth,
  label,
  decorative = false,
  className = '',
  style,
}: MitraProductLockupProps) {
  const asset = useLetteringAsset();

  const h = wordmarkHeight;
  const symbolSize = Math.round(h * RATIO.symbol);
  const gapSymbol = Math.round(h * RATIO.gapSymbol);
  const gapMark = Math.round(h * RATIO.gapMark);
  const gapProduct = Math.round(h * RATIO.gapProduct);
  const dividerHeight = Math.round(h * RATIO.divider);
  const productSize = Math.round(h * RATIO.product);
  // O descritor trunca (overflow hidden), entao precisa de respiro interno para
  // nao cortar descendentes de nomes em caixa mista ("Playground"). O respiro e
  // devolvido em margem negativa: nao desloca nada, so evita o corte.
  const productPad = Math.ceil(productSize * 0.25);

  const a11y = decorative
    ? ({ 'aria-hidden': true } as const)
    : ({ role: 'img', 'aria-label': label ?? (product ? `Mitra — ${product}` : 'Mitra') } as const);

  const tailClass = tailVisibility === 'lg' ? 'hidden lg:inline-flex' : 'inline-flex';

  return (
    <span
      {...a11y}
      data-testid="mitra-lockup"
      className={`inline-flex items-center min-w-0 ${className}`}
      style={{
        // Medida unica que comanda o lockup — visivel/inspecionavel em CSS.
        ['--mitra-wordmark-height' as string]: `${h}px`,
        color: 'inherit',
        gap: gapSymbol,
        ...style,
      }}
    >
      <MitraSymbol size={symbolSize} />

      {!symbolOnly && (
        <span
          data-testid="mitra-lockup-cauda"
          className={`${tailClass} items-end min-w-0`}
          style={{ gap: gapProduct }}
        >
          {asset.status === 'ok'
            ? <OfficialMitraLettering height={h} aspect={asset.aspect} />
            : <MitraTextFallback height={h} />}

          {product && (
            <>
              <span
                aria-hidden
                data-testid="mitra-lockup-divisor"
                className="block shrink-0"
                style={{
                  width: 1,
                  height: dividerHeight,
                  backgroundColor: 'currentColor',
                  opacity: DIVIDER_OPACITY,
                  // O gap da cauda ja aplica o espaco do lado do produto; aqui
                  // entra so a diferenca do lado da marca.
                  marginLeft: gapMark - gapProduct,
                }}
              />
              <span
                aria-hidden
                data-testid="mitra-lockup-produto"
                className="block min-w-0 truncate"
                style={{
                  fontSize: productSize,
                  lineHeight: 1,
                  fontWeight: 400,
                  letterSpacing: '-0.01em',
                  maxWidth: productMaxWidth,
                  paddingTop: productPad,
                  paddingBottom: productPad,
                  // Apoia a caixa alta do descritor na linha de base da marca.
                  marginTop: -(Math.round(productSize * (1 - BASELINE_FROM_BOTTOM - CAP_HEIGHT)) + productPad),
                  marginBottom: -(Math.round(productSize * BASELINE_FROM_BOTTOM) + productPad),
                }}
              >
                {product}
              </span>
            </>
          )}
        </span>
      )}
    </span>
  );
}
