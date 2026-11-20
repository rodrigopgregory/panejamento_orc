/**
 * Skeleton — placeholders de carregamento.
 *
 * POR QUE EXISTE: as telas montam com lista vazia enquanto a rede responde, e o
 * JSX de estado vazio ("Nenhum gestor cadastrado", "Tudo pronto") acabava sendo
 * exibido nesse intervalo — afirmando ausencia de dado quando o dado ainda
 * estava vindo. Estes componentes dao a terceira resposta, "ainda carregando",
 * e ja reservam a altura final, eliminando o salto de layout.
 *
 * Shimmer reaproveitado da classe .pg-skeleton (index.css), a mesma usada no
 * Dashboard e no Playground — nao criar variacao nova de animacao.
 */

type SkStyle = Record<string, string | number>;

const CARD_STYLE: SkStyle = {
  backgroundColor: 'var(--color-surface)',
  borderColor: 'var(--color-border)',
  boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
};

// Larguras ciclicas: barras de tamanho igual parecem roboticas, e Math.random
// mudaria a cada render. O offset por linha+coluna quebra o padrao visual sem
// abrir mao do determinismo.
const CELL_W = ['78%', '52%', '66%', '44%', '60%', '48%'];

/** Barra base com shimmer. Dimensione via className (h-4 w-24) ou style. */
export function Skeleton({ className = '', style }: { className?: string; style?: SkStyle }) {
  return <div className={`pg-skeleton ${className}`} style={style} />;
}

/** Moldura de card do app — mesma borda/sombra dos cards reais. */
export function SkeletonCard({
  children,
  className = '',
  style,
}: {
  children?: React.ReactNode;
  className?: string;
  style?: SkStyle;
}) {
  return (
    <div className={`rounded-xl border ${className}`} style={{ ...CARD_STYLE, ...style }}>
      {children}
    </div>
  );
}

/**
 * Faixa de KPIs — circulo de 48px + 3 linhas, identico ao card de KPI real.
 * Passe o mesmo `className` de grid usado pelos KPIs da tela para a faixa
 * ocupar exatamente o mesmo espaco.
 */
export function SkeletonKpis({
  count = 4,
  className = 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4',
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div className={className}>
      {Array.from({ length: count }, (_, i) => (
        <SkeletonCard key={i} className="p-5">
          <div className="flex items-center gap-4">
            <Skeleton className="w-12 h-12 shrink-0" style={{ borderRadius: '9999px' }} />
            <div className="flex-1 min-w-0 flex flex-col gap-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-5 w-16" />
              <Skeleton className="h-3 w-32" />
            </div>
          </div>
        </SkeletonCard>
      ))}
    </div>
  );
}

/**
 * Tabela — cabecalho + N linhas dentro da moldura de card, replicando o
 * espacamento das tabelas reais (px-6 na 1a coluna, px-3 nas demais, py-3).
 * `footer` reserva a barra de paginacao para a altura nao colapsar entre paginas.
 */
export function SkeletonTable({
  columns = 5,
  rows = 8,
  firstColWidth,
  footer = false,
  className = '',
}: {
  columns?: number;
  rows?: number;
  firstColWidth?: string;
  footer?: boolean;
  className?: string;
}) {
  const cols = Array.from({ length: columns }, (_, i) => i);
  return (
    <SkeletonCard className={`overflow-hidden ${className}`}>
      <table className="w-full text-sm">
        <thead>
          <tr>
            {cols.map((c) => (
              <th
                key={c}
                className={`text-left py-3 ${c === 0 ? 'px-6' : 'px-3'}`}
                style={c === 0 && firstColWidth ? { width: firstColWidth } : undefined}
              >
                <Skeleton className="h-3" style={{ width: c === 0 ? 90 : 64 }} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, r) => (
            <tr key={r} style={{ borderTop: '1px solid var(--color-border)' }}>
              {cols.map((c) => (
                <td key={c} className={`py-3 ${c === 0 ? 'px-6' : 'px-3'}`}>
                  <Skeleton className="h-4" style={{ width: CELL_W[(r + c) % CELL_W.length] }} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {footer && (
        <div className="px-6 py-3" style={{ borderTop: '1px solid var(--color-border)' }}>
          <Skeleton className="h-3 w-40" />
        </div>
      )}
    </SkeletonCard>
  );
}

/**
 * Cards em grid — para kanban e listas de cards. `className` deve repetir o
 * grid da tela; `height` deve bater com a altura do card real.
 */
export function SkeletonCards({
  count = 3,
  height = 120,
  className = '',
}: {
  count?: number;
  height?: number;
  className?: string;
}) {
  return (
    <div className={className}>
      {Array.from({ length: count }, (_, i) => (
        <SkeletonCard key={i} className="p-4" style={{ height }}>
          <div className="flex flex-col gap-2.5">
            <Skeleton className="h-3" style={{ width: '40%' }} />
            <Skeleton className="h-4" style={{ width: '72%' }} />
            <Skeleton className="h-1.5 mt-1" style={{ width: '100%', borderRadius: '9999px' }} />
          </div>
        </SkeletonCard>
      ))}
    </div>
  );
}

/**
 * Pagina inteira — fallback do Suspense enquanto o chunk da rota lazy baixa.
 *
 * POR QUE EXISTE: o fallback anterior era uma bolinha de 40px centralizada.
 * Como toda rota fora do Dashboard e lazy, era ela que o usuario via primeiro
 * ao entrar em Premissas, Folha e nas demais telas — um indicador redondo
 * generico, estranho ao resto do app, seguido pelo skeleton real da tela. Aqui
 * o fallback ja tem a forma de pagina (titulo, faixa de filtros, tabela), entao
 * a transicao chunk -> tela e continua: mesmo shimmer, mesmo layout.
 */
export function SkeletonPage() {
  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-5" style={{ width: 220 }} />
        <Skeleton className="h-3" style={{ width: 340 }} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {[200, 160, 240, 180].map((w, i) => (
          <Skeleton key={i} className="h-9" style={{ width: w }} />
        ))}
      </div>
      <SkeletonTable columns={6} rows={8} firstColWidth="260px" />
    </div>
  );
}

/** Itens de lista simples (sem moldura propria) — ex: coluna de modelos. */
export function SkeletonListItems({
  count = 6,
  height = 40,
  className = '',
}: {
  count?: number;
  height?: number;
  className?: string;
}) {
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} style={{ height, width: CELL_W[i % CELL_W.length] }} />
      ))}
    </div>
  );
}
