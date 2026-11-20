import { useState, useEffect, useMemo, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { execSF, execSFCached, SF_IDS } from '../hooks/useMitraData';
import { Card, CardContent } from '../components/ui/Card';
import Badge from '../components/ui/Badge';
import {
  ArrowRight,

} from 'lucide-react';
import { Link } from 'react-router-dom';

const HIGHLIGHT_KEYS = ['receita líquida', 'receita liquida', 'lucro bruto', 'ebitda', 'resultado líquido', 'resultado liquido', 'resultado operacional'];

// Formatacao brasileira dos KPIs: R$ 10,8 mi / -R$ 118 mil / -1,1%
function nBR(v: number, dec: number): string {
  return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec }).format(v);
}
function fmtMoedaBR(v: number): string {
  const sign = v < 0 ? '-' : '';
  const a = Math.abs(v);
  if (a >= 1_000_000) return `${sign}R$ ${nBR(a / 1_000_000, 1)} mi`;
  if (a >= 1_000) return `${sign}R$ ${nBR(a / 1_000, 0)} mil`;
  return `${sign}R$ ${nBR(a, 0)}`;
}
function fmtPctBR(v: number): string {
  return `${nBR(v, 1)}%`;
}
// Magnitude da variacao (sem sinal — a seta indica a direcao)
function fmtVarMoedaBR(v: number): string {
  return fmtMoedaBR(Math.abs(v));
}
function fmtVarPpBR(v: number): string {
  return `${nBR(Math.abs(v), 0)} p.p.`;
}

interface DRERow {
  label: string;
  isSubtotal: boolean;
  isHighlight: boolean;
  orcadoAtual: number;
  realizado: number;
  orcadoControle: number;
}

export default function Dashboard() {
  const location = useLocation();
  // Leituras de base via SFs SQL dedicadas (~8ms no banco), em paralelo e com
  // cache TTL — voltar pra home dentro do TTL nao refaz nenhuma chamada.
  const [baseData, setBaseData] = useState<any[][]>([]);
  const [loading, setLoading] = useState(true);
  const loadBase = useCallback(async (fresh = false) => {
    try {
      const ttl = fresh ? 0 : 60_000;
      const rows = await Promise.all([
        execSFCached(SF_IDS.baseCiclos, {}, ttl),
        execSFCached(SF_IDS.baseDreConfig, {}, ttl),
        execSFCached(SF_IDS.baseContas, {}, ttl),
      ]);
      setBaseData(rows);
      // Sem ciclo ou sem config de DRE, buildDRE nunca roda — encerra o skeleton aqui.
      if (!(rows[0] || []).length || !(rows[1] || []).length || !(rows[2] || []).length) setLoading(false);
    } catch (e) { console.error(e); setLoading(false); }
  }, []);
  useEffect(() => { loadBase(); }, [loadBase]);
  const refetchCiclos = useCallback(() => { loadBase(true); }, [loadBase]);
  const ciclos = baseData[0] || [];
  const dreConfig = baseData[1] || [];
  const contas = baseData[2] || [];

  const [dreRows, setDreRows] = useState<DRERow[]>([]);
  const [statusData, setStatusData] = useState<any[]>([]);

  const activeCiclo = ciclos.find((c: any) => c.VERSAO_ATUAL === 'true')
    || ciclos.find((c: any) => c.STATUS === 'ABERTO')
    || ciclos.find((c: any) => c.STATUS === 'INICIADA')
    || ciclos[0];

  // Agrega status de CRs (ORCAMENTO_STATUS) + Pacotes (PACOTE_STATUS) — antes
  // contava só CRs e por isso aprovar/reprovar pacote nao refletia no donut.
  const refetchStatus = useCallback(() => {
    if (!activeCiclo) return;
    execSF(SF_IDS.dashStatusAgg, { cicloId: activeCiclo.ID }).then(setStatusData).catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCiclo?.ID]);

  // Refetch ao montar, ao trocar ciclo, e a cada navegacao pra ca (location.key).
  useEffect(() => { refetchStatus(); }, [refetchStatus, location.key]);

  // Refetch tambem quando aba volta ao foco (caso o user tenha aprovado em outra aba).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        refetchCiclos();
        refetchStatus();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [refetchCiclos, refetchStatus]);
  // Ano corrente como fallback, nunca um literal — ver OrcamentoContent.
  const cicloAno = activeCiclo?.ANO ?? new Date().getFullYear();
  const prevYear = cicloAno - 1;
  const controlCiclo = ciclos.find((c: any) => c.ANO === cicloAno && c.VERSAO_CONTROLE === 'true' && c.ID !== activeCiclo?.ID);

  const hasControle = !!controlCiclo;

  const statusMap: Record<string, number> = {};
  statusData.forEach((s: any) => { statusMap[s.STATUS] = Number(s.QTD); });
  const totalPendente = statusMap['PENDENTE'] || 0;
  const totalSubmetido = statusMap['SUBMETIDO'] || 0;
  const totalAprovado = statusMap['APROVADO'] || 0;
  const totalReprovado = statusMap['REPROVADO'] || 0;
  const totalItems = totalPendente + totalSubmetido + totalAprovado + totalReprovado;
  const progressPct = totalItems > 0 ? Math.round(((totalAprovado) / totalItems) * 100) : 0;
  const preenchidoPct = totalItems > 0 ? Math.round(((totalSubmetido + totalAprovado) / totalItems) * 100) : 0;

  useEffect(() => {
    if (!activeCiclo || dreConfig.length === 0 || contas.length === 0) return;
    buildDRE();
  }, [ciclos, dreConfig, contas]);

  const buildDRE = async () => {
    if (!activeCiclo) return;
    try {
      // SFs SQL dedicadas em paralelo; as SFs retornam por conta+mes, somamos os
      // meses aqui (payload pequeno: contas x 12).
      const calls = [
        execSF(SF_IDS.dreRealizadoPorConta, { ano: prevYear, crIds: '', contaIds: '', empresaId: '' }),
        execSF(SF_IDS.dreOrcadoPorConta, { cicloId: activeCiclo.ID, crIds: '', contaIds: '' }),
      ];
      if (controlCiclo) calls.push(execSF(SF_IDS.dreOrcadoPorConta, { cicloId: controlCiclo.ID, crIds: '', contaIds: '' }));
      const res = await Promise.all(calls);

      // Indexa somando os meses — Map pra lookup O(1) mesmo com muitas contas.
      const toMap = (rows: any[]) => {
        const m = new Map<number, number>();
        rows.forEach((r: any) => m.set(Number(r.CONTA_ID), (m.get(Number(r.CONTA_ID)) || 0) + Number(r.VALOR)));
        return m;
      };
      const realizado = toMap(res[0] || []);
      const orcadoAtual = toMap(res[1] || []);
      const orcadoControleData = toMap(controlCiclo ? (res[2] || []) : []);

      const gv = (data: Map<number, number>, contaId: number) => Math.round(data.get(contaId) || 0);

      const rows: DRERow[] = [];
      let rR = 0, rA = 0, rC = 0;

      dreConfig.forEach((line: any) => {
        const isHL = HIGHLIGHT_KEYS.some(k => line.NOME_LINHA.toLowerCase().includes(k));
        if (line.IS_SUBTOTAL === 'true') {
          rows.push({ label: line.NOME_LINHA, isSubtotal: true, isHighlight: isHL, orcadoAtual: rA, realizado: rR, orcadoControle: rC });
        } else {
          const mc = contas.filter((c: any) => c.CODIGO.startsWith(line.PREFIXO_CONTA));
          let rv = 0, av = 0, cv = 0;
          mc.forEach((c: any) => { rv += gv(realizado, c.ID); av += gv(orcadoAtual, c.ID); cv += gv(orcadoControleData, c.ID); });
          rv *= line.SINAL; av *= line.SINAL; cv *= line.SINAL;
          rR += rv; rA += av; rC += cv;
          rows.push({ label: line.NOME_LINHA, isSubtotal: false, isHighlight: isHL, orcadoAtual: av, realizado: rv, orcadoControle: cv });
        }
      });
      setDreRows(rows);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const getBase = (row: DRERow) => hasControle ? row.orcadoControle : row.realizado;

  const resultRow = useMemo(() => {
    const subs = dreRows.filter(r => r.isSubtotal);
    return subs.find(r => ['resultado líquido', 'resultado liquido', 'lucro líquido', 'lucro liquido'].some(k => r.label.toLowerCase().includes(k))) || subs[subs.length - 1];
  }, [dreRows]);

  // Corpo da tabela = todas as linhas menos o resultado, que vai pro <tfoot> sticky.
  const bodyRows = useMemo(() => dreRows.filter(r => r !== resultRow), [dreRows, resultRow]);

  // Escala declarada uma unica vez no cabecalho (R$ mil ou R$ mi), escolhida
  // pela magnitude dos dados — as celulas nao repetem sufixo K/M.
  const dreScale = useMemo(() => {
    let max = 0;
    dreRows.forEach(r => {
      max = Math.max(max, Math.abs(r.orcadoAtual), Math.abs(r.realizado), Math.abs(r.orcadoControle));
    });
    return max >= 1_000_000
      ? { label: 'R$ mi', divisor: 1_000_000, decimals: 1 }
      : { label: 'R$ mil', divisor: 1_000, decimals: 0 };
  }, [dreRows]);
  // Cabecalho da tabela do DRE: fundo opaco + divisoria entre titulos e valores
  const thStyle = { backgroundColor: 'var(--color-surface)', borderBottom: '1px solid var(--dash-card-border)' };
  const fmtDre = (v: number, signed = false) => {
    const scaled = v / dreScale.divisor;
    const str = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: dreScale.decimals, maximumFractionDigits: dreScale.decimals }).format(scaled);
    if (!signed) return str;
    // Sinal explicito (+/-) pelo valor ja escalado — evita "+0" em impacto que arredonda pra zero.
    const rounded = Number(scaled.toFixed(dreScale.decimals));
    if (rounded === 0) return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: dreScale.decimals, maximumFractionDigits: dreScale.decimals }).format(0);
    return (rounded > 0 ? '+' : '') + str;
  };
  const impactColor = (v: number) => {
    const rounded = Number((v / dreScale.divisor).toFixed(dreScale.decimals));
    return rounded > 0 ? 'var(--dre-var-pos)' : rounded < 0 ? 'var(--dre-var-neg)' : 'var(--color-text-muted)';
  };

  const kpiCards = useMemo(() => {
    const find = (kws: string[]) => dreRows.find(r => r.isSubtotal && kws.some(k => r.label.toLowerCase().includes(k)));
    const rl = find(['receita líquida', 'receita liquida']);
    const eb = find(['ebitda']);
    const res = resultRow;

    const rlAtual = rl?.orcadoAtual || 0;
    const rlBase = rl ? getBase(rl) : 0;
    const ebAtual = eb?.orcadoAtual || 0;
    const ebBase = eb ? getBase(eb) : 0;
    const resAtual = res?.orcadoAtual || 0;
    const resBase = res ? getBase(res) : 0;

    const margemAtual = rlAtual !== 0 ? (ebAtual / rlAtual) * 100 : 0;
    const margemBase = rlBase !== 0 ? (ebBase / rlBase) * 100 : 0;

    return { rlAtual, rlBase, ebAtual, ebBase, resAtual, resBase, margemAtual, margemBase };
  }, [dreRows, resultRow, hasControle]);

  const baseLabel = hasControle ? 'controle' : 'ano anterior';

  const kpiItems: { label: string; valor: string; delta: number; kind: 'moeda' | 'pp' }[] = [
    { label: 'Receita líquida', valor: fmtMoedaBR(kpiCards.rlAtual), delta: kpiCards.rlAtual - kpiCards.rlBase, kind: 'moeda' },
    { label: 'EBITDA', valor: fmtMoedaBR(kpiCards.ebAtual), delta: kpiCards.ebAtual - kpiCards.ebBase, kind: 'moeda' },
    { label: 'Margem EBITDA', valor: fmtPctBR(kpiCards.margemAtual), delta: kpiCards.margemAtual - kpiCards.margemBase, kind: 'pp' },
    // Usa o rotulo da propria linha de resultado do DRE (pode ser "Lucro liquido").
    { label: resultRow?.label || 'Resultado líquido', valor: fmtMoedaBR(kpiCards.resAtual), delta: kpiCards.resAtual - kpiCards.resBase, kind: 'moeda' },
  ];

  // ─── Variacao do KPI ──────────────────
  // Seta + magnitude + base de comparacao. Cor so aqui — o valor principal fica neutro.
  const KpiDelta = ({ value, kind = 'moeda' }: { value: number; kind?: 'moeda' | 'pp' }) => {
    const isPos = value >= 0;
    const texto = kind === 'pp' ? fmtVarPpBR(value) : fmtVarMoedaBR(value);
    return (
      <p className="tabular-nums truncate" style={{ fontSize: 11.5, lineHeight: 1.2, marginTop: 5, color: isPos ? 'var(--dre-var-pos)' : 'var(--dre-var-neg)' }}>
        {isPos ? '↑' : '↓'} {texto}{' '}
        <span style={{ color: 'var(--color-text-secondary)' }}>vs. {baseLabel}</span>
      </p>
    );
  };

  // ─── Skeleton (shimmer reaproveitado da classe .pg-skeleton do index.css) ───
  const Sk = ({ className = '', style }: { className?: string; style?: Record<string, string | number> }) => (
    <div className={`pg-skeleton ${className}`} style={style} />
  );

  // ─── Status items ─────────────────────
  const statusItems = [
    { value: totalPendente, label: 'Pendentes' },
    { value: totalSubmetido, label: 'Submetidos' },
    { value: totalAprovado, label: 'Aprovados' },
    { value: totalReprovado, label: 'Reprovados' },
  ];

  return (
    <div className="flex flex-col gap-6 animate-fadeIn">
      {/* ── Header ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          {/* Titulo padrao da tela; o ciclo ativo vai no subtitulo (o badge do ciclo saiu, era redundante). */}
          <h1 className="font-semibold" style={{ color: 'var(--color-text)', fontSize: '20px' }}>Dashboard</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>
            Visão geral do ciclo
            {activeCiclo && ` ${String(activeCiclo.NOME || '').includes(String(activeCiclo.ANO))
              ? activeCiclo.NOME
              : `${activeCiclo.NOME} (${activeCiclo.ANO})`}`}
            {` · variações ${hasControle ? 'vs controle' : 'vs real do ano anterior'}`}
          </p>
        </div>
        {loading && !activeCiclo && (
          <Sk className="h-6 w-24" style={{ borderRadius: '9999px' }} />
        )}
        {activeCiclo && (
          <Badge variant={activeCiclo.STATUS === 'FINALIZADA' ? 'success' : 'blue'}>
            {activeCiclo.STATUS}
          </Badge>
        )}
      </div>

      {/* ── Faixa unica de KPIs ────────────────────────────── */}
      {/* Resumo executivo: um bloco horizontal, divisores sutis, sem icones. */}
      <div
        className="rounded-lg border overflow-hidden"
        style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--dash-card-border)' }}
      >
        <div className="grid grid-cols-2 lg:grid-cols-4">
          {loading ? (
            [0, 1, 2, 3].map(i => (
              <div key={i} className="px-6 py-4" style={i % 4 === 0 ? undefined : { borderLeft: '1px solid var(--dash-card-border)' }}>
                <Sk className="h-3 w-24" />
                <Sk className="h-5 w-28" style={{ marginTop: 8 }} />
                <Sk className="h-2.5 w-32" style={{ marginTop: 7 }} />
              </div>
            ))
          ) : (
            kpiItems.map((kpi, i) => (
              <div
                key={kpi.label}
                className="px-6 py-4 min-w-0"
                style={i % 4 === 0 ? undefined : { borderLeft: '1px solid var(--dash-card-border)' }}
              >
                <p className="truncate" style={{ color: 'var(--color-text-secondary)', fontSize: 12.5, lineHeight: 1.2 }}>
                  {kpi.label}
                </p>
                <p
                  className="font-semibold tabular-nums truncate"
                  style={{ color: 'var(--color-text)', fontSize: 23, lineHeight: 1.15, letterSpacing: '-0.02em', marginTop: 6 }}
                >
                  {kpi.valor}
                </p>
                <KpiDelta value={kpi.delta} kind={kpi.kind} />
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── DRE + Progresso ────────────────────────────────── */}
      {/* Sem altura fixa: o card cresce com o DRE e a pagina rola — nada de scroll interno. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* DRE Consolidado */}
        <Card className="lg:col-span-2 flex flex-col overflow-hidden" style={{ border: '1px solid var(--dash-card-border)', boxShadow: 'none' }}>
          {/* Header: titulo + escala dos valores, sem divisoria propria. A divisoria e a do
              cabecalho da tabela, e precisa cair na mesma altura da linha do card de Progresso
              (py-5 + h3 + mt-1 + p + borda = 90px): pt-5 + h3(24) + 4 + p(16) + th(py-1 + 18 + borda) = 90. */}
          <div className="px-6 pt-5 pb-0">
            <h3 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>DRE Consolidado</h3>
            <p className="mt-2 leading-4" style={{ color: 'var(--color-text-secondary)', fontSize: '14px' }}>
              Valores em {dreScale.label}
            </p>
          </div>

          {loading ? (
            <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 py-3 px-6">
                  <Sk className="h-4" style={{ width: `${[38, 30, 44, 26, 34, 40, 28, 36, 32, 42][i]}%` }} />
                  <div className="flex-1" />
                  <Sk className="h-4 w-16" />
                  {hasControle && <Sk className="h-4 w-16" />}
                  <Sk className="h-4 w-16" />
                  <Sk className="h-4 w-14" />
                </div>
              ))}
            </div>
          ) : dreRows.length === 0 ? (
            <div className="text-center py-16 text-sm" style={{ color: 'var(--color-text-muted)' }}>
              Sem dados para exibir
            </div>
          ) : (
            <div className="overflow-x-hidden">
              <table className="w-full text-sm" style={{ borderCollapse: 'separate', borderSpacing: 0 }}>
                {/* Cabecalho: primeira coluna sem titulo; divisoria embaixo separa titulos dos valores.
                    A escala (R$ mi / R$ mil) fica no subtitulo do card. */}
                <thead>
                  <tr style={{ color: 'var(--color-text-secondary)', fontSize: 12, fontWeight: 400 }}>
                    <th className="text-left px-6 py-0.5 font-normal" style={thStyle} aria-label="Conta" />
                    <th className="text-right px-3 py-0.5 font-normal" style={thStyle}>Real ano anterior</th>
                    {hasControle && (
                      <th className="text-right px-3 py-0.5 font-normal" style={thStyle}>Versão controle</th>
                    )}
                    <th className="text-right px-3 py-0.5" style={{ ...thStyle, backgroundColor: 'var(--dash-dre-atual-bg)', color: 'var(--color-text)', fontWeight: 600 }}>Versão atual</th>
                    <th className="text-right px-6 py-1 font-normal" style={{ ...thStyle, minWidth: 90 }}>Impacto</th>
                  </tr>
                </thead>
                <tbody>
                  {bodyRows.map((row, i) => {
                    const impact = row.orcadoAtual - getBase(row);
                    const sub = row.isSubtotal;
                    // Subtotal: gradiente leve na <tr> (nao por celula, senao reinicia em cada coluna)
                    const rowStyle = sub
                      ? { color: 'var(--color-text)', fontWeight: 600, borderTop: '1px solid var(--dash-dre-sub-border)' }
                      : { color: 'var(--color-text-secondary)' };
                    return (
                      <tr key={i} style={sub ? { background: 'var(--dash-dre-sub-grad)' } : undefined}>
                        <td className="px-6 py-3" style={{ ...rowStyle, paddingLeft: sub ? 12 : 28 }}>
                          {row.label}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums" style={rowStyle}>
                          {fmtDre(row.realizado)}
                        </td>
                        {hasControle && (
                          <td className="px-3 py-3 text-right tabular-nums" style={rowStyle}>
                            {fmtDre(row.orcadoControle)}
                          </td>
                        )}
                        {/* Versao atual: coluna com fundo proprio (mais forte nos subtotais) */}
                        <td className="px-3 py-3 text-right tabular-nums" style={{ ...rowStyle, backgroundColor: sub ? 'var(--dash-dre-atual-bg-sub)' : 'var(--dash-dre-atual-bg)', color: 'var(--color-text)', fontWeight: sub ? 600 : 500 }}>
                          {fmtDre(row.orcadoAtual)}
                        </td>
                        {/* Impacto: subtotais intermediarios ficam em branco */}
                        <td className="px-6 py-3 text-right tabular-nums" style={{ ...rowStyle, color: sub ? undefined : impactColor(impact) }}>
                          {sub ? '' : fmtDre(impact, true)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {resultRow && (() => {
                  const impact = resultRow.orcadoAtual - getBase(resultRow);
                  // Resultado liquido: mesmo gradiente leve dos subtotais, sem linha em cima.
                  const footStyle = { color: 'var(--color-text)', fontWeight: 600 };
                  return (
                    <tfoot>
                      <tr style={{ background: 'var(--dash-dre-sub-grad)' }}>
                        <td className="px-6 py-3" style={{ ...footStyle, paddingLeft: 12 }}>{resultRow.label}</td>
                        <td className="px-3 py-3 text-right tabular-nums" style={footStyle}>{fmtDre(resultRow.realizado)}</td>
                        {hasControle && (
                          <td className="px-3 py-3 text-right tabular-nums" style={footStyle}>{fmtDre(resultRow.orcadoControle)}</td>
                        )}
                        <td className="px-3 py-3 text-right tabular-nums" style={{ ...footStyle, backgroundColor: 'var(--dash-dre-atual-bg-sub)' }}>{fmtDre(resultRow.orcadoAtual)}</td>
                        <td className="px-6 py-3 text-right tabular-nums" style={{ ...footStyle, color: impactColor(impact) }}>
                          {fmtDre(impact, true)}
                        </td>
                      </tr>
                    </tfoot>
                  );
                })()}
              </table>
            </div>
          )}
        </Card>

        {/* ── Progresso do orçamento ──────────────────────── */}
        <Card className="flex flex-col overflow-hidden" style={{ border: '1px solid var(--dash-card-border)', boxShadow: 'none' }}>
          <div className="px-6 py-5" style={{ borderBottom: '1px solid var(--dash-card-border)' }}>
            <h3 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>
              Progresso do orçamento
            </h3>
            <p className="mt-1" style={{ color: 'var(--color-text-secondary)', fontSize: '14px' }}>
              Status de aprovação dos centros de resultado
            </p>
          </div>

          {loading ? (
            <CardContent className="flex-1 flex flex-col min-h-0 justify-between gap-4">
              <div className="flex items-center justify-center py-2">
                <Sk className="w-44 h-44" style={{ borderRadius: '9999px' }} />
              </div>
              <div className="flex items-center justify-center gap-5">
                <Sk className="h-3 w-20" />
                <Sk className="h-3 w-20" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                {[0, 1, 2, 3].map(i => <Sk key={i} className="h-16" />)}
              </div>
              <Sk className="h-10 w-full" />
            </CardContent>
          ) : (
          <CardContent className="flex-1 flex flex-col min-h-0 overflow-auto justify-between gap-4">
            {/* Donut chart */}
            <div className="flex items-center justify-center">
              <div className="relative w-44 h-44">
                <svg className="w-44 h-44 -rotate-90" viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="42" fill="none" stroke="var(--color-border)" strokeWidth="5" opacity="0.5" />
                  <circle cx="50" cy="50" r="42" fill="none" stroke="#10b981" strokeWidth="5"
                    strokeDasharray={`${progressPct * 2.64} 264`} strokeLinecap="round" className="transition-all duration-700" />
                  <circle cx="50" cy="50" r="33" fill="none" stroke="var(--color-border)" strokeWidth="4" opacity="0.5" />
                  <circle cx="50" cy="50" r="33" fill="none" stroke="var(--color-primary)" strokeWidth="4"
                    strokeDasharray={`${preenchidoPct * 2.07} 207`} strokeLinecap="round" className="transition-all duration-700" />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-2xl font-bold tabular-nums" style={{ color: 'var(--color-text)' }}>{progressPct}%</span>
                  <span className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>Aprovados</span>
                </div>
              </div>
            </div>

            {/* Legenda */}
            <div className="flex items-center justify-center gap-5 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#10b981' }} /> Aprovados
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: 'var(--color-primary)' }} /> Preenchidos
              </span>
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-2 gap-2">
              {statusItems.map(item => (
                <div key={item.label} className="rounded-lg px-3 py-2" style={{ backgroundColor: 'var(--dash-dre-atual-bg)' }}>
                  <span className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>{item.label}</span>
                  <span className="block font-medium tabular-nums" style={{ color: 'var(--color-text)', fontSize: '20px', lineHeight: 1.3 }}>{item.value}</span>
                </div>
              ))}
            </div>

            {/* CTA */}
            <div>
              <Link
                to="/workflow?mode=admin"
                className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl text-sm font-medium transition-all duration-200"
                style={{ backgroundColor: 'var(--color-primary)', color: '#fff' }}
                onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.9'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.transform = 'translateY(0)'; }}
              >
                Gerenciar workflow <ArrowRight size={14} />
              </Link>
            </div>
          </CardContent>
          )}
        </Card>
      </div>
    </div>
  );
}
