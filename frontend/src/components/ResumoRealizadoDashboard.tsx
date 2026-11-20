import { useMemo, useState } from 'react';
import {
  CHART_COLORS, CHART_SEQUENCE,
  ChartContainer, ChartTooltip,
  ComposedChart, RechartsBar, RechartsLine, RechartsArea,
  XAxis, YAxis, CartesianGrid, ReferenceLine,
  PieChart, Pie, Cell,
} from './ui/Chart';
import { formatCurrency } from '../hooks/useMitraData';
import { isReceitaTipo, isDespesaTipo } from '../lib/realizado-tipos';
import { BARRAS_EVOLUCAO_MENSAL } from '../lib/barras-evolucao-mensal';

// ChartConfig e re-declarado localmente: o tsconfig usa verbatimModuleSyntax,
// entao importar o type de outro arquivo quebra em runtime.
type ChartConfig = { [k: string]: { label?: string; color?: string } };

// Props que o Recharts injeta no componente passado em `content`. Todas
// opcionais: o elemento e criado sem props no JSX (<MeuTooltip />).
type TooltipProps<T> = {
  active?: boolean;
  payload?: { payload: T }[];
  label?: string | number;
};

interface MesPonto {
  mes: string;
  Receita: number;
  Despesa: number;
  Resultado: number;
  Acumulado: number;
  margem: number;
  _vazio: boolean;
}
interface TipoFatia { tipo: string; name: string; valor: number; pct: number; color: string }
interface ContaPonto { name: string; full: string; valor: number }
interface RankPonto { name: string; receita: number; despesa: number; Resultado: number }

const COLOR_RECEITA = CHART_COLORS.secondary;
const COLOR_DESPESA = CHART_COLORS.danger;
const COLOR_RESULTADO = CHART_COLORS.accent;

// Eixos em escala compacta: valores contabeis cheios (9+ digitos) nao cabem
// no gutter do eixo e viram "..." ou empurram a area do grafico.
function fmtAxis(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000_000) return `${(v / 1_000_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} bi`;
  if (abs >= 1_000_000) return `${(v / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  if (abs >= 1_000) return `${Math.round(v / 1_000).toLocaleString('pt-BR')} mil`;
  return v.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
}

function fmtPct(v: number): string {
  return `${v >= 0 ? '' : '-'}${Math.abs(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

const AXIS = { tickLine: false, axisLine: false, tickMargin: 8, fontSize: 12 } as const;

function ChartCard({ title, subtitle, action, height, children }: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  height: number;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border p-5 min-w-0" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)' }}>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{title}</h3>
          {subtitle && <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>{subtitle}</p>}
        </div>
        {action}
      </div>
      <div style={{ height }}>{children}</div>
    </div>
  );
}

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="h-full flex items-center justify-center text-xs" style={{ color: 'var(--color-text-muted)' }}>
      {message}
    </div>
  );
}

function TooltipBox({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg px-3 py-2 shadow-lg text-xs" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
      <p className="font-medium mb-1.5" style={{ color: 'var(--color-text)' }}>{label}</p>
      {children}
    </div>
  );
}

function TooltipRow({ color, label, value, valueColor }: { color?: string; label: string; value: string; valueColor?: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-0.5">
      <span className="flex items-center gap-1.5">
        {color && <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ background: color }} />}
        <span style={{ color: 'var(--color-text-secondary)' }}>{label}</span>
      </span>
      <span className="font-medium tabular-nums" style={{ color: valueColor || 'var(--color-text)' }}>{value}</span>
    </div>
  );
}

function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="flex items-center gap-4 flex-wrap">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--color-text-secondary)' }}>
          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );
}

interface AggRow {
  EMPRESA_ID: number | string;
  EMPRESA_NOME: string;
  CONTA_ID: number | string;
  CONTA_CODIGO: string;
  CONTA_NOME: string;
  CONTA_TIPO: string;
  CR_ID: number | string;
  CR_CODIGO: string;
  CR_NOME: string;
  MES: number | string;
  VALOR: number | string;
}

// Tooltips no escopo de modulo: dependem so das props e das constantes de cor,
// entao nao precisam ser recriados a cada render da tela.
const MensalTooltip = ({ active, payload, label }: TooltipProps<MesPonto>) => {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <TooltipBox label={String(label)}>
      <TooltipRow color={COLOR_RECEITA} label="Receita" value={formatCurrency(d.Receita)} />
      <TooltipRow color={COLOR_DESPESA} label="Despesa" value={formatCurrency(d.Despesa)} />
      <div className="mt-1.5 pt-1.5" style={{ borderTop: '1px solid var(--color-border)' }}>
        <TooltipRow color={COLOR_RESULTADO} label="Resultado" value={formatCurrency(d.Resultado)}
          valueColor={d.Resultado >= 0 ? COLOR_RECEITA : COLOR_DESPESA} />
        <TooltipRow label="Margem" value={d.Receita ? fmtPct(d.margem) : '—'}
          valueColor={d.margem >= 0 ? COLOR_RECEITA : COLOR_DESPESA} />
      </div>
    </TooltipBox>
  );
};

const AcumuladoTooltip = ({ active, payload, label }: TooltipProps<MesPonto>) => {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <TooltipBox label={String(label)}>
      <TooltipRow label="Acumulado no ano" value={formatCurrency(d.Acumulado)}
        valueColor={d.Acumulado >= 0 ? COLOR_RECEITA : COLOR_DESPESA} />
      <TooltipRow label="Resultado do mês" value={formatCurrency(d.Resultado)}
        valueColor={d.Resultado >= 0 ? COLOR_RECEITA : COLOR_DESPESA} />
    </TooltipBox>
  );
};

const ContaTooltip = ({ active, payload }: TooltipProps<ContaPonto>) => {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <TooltipBox label={d.full}>
      <TooltipRow color={COLOR_DESPESA} label="Despesa no período" value={formatCurrency(d.valor)} />
    </TooltipBox>
  );
};

const RankingTooltip = ({ active, payload }: TooltipProps<RankPonto>) => {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  const margem = d.receita ? (d.Resultado / d.receita) * 100 : 0;
  return (
    <TooltipBox label={d.name}>
      <TooltipRow color={COLOR_RECEITA} label="Receita" value={formatCurrency(d.receita)} />
      <TooltipRow color={COLOR_DESPESA} label="Despesa" value={formatCurrency(d.despesa)} />
      <div className="mt-1.5 pt-1.5" style={{ borderTop: '1px solid var(--color-border)' }}>
        <TooltipRow label="Resultado" value={formatCurrency(d.Resultado)}
          valueColor={d.Resultado >= 0 ? COLOR_RECEITA : COLOR_DESPESA} />
        <TooltipRow label="Margem" value={d.receita ? fmtPct(margem) : '—'}
          valueColor={margem >= 0 ? COLOR_RECEITA : COLOR_DESPESA} />
      </div>
    </TooltipBox>
  );
};

const PieTooltip = ({ active, payload }: TooltipProps<TipoFatia>) => {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  return (
    <TooltipBox label={d.name}>
      <TooltipRow color={d.color} label="Total" value={formatCurrency(d.valor)} />
      <TooltipRow label="Participação" value={fmtPct(d.pct)} />
    </TooltipBox>
  );
};

export default function ResumoRealizadoDashboard({ aggRows, monthsShort, fiscalMonthNumbers, tipoLabels }: {
  aggRows: AggRow[];
  monthsShort: string[];
  fiscalMonthNumbers: number[];
  tipoLabels: Record<string, string>;
}) {
  const [rankDim, setRankDim] = useState<'cr' | 'empresa'>('cr');

  const multiEmpresa = useMemo(
    () => new Set(aggRows.map((r) => String(r.EMPRESA_ID))).size > 1,
    [aggRows],
  );
  const dim = multiEmpresa ? rankDim : 'cr';

  // ── Serie mensal: receita, despesa, resultado e resultado acumulado ──
  // Meses finais sem movimento sao cortados: num ano parcialmente realizado
  // eles achatariam o grafico e prolongariam a curva do acumulado em linha reta.
  const monthly = useMemo(() => {
    const byMes = new Map<number, { rec: number; desp: number }>();
    for (const r of aggRows) {
      const mes = Number(r.MES);
      const valor = Number(r.VALOR || 0);
      let entry = byMes.get(mes);
      if (!entry) { entry = { rec: 0, desp: 0 }; byMes.set(mes, entry); }
      if (isReceitaTipo(r.CONTA_TIPO)) entry.rec += valor;
      else if (isDespesaTipo(r.CONTA_TIPO)) entry.desp += valor;
    }
    const serie: MesPonto[] = fiscalMonthNumbers.map((cm, i) => {
      const entry = byMes.get(cm) || { rec: 0, desp: 0 };
      const receita = Math.round(entry.rec);
      const despesa = Math.round(entry.desp);
      const resultado = receita - despesa;
      return {
        mes: monthsShort[i],
        Receita: receita,
        Despesa: despesa,
        Resultado: resultado,
        Acumulado: 0,
        margem: receita !== 0 ? (resultado / receita) * 100 : 0,
        _vazio: receita === 0 && despesa === 0,
      };
    });
    let acumulado = 0;
    for (const ponto of serie) {
      acumulado += ponto.Resultado;
      ponto.Acumulado = acumulado;
    }
    let last = -1;
    for (let i = 0; i < serie.length; i++) if (!serie[i]._vazio) last = i;
    return last < 0 ? [] : serie.slice(0, last + 1);
  }, [aggRows, fiscalMonthNumbers, monthsShort]);

  // ── Composicao das despesas por tipo ──
  const despesaPorTipo = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of aggRows) {
      if (!isDespesaTipo(r.CONTA_TIPO)) continue;
      const tipo = r.CONTA_TIPO || 'OUTROS';
      map.set(tipo, (map.get(tipo) || 0) + Number(r.VALOR || 0));
    }
    const itens = Array.from(map, ([tipo, valor]) => ({ tipo, name: tipoLabels[tipo] || tipo, valor: Math.round(valor) }))
      .filter((d) => d.valor > 0)
      .sort((a, b) => b.valor - a.valor);
    const total = itens.reduce((s, d) => s + d.valor, 0);
    return {
      total,
      itens: itens.map((d, i) => ({
        ...d,
        pct: total ? (d.valor / total) * 100 : 0,
        color: CHART_SEQUENCE[i % CHART_SEQUENCE.length],
      })),
    };
  }, [aggRows, tipoLabels]);

  // ── Top 10 contas por despesa (somadas entre CRs) ──
  const topContas = useMemo(() => {
    const map = new Map<string, { name: string; full: string; valor: number }>();
    for (const r of aggRows) {
      if (!isDespesaTipo(r.CONTA_TIPO)) continue;
      const key = String(r.CONTA_ID);
      let entry = map.get(key);
      if (!entry) {
        entry = { name: r.CONTA_NOME || r.CONTA_CODIGO, full: `${r.CONTA_CODIGO} - ${r.CONTA_NOME}`, valor: 0 };
        map.set(key, entry);
      }
      entry.valor += Number(r.VALOR || 0);
    }
    return Array.from(map.values())
      .map((d) => ({ ...d, valor: Math.round(d.valor) }))
      .filter((d) => d.valor > 0)
      .sort((a, b) => b.valor - a.valor)
      .slice(0, 10);
  }, [aggRows]);

  // ── Ranking por centro de resultado ou por empresa ──
  const ranking = useMemo(() => {
    const map = new Map<string, { name: string; receita: number; despesa: number }>();
    for (const r of aggRows) {
      const key = dim === 'cr' ? String(r.CR_ID) : String(r.EMPRESA_ID);
      let entry = map.get(key);
      if (!entry) {
        entry = { name: dim === 'cr' ? `${r.CR_CODIGO} - ${r.CR_NOME}` : r.EMPRESA_NOME, receita: 0, despesa: 0 };
        map.set(key, entry);
      }
      const valor = Number(r.VALOR || 0);
      if (isReceitaTipo(r.CONTA_TIPO)) entry.receita += valor;
      else if (isDespesaTipo(r.CONTA_TIPO)) entry.despesa += valor;
    }
    return Array.from(map.values())
      .map((d) => ({
        name: d.name,
        receita: Math.round(d.receita),
        despesa: Math.round(d.despesa),
        Resultado: Math.round(d.receita - d.despesa),
      }))
      .sort((a, b) => b.Resultado - a.Resultado)
      .slice(0, 10);
  }, [aggRows, dim]);

  const cfgMensal: ChartConfig = {
    Receita: { label: 'Receita', color: COLOR_RECEITA },
    Despesa: { label: 'Despesa', color: COLOR_DESPESA },
    Resultado: { label: 'Resultado', color: COLOR_RESULTADO },
  };

  const acumuladoFinal = monthly.length ? monthly[monthly.length - 1].Acumulado : 0;
  const corAcumulado = acumuladoFinal >= 0 ? COLOR_RECEITA : COLOR_DESPESA;
  const temAcumuladoNegativo = monthly.some((d) => d.Acumulado < 0);

  return (
    <div className="space-y-4">
      {/* ── Evolução mensal ── */}
      <ChartCard
        title="Evolução mensal"
        subtitle="Receita e despesa por mês, com o resultado do período"
        height={300}
        action={<Legend items={[
          { label: 'Receita', color: COLOR_RECEITA },
          { label: 'Despesa', color: COLOR_DESPESA },
          { label: 'Resultado', color: COLOR_RESULTADO },
        ]} />}
      >
        {monthly.length === 0 ? (
          <EmptyChart message="Sem movimento no período" />
        ) : (
          <ChartContainer config={cfgMensal}>
            <ComposedChart data={monthly} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}
              barGap={BARRAS_EVOLUCAO_MENSAL.barGap} barCategoryGap={BARRAS_EVOLUCAO_MENSAL.barCategoryGap}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
              <XAxis dataKey="mes" {...AXIS} />
              <YAxis {...AXIS} width={70} tickFormatter={fmtAxis} />
              <ChartTooltip content={<MensalTooltip />} cursor={{ fill: 'var(--bg-hover)' }} />
              <RechartsBar dataKey="Receita" fill={COLOR_RECEITA} barSize={BARRAS_EVOLUCAO_MENSAL.barSize} radius={[4, 4, 0, 0]} />
              <RechartsBar dataKey="Despesa" fill={COLOR_DESPESA} barSize={BARRAS_EVOLUCAO_MENSAL.barSize} radius={[4, 4, 0, 0]} />
              <RechartsLine type="monotone" dataKey="Resultado" stroke={COLOR_RESULTADO} strokeWidth={2}
                dot={{ r: 3, fill: COLOR_RESULTADO, strokeWidth: 0 }} activeDot={{ r: 5 }} />
            </ComposedChart>
          </ChartContainer>
        )}
      </ChartCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* ── Composição das despesas ── */}
        <ChartCard
          title="Composição das despesas"
          subtitle="Onde o gasto do período está concentrado"
          height={280}
        >
          {despesaPorTipo.itens.length === 0 ? (
            <EmptyChart message="Sem despesas no período" />
          ) : (
            <div className="flex items-center gap-4 h-full min-w-0">
              <div className="h-full shrink-0" style={{ width: '45%' }}>
                <ChartContainer config={{}}>
                  <PieChart>
                    <ChartTooltip content={<PieTooltip />} />
                    <Pie data={despesaPorTipo.itens} dataKey="valor" nameKey="name"
                      innerRadius="56%" outerRadius="86%" paddingAngle={2} stroke="none" isAnimationActive>
                      {despesaPorTipo.itens.map((d) => <Cell key={d.tipo} fill={d.color} />)}
                    </Pie>
                  </PieChart>
                </ChartContainer>
              </div>
              <ul className="flex-1 min-w-0 space-y-1.5 overflow-y-auto max-h-full pr-1">
                {despesaPorTipo.itens.map((d) => (
                  <li key={d.tipo} className="flex items-center gap-2 text-xs min-w-0">
                    <span className="inline-block w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: d.color }} />
                    <span className="truncate" style={{ color: 'var(--color-text-secondary)' }} title={d.name}>{d.name}</span>
                    <span className="ml-auto tabular-nums font-medium whitespace-nowrap" style={{ color: 'var(--color-text)' }}>
                      {fmtAxis(d.valor)}
                    </span>
                    <span className="tabular-nums whitespace-nowrap w-11 text-right" style={{ color: 'var(--color-text-muted)' }}>
                      {fmtPct(d.pct)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </ChartCard>

        {/* ── Resultado acumulado ── */}
        <ChartCard
          title="Resultado acumulado"
          subtitle="Curva do resultado somado mês a mês"
          height={280}
          action={monthly.length > 0 ? (
            <span className="text-sm font-semibold tabular-nums whitespace-nowrap" style={{ color: corAcumulado }}>
              {formatCurrency(acumuladoFinal)}
            </span>
          ) : undefined}
        >
          {monthly.length === 0 ? (
            <EmptyChart message="Sem movimento no período" />
          ) : (
            <ChartContainer config={{ Acumulado: { label: 'Acumulado', color: corAcumulado } }}>
              <ComposedChart data={monthly} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
                <defs>
                  <linearGradient id="gradAcumulado" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={corAcumulado} stopOpacity={0.35} />
                    <stop offset="95%" stopColor={corAcumulado} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
                <XAxis dataKey="mes" {...AXIS} />
                <YAxis {...AXIS} width={70} tickFormatter={fmtAxis} />
                <ChartTooltip content={<AcumuladoTooltip />} cursor={{ stroke: 'var(--color-border)' }} />
                {temAcumuladoNegativo && <ReferenceLine y={0} stroke="var(--color-text-muted)" strokeDasharray="4 4" />}
                <RechartsArea type="monotone" dataKey="Acumulado" stroke={corAcumulado} strokeWidth={2}
                  fill="url(#gradAcumulado)" dot={{ r: 2.5, fill: corAcumulado, strokeWidth: 0 }} activeDot={{ r: 5 }}
                  baseValue={temAcumuladoNegativo ? 0 : undefined} />
              </ComposedChart>
            </ChartContainer>
          )}
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* ── Top contas por despesa ── */}
        <ChartCard
          title="Maiores contas de despesa"
          subtitle="As 10 contas que mais consumiram no período"
          height={320}
        >
          {topContas.length === 0 ? (
            <EmptyChart message="Sem despesas no período" />
          ) : (
            <ChartContainer config={{ valor: { label: 'Despesa', color: COLOR_DESPESA } }}>
              <ComposedChart data={topContas} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--color-border)" />
                <XAxis type="number" {...AXIS} tickFormatter={fmtAxis} />
                <YAxis type="category" dataKey="name" {...AXIS} width={150}
                  tickFormatter={(v: string) => truncate(String(v), 22)} />
                <ChartTooltip content={<ContaTooltip />} cursor={{ fill: 'var(--bg-hover)' }} />
                <RechartsBar dataKey="valor" fill={COLOR_DESPESA} radius={[0, 4, 4, 0]} maxBarSize={20} isAnimationActive />
              </ComposedChart>
            </ChartContainer>
          )}
        </ChartCard>

        {/* ── Ranking por CR / empresa ── */}
        <ChartCard
          title={dim === 'cr' ? 'Resultado por centro de resultado' : 'Resultado por empresa'}
          subtitle="Receita menos despesa, do melhor para o pior"
          height={320}
          action={multiEmpresa ? (
            <div className="flex rounded-lg overflow-hidden border shrink-0" style={{ borderColor: 'var(--color-border)' }}>
              {([
                { key: 'cr', label: 'Centro' },
                { key: 'empresa', label: 'Empresa' },
              ] as const).map((opt) => {
                const active = dim === opt.key;
                return (
                  <button key={opt.key} type="button" onClick={() => setRankDim(opt.key)}
                    className="px-2.5 py-1 text-[12px] font-medium transition-all duration-200"
                    style={{
                      backgroundColor: active ? 'var(--color-primary)' : 'transparent',
                      color: active ? '#fff' : 'var(--color-text-secondary)',
                    }}>
                    {opt.label}
                  </button>
                );
              })}
            </div>
          ) : undefined}
        >
          {ranking.length === 0 ? (
            <EmptyChart message="Sem movimento no período" />
          ) : (
            <ChartContainer config={{ Resultado: { label: 'Resultado', color: COLOR_RESULTADO } }}>
              <ComposedChart data={ranking} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--color-border)" />
                <XAxis type="number" {...AXIS} tickFormatter={fmtAxis} />
                <YAxis type="category" dataKey="name" {...AXIS} width={150}
                  tickFormatter={(v: string) => truncate(String(v), 22)} />
                <ChartTooltip content={<RankingTooltip />} cursor={{ fill: 'var(--bg-hover)' }} />
                <ReferenceLine x={0} stroke="var(--color-border)" />
                <RechartsBar dataKey="Resultado" radius={[0, 4, 4, 0]} maxBarSize={20} isAnimationActive>
                  {ranking.map((d, i) => (
                    <Cell key={i} fill={d.Resultado >= 0 ? COLOR_RECEITA : COLOR_DESPESA} />
                  ))}
                </RechartsBar>
              </ComposedChart>
            </ChartContainer>
          )}
        </ChartCard>
      </div>
    </div>
  );
}
