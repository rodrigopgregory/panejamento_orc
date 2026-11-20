import { useState, useCallback, useMemo, useRef, memo } from 'react';
import { Columns3, Eye, EyeOff, RotateCcw, GripVertical, ArrowUp, ArrowDown, ChevronsUpDown } from 'lucide-react';
import { useColunasLancamentos, useOrdenacaoLancamentos } from '../hooks/useColunasLancamentos';

// Tipos derivados do hook em vez de importados: o tsconfig usa
// verbatimModuleSyntax, entao type importado de outro arquivo quebra em
// runtime. Derivar do valor mantem os tres arquivos sempre em sincronia.
type ColunasState = ReturnType<typeof useColunasLancamentos>;
type OrdemState = ReturnType<typeof useOrdenacaoLancamentos>;
type ColunaDef = ColunasState['visiveis'][number];
type LancRow = Parameters<ColunaDef['render']>[0];
type RenderCtx = Parameters<ColunaDef['render']>[1];

// ── Menu "Colunas" ───────────────────────────────────────────────────
export function ColunasMenu({ estado }: { estado: ColunasState }) {
  const [aberto, setAberto] = useState(false);
  const { colunas, ocultas, visiveis, alternarColuna, restaurarPadrao, alterado } = estado;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        aria-haspopup="true"
        className="inline-flex items-center gap-1.5 px-2.5 h-8 text-xs font-medium rounded-lg transition-all duration-200"
        style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', color: alterado ? 'var(--color-primary)' : 'var(--color-text-secondary)' }}
      >
        <Columns3 size={14} /> Colunas
        {ocultas.length > 0 && (
          <span className="tabular-nums text-[11px]" style={{ color: 'var(--color-primary)' }}>
            {visiveis.length}/{colunas.length}
          </span>
        )}
      </button>
      {aberto && (
        <>
          <button className="fixed inset-0 z-10 cursor-default" aria-label="Fechar menu" onClick={() => setAberto(false)} />
          <div className="absolute right-0 z-20 mt-1 rounded-lg shadow-lg p-1.5 min-w-[210px]" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <p className="px-2.5 pt-1 pb-1.5 text-[10px] uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>
              Exibir colunas
            </p>
            {colunas.map((coluna) => {
              const visivel = !ocultas.includes(coluna.key);
              const ultima = visivel && visiveis.length === 1;
              return (
                <button
                  key={coluna.key}
                  type="button"
                  onClick={() => alternarColuna(coluna.key)}
                  disabled={ultima}
                  title={ultima ? 'Ao menos uma coluna precisa ficar visível' : undefined}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left text-xs disabled:cursor-not-allowed disabled:opacity-60"
                  style={{
                    color: visivel ? 'var(--color-primary)' : 'var(--color-text-muted)',
                    backgroundColor: visivel ? 'var(--color-primary-bg)' : 'transparent',
                  }}
                >
                  {visivel ? <Eye size={14} /> : <EyeOff size={14} />}{coluna.label}
                </button>
              );
            })}
            <div className="mt-1 pt-1" style={{ borderTop: '1px solid var(--color-border)' }}>
              <button
                type="button"
                onClick={() => { restaurarPadrao(); setAberto(false); }}
                disabled={!alterado}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left text-xs disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                <RotateCcw size={14} /> Restaurar padrão
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Tabela ───────────────────────────────────────────────────────────
// Memoizada: so re-renderiza quando os lancamentos ou o layout de colunas
// mudam — nao quando o usuario digita na busca do card.
export const TabelaLancamentos = memo(function TabelaLancamentos({ lancamentos, estado, ordenacao, monthsShort, fiscalMonthNumbers, tipoLabels }: {
  lancamentos: LancRow[];
  estado: ColunasState;
  ordenacao: OrdemState;
  monthsShort: string[];
  fiscalMonthNumbers: number[];
  tipoLabels: Record<string, string>;
}) {
  const { visiveis, larguras, moverColuna, redimensionarColuna } = estado;
  const { ordem, alternarOrdem } = ordenacao;
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [alvo, setAlvo] = useState<string | null>(null);
  const [redimensionando, setRedimensionando] = useState<string | null>(null);
  const resizeRef = useRef<{ key: string; startX: number; startW: number } | null>(null);

  const ctx = useMemo<RenderCtx>(
    () => ({ monthsShort, fiscalMonthNumbers, tipoLabels }),
    [monthsShort, fiscalMonthNumbers, tipoLabels],
  );

  const larguraDe = useCallback((c: ColunaDef) => larguras[c.key] ?? c.width, [larguras]);
  const larguraTotal = visiveis.reduce((soma, c) => soma + larguraDe(c), 0);

  const iniciarRedimensionamento = useCallback((e: React.MouseEvent, coluna: ColunaDef) => {
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = { key: coluna.key, startX: e.clientX, startW: larguraDe(coluna) };
    setRedimensionando(coluna.key);

    const mover = (ev: MouseEvent) => {
      const ref = resizeRef.current;
      if (!ref) return;
      redimensionarColuna(ref.key, ref.startW + (ev.clientX - ref.startX));
    };
    const soltar = () => {
      resizeRef.current = null;
      setRedimensionando(null);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', mover);
      document.removeEventListener('mouseup', soltar);
    };
    document.addEventListener('mousemove', mover);
    document.addEventListener('mouseup', soltar);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [larguraDe, redimensionarColuna]);

  const thBase = 'px-3 py-2.5 uppercase tracking-wide font-medium sticky top-0 z-10 select-none group';

  return (
    <table className="text-sm" style={{ tableLayout: 'fixed', width: '100%', minWidth: larguraTotal }}>
      <colgroup>
        {visiveis.map((c) => <col key={c.key} style={{ width: larguraDe(c) }} />)}
        {/* Absorve a sobra quando as colunas somam menos que o container,
            para as larguras fixas nao serem esticadas proporcionalmente. */}
        <col />
      </colgroup>
      <thead>
        <tr style={{ color: 'var(--color-text-secondary)', fontSize: '11px', backgroundColor: 'var(--color-surface)' }}>
          {visiveis.map((coluna) => {
            const ehAlvo = alvo === coluna.key && arrastando !== null && arrastando !== coluna.key;
            const ordenadaPor = ordem?.campo === coluna.key ? ordem.dir : null;
            const SortIcon = ordenadaPor === 'asc' ? ArrowUp : ordenadaPor === 'desc' ? ArrowDown : ChevronsUpDown;
            return (
              <th
                key={coluna.key}
                scope="col"
                aria-sort={ordenadaPor === 'asc' ? 'ascending' : ordenadaPor === 'desc' ? 'descending' : 'none'}
                // O clique ordena; o arraste reordena. Nao competem: o dragstart
                // do navegador so dispara depois de mover o ponteiro, e o click
                // e suprimido quando um arraste acontece.
                onClick={() => { if (!resizeRef.current) alternarOrdem(coluna.key); }}
                draggable={redimensionando === null}
                onDragStart={(e) => {
                  // A alca de redimensionar vive dentro do th arrastavel, e o
                  // atributo draggable so vira false no re-render seguinte ao
                  // mousedown. Sem esta guarda o navegador poderia iniciar um
                  // arraste de coluna no meio de um ajuste de largura.
                  if (resizeRef.current) { e.preventDefault(); return; }
                  setArrastando(coluna.key);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setAlvo(coluna.key); }}
                onDragLeave={() => setAlvo((k) => (k === coluna.key ? null : k))}
                onDrop={(e) => { e.preventDefault(); if (arrastando) moverColuna(arrastando, coluna.key); setArrastando(null); setAlvo(null); }}
                onDragEnd={() => { setArrastando(null); setAlvo(null); }}
                title="Clique para ordenar. Arraste para reordenar a coluna. Puxe a borda direita para ajustar a largura."
                className={`${thBase} ${coluna.align === 'right' ? 'text-right' : 'text-left'}`}
                style={{
                  backgroundColor: 'var(--color-surface)',
                  borderBottom: '1px solid var(--color-border)',
                  cursor: redimensionando ? 'col-resize' : 'grab',
                  opacity: arrastando === coluna.key ? 0.4 : 1,
                  boxShadow: ehAlvo ? 'inset 2px 0 0 0 var(--color-primary)' : undefined,
                  position: 'relative',
                }}
              >
                <span className={`inline-flex items-center gap-1 ${coluna.align === 'right' ? 'flex-row-reverse' : ''}`}>
                  <GripVertical
                    size={11}
                    className="opacity-0 group-hover:opacity-60 transition-opacity duration-150 shrink-0"
                    aria-hidden
                  />
                  {coluna.label}
                  <SortIcon
                    size={12}
                    aria-hidden
                    className={`shrink-0 transition-opacity duration-150 ${ordenadaPor ? 'opacity-100' : 'opacity-0 group-hover:opacity-50'}`}
                    style={{ color: ordenadaPor ? 'var(--color-primary)' : undefined }}
                  />
                </span>
                <span
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={`Ajustar largura da coluna ${coluna.label}`}
                  onMouseDown={(e) => iniciarRedimensionamento(e, coluna)}
                  // Sem isto o clique na alca sobe para o th e ordenaria a tabela
                  // toda vez que o usuario so quisesse ajustar a largura.
                  onClick={(e) => e.stopPropagation()}
                  onDragStart={(e) => e.preventDefault()}
                  className="absolute top-0 right-0 h-full"
                  style={{
                    width: 7,
                    cursor: 'col-resize',
                    // Faixa visivel so no hover/arrasto: sinaliza a alca sem
                    // poluir o cabecalho com uma linha permanente por coluna.
                    borderRight: redimensionando === coluna.key ? '2px solid var(--color-primary)' : '2px solid transparent',
                  }}
                  onMouseEnter={(e) => { if (!redimensionando) e.currentTarget.style.borderRight = '2px solid var(--color-border)'; }}
                  onMouseLeave={(e) => { if (redimensionando !== coluna.key) e.currentTarget.style.borderRight = '2px solid transparent'; }}
                />
              </th>
            );
          })}
          <th aria-hidden style={{ backgroundColor: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }} className="sticky top-0 z-10" />
        </tr>
      </thead>
      <tbody>
        {lancamentos.length === 0 ? (
          <tr>
            <td colSpan={visiveis.length + 1} className="text-center py-10" style={{ color: 'var(--color-text-muted)' }}>
              Nenhum lançamento com os filtros atuais
            </td>
          </tr>
        ) : lancamentos.map((r) => (
          <tr key={r.id} style={{ borderTop: '1px solid var(--color-border)' }}>
            {visiveis.map((coluna) => (
              <td
                key={coluna.key}
                className={`py-3 px-3 text-sm overflow-hidden ${coluna.align === 'right' ? 'text-right tabular-nums font-medium' : ''}`}
                style={{ color: 'var(--color-text)', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              >
                {coluna.render(r, ctx)}
              </td>
            ))}
            <td aria-hidden />
          </tr>
        ))}
      </tbody>
    </table>
  );
});
