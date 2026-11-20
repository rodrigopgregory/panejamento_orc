import { useState, useCallback, useMemo } from 'react';
import { useOrdenacaoTabela } from './useOrdenacaoTabela';

// ──────────────────────────────────────────────────────────────────────
// Tabela de lancamentos contabeis com colunas manipulaveis pelo usuario:
// reordenar (arrastar o cabecalho), ocultar (menu "Colunas") e redimensionar
// (alca na borda direita do cabecalho).
//
// O estado vive so na sessao — recarregar a tela volta ao padrao. Foi o pedido
// ("temporariamente") e e o mesmo comportamento do seletor de colunas que a
// tela publica de DRE ja tem.
// ──────────────────────────────────────────────────────────────────────

const MESES_FALLBACK = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

const LARGURA_MINIMA = 80;

interface LancRow {
  id: number | string;
  ano: number;
  mes: number;
  empresaNome: string;
  crCodigo: string;
  crNome: string;
  codigo: string;
  nome: string;
  tipo: string;
  valor: number;
}

interface RenderCtx {
  monthsShort: string[];
  fiscalMonthNumbers: number[];
  tipoLabels: Record<string, string>;
}

interface ColunaDef {
  key: string;
  label: string;
  width: number;
  align: 'left' | 'right';
  // Direcao do primeiro clique no cabecalho. Em texto o util e comecar de A-Z;
  // em numero e data o que o usuario quer ver primeiro e o maior/mais recente.
  dirInicial: Direcao;
  render: (row: LancRow, ctx: RenderCtx) => React.ReactNode;
}

type Direcao = 'asc' | 'desc';  // espelha DirecaoOrdem do hook generico

function fmtVal(v: number): string {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(v);
}

const COLUNAS_LANCAMENTOS: ColunaDef[] = [
  {
    key: 'periodo', label: 'Período', width: 110, align: 'left', dirInicial: 'desc',
    render: (r, ctx) => (
      <>
        <span>{ctx.monthsShort[ctx.fiscalMonthNumbers.indexOf(r.mes)] || MESES_FALLBACK[r.mes - 1]}</span>
        <span className="ml-1 tabular-nums">/{r.ano}</span>
      </>
    ),
  },
  {
    key: 'empresa', label: 'Empresa', width: 180, align: 'left', dirInicial: 'asc',
    render: (r) => r.empresaNome,
  },
  {
    key: 'setor', label: 'Setor', width: 220, align: 'left', dirInicial: 'asc',
    render: (r) => (
      <>
        <span className="tabular-nums">{r.crCodigo}</span>
        <span className="ml-2">{r.crNome}</span>
      </>
    ),
  },
  {
    key: 'conta', label: 'Conta contábil', width: 300, align: 'left', dirInicial: 'asc',
    render: (r) => (
      <>
        <span className="tabular-nums">{r.codigo}</span>
        <span className="ml-2">{r.nome}</span>
      </>
    ),
  },
  {
    key: 'tipo', label: 'Tipo', width: 170, align: 'left', dirInicial: 'asc',
    render: (r, ctx) => (
      <span className="inline-block px-1.5 py-0.5 rounded" style={{ color: 'var(--color-text)', backgroundColor: 'var(--color-bg)' }}>
        {ctx.tipoLabels[r.tipo] || r.tipo.toLowerCase().replace(/_/g, ' ')}
      </span>
    ),
  },
  {
    key: 'valor', label: 'Valor', width: 130, align: 'right', dirInicial: 'desc',
    render: (r) => fmtVal(r.valor),
  },
];

const ORDEM_PADRAO = COLUNAS_LANCAMENTOS.map((c) => c.key);

// ── Hook de estado das colunas ───────────────────────────────────────
// Fica fora da tabela porque o botao "Colunas" mora na barra do card, e a
// tabela mora no corpo — os dois precisam do mesmo estado.
export function useColunasLancamentos() {
  const [ordem, setOrdem] = useState<string[]>(ORDEM_PADRAO);
  const [ocultas, setOcultas] = useState<string[]>([]);
  const [larguras, setLarguras] = useState<Record<string, number>>({});

  const colunas = useMemo(
    () => ordem
      .map((key) => COLUNAS_LANCAMENTOS.find((c) => c.key === key))
      .filter((c): c is ColunaDef => Boolean(c)),
    [ordem],
  );
  const visiveis = useMemo(() => colunas.filter((c) => !ocultas.includes(c.key)), [colunas, ocultas]);

  const alternarColuna = useCallback((key: string) => {
    setOcultas((prev) => {
      if (!prev.includes(key)) {
        // Nunca deixa a tabela sem nenhuma coluna.
        if (prev.length + 1 >= ORDEM_PADRAO.length) return prev;
        return [...prev, key];
      }
      return prev.filter((k) => k !== key);
    });
  }, []);

  const moverColuna = useCallback((origem: string, destino: string) => {
    if (origem === destino) return;
    setOrdem((prev) => {
      const from = prev.indexOf(origem);
      const to = prev.indexOf(destino);
      if (from < 0 || to < 0) return prev;
      const next = [...prev];
      next.splice(from, 1);
      next.splice(to, 0, origem);
      return next;
    });
  }, []);

  const redimensionarColuna = useCallback((key: string, largura: number) => {
    setLarguras((prev) => ({ ...prev, [key]: Math.max(LARGURA_MINIMA, Math.round(largura)) }));
  }, []);

  const restaurarPadrao = useCallback(() => {
    setOrdem(ORDEM_PADRAO);
    setOcultas([]);
    setLarguras({});
  }, []);

  const alterado = ordem.join() !== ORDEM_PADRAO.join() || ocultas.length > 0 || Object.keys(larguras).length > 0;

  return { colunas, visiveis, ocultas, larguras, alternarColuna, moverColuna, redimensionarColuna, restaurarPadrao, alterado };
}

// ── Ordenacao das linhas ─────────────────────────────────────────────
// A tabela e paginada no banco (LIMIT/OFFSET), entao ordenar aqui ordenaria
// so as 100 linhas da pagina — "maior valor" mostraria o maior DA PAGINA.
// Por isso o hook generico e usado sem `ordenar`: quem ordena e a SF 101,
// via os params ordemCampo/ordemDir.
export function useOrdenacaoLancamentos() {
  return useOrdenacaoTabela(COLUNAS_LANCAMENTOS);
}
