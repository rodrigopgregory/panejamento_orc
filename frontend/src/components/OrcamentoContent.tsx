import React, { useState, useEffect, useRef, useMemo, Fragment } from 'react';
import { querySQL, execSF, execSFCached, jsonField, sqlEscape, SF_IDS, formatCurrency, getPublicOrcToken, publicOrcWrite, queuePublicOrcCell, queuePublicFormulaCell, queuePublicPkgCell, queuePublicPkgLineCell, flushPublicOrcQueue, avaliarWorkflow, avaliarErroMsg } from '../hooks/useMitraData';
import { useFiscalYear } from '../hooks/useFiscalYear';
import { patchRecordMitra, createRecordMitra, deleteRecordMitra } from 'mitra-interactions-sdk';
import { MITRA_CONFIG } from '../mitra-config';
import { toTitleCase } from '../lib/utils';
import { colaboradorTemCustoNoMes } from '../lib/pessoal';
import { avisoFolhaNaoLancada, precisaAvisarFolhaNaoCalculada, AVISO_CONFIRMAR_SEM_FOLHA } from '../lib/folha-lancamento';
import { tipoLinha, mapaPremissas, valorPremissa } from '../lib/linha-modelo';
import { avaliarFormula, formulaValida } from '../lib/formula-core';
import { mesesMaterializaveis, decidirGravacao, avisoContasNaoCalculadas } from '../lib/materializacao';
import { getUser } from '../lib/auth';
import { escolherVersaoVigente, versaoEhFechada } from '../lib/versao-vigente';
import { Card, CardHeader, CardTitle, CardContent } from './ui/Card';
import Button from './ui/Button';
import Badge from './ui/Badge';
import Modal from './ui/Modal';
import Tooltip from './ui/Tooltip';
import ConfirmDialog from './ui/ConfirmDialog';
import { useToast } from '../hooks/useToast';
import { ToastContainer } from './ui/Toast';
import { registerAllModules } from 'handsontable/registry';
import { COL_TOTAL_ORCADO, rotuloOrcadoPorStatus } from '../lib/model-grid';
import GradeModelo from './GradeModelo';
import numbro from 'numbro';
// @ts-ignore — numbro language file has no type declarations
import numbroPtBR from 'numbro/languages/pt-BR';
import {
  ChartContainer, ChartTooltip,
  ChartLegend, ComposedChart, RechartsBar,
  XAxis, YAxis, CartesianGrid, Cell,
} from './ui/Chart';
import type { ChartConfig } from './ui/Chart';
import Select from './ui/Select';
import { FileSpreadsheet, Calculator, TrendingUp, CheckCircle, XCircle, Users, Package, Lock, Plus, Trash2, BarChart3, Layers, Eye, CalendarClock, ChevronRight, Clock, AlertCircle, UserMinus, MessageSquare } from 'lucide-react';
import WorkflowHistorico from './WorkflowHistorico';

registerAllModules();
numbro.registerLanguage(numbroPtBR);
numbro.setLanguage('pt-BR');
const pid = MITRA_CONFIG.projectId;

// SFs dedicadas do calculo de pessoal (backend/add-pessoal-sfs.mjs,
// backend/add-pessoal-gravar-folha.mjs)
const SF_PESSOAL = {
  // 1 chamada: limpa a folha do ciclo/CR, insere a projecao em lote e regrava
  // as contas de pessoal do ORCAMENTO (encadeia as SFs 60 e 61 no servidor).
  gravarFolha: 247,
  salvarDesligamento: 221,
  excluirDesligamento: 222,
  // Grade de contratacoes cargo x mes (backend/add-contratacao-grid.mjs)
  limparCelulaContrat: 249,
  inserirCelulaContrat: 250,
  justificativaContrat: 251,
};

type DriverTab = string;
const DRIVER_TABS_FIXED: { key: string; label: string; icon: any }[] = [
  { key: 'RESUMO', label: 'Resumo', icon: BarChart3 },
  { key: 'RECEITA', label: 'Receita', icon: Calculator },
  { key: 'BASE_ZERO', label: 'Base Zero', icon: FileSpreadsheet },
  { key: 'BASE_HISTORICO', label: 'Base Histórica', icon: TrendingUp },
  { key: 'PESSOAL', label: 'Pessoal', icon: Users },
];


function ComparisonChart({ configs: configsProp, getRealizadoValue: getRealAnterior, getBudgetValue: getOrc, getRealizadoAtualValue: getRealAtual, ultimoMesRealizado, pkgCrs, pkgBudgetRows, pkgRealAtualRows, permitirPorConta }: {
  configs: any[];
  getRealizadoValue?: (contaId: number, mes: number) => number;
  getBudgetValue?: (contaId: number, mes: number) => number;
  getRealizadoAtualValue?: (contaId: number, mes: number) => number;
  ultimoMesRealizado?: number;
  // Pkg mode: viabiliza a visao "Por CR" — quando estes 4 estao setados, mostra o toggle Total/Por CR.
  pkgCrs?: Array<{ id: number; code: string; nome: string }>;
  pkgBudgetRows?: Array<any>;
  pkgRealAtualRows?: Array<any>;
  /** Liga a visao "Por Conta" (decomposicao do Vigente por conta contabil). */
  permitirPorConta?: boolean;
}) {
  const { monthsShort, fiscalMonthNumbers } = useFiscalYear();
  const lastReal = ultimoMesRealizado || 0;
  const getRealAnteriorFn = getRealAnterior || (() => 0);
  const getOrcFn = getOrc || (() => 0);
  const getRealAtualFn = getRealAtual || (() => 0);
  const isPkgChart = !!(pkgCrs && pkgCrs.length > 0);
  // Em modo pacote as configs vem com uma linha por (conta, CR) — dedup por conta,
  // porque os getters agregados ja somam todos os CRs (senao a conta contaria N vezes).
  const configs = useMemo(() => {
    const seen = new Set<number>();
    return configsProp.filter((c: any) => {
      if (seen.has(c.CONTA_ID)) return false;
      seen.add(c.CONTA_ID);
      return true;
    });
  }, [configsProp]);
  // TOTAL e a visao padrao; as outras duas decompoem a MESMA barra Vigente, uma
  // por CR do pacote, outra por conta contabil.
  const [viewMode, setViewMode] = useState<'TOTAL' | 'BY_CR' | 'BY_CONTA'>('TOTAL');

  // Os modos oferecidos dependem do que a tela tem: CR so em pacote, Conta so
  // onde faz sentido decompor (folha). Com um modo so, o toggle nem aparece.
  const modosDisponiveis: Array<['TOTAL' | 'BY_CR' | 'BY_CONTA', string]> = [
    ['TOTAL', 'Total'],
    ...(permitirPorConta ? [['BY_CONTA', 'Por Conta'] as ['BY_CONTA', string]] : []),
    ...(isPkgChart ? [['BY_CR', 'Por CR'] as ['BY_CR', string]] : []),
  ];
  // Modo pedido mas indisponivel (ex: sai do pacote com "Por CR" ativo) cai no Total.
  const decomposto = modosDisponiveis.some(([k]) => k === viewMode) && viewMode !== 'TOTAL' ? viewMode : null;

  // Mesma familia da grade (ver --chart-* no index.css): realizado neutro,
  // orcado no azul de acento. Como var() de CSS, o tema escuro troca sozinho —
  // com hex fixo o grafico ficaria com a paleta do claro no escuro.
  const COLOR_REAL_ANTERIOR = 'var(--chart-real-anterior)';
  const COLOR_REAL = 'var(--chart-realizado)';
  const COLOR_PROJ = 'var(--chart-projetado)';
  // Paleta das visoes decompostas (por CR e por conta). Aqui a cor e categorica:
  // separa itens, nao carrega significado — por isso nao segue a familia
  // azul/roxo das tres series do comparativo.
  const PALETA_DECOMPOSICAO = ['#3b82f6', '#8b5cf6', '#f59e0b', '#ec4899', '#14b8a6', '#f43f5e', '#06b6d4', '#84cc16', '#a855f7', '#75c95f'];

  // Série única "Vigente" — uma barra por mês, cor depende de ser realizado ou projetado.
  // Assim realizado e projetado dividem o mesmo eixo (continuidade visual: jan-mar real, abr-dez proj).
  const chartData = monthsShort.map((m, i) => {
    const calMonth = fiscalMonthNumbers[i];
    let anterior = 0, realAtual = 0, orcado = 0;
    configs.forEach((dc: any) => {
      anterior += getRealAnteriorFn(dc.CONTA_ID, calMonth);
      orcado += getOrcFn(dc.CONTA_ID, calMonth);
      if (calMonth <= lastReal) realAtual += getRealAtualFn(dc.CONTA_ID, calMonth);
    });
    const isReal = calMonth <= lastReal;
    return {
      mes: m,
      'Realizado anterior': Math.round(anterior),
      Vigente: Math.round(isReal ? realAtual : orcado),
      _orcado: Math.round(orcado),
      _isReal: isReal,
    };
  });
  if (configs.length === 0) return null;
  const chartCfg: ChartConfig = {
    'Realizado anterior': { label: 'Realizado anterior', color: COLOR_REAL_ANTERIOR },
    'Realizado': { label: 'Realizado', color: COLOR_REAL },
    'Projetado': { label: 'Projetado', color: COLOR_PROJ },
  };

  // ── Visoes decompostas ────────────────────────────────────────────────
  // Por CR e Por Conta sao a MESMA coisa vista por eixos diferentes: fatiam a
  // barra Vigente (realizado nos meses fechados, orcado nos abertos). Por isso
  // compartilham serie, dados, tooltip e legenda — antes so existia a de CR e
  // a tela de folha mantinha um grafico proprio so para ter a de conta.
  const seriesDecompostas: Array<{ chave: string; rotulo: string; titulo?: string; cor: string }> =
    viewMode === 'BY_CR'
      ? (pkgCrs || []).map((cr, i) => ({
          chave: cr.code, rotulo: cr.code, titulo: cr.nome,
          cor: PALETA_DECOMPOSICAO[i % PALETA_DECOMPOSICAO.length],
        }))
      : viewMode === 'BY_CONTA'
        // Chave pelo ID: dois planos de conta podem repetir o nome, e nome
        // repetido viraria uma serie so, somando contas diferentes na mesma cor.
        ? configs.map((dc: any, i: number) => ({
            chave: `c${dc.CONTA_ID}`, rotulo: dc.CONTA_NOME, titulo: dc.CONTA_NOME,
            cor: PALETA_DECOMPOSICAO[i % PALETA_DECOMPOSICAO.length],
          }))
        : [];

  const contaIdSet = new Set(configs.map((c: any) => c.CONTA_ID));
  const dadosDecompostos = seriesDecompostas.length === 0 ? [] : monthsShort.map((m, i) => {
    const calMonth = fiscalMonthNumbers[i];
    const isReal = calMonth <= lastReal;
    const row: any = { mes: m, _isReal: isReal };
    let total = 0;
    if (viewMode === 'BY_CR') {
      const rows = isReal ? (pkgRealAtualRows || []) : (pkgBudgetRows || []);
      (pkgCrs || []).forEach((cr) => {
        const v = rows
          .filter((r: any) => Number(r.CR_ID) === cr.id && r.MES === calMonth && contaIdSet.has(r.CONTA_ID))
          .reduce((s: number, r: any) => s + (Number(r.VALOR) || 0), 0);
        row[cr.code] = Math.round(v);
        total += v;
      });
    } else {
      configs.forEach((dc: any) => {
        const v = isReal ? getRealAtualFn(dc.CONTA_ID, calMonth) : getOrcFn(dc.CONTA_ID, calMonth);
        row[`c${dc.CONTA_ID}`] = Math.round(v);
        total += v;
      });
    }
    row._total = Math.round(total);
    return row;
  });

  const TooltipDecomposto = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const data = payload[0]?.payload;
    if (!data) return null;
    const items = seriesDecompostas
      .map(s => ({ s, val: Number(data[s.chave]) || 0 }))
      .filter(it => it.val !== 0)
      .sort((a, b) => b.val - a.val);
    const total = items.reduce((s, it) => s + it.val, 0);
    return (
      <div className="rounded-lg px-3 py-2 shadow-lg text-xs" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', minWidth: 200 }}>
        <p className="font-medium mb-1.5" style={{ color: 'var(--text)' }}>
          {label} <span style={{ color: 'var(--color-text-secondary)', fontWeight: 400 }}>· {data._isReal ? 'Realizado' : 'Projetado'}</span>
        </p>
        {items.map(({ s, val }) => (
          <div key={s.chave} className="flex items-center justify-between gap-4 py-0.5">
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: s.cor }} />
              <span style={{ color: 'var(--color-text-secondary)' }} title={s.titulo}>
                {s.rotulo}{s.titulo && s.titulo !== s.rotulo ? ` · ${s.titulo.slice(0, 22)}` : ''}
              </span>
            </span>
            <span className="font-medium tabular-nums" style={{ color: 'var(--text)' }}>{formatCurrency(val)}</span>
          </div>
        ))}
        <div className="mt-1.5 pt-1.5 flex justify-between gap-4" style={{ borderTop: '1px solid var(--color-border)' }}>
          <span style={{ color: 'var(--color-text-secondary)' }}>Total</span>
          <span className="font-semibold tabular-nums" style={{ color: 'var(--text)' }}>{formatCurrency(total)}</span>
        </div>
      </div>
    );
  };

  const LegendaDecomposta = () => (
    <div className="flex items-center justify-center gap-3 flex-wrap mt-2">
      {seriesDecompostas.map((s) => (
        <span key={s.chave} className="inline-flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--color-text-secondary)' }} title={s.titulo}>
          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: s.cor }} />
          {s.rotulo}
        </span>
      ))}
    </div>
  );

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const data = payload[0]?.payload;
    if (!data) return null;
    const anterior = data['Realizado anterior'] || 0;
    const vigente = data.Vigente || 0;
    const orcado = data._orcado || 0;
    const isReal = !!data._isReal;
    const pctVsAnterior = anterior !== 0 ? ((vigente - anterior) / Math.abs(anterior)) * 100 : 0;
    const pctVsOrcado = isReal && orcado !== 0 ? ((vigente - orcado) / Math.abs(orcado)) * 100 : 0;
    const fmtPct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
    const vigenteLabel = isReal ? 'Realizado' : 'Projetado';
    const vigenteColor = isReal ? COLOR_REAL : COLOR_PROJ;
    return (
      <div className="rounded-lg px-3 py-2 shadow-lg text-xs" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <p className="font-medium mb-1.5" style={{ color: 'var(--text)' }}>{label}</p>
        <div className="flex items-center justify-between gap-4 py-0.5">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full" style={{ background: COLOR_REAL_ANTERIOR }} />
            <span style={{ color: 'var(--color-text-secondary)' }}>Realizado anterior</span>
          </span>
          <span className="font-medium tabular-nums" style={{ color: 'var(--text)' }}>{formatCurrency(anterior)}</span>
        </div>
        <div className="flex items-center justify-between gap-4 py-0.5">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full" style={{ background: vigenteColor }} />
            <span style={{ color: 'var(--color-text-secondary)' }}>{vigenteLabel}</span>
          </span>
          <span className="font-medium tabular-nums" style={{ color: 'var(--text)' }}>{formatCurrency(vigente)}</span>
        </div>
        <div className="mt-1.5 pt-1.5" style={{ borderTop: '1px solid var(--color-border)' }}>
          {isReal && (
            <div className="flex justify-between gap-4 py-0.5">
              <span style={{ color: 'var(--color-text-secondary)' }}>Real vs Orçado</span>
              <span className="font-medium tabular-nums" style={{ color: pctVsOrcado >= 0 ? '#10b981' : '#ef4444' }}>{fmtPct(pctVsOrcado)}</span>
            </div>
          )}
          <div className="flex justify-between gap-4 py-0.5">
            <span style={{ color: 'var(--color-text-secondary)' }}>{vigenteLabel} vs Anterior</span>
            <span className="font-medium tabular-nums" style={{ color: pctVsAnterior >= 0 ? '#10b981' : '#ef4444' }}>{fmtPct(pctVsAnterior)}</span>
          </div>
        </div>
      </div>
    );
  };

  // Legenda manual: 3 chips coloridos (anterior / real / projetado)
  const CustomLegend = () => (
    <div className="flex items-center justify-center gap-4 flex-wrap mt-2">
      {[
        { label: 'Realizado anterior', color: COLOR_REAL_ANTERIOR },
        { label: 'Realizado', color: COLOR_REAL },
        { label: 'Projetado', color: COLOR_PROJ },
      ].map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--color-text-secondary)' }}>
          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: it.color }} />
          {it.label}
        </span>
      ))}
    </div>
  );

  return (
    <Card>
      <CardHeader style={{ borderBottom: 'none' }}>
        <div className="flex items-center justify-between gap-3 flex-wrap w-full">
          <div>
            {/* Sem ano no titulo de proposito: o ciclo muda e o texto ficaria
                mentindo. "Anterior" e "vigente" valem para qualquer ciclo. */}
            <CardTitle>Comparativo: Realizado e Orçado</CardTitle>
            <p className="mt-1" style={{ color: 'var(--color-text-secondary)', fontSize: '14px' }}>
              {decomposto === 'BY_CR'
                ? 'Vigente (realizado + projeção) decomposto por CR do pacote'
                : decomposto === 'BY_CONTA'
                  ? 'Vigente (realizado + projeção) decomposto por conta contábil'
                  : 'Ano anterior (realizado) versus ano vigente (realizado + projeção)'}
            </p>
          </div>
          {modosDisponiveis.length > 1 && (
            <div className="inline-flex rounded-lg border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
              {modosDisponiveis.map(([k, l]) => {
                const active = viewMode === k;
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setViewMode(k)}
                    className="px-3 py-1 text-[12px] font-medium transition-colors"
                    style={{
                      backgroundColor: active ? 'var(--color-primary)' : 'var(--color-surface)',
                      color: active ? 'white' : 'var(--color-text-secondary)',
                    }}
                  >
                    {l}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {decomposto ? (
          <ChartContainer config={chartCfg} style={{ height: 250 }}>
            <ComposedChart data={dadosDecompostos} margin={{ top: 8, right: 12, left: 4, bottom: 4 }} barCategoryGap="20%">
              <CartesianGrid vertical={false} />
              <XAxis dataKey="mes" tickLine={false} axisLine={false} tickMargin={8} />
              <YAxis tickLine={false} axisLine={false} width={55} />
              <ChartTooltip content={<TooltipDecomposto />} cursor={{ fill: 'var(--bg-hover)' }} />
              <ChartLegend content={<LegendaDecomposta />} />
              {seriesDecompostas.map((serie, idx, arr) => (
                <RechartsBar
                  key={serie.chave}
                  dataKey={serie.chave}
                  name={serie.rotulo}
                  stackId="vigente"
                  fill={serie.cor}
                  maxBarSize={40}
                  radius={idx === arr.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                />
              ))}
            </ComposedChart>
          </ChartContainer>
        ) : (
          <ChartContainer config={chartCfg} style={{ height: 250 }}>
            <ComposedChart data={chartData} margin={{ top: 8, right: 12, left: 4, bottom: 4 }} barGap={2} barCategoryGap="20%">
              <CartesianGrid vertical={false} />
              <XAxis dataKey="mes" tickLine={false} axisLine={false} tickMargin={8} />
              <YAxis tickLine={false} axisLine={false} width={55} />
              <ChartTooltip content={<CustomTooltip />} cursor={{ fill: 'var(--bg-hover)' }} />
              <ChartLegend content={<CustomLegend />} />
              <RechartsBar dataKey="Realizado anterior" name="Realizado anterior" fill={COLOR_REAL_ANTERIOR} maxBarSize={40} radius={[4, 4, 0, 0]} />
              <RechartsBar dataKey="Vigente" name="Vigente" maxBarSize={40} radius={[4, 4, 0, 0]}>
                {chartData.map((d, i) => (
                  <Cell key={i} fill={d._isReal ? COLOR_REAL : COLOR_PROJ} />
                ))}
              </RechartsBar>
            </ComposedChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

interface OrcamentoContentProps {
  gestorId: number | null;
  selectedCR: number | null;
  /**
   * Modo pacote: quando setado, o componente opera sobre o pacote (todas as CRs do pacote,
   * deduplicando contas, modelo efetivo NORMAL via deriveRota). Storage em ORCAMENTO_PACOTE.
   * selectedCR fica null e o "entity scope" passa a ser o pacote.
   */
  selectedPackage?: { ID: number; NOME: string; GESTOR_ID?: number | null } | null;
  readOnly?: boolean;
  /**
   * Modo publico (link do gestor): forca o ciclo do token em vez do ciclo mais
   * recente — o token e emitido para um (ciclo, gestor) especifico.
   */
  forcedCicloId?: number | null;
  /** Callback when data loads (e.g. to get available drivers for external tabs) */
  onDriversLoaded?: (drivers: string[]) => void;
  onStatusChange?: (crId: number, status: string, driversConfirmados?: string) => void;
}

// Cabecalho do DRE do CR — mesma linguagem do card DRE do Dashboard: uma unica
// divisoria suave sob os titulos, sem sombra.
const thDreStyle: React.CSSProperties = {
  borderBottom: '1px solid var(--dash-dre-sub-border)',
};

export default function OrcamentoContent({ gestorId, selectedCR, selectedPackage, readOnly: readOnlyProp = false, forcedCicloId = null, onStatusChange }: OrcamentoContentProps) {
  // Modo publico: dados via espelhos token-escopados (execSF roteia sozinho) e
  // escritas via publicOrcWrite — mesma UI, mesmo fluxo, zero REST autenticado.
  const isPublic = !!getPublicOrcToken();
  const { monthsShort, fiscalMonthNumbers } = useFiscalYear();
  const colToMonth = (col: number) => fiscalMonthNumbers[col - 1];
  // Corrige o scroll horizontal da grade de modelo (ver o hook).
  // Mount em 1 ida so: SF 124 (hotOrcBase) devolve os 9 blocos como JSON — eram 9
  // consultas via SF 76 (sandbox ~550ms cada, concorrencia ~2 no servidor).
  // Ordenacoes dos ORDER BY originais ficam no cliente (JSON_ARRAYAGG nao ordena).
  const [orcBase, setOrcBase] = useState<any | null>(null);
  useEffect(() => {
    execSFCached(SF_IDS.hotOrcBase, {}, 60_000)
      .then(rows => setOrcBase(rows?.[0] || {}))
      .catch(e => console.error('hotOrcBase:', e));
  }, []);
  // Ordem escolhida dos modelos (DRIVERS.ORDEM) para ordenar as abas. Vem direto
  // no bloco NORMAL_DRIVERS do mount (hotOrcBase), entao vale tanto no contexto
  // interno quanto no link publico do gestor. Definida no Mapeamento -> Ordenar.
  const ordemOfDriver = (d: any) => (d?.ORDEM != null ? Number(d.ORDEM) : Number(d?.ID ?? 0));
  const byStr = (f: string) => (a: any, b: any) => String(a[f] ?? '').localeCompare(String(b[f] ?? ''));
  const ciclos = useMemo(() => jsonField(orcBase?.CICLOS).sort((a, b) => Number(b.ANO) - Number(a.ANO)), [orcBase]);
  const cargos = useMemo(() => jsonField(orcBase?.CARGOS).sort(byStr('NOME')), [orcBase]);
  const pacoteDrivers = useMemo(() => jsonField(orcBase?.PACOTE_DRIVERS), [orcBase]);
  const normalDrivers = useMemo(() => jsonField(orcBase?.NORMAL_DRIVERS).sort(byStr('NOME')), [orcBase]);
  const allFormulas = useMemo(() => jsonField(orcBase?.FORMULAS).sort((a, b) => (Number(a.ORDEM) - Number(b.ORDEM)) || String(a.CONTA_CODIGO ?? '').localeCompare(String(b.CONTA_CODIGO ?? ''))), [orcBase]);
  const dreConfig = useMemo(() => jsonField(orcBase?.DRE_CONFIG).sort((a, b) => Number(a.ORDEM) - Number(b.ORDEM)), [orcBase]);
  const allContas = useMemo(() => jsonField(orcBase?.CONTAS).sort(byStr('CODIGO')), [orcBase]);

  const [selectedCiclo, setSelectedCiclo] = useState<number | null>(null);
  // BENEFICIO/ENCARGO sao versionados por ciclo — sem o filtro, o modal de
  // premissas duplica os itens e o calcBenEnc soma os beneficios de TODOS os
  // ciclos (inclusive orfaos de versoes deletadas), inflando a folha.
  const beneficios = useMemo(() => jsonField(orcBase?.BENEFICIOS).filter((b: any) => Number(b.CICLO_ID) === selectedCiclo), [orcBase, selectedCiclo]);
  const encargos = useMemo(() => jsonField(orcBase?.ENCARGOS).filter((e: any) => Number(e.CICLO_ID) === selectedCiclo), [orcBase, selectedCiclo]);
  const [activeTab, setActiveTab] = useState<DriverTab>('');
  const [driverConfigs, setDriverConfigs] = useState<any[]>([]);
  const [budgetData, setBudgetData] = useState<any[]>([]);
  const [realizadoData, setRealizadoData] = useState<any[]>([]);
  const [realizadoAnoAtual, setRealizadoAnoAtual] = useState<any[]>([]);
  const [orcadoControleData, setOrcadoControleData] = useState<any[]>([]);
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [historicoOpen, setHistoricoOpen] = useState(false);
  const [rejectComment, setRejectComment] = useState('');
  const [colaboradores, setColaboradores] = useState<any[]>([]);
  const [orcamentoPessoal, setOrcamentoPessoal] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [calculating, setCalculating] = useState(false);
  const [showRecalcConfirm, setShowRecalcConfirm] = useState(false);
  const [dataVersion, setDataVersion] = useState(0);
  // Em CR mode, guarda o STATUS do PACOTE_STATUS dos drivers de pacote que aparecem
  // como abas no CR — usado pra esconder a aba do pacote durante o preenchimento
  // (status PENDENTE/CONFIRMADO) e mostrar aviso quando REPROVADO.
  const [pacoteStatusesByDriver, setPacoteStatusesByDriver] = useState<Record<number, any>>({});
  const [headcountData, setHeadcountData] = useState<number[][]>([]);
  const [contratacoes, setContratacoes] = useState<any[]>([]);
  // Grade de contratacoes: celula em edicao (valor digitado) e cargo com a justificativa aberta
  const [contratJustEdit, setContratJustEdit] = useState<{ cargoId: number; texto: string } | null>(null);
  const [expandedProjecao, setExpandedProjecao] = useState<Set<string>>(new Set());
  // Aba Pacotes dentro do CR: seções expansíveis (padrão Pessoal), iniciam
  // EXPANDIDAS. Guardamos os COLAPSADOS (Set vazio = todos abertos).
  const [collapsedPacotes, setCollapsedPacotes] = useState<Set<string>>(new Set());
  const togglePacote = (key: string) => setCollapsedPacotes(prev => {
    const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n;
  });
  // Drill por conta no DRE do CR (aba Resumo): linhas expandidas (por PREFIXO_CONTA)
  const [expandedResumoLines, setExpandedResumoLines] = useState<Set<string>>(new Set());
  // Orientacao da arvore da Projecao Mensal de Pessoal: 'conta' (Salarios/Encargos/
  // Beneficios -> colaboradores) ou 'colaborador' (colaborador -> contas: salario,
  // INSS, ferias, VA...). Default 'colaborador' (visao pedida pelo gestor).
  const [pessoalProjView, setPessoalProjView] = useState<'conta' | 'colaborador'>('colaborador');
  const [showPremissasModal, setShowPremissasModal] = useState(false);
  const [aumentoColabId, setAumentoColabId] = useState<number | null>(null);
  const [aumentoForm, setAumentoForm] = useState({ PERCENTUAL: '', MES_APLICACAO: '1', MOTIVO: '' });
  const [desligamentoColabId, setDesligamentoColabId] = useState<number | null>(null);
  const [desligamentoForm, setDesligamentoForm] = useState({ MES_DESLIGAMENTO: '1' });
  const [dissidios, setDissidios] = useState<any[]>([]);
  const [_turnovers, setTurnovers] = useState<any[]>([]);
  const [aumentosSalariais, setAumentosSalariais] = useState<any[]>([]);
  const [desligamentosProjetados, setDesligamentosProjetados] = useState<any[]>([]);
  const [histPercent, setHistPercent] = useState('5');
  // Chaves: CONTA_ID em modo CR; `${CONTA_ID}_${CR_ID}` em modo pacote (linha por CR)
  const [histModes, setHistModes] = useState<Record<string, 'sazonalidade' | 'igual'>>({});
  const [histPercents, setHistPercents] = useState<Record<string, string>>({});
  const [histJustificativas, setHistJustificativas] = useState<Record<string, string>>({});
  const [showJustModal, setShowJustModal] = useState(false);
  const [showHistReal, setShowHistReal] = useState(false);
  const [justContaId, setJustContaId] = useState<number | null>(null);
  // Chave da linha no modal de justificativa (em modo pacote inclui o CR)
  const [justHk, setJustHk] = useState<string | null>(null);
  const [justText, setJustText] = useState('');
  // Visao consolidada das justificativas da Base Historica (consulta do aprovador
  // em modo leitura): lista conta a conta o que o gestor escreveu.
  const [showJustConsulta, setShowJustConsulta] = useState(false);
  const [confirmedDrivers, setConfirmedDrivers] = useState<Set<string>>(new Set());
  // Espelho em ref de confirmedDrivers, lido por desconfirmarPorEdicao.
  //
  // Uma projecao em massa grava 12 celulas dentro do MESMO tick: o state nao
  // re-renderiza no meio do laco, entao todas as 12 chamadas enxergariam o
  // driver ainda confirmado e disparariam 12 desconfirmacoes (12 toasts, 12
  // gravacoes de status). O ref e atualizado na hora, junto do setState, e por
  // isso a 2a chamada em diante ja ve o driver fora do conjunto.
  //
  // Toda escrita em confirmedDrivers passa por aplicarConfirmedDrivers para que
  // os dois nunca divirjam.
  const confirmedDriversRef = useRef<Set<string>>(new Set());
  const aplicarConfirmedDrivers = (next: Set<string>) => {
    confirmedDriversRef.current = next;
    setConfirmedDrivers(next);
  };
  const [statusRecord, setStatusRecord] = useState<any>(null);
  // Avisos de rateio do modelo de pacote — colapsados num icone acima do banner
  // de meses travados (banner inline no header empurrava o botao Confirmar do lugar)
  const [showRateioAvisos, setShowRateioAvisos] = useState(false);
  // Modo pacote: helpers de scope SQL (CRs sao carregadas dentro de loadData como local).
  const isPkg = !!selectedPackage;
  // ── Modo avaliacao ──────────────────────────────────────────────────────
  // CR SUBMETIDO aberto por quem pode aprovar (admin/aprovador): a tela vira
  // uma visao de AVALIACAO — tudo somente leitura (grids, confirmacoes, acoes)
  // e uma barra fixa com Aprovar/Reprovar acima das abas. O gestor dono nao e
  // afetado (perfil dele nao aprova) e o link publico tambem nao (sem sessao).
  const evalUser = getUser();
  // Sem perfis no app: qualquer usuario autenticado decide (a tela publica, nao).
  const canApproveUser = !isPublic && !!evalUser;
  const isEvaluation = canApproveUser && !isPkg && statusRecord?.STATUS === 'SUBMETIDO';
  // SUBMETIDO ou APROVADO travam a edicao em QUALQUER contexto (link publico do
  // gestor, /orcamento, /preenchimento, CR ou pacote): depois de submetido o
  // cenario aguarda avaliacao e nao pode mais ser editado; so volta a ser
  // editavel se for REPROVADO. APROVADO idem. Reabrir para editar exige a acao
  // explicita de aprovacao/reprovacao (nao a edicao direta das celulas).
  const isLockedStatus = statusRecord?.STATUS === 'SUBMETIDO' || statusRecord?.STATUS === 'APROVADO';
  // Versao fechada agora pode ser aberta aqui (o "Tornar atual" passou a valer
  // para o sistema inteiro), mas so para consulta: orcamento fechado e historico.
  // Trava independente do status do CR — fechada bloqueia ate CR PENDENTE.
  const cicloFechado = versaoEhFechada(ciclos, selectedCiclo);
  const readOnly = readOnlyProp || isEvaluation || isLockedStatus || cicloFechado;
  // Identificacao da faixa de Orcado no cabecalho das grades. Deriva do MESMO
  // statusRecord que trava a edicao, entao acompanha a submissao/aprovacao sem
  // recarregar a tela. Nao altera permissao nenhuma — so o texto.
  const rotuloOrcado = rotuloOrcadoPorStatus(statusRecord?.STATUS);
  // pkgConfigsRaw: pre-dedup, preserva CR_ID por (CONTA_ID, DRIVER_TIPO). Em modo
  // pacote o preenchimento e feito CR a CR (uma linha por CR no grid) — este mapa
  // define quais CRs aplicam a cada (conta, modelo) e alimenta os getters por CR.
  const [pkgConfigsRaw, setPkgConfigsRaw] = useState<any[]>([]);
  // Em CR mode: linhas de ORCAMENTO_PACOTE deste CR (bloco PKG_BUDGET da SF 125) —
  // alimenta a aba "Pacotes" com os valores que o gestor do pacote lancou para o CR.
  const [pkgBudgetCrRows, setPkgBudgetCrRows] = useState<any[]>([]);
  const [impostosExpanded, setImpostosExpanded] = useState(false);
  // PREMISSA_IMPOSTO (bloco IMPOSTO_CENTRAL da SF de detalhe) nao e mais lido
  // aqui: a aliquota virou premissa livre e a regra virou formula no modelo.
  // A tabela continua existindo para as versoes ja fechadas, que foram
  // orcadas sob o mecanismo antigo.
  // Premissas gerais da versao (nome livre, valor por mes). Alimentam as linhas
  // de modelo do tipo PREMISSA — ver lib/linha-modelo.
  const [premissasGerais, setPremissasGerais] = useState<any[]>([]);
  const premissasMap = useMemo(() => mapaPremissas(premissasGerais), [premissasGerais]);
  const [customLineValues, setCustomLineValues] = useState<any[]>([]);
  const [formulaOverrides, setFormulaOverrides] = useState<any[]>([]);
  // Modelos de pacote: cadastro de rateios reutilizaveis (aba Tipos de Rateio do
  // Mapeamento) — quantidade por CR vira % on-the-fly na distribuicao das linhas.
  const [rateiosPkg, setRateiosPkg] = useState<any[]>([]);
  const [rateioItensPkg, setRateioItensPkg] = useState<any[]>([]);
  const { toasts, addToast, removeToast } = useToast();
  const hotRefs = useRef<Record<string, any>>({});

  const cicloAtivo = ciclos.find((c: any) => c.ID === selectedCiclo);
  // Sem ciclo ativo, cai no ano corrente e nao num literal: ano fixo aqui
  // envelhece calado — a tela segue funcionando, so que no ano errado.
  const cicloAno = cicloAtivo?.ANO ?? new Date().getFullYear();

  useEffect(() => {
    if (ciclos.length > 0 && !selectedCiclo) {
      const forced = forcedCicloId != null && ciclos.some((c: any) => c.ID === forcedCicloId);
      setSelectedCiclo(forced ? forcedCicloId : escolherVersaoVigente(ciclos));
    }
  }, [ciclos]);

  useEffect(() => {
    if ((!selectedCR && !selectedPackage) || !selectedCiclo) return;
    loadData();
  }, [selectedCR, selectedPackage, selectedCiclo]);

  const loadData = async () => {
    if ((!selectedCR && !selectedPackage) || !selectedCiclo) return;
    setLoading(true);
    try {
      const ciclo = ciclos.find((c: any) => c.ID === selectedCiclo);
      const prevYear = (ciclo?.ANO ?? new Date().getFullYear()) - 1;
      const anoAtual = ciclo?.ANO ?? new Date().getFullYear();
      // Versao controle (mesmo ANO do ciclo selecionado, VERSAO_CONTROLE = true) — pra
      // comparar Versao Atual vs Versao Controle no Resumo. 0 = sem versao controle.
      const controlCiclo = ciclos.find((c: any) => c.ANO === (ciclo?.ANO || 0) && c.VERSAO_CONTROLE === 'true' && c.ID !== selectedCiclo);
      const controlCicloId = controlCiclo ? controlCiclo.ID : 0;

      // UMA ida ao servidor: SF 125 (modo CR) ou 126 (modo pacote) devolve todos os
      // blocos de dados como campos JSON — eram ~20 consultas sequenciais via SF 76
      // (sandbox ~550ms cada), a raiz da lentidao ao abrir um driver.
      const row = (isPkg && selectedPackage
        ? await execSF(SF_IDS.hotOrcDetalhePkg, { pkgId: selectedPackage.ID, cicloId: selectedCiclo, ano: anoAtual, anoPrev: prevYear, controlCicloId })
        : await execSF(SF_IDS.hotOrcDetalheCr, { crId: selectedCR, cicloId: selectedCiclo, ano: anoAtual, anoPrev: prevYear, gestorId: gestorId || 0, controlCicloId })
      )?.[0] || {};

      // Fonte dinâmica: contas do CR (CR_CONTA) × driver do mapeamento global (CONTA_DRIVER)
      // com override por exceção CR-específica (CONTA_DRIVER_EXCECAO). Ordenacao do
      // ORDER BY cc.CODIGO original feita no cliente.
      const rawConfigs = jsonField(row.CONFIGS).sort((a: any, b: any) =>
        String(a.CODIGO ?? '').localeCompare(String(b.CODIGO ?? '')) ||
        String(a.CR_CODIGO ?? '').localeCompare(String(b.CR_CODIGO ?? '')));
      // Em modo pacote, preserva rawConfigs — os getters por CR derivam daqui
      // quais CRs aplicam a cada (conta, modelo).
      if (isPkg) setPkgConfigsRaw(rawConfigs);
      // Dedup: em modo CR, 1 linha por (conta, modelo). Em modo pacote o
      // preenchimento e CR a CR — 1 linha por (conta, modelo, CR), exceto PESSOAL
      // (a folha e calculada por colaborador, nao por lancamento manual).
      const seen = new Set<string>();
      const configs = rawConfigs.filter((dc: any) => {
        const key = isPkg && dc.DRIVER_TIPO !== 'PESSOAL'
          ? `${dc.CONTA_ID}_${dc.DRIVER_TIPO}_${dc.CR_ID}`
          : `${dc.CONTA_ID}_${dc.DRIVER_TIPO}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      setDriverConfigs(configs);

      // Orcamento: em modo pacote usa ORCAMENTO_PACOTE; em modo CR usa ORCAMENTO.
      // Saida sempre formatada como ORCAMENTO (linhas {CR_ID, CONTA_ID, MES, VALOR}).
      setBudgetData(jsonField(row.BUDGET));
      setRealizadoData(jsonField(row.REALIZADO));
      setRealizadoAnoAtual(jsonField(row.REALIZADO_ATUAL));
      setOrcadoControleData(controlCicloId ? jsonField(row.ORC_CONTROLE) : []);

      const cols = jsonField(row.COLABORADORES).sort((a: any, b: any) => String(a.NOME ?? '').localeCompare(String(b.NOME ?? '')));
      setColaboradores(cols);
      const orcPessoal = jsonField(row.ORCAMENTO_PESSOAL);
      setOrcamentoPessoal(orcPessoal);
      // Projeção Mensal de Pessoal inicia expandida SÓ quando a folha já foi
      // calculada (há projeção salva); caso contrário permanece recolhida.
      setExpandedProjecao(prev => {
        const n = new Set(prev);
        if (orcPessoal.length > 0) n.add('section-proj'); else n.delete('section-proj');
        return n;
      });

      if (cargos.length > 0) {
        const hcRows = jsonField(row.HEADCOUNT);
        const hcGrid = cargos.map((cargo: any) => {
          const r = new Array(12).fill(0);
          hcRows.filter((h: any) => h.CARGO_ID === cargo.ID).forEach((h: any) => { r[h.MES - 1] = Number(h.QUANTIDADE) || 0; });
          return r;
        });
        setHeadcountData(hcGrid);
      }

      const contrats = jsonField(row.CONTRATACOES).sort((a: any, b: any) => Number(a.MES_ENTRADA) - Number(b.MES_ENTRADA));
      setContratacoes(contrats);

      setDissidios(jsonField(row.DISSIDIOS));
      setTurnovers(jsonField(row.TURNOVERS));
      setAumentosSalariais(jsonField(row.AUMENTOS));
      setDesligamentosProjetados(jsonField(row.DESLIGAMENTOS));

      const histPrem = jsonField(row.HIST_PREMISSA);
      const hpMap: Record<string, string> = {};
      const hmMap: Record<string, 'sazonalidade' | 'igual'> = {};
      const hjMap: Record<string, string> = {};
      for (const hp of histPrem) {
        hpMap[hp.CONTA_ID] = String(hp.PERCENTUAL ?? 0);
        hmMap[hp.CONTA_ID] = (hp.MODO === 'igual' ? 'igual' : 'sazonalidade');
        hjMap[hp.CONTA_ID] = hp.JUSTIFICATIVA || '';
      }
      setHistPercents(hpMap);
      setHistModes(hmMap);
      setHistJustificativas(hjMap);

      setCustomLineValues(jsonField(row.CLV));
      setFormulaOverrides(jsonField(row.OVERRIDES));
      setPremissasGerais(jsonField(row.PREMISSAS));
      // Blocos RATEIOS/RATEIO_ITENS so existem no modo pacote (SF 126)
      setRateiosPkg(jsonField(row.RATEIOS));
      setRateioItensPkg(jsonField(row.RATEIO_ITENS));

      // Status: em modo CR usa ORCAMENTO_STATUS por CR; em pacote usa PACOTE_STATUS por DRIVER_ID.
      const statusRows = jsonField(row.STATUS);
      if (statusRows.length > 0) {
        setStatusRecord(statusRows[0]);
        const saved = statusRows[0].DRIVERS_CONFIRMADOS;
        aplicarConfirmedDrivers(saved ? new Set(saved.split(',').filter(Boolean)) : new Set());
      } else {
        setStatusRecord(null);
        aplicarConfirmedDrivers(new Set());
      }

      // Em CR mode: STATUS dos pacotes que sao abas neste CR — condiciona a renderizacao
      // da aba do pacote (PENDENTE/CONFIRMADO esconde, SUBMETIDO/APROVADO read-only,
      // REPROVADO mostra com aviso). PKG_BUDGET traz os valores lancados pelo gestor
      // do pacote para ESTE CR (a aba Pacotes le daqui, nao de ORCAMENTO).
      if (!isPkg) {
        const map: Record<number, any> = {};
        for (const r of jsonField(row.PACOTE_STATUS_ALL)) {
          map[Number(r.DRIVER_ID)] = r;
        }
        setPacoteStatusesByDriver(map);
        setPkgBudgetCrRows(jsonField(row.PKG_BUDGET));
      } else {
        setPacoteStatusesByDriver({});
        setPkgBudgetCrRows([]);
      }

      // Aba inicial: Resumo no modo CR; no modo pacote a aba Resumo nao existe —
      // abre direto no modelo do proprio pacote (pos-fusao o nome coincide com o
      // do driver; fallback: primeiro modelo presente nas configs).
      if (!activeTab) {
        if (isPkg) {
          const own = selectedPackage?.NOME && configs.some((dc: any) => dc.DRIVER_TIPO === selectedPackage.NOME)
            ? selectedPackage.NOME
            : (configs[0]?.DRIVER_TIPO || '');
          setActiveTab(own || 'RESUMO');
        } else {
          setActiveTab('RESUMO');
        }
      }
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  // Releitura silenciosa dos blocos do detalhe (sem spinner) — usada no modo
  // publico apos escritas que precisam de dados frescos do servidor (IDs novos,
  // agregados de folha). Garante antes que a fila de celulas pendentes foi gravada.
  const fetchDetalheRow = async (): Promise<any | null> => {
    if (!selectedCR || !selectedCiclo) return null;
    if (isPublic) await flushPublicOrcQueue();
    const ciclo = ciclos.find((c: any) => c.ID === selectedCiclo);
    const anoAtual = ciclo?.ANO ?? new Date().getFullYear();
    const controlCiclo = ciclos.find((c: any) => c.ANO === (ciclo?.ANO || 0) && c.VERSAO_CONTROLE === 'true' && c.ID !== selectedCiclo);
    const rows = await execSF(SF_IDS.hotOrcDetalheCr, {
      crId: selectedCR, cicloId: selectedCiclo, ano: anoAtual, anoPrev: anoAtual - 1,
      gestorId: gestorId || 0, controlCicloId: controlCiclo ? controlCiclo.ID : 0,
    });
    return rows?.[0] || null;
  };

  const configsByDriver = (driver: string) => driverConfigs.filter((dc: any) => dc.DRIVER_TIPO === driver);
  const hasDriver = (driver: string) => driverConfigs.some((dc: any) => dc.DRIVER_TIPO === driver);

  const pacoteTabs = pacoteDrivers
    .filter((d: any) => hasDriver(d.NOME))
    .map((d: any) => ({ key: d.NOME, label: toTitleCase(d.NOME), icon: Package, isPacote: true, isNormal: false, driverId: d.ID }));

  const fixedKeys = new Set(DRIVER_TABS_FIXED.map(t => t.key));
  // Um driver só renderiza com a UI FIXA/nativa (ticket x volume, base histórica,
  // base zero, pessoal) quando é REALMENTE nativo (ORIGEM='NATIVO'). O driver
  // "RECEITA" foi seedado no passado mas ficou com ORIGEM='TELA' (personalizado) —
  // logo deve ser renderizado como MODELO PERSONALIZADO (contas + linhas de input +
  // resultado da fórmula na mesma Handsontable), e não com a tela nativa de receita.
  // A decisão é sempre por ORIGEM, nunca pelo nome do driver.
  const isNativeDriverName = (name: string) => {
    const d = normalDrivers.find((dr: any) => dr.NOME === name);
    if (!d) return true; // sem registro do driver: mantém o comportamento antigo (nativo por nome)
    return d.ORIGEM === 'NATIVO';
  };
  // Abas de modelos numa ordem GLOBAL unica (DRIVERS.ORDEM), nativos e
  // personalizados juntos — um personalizado pode vir antes de um nativo. O
  // nativo mantem a UI fixa (ticket x volume, base historica/zero, pessoal)
  // quando fixedKeys+ORIGEM='NATIVO'; os demais renderizam como modelo (isNormal).
  // Modo CR: ESCOPO='PACOTE' fica de fora (aparece na aba unica "Pacotes"). Modo
  // PACOTE: a aba do proprio pacote precisa estar aqui.
  const fixedMeta = new Map(DRIVER_TABS_FIXED.filter(t => t.key !== 'RESUMO').map(t => [t.key, t] as const));
  const modelTabs = normalDrivers
    .filter((d: any) => (isPkg || d.ESCOPO !== 'PACOTE') && hasDriver(d.NOME))
    .slice()
    .sort((a: any, b: any) => ordemOfDriver(a) - ordemOfDriver(b) || String(a.NOME ?? '').localeCompare(String(b.NOME ?? '')))
    .map((d: any) => {
      const isFixedNative = fixedKeys.has(d.NOME) && isNativeDriverName(d.NOME);
      const meta = fixedMeta.get(d.NOME);
      return isFixedNative
        ? { key: d.NOME, label: meta?.label ?? toTitleCase(d.NOME), icon: meta?.icon ?? Calculator, isPacote: false, isNormal: false, driverId: d.ID }
        : { key: d.NOME, label: toTitleCase(d.NOME), icon: Calculator, isPacote: false, isNormal: true, driverId: d.ID };
    });

  // Aba unica 'Pacotes' (substitui as multiplas abas individuais de pacote — um CR
  // pode ter varios pacotes; o single tab evita poluir a barra de abas e centraliza
  // a visualizacao em uma lista).
  const PACOTES_CONTAINER_TAB = {
    key: 'PACOTES', label: 'Pacotes', icon: Package,
    isPacote: false, isNormal: false, driverId: 0,
  };
  // A aba única "Pacotes" é do modo CR — dentro de um pacote não faz sentido
  // (e pós-fusão o nome do pacote coincide com o do modelo, o que a faria surgir)
  const hasPacotes = !isPkg && pacoteTabs.length > 0;
  const availableTabs = [
    // Resumo sempre primeiro (so no modo CR — em modo pacote a tela abre direto no
    // modelo do pacote; as acoes de aprovacao ficam na barra de status).
    ...DRIVER_TABS_FIXED.filter(t => t.key === 'RESUMO' && !isPkg).map(t => ({ ...t, isPacote: false, isNormal: false, driverId: 0 })),
    ...modelTabs,        // nativos + personalizados na ordem global
    ...(hasPacotes ? [PACOTES_CONTAINER_TAB] : []),  // Pacotes sempre por ultimo
  ];

  const isPacoteReadonly = (driverName: string) => {
    const pd = pacoteDrivers.find((d: any) => d.NOME === driverName);
    if (!pd) return false;
    return pd.GESTOR_ID !== gestorId;
  };

  const getDriverFormulas = (driverName: string) => {
    const driver = normalDrivers.find((d: any) => d.NOME === driverName);
    if (!driver) return [];
    return allFormulas.filter((f: any) => f.DRIVER_ID === driver.ID);
  };

  // A aritmetica e a sanitizacao moram em lib/formula-core (JS puro), porque os
  // scripts de auditoria em backend/ importam o MESMO arquivo. Aqui fica so a
  // resolucao dos tokens, que depende dos blocos ja carregados na tela.
  const evaluateFormula = (formula: string, mes: number, configs: any[], currentBudget: Map<string, number>, customBudget?: Map<string, number>): number => {
    const resolverConta = (codigo: string): number => {
      const refConta = configs.find((c: any) => c.CODIGO === codigo);
      if (!refConta) return 0;
      return currentBudget.get(`${refConta.CONTA_ID}_${mes}`) ?? getBudgetValue(refConta.CONTA_ID, mes);
    };
    const resolverLinha = (lineName: string): number | undefined => {
      const val = customBudget?.get(`${lineName}_${mes}`);
      if (val !== undefined) return val;
      // [Lx] de linha VINCULADA a conta contabil: sinonimo garantido do
      // {codigo da conta} — resolve pelo mesmo caminho. O codigo e unico por
      // modelo; o match exige a conta presente nas configs deste driver para
      // nao vazar colisao de codigo entre modelos.
      const linha = allFormulas.find((f: any) =>
        String(f.CODIGO || '') === lineName && f.CONTA_ID &&
        configs.some((c: any) => Number(c.CONTA_ID) === Number(f.CONTA_ID) &&
          (c.DRIVER_ID == null || Number(c.DRIVER_ID) === Number(f.DRIVER_ID))));
      if (!linha) return undefined;
      return currentBudget.get(`${linha.CONTA_ID}_${mes}`) ?? getBudgetValue(Number(linha.CONTA_ID), mes);
    };
    return avaliarFormula(formula, resolverConta, resolverLinha);
  };

  // O que o pacote rateou para ESTE CR e orcamento dele: entra no resultado do
  // setor como qualquer outra conta. So conta depois que o gestor do pacote
  // SUBMETE — antes disso o numero ainda muda, e o CR nem ve os valores. Mesmo
  // gate do DRE server-side (SF 86/88/90 e 127/128), que ja somava as duas fontes.
  //
  // Fica separado de budgetData de proposito: budgetData e o espelho da tabela
  // ORCAMENTO e e por ele que o save decide entre INSERT e UPDATE (achando a linha
  // e usando o ID dela). Misturar as duas fontes ali faria um save gravar em
  // ORCAMENTO com o ID de uma linha de ORCAMENTO_PACOTE.
  const pkgOrcadoDoCr = useMemo(() => {
    const m = new Map<string, number>();
    if (isPkg) return m;
    for (const b of pkgBudgetCrRows) {
      const status = pacoteStatusesByDriver[Number(b.DRIVER_ID)]?.STATUS;
      if (status !== 'SUBMETIDO' && status !== 'APROVADO') continue;
      const k = `${b.CONTA_ID}_${b.MES}`;
      m.set(k, (m.get(k) || 0) + (Number(b.VALOR) || 0));
    }
    return m;
  }, [isPkg, pkgBudgetCrRows, pacoteStatusesByDriver]);

  const pkgOrcadoNoMes = (contaId: number, mes: number) =>
    Math.round(pkgOrcadoDoCr.get(`${contaId}_${mes}`) || 0);

  const pkgOrcadoNoAno = (contaId: number) => {
    let s = 0;
    for (let mes = 1; mes <= 12; mes++) s += pkgOrcadoNoMes(contaId, mes);
    return s;
  };

  const getBudgetValue = (contaId: number, mes: number, crId?: number) => {
    // Em modo pacote, ORCAMENTO_PACOTE tem N linhas por (conta, mes) — uma por CR.
    // Com crId: valor daquele CR especifico (linha do grid CR a CR).
    // Sem crId: soma dos CRs que aplicam ao MODELO ATIVO (totais, resumo, charts) —
    // uma conta com excecao Receita em CR007 fica em duas abas, e cada aba deve
    // somar APENAS o orcamento das proprias CRs (sem misturar entre modelos).
    if (isPkg) {
      if (crId != null) {
        const e = budgetData.find((b: any) =>
          b.CONTA_ID === contaId && b.MES === mes && Number(b.CR_ID) === Number(crId));
        return e ? Math.round(Number(e.VALOR)) : 0;
      }
      const allowedCrIds = new Set<number>();
      for (const r of pkgConfigsRaw) {
        if (r.CONTA_ID === contaId && r.DRIVER_TIPO === activeTab) {
          allowedCrIds.add(Number(r.CR_ID));
        }
      }
      const matches = budgetData.filter((b: any) =>
        b.CONTA_ID === contaId && b.MES === mes && allowedCrIds.has(Number(b.CR_ID))
      );
      return matches.reduce((s: number, b: any) => s + Math.round(Number(b.VALOR) || 0), 0);
    }
    const e = budgetData.find((b: any) => b.CONTA_ID === contaId && b.MES === mes);
    return (e ? Math.round(Number(e.VALOR)) : 0) + pkgOrcadoNoMes(contaId, mes);
  };

  // Aba "Pacotes" dentro do CR: valor lancado pelo gestor do pacote para ESTE CR
  // (linhas de ORCAMENTO_PACOTE do bloco PKG_BUDGET da SF 125).
  const getPacoteBudgetValue = (driverId: number, contaId: number, mes: number) => {
    let s = 0;
    for (const b of pkgBudgetCrRows) {
      if (Number(b.DRIVER_ID) === driverId && b.CONTA_ID === contaId && b.MES === mes) s += Number(b.VALOR) || 0;
    }
    return Math.round(s);
  };

  // ──────────────────────────────────────────────────────────────────────
  // Suporte a formulas nos modelos padrao (BASE_HISTORICO / RECEITA / PESSOAL):
  // se a conta foi marcada TIPO=FORMULA em /modelagem, o valor do orcamento
  // vem do evaluateFormula em vez da logica especializada do bloco.
  // ──────────────────────────────────────────────────────────────────────
  // Uma formula so e valida se compila. Formula incompleta/errada (ex: "2222 *")
  // NAO deve transformar a conta em "conta calculada" e some-la da tabela — nesse
  // caso a conta cai de volta como input normal e volta a aparecer no lancamento.
  const isFormulaValid = (formula: string): boolean => formulaValida(formula);

  const getFormulaOverrideForDriver = (driverName: string): Map<number, { formula: string; formulaId: number; isOverride: boolean }> => {
    const driver = normalDrivers.find((d: any) => d.NOME === driverName);
    if (!driver) return new Map();
    const m = new Map<number, any>();
    allFormulas.forEach((f: any) => {
      if (f.DRIVER_ID !== driver.ID || !f.CONTA_ID) return;
      const resolved = resolveFormula(f);
      if (resolved.tipo === 'FORMULA' && (resolved.formula || '').trim() && isFormulaValid(resolved.formula)) {
        m.set(f.CONTA_ID, { formula: resolved.formula, formulaId: f.ID, isOverride: resolved.isOverride });
      }
    });
    return m;
  };

  const buildGlobalBudgetMap = (): Map<string, number> => {
    const m = new Map<string, number>();
    driverConfigs.forEach((dc: any) => {
      for (let mes = 1; mes <= 12; mes++) {
        m.set(`${dc.CONTA_ID}_${mes}`, getBudgetValue(dc.CONTA_ID, mes));
      }
    });
    return m;
  };

  const buildCustomBudgetMap = (driverName: string, globalBudget: Map<string, number>): Map<string, number> => {
    const driver = normalDrivers.find((d: any) => d.NOME === driverName);
    if (!driver) return new Map();
    const m = new Map<string, number>();
    const customLines = allFormulas.filter((f: any) => f.DRIVER_ID === driver.ID && !f.CONTA_ID);
    // Cada linha e referenciavel pelo CODIGO estavel ([L2]) e, por compatibilidade
    // com formulas antigas, tambem pelo NOME_CUSTOM ([qtd])
    const setKeys = (cl: any, mes: number, val: number) => {
      if (cl.NOME_CUSTOM) m.set(`${cl.NOME_CUSTOM}_${mes}`, val);
      if (cl.CODIGO) m.set(`${cl.CODIGO}_${mes}`, val);
    };
    // Inputs primeiro
    customLines.forEach((cl: any) => {
      if (!cl.NOME_CUSTOM && !cl.CODIGO) return;
      const tipo = tipoLinha(cl);
      if (tipo === 'INPUT') {
        for (let mes = 1; mes <= 12; mes++) setKeys(cl, mes, getCustomLineValue(cl.ID, mes));
      } else if (tipo === 'PREMISSA') {
        // Premissa e folha, igual ao input: nao depende de nada, entao resolve
        // antes das formulas que a citam.
        for (let mes = 1; mes <= 12; mes++) setKeys(cl, mes, valorPremissa(premissasMap, cl.PREMISSA_NOME, mes));
      }
    });
    // Depois formulas custom (podem referenciar inputs, premissas e contas)
    customLines.filter((cl: any) => tipoLinha(cl) === 'FORMULA').forEach((cl: any) => {
      if (!cl.NOME_CUSTOM && !cl.CODIGO) return;
      for (let mes = 1; mes <= 12; mes++) {
        const val = evaluateFormula(cl.FORMULA || '', mes, driverConfigs, globalBudget, m);
        setKeys(cl, mes, val);
      }
    });
    return m;
  };

  // Retorna o valor "efetivo" da conta: se ela tem formula no driver, calcula;
  // senao, retorna o valor salvo em ORCAMENTO.
  const getEffectiveBudgetValue = (
    contaId: number,
    mes: number,
    formulaMap: Map<number, { formula: string }>,
    globalBudget: Map<string, number>,
    customBudget: Map<string, number>
  ): number => {
    const f = formulaMap.get(contaId);
    if (!f) return getBudgetValue(contaId, mes);
    return Math.round(evaluateFormula(f.formula, mes, driverConfigs, globalBudget, customBudget));
  };

  // Pkg-mode helpers: agrega valores apenas dos CRs que aplicam ao modelo ativo
  // (mesma logica de getBudgetValue) — evita contar realizado de CRs de outros modelos.
  const pkgAllowedCrsFor = (contaId: number): Set<number> => {
    const s = new Set<number>();
    for (const r of pkgConfigsRaw) {
      if (r.CONTA_ID === contaId && r.DRIVER_TIPO === activeTab) s.add(Number(r.CR_ID));
    }
    return s;
  };

  const getRealizadoValue = (contaId: number, mes: number, crId?: number) => {
    if (isPkg) {
      // Com crId: realizado daquele CR (linha do grid CR a CR). Sem crId: soma do modelo.
      const allowed = crId != null ? new Set([Number(crId)]) : pkgAllowedCrsFor(contaId);
      const matches = realizadoData.filter((r: any) =>
        r.CONTA_ID === contaId && r.MES === mes && allowed.has(Number(r.CR_ID))
      );
      return matches.reduce((s: number, r: any) => s + Math.round(Number(r.VALOR) || 0), 0);
    }
    const e = realizadoData.find((r: any) => r.CONTA_ID === contaId && r.MES === mes);
    return e ? Math.round(Number(e.VALOR)) : 0;
  };

  const getRealizadoAtualValue = (contaId: number, mes: number, crId?: number) => {
    if (isPkg) {
      const allowed = crId != null ? new Set([Number(crId)]) : pkgAllowedCrsFor(contaId);
      const matches = realizadoAnoAtual.filter((r: any) =>
        r.CONTA_ID === contaId && r.MES === mes && allowed.has(Number(r.CR_ID))
      );
      return matches.reduce((s: number, r: any) => s + Math.round(Number(r.VALOR) || 0), 0);
    }
    const e = realizadoAnoAtual.find((r: any) => r.CONTA_ID === contaId && r.MES === mes);
    return e ? Math.round(Number(e.VALOR)) : 0;
  };

  const getCustomLineValue = (formulaId: number, mes: number) => {
    const e = customLineValues.find((v: any) => v.FORMULA_ID === formulaId && v.MES === mes);
    return e ? Number(e.VALOR) : 0;
  };

  const saveCustomLineCell = async (formulaId: number, mes: number, valor: number) => {
    desconfirmarPorEdicao(activeTab);
    if (isPublic && selectedCR) {
      // Persistencia em lote (debounce) via SF publica — estado local imediato
      const existing = customLineValues.find((v: any) => v.FORMULA_ID === formulaId && v.MES === mes);
      if (existing) existing.VALOR = valor;
      else customLineValues.push({ FORMULA_ID: formulaId, CICLO_ID: selectedCiclo, CR_ID: selectedCR, MES: mes, VALOR: valor });
      setCustomLineValues([...customLineValues]);
      setDataVersion(v => v + 1);
      queuePublicFormulaCell(selectedCR, { formulaId, mes, valor });
      return;
    }
    // Serializa por celula (mesmo padrao do saveBudgetCell): encadeia este save
    // APOS o anterior, garantindo que uma segunda edicao ache o ID recem-criado
    // (evita criar linha duplicada ou dar PATCH com ID indefinido).
    const lockKey = `fml_${formulaId}_${mes}`;
    const prev = saveLocks.current.get(lockKey);
    const myPromise = (async () => {
      if (prev) { try { await prev; } catch { /* ignora erro anterior */ } }
      await doSaveCustomLineCell(formulaId, mes, valor);
    })();
    saveLocks.current.set(lockKey, myPromise);
    try { await myPromise; } finally {
      if (saveLocks.current.get(lockKey) === myPromise) saveLocks.current.delete(lockKey);
    }
  };

  const doSaveCustomLineCell = async (formulaId: number, mes: number, valor: number) => {
    const existing = customLineValues.find((v: any) => v.FORMULA_ID === formulaId && v.MES === mes);
    try {
      // Upsert via SF SQL (SF 197) — o preenchimento interno pode ser aberto por
      // usuario business (gestor), e CRUD REST direto retorna 403. A SF faz o
      // upsert real pela chave natural (FORMULA_ID,CICLO_ID,CR_ID,MES), entao nao
      // precisamos rastrear o ID nem arriscar linha duplicada.
      await execSF(SF_IDS.upsertFormulaValor, {
        formulaId, cicloId: selectedCiclo, crId: selectedCR, mes, valor,
      });
      if (existing) existing.VALOR = valor;
      else customLineValues.push({ FORMULA_ID: formulaId, CICLO_ID: selectedCiclo, CR_ID: selectedCR, MES: mes, VALOR: valor });
      setCustomLineValues([...customLineValues]);
      setDataVersion(v => v + 1);
    } catch (e: any) {
      console.error('Save custom line error:', e);
      const msg = e?.message || e?.error || e?.result?.error || '';
      addToast('error', `Erro ao salvar linha personalizada${msg ? ': ' + String(msg).slice(0, 160) : ''}`);
    }
  };

  const getOverride = (formulaId: number) =>
    formulaOverrides.find((o: any) => o.FORMULA_ID === formulaId);

  const resolveFormula = (formula: any) => {
    const ovr = getOverride(formula.ID);
    if (ovr) return { formula: ovr.FORMULA, tipo: ovr.TIPO || formula.TIPO || 'FORMULA', isOverride: true, overrideId: ovr.ID };
    return { formula: formula.FORMULA, tipo: formula.TIPO || 'FORMULA', isOverride: false, overrideId: null };
  };

  const isOrphanCustomLine = (customLine: any, accountFormulas: any[], configs: any[]) => {
    // A linha pode ser referenciada por [CODIGO] (padrao atual) ou [nome] (legado)
    const refs = [customLine.CODIGO, customLine.NOME_CUSTOM]
      .filter(Boolean)
      .map((r: string) => `[${String(r).toLowerCase()}]`);
    if (refs.length === 0) return false;
    const hasRef = (formula: string) => {
      const formulaLower = (formula || '').toLowerCase();
      return refs.some((r) => formulaLower.includes(r));
    };
    const mappedContaIds = new Set(configs.map((c: any) => c.CONTA_ID));

    const referencingAccountFormulas = accountFormulas.filter((f: any) => hasRef(resolveFormula(f).formula));

    if (referencingAccountFormulas.length === 0) {
      const referencedByOtherCustom = allFormulas
        .filter((f: any) => !f.CONTA_ID && f.ID !== customLine.ID && f.DRIVER_ID === customLine.DRIVER_ID)
        .some((f: any) => hasRef(resolveFormula(f).formula));
      if (referencedByOtherCustom) return false;
      return false;
    }

    const anyMapped = referencingAccountFormulas.some((f: any) => mappedContaIds.has(f.CONTA_ID));
    return !anyMapped;
  };

  const ultimoMesRealizado = cicloAtivo?.ULTIMO_MES_REALIZADO ? Number(cicloAtivo.ULTIMO_MES_REALIZADO) : 0;
  const lockedCalendarMonths = new Set<number>();
  if (ultimoMesRealizado > 0) {
    for (let m = 1; m <= ultimoMesRealizado; m++) lockedCalendarMonths.add(m);
  }
  const isColLocked = (col: number) => {
    if (col < 1 || col > 12) return false;
    const calMonth = fiscalMonthNumbers[col - 1];
    return lockedCalendarMonths.has(calMonth);
  };

  // Lock por (CONTA_ID, MES) — serializa chamadas concorrentes de saveBudgetCell
  // pra evitar race condition que duplicava rows em drag-fill (afterChange chamava
  // saveBudgetCell em paralelo, todas faziam find()=undefined, todas criavam row).
  const saveLocks = useRef(new Map<string, Promise<void>>());

  // EDITAR DESFAZ A CONFIRMACAO
  //
  // Conta calculada so vira numero em ORCAMENTO no confirmar (ver a nota
  // MATERIALIZACAO). Isso abria um buraco: confirmar, depois editar uma celula e
  // nao reconfirmar deixava a grade mostrando um numero e o DRE somando outro,
  // sem nada na tela denunciar. Foi assim que o imposto do CR008 ficou zerado no
  // DRE enquanto a grade ja mostrava o valor certo.
  //
  // A saida NAO foi gravar o calculado a cada tecla: isso e uma chamada por
  // celula digitada, e o numero de linhas de formula de um modelo real nao tem
  // teto. Em vez disso, editar devolve o modelo para "nao confirmado". O CR sai
  // dos 100% e o workflow trava a submissao ate alguem confirmar de novo — e
  // confirmar materializa.
  //
  // A garantia que isso da: CR em SUBMETIDO ou APROVADO tem DRE igual a grade
  // POR CONSTRUCAO, porque o unico caminho para esses estados passa pelo
  // confirmar. Sobra defasagem so em CR PENDENTE com edicao em andamento — onde
  // quem ve a diferenca e a propria pessoa que esta digitando.
  //
  // Vale para qualquer origem de escrita (tecla, drag-fill, projecao em massa),
  // porque o gancho fica nos dois pontos de gravacao de celula e nao em cada
  // grade. A unica escrita que NAO desconfirma e a da propria materializacao.
  // UMA desconfirmacao por rajada de escrita
  //
  // Uma projecao historica grava um mes por vez: doze chamadas de saveBudgetCell
  // em sequencia, todas no mesmo tick de React. Como o aviso e o efeito colateral
  // de UMA transicao (confirmado -> pendente), ele tem de sair uma vez, nao doze —
  // doze toasts iguais empilhados escondem a tela em vez de informar.
  //
  // A trava que garante isso e o confirmedDriversRef: ele sai do conjunto na hora,
  // sem esperar re-render, entao da segunda celula em diante o guard abaixo ja
  // devolve cedo. O mesmo vale para drag-fill e para digitacao rapida.
  const desconfirmarPorEdicao = (driver: string) => {
    if (!driver || readOnly) return;
    if (materializandoRef.current) return;
    if (!confirmedDriversRef.current.has(driver)) return;
    // Retirada otimista e SINCRONA: e ela que torna a chamada idempotente dentro
    // da rajada. Se a gravacao falhar, unconfirmDriver devolve o driver ao ref.
    const otimista = new Set(confirmedDriversRef.current);
    otimista.delete(driver);
    confirmedDriversRef.current = otimista;
    void unconfirmDriver(driver, { porEdicao: true, jaRetiradoDoRef: true });
  };

  const saveBudgetCell = async (contaId: number, mes: number, valor: number, qty?: number, unitPrice?: number, crId?: number) => {
    desconfirmarPorEdicao(activeTab);
    const lockKey = `${contaId}_${mes}_${crId ?? ''}`;
    const prev = saveLocks.current.get(lockKey);
    // Encadeia este save APOS o anterior (se houver) — serializa por celula
    const myPromise = (async () => {
      if (prev) { try { await prev; } catch { /* ignora erro anterior */ } }
      await doSaveBudgetCell(contaId, mes, valor, qty, unitPrice, crId);
    })();
    saveLocks.current.set(lockKey, myPromise);
    try {
      await myPromise;
    } finally {
      // Limpa se essa eh ainda a ultima da fila pra essa celula
      if (saveLocks.current.get(lockKey) === myPromise) saveLocks.current.delete(lockKey);
    }
  };

  const doSaveBudgetCell = async (contaId: number, mes: number, valor: number, qty?: number, unitPrice?: number, crId?: number) => {
    // Modo publico: celula vai pra fila com debounce (1 chamada por rajada de
    // edicao) — o estado local ja reflete o grid. Pacote grava CR a CR em
    // ORCAMENTO_PACOTE via op pkgCells (token-escopada na SF 147).
    if (isPublic) {
      if (isPkg && selectedPackage) {
        let targets: Array<{ CR_ID: number; VALOR: number }> = [];
        if (crId != null) {
          targets = [{ CR_ID: Number(crId), VALOR: valor }];
        } else {
          const crIdSet = new Set<number>();
          for (const c of pkgConfigsRaw) {
            if (c.CONTA_ID === contaId && c.DRIVER_TIPO === activeTab) crIdSet.add(Number(c.CR_ID));
          }
          const crIds = Array.from(crIdSet);
          if (crIds.length === 0) return;
          targets = crIds.map(id => ({ CR_ID: id, VALOR: Math.round(valor / crIds.length) }));
        }
        for (const t of targets) {
          const existing = budgetData.find((b: any) =>
            b.CONTA_ID === contaId && b.MES === mes && Number(b.CR_ID) === t.CR_ID);
          if (existing) existing.VALOR = t.VALOR;
          else budgetData.push({ CICLO_ID: selectedCiclo, DRIVER_ID: selectedPackage.ID, CR_ID: t.CR_ID, CONTA_ID: contaId, MES: mes, VALOR: t.VALOR });
          queuePublicPkgCell(selectedPackage.ID, { contaId, mes, valor: t.VALOR, crId: t.CR_ID });
        }
        setBudgetData([...budgetData]);
        setDataVersion(v => v + 1);
        return;
      }
      if (!selectedCR) return;
      const existing = budgetData.find((b: any) => b.CONTA_ID === contaId && b.MES === mes);
      const qtd = qty !== undefined ? qty : Number(existing?.QUANTIDADE) || 0;
      const vu = unitPrice !== undefined ? unitPrice : Number(existing?.VALOR_UNITARIO) || 0;
      if (existing) {
        existing.VALOR = valor;
        existing.QUANTIDADE = qtd;
        existing.VALOR_UNITARIO = vu;
      } else {
        budgetData.push({ CICLO_ID: selectedCiclo, CR_ID: selectedCR, CONTA_ID: contaId, MES: mes, VALOR: valor, QUANTIDADE: qtd, VALOR_UNITARIO: vu });
      }
      setBudgetData([...budgetData]);
      setDataVersion(v => v + 1);
      queuePublicOrcCell(selectedCR, { contaId, mes, valor, qtd, vu });
      return;
    }
    try {
      // Modo pacote: preenchimento CR a CR — o valor digitado pertence ao CR da
      // linha do grid, gravado direto em ORCAMENTO_PACOTE (sem rateio).
      if (isPkg && selectedPackage) {
        // CRs alvo: o CR da linha editada; sem crId (escritas agregadas legadas,
        // ex: formula), divide igual entre os CRs do (conta, modelo atual).
        let targets: Array<{ CR_ID: number; VALOR: number }> = [];
        if (crId != null) {
          targets = [{ CR_ID: Number(crId), VALOR: valor }];
        } else {
          const crIdSet = new Set<number>();
          for (const c of pkgConfigsRaw) {
            if (c.CONTA_ID === contaId && c.DRIVER_TIPO === activeTab) crIdSet.add(Number(c.CR_ID));
          }
          const crIds = Array.from(crIdSet);
          if (crIds.length === 0) return;
          targets = crIds.map(id => ({ CR_ID: id, VALOR: Math.round(valor / crIds.length) }));
        }
        // IMPORTANTE: mutamos budgetData IN-PLACE (mesma estrategia do CR mode) pra que
        // chamadas sequenciais (ex: drag-fill afterChange itera N cells) vejam as
        // mutacoes umas das outras. Copiar primeiro com [...budgetData] fazia cada
        // setBudgetData sobrescrever o anterior — so o ultimo cell aparecia salvo.
        for (const t of targets) {
          const existing = budgetData.find((b: any) =>
            b.CONTA_ID === contaId && b.MES === mes && Number(b.CR_ID) === t.CR_ID
          );
          if (existing) {
            await patchRecordMitra({
              projectId: pid, tableName: 'ORCAMENTO_PACOTE',
              id: existing.ID, data: { VALOR: t.VALOR },
            });
            existing.VALOR = t.VALOR;
          } else {
            const newRec: any = {
              CICLO_ID: selectedCiclo,
              DRIVER_ID: selectedPackage.ID,
              CR_ID: t.CR_ID,
              CONTA_ID: contaId,
              MES: mes,
              VALOR: t.VALOR,
            };
            const res = await createRecordMitra({ projectId: pid, tableName: 'ORCAMENTO_PACOTE', data: newRec });
            budgetData.push({ ...newRec, ID: (res as any).ID || (res as any).id });
          }
        }
        setBudgetData([...budgetData]);
        setDataVersion(v => v + 1);
        return;
      }

      // Modo CR (original): 1 linha ORCAMENTO por (CR, CONTA, MES)
      const existing = budgetData.find((b: any) => b.CONTA_ID === contaId && b.MES === mes);
      if (existing) {
        const patchData: any = { VALOR: valor };
        if (qty !== undefined) patchData.QUANTIDADE = qty;
        if (unitPrice !== undefined) patchData.VALOR_UNITARIO = unitPrice;
        await patchRecordMitra({ projectId: pid, tableName: 'ORCAMENTO', id: existing.ID, data: patchData });
        Object.assign(existing, patchData);
      } else {
        const newRec: any = { CICLO_ID: selectedCiclo, CR_ID: selectedCR, CONTA_ID: contaId, MES: mes, VALOR: valor, QUANTIDADE: qty || 0, VALOR_UNITARIO: unitPrice || 0 };
        const res = await createRecordMitra({ projectId: pid, tableName: 'ORCAMENTO', data: newRec });
        budgetData.push({ ...newRec, ID: (res as any).ID || (res as any).id });
      }
      setBudgetData([...budgetData]);
      setDataVersion(v => v + 1);
    } catch (e) {
      console.error('Save error:', e);
      addToast('error', 'Erro ao salvar');
    }
  };

  // ══════════════════════════════════════════════════════════════════════
  // MODELO DE PACOTE (DRIVERS.ESCOPO='PACOTE') — preenchimento dirigido pelas
  // linhas do modelo (DRIVER_FORMULA.GRANULARIDADE / RATEIO_ID):
  //   · linha granular por CR  -> uma linha do grid por CR (input direto no CR)
  //   · linha sem granularidade -> valor unico; se tem conta contabil, o total e
  //     distribuido entre os CRs pelo rateio aplicado (renormalizado nos CRs onde
  //     a conta esta na matriz) e persistido em ORCAMENTO_PACOTE (o DRE le de la)
  // ══════════════════════════════════════════════════════════════════════
  const pkgId = selectedPackage?.ID || 0;

  // Valor de linha de modelo de pacote: DRIVER_FORMULA_VALOR com PACOTE_ID
  // (crId 0 = valor unico da linha; crId real = linha granular por CR)
  const getClvPkgValue = (formulaId: number, mes: number, crId: number) => {
    const e = customLineValues.find((v: any) =>
      v.FORMULA_ID === formulaId && v.MES === mes &&
      Number(v.PACOTE_ID || 0) === pkgId && Number(v.CR_ID || 0) === crId);
    return e ? Number(e.VALOR) : 0;
  };

  const savePkgLineCell = async (formulaId: number, mes: number, valor: number, crId: number) => {
    const lockKey = `pkgfml_${formulaId}_${mes}_${crId}`;
    const prev = saveLocks.current.get(lockKey);
    const myPromise = (async () => {
      if (prev) { try { await prev; } catch { /* ignora erro anterior */ } }
      try {
        // Modo publico: fila com debounce -> op pkgLineCells (token-escopada);
        // interno: upsert direto via SF 200.
        if (isPublic) queuePublicPkgLineCell(pkgId, { formulaId, mes, valor, crId });
        else await execSF(SF_IDS.upsertFormulaValorPkg, { formulaId, cicloId: selectedCiclo, pacoteId: pkgId, crId, mes, valor });
        const existing = customLineValues.find((v: any) =>
          v.FORMULA_ID === formulaId && v.MES === mes && Number(v.PACOTE_ID || 0) === pkgId && Number(v.CR_ID || 0) === crId);
        if (existing) existing.VALOR = valor;
        else customLineValues.push({ FORMULA_ID: formulaId, CICLO_ID: selectedCiclo, PACOTE_ID: pkgId, CR_ID: crId, MES: mes, VALOR: valor });
        setCustomLineValues([...customLineValues]);
        setDataVersion(v => v + 1);
      } catch (e: any) {
        console.error('Save pkg line error:', e);
        addToast('error', 'Erro ao salvar linha do modelo de pacote');
      }
    })();
    saveLocks.current.set(lockKey, myPromise);
    try { await myPromise; } finally {
      if (saveLocks.current.get(lockKey) === myPromise) saveLocks.current.delete(lockKey);
    }
  };

  // Share de cada CR num rateio, restrito aos CRs validos da conta — CR fora da
  // matriz (ou com quantidade 0) e pulado e os percentuais renormalizam.
  const rateioSharesFor = (rateioId: number, validCrIds: Set<number>): Map<number, number> => {
    const itens = rateioItensPkg.filter((it: any) =>
      Number(it.RATEIO_ID) === rateioId && validCrIds.has(Number(it.CR_ID)) && Number(it.QUANTIDADE) > 0);
    const tot = itens.reduce((s: number, it: any) => s + Number(it.QUANTIDADE), 0);
    if (tot <= 0) return new Map();
    return new Map(itens.map((it: any) => [Number(it.CR_ID), Number(it.QUANTIDADE) / tot]));
  };

  // Distribui um total pelos shares com ajuste de arredondamento no ultimo CR —
  // a soma das parcelas fecha exatamente no total digitado.
  const distributeTotal = (total: number, shares: Map<number, number>): Map<number, number> => {
    const out = new Map<number, number>();
    const entries = Array.from(shares.entries());
    let used = 0;
    entries.forEach(([cr, sh], i) => {
      const v = i === entries.length - 1 ? Math.round(total) - used : Math.round(total * sh);
      if (i < entries.length - 1) used += v;
      out.set(cr, v);
    });
    return out;
  };

  const rateioNomeById = (id: number | null) => {
    if (id == null) return '';
    const r = rateiosPkg.find((x: any) => Number(x.ID) === id);
    return r ? toTitleCase(String(r.NOME || '').replace(/_/g, ' ')) : `Rateio #${id}`;
  };

  // Estado derivado completo de um modelo de pacote: itens do grid (linhas
  // expandidas por CR quando granulares), mapas de valores por CR e por total, e
  // avaliacao das formulas no escopo certo (linha granular calcula CR a CR; linha
  // de total calcula sobre os totais). Usado no render E na materializacao.
  const computePkgModel = (driverName: string) => {
    const driverObj = normalDrivers.find((d: any) => d.NOME === driverName);
    if (!isPkg || !driverObj || driverObj.ESCOPO !== 'PACOTE') return null;
    const configs = driverConfigs.filter((dc: any) => dc.DRIVER_TIPO === driverName); // pares conta × CR
    const linhas = allFormulas
      .filter((f: any) => f.DRIVER_ID === driverObj.ID)
      .sort((a: any, b: any) => ((a.ORDEM ?? 9999) - (b.ORDEM ?? 9999)) || (Number(a.ID) - Number(b.ID)));

    const pairsByConta = new Map<number, Array<{ crId: number; code: string }>>();
    const crMap = new Map<number, string>();
    configs.forEach((dc: any) => {
      const crId = Number(dc.CR_ID);
      const arr = pairsByConta.get(dc.CONTA_ID) || [];
      arr.push({ crId, code: dc.CR_CODIGO || `CR${crId}` });
      pairsByConta.set(dc.CONTA_ID, arr);
      if (!crMap.has(crId)) crMap.set(crId, dc.CR_CODIGO || `CR${crId}`);
    });
    pairsByConta.forEach(arr => arr.sort((a, b) => a.code.localeCompare(b.code)));
    const crList = Array.from(crMap.entries()).map(([id, code]) => ({ id, code })).sort((a, b) => a.code.localeCompare(b.code));

    // Mapas de valores armazenados: contas por CR + total do modelo
    const bmByCr = new Map<number, Map<string, number>>();
    crList.forEach(cr => {
      const m = new Map<string, number>();
      configs.forEach((dc: any) => {
        if (Number(dc.CR_ID) !== cr.id) return;
        for (let i = 0; i < 12; i++) {
          const mes = fiscalMonthNumbers[i];
          m.set(`${dc.CONTA_ID}_${mes}`, getBudgetValue(dc.CONTA_ID, mes, cr.id));
        }
      });
      bmByCr.set(cr.id, m);
    });
    const bmTotal = new Map<string, number>();
    pairsByConta.forEach((pares, contaId) => {
      for (let i = 0; i < 12; i++) {
        const mes = fiscalMonthNumbers[i];
        bmTotal.set(`${contaId}_${mes}`, pares.reduce((s, p) => s + (bmByCr.get(p.crId)?.get(`${contaId}_${mes}`) || 0), 0));
      }
    });
    const custByCr = new Map<number, Map<string, number>>();
    crList.forEach(cr => custByCr.set(cr.id, new Map()));
    const custTotal = new Map<string, number>();
    const setCust = (map: Map<string, number>, l: any, mes: number, v: number) => {
      if (l.NOME_CUSTOM) map.set(`${l.NOME_CUSTOM}_${mes}`, v);
      if (l.CODIGO) map.set(`${l.CODIGO}_${mes}`, v);
    };

    const items: any[] = [];
    const semRateio: string[] = [];
    const rateioParcial: Array<{ nome: string; rateioNome: string; faltam: string[]; recebem: string[] }> = [];
    for (const l of linhas) {
      const r = resolveFormula(l);
      const isInput = (r.tipo || 'INPUT') === 'INPUT';
      const granular = l.GRANULARIDADE === 'CR';
      const rateioId = l.RATEIO_ID != null ? Number(l.RATEIO_ID) : null;
      const validFormula = !isInput && isFormulaValid(r.formula);
      if (l.CONTA_ID) {
        const contaId = Number(l.CONTA_ID);
        const pares = pairsByConta.get(contaId);
        if (!pares || pares.length === 0) continue; // conta do modelo nao mapeada a este pacote
        const cfg = configs.find((dc: any) => dc.CONTA_ID === contaId);
        const nomeLinha = l.NOME_CUSTOM || l.LABEL || cfg?.CONTA_NOME || '';
        const base = {
          type: 'account' as const, contaId, codigo: cfg?.CODIGO || '', nome: nomeLinha,
          hasFormula: validFormula, formulaId: l.ID, granular, rateioId, formula: r.formula || '',
          // Formato escolhido na coluna "Formato" do mapeamento. Vem cru do banco
          // e so decide como o numero e exibido na grade de preenchimento.
          formato: l.FORMATO || 'SEM_PREFIXO',
        };
        const validCrs = new Set(pares.map(p => p.crId));
        if (validFormula) {
          if (granular) {
            // formula granular: avalia dentro de cada CR e o total vira a soma
            for (const p of pares) {
              const bm = bmByCr.get(p.crId)!;
              for (let i = 0; i < 12; i++) {
                const mes = fiscalMonthNumbers[i];
                bm.set(`${contaId}_${mes}`, evaluateFormula(r.formula, mes, configs, bm, custByCr.get(p.crId)));
              }
            }
            for (let i = 0; i < 12; i++) {
              const mes = fiscalMonthNumbers[i];
              bmTotal.set(`${contaId}_${mes}`, pares.reduce((s, p) => s + (bmByCr.get(p.crId)?.get(`${contaId}_${mes}`) || 0), 0));
            }
          } else {
            // formula de total: avalia sobre os totais do modelo
            for (let i = 0; i < 12; i++) {
              const mes = fiscalMonthNumbers[i];
              bmTotal.set(`${contaId}_${mes}`, evaluateFormula(r.formula, mes, configs, bmTotal, custTotal));
            }
          }
        }
        if (granular) {
          pares.forEach(p => items.push({ ...base, crId: p.crId, crSuffix: ` · ${p.code}` }));
        } else {
          const shares = rateioId != null ? rateioSharesFor(rateioId, validCrs) : new Map<number, number>();
          const rateioOk = shares.size > 0;
          if (!rateioOk) semRateio.push(nomeLinha);
          else {
            // Cobertura parcial: CRs da conta sem quantidade no rateio ficam de
            // fora e o total concentra nos demais — alerta para análise do usuário
            const faltam = pares.filter(p => !shares.has(p.crId)).map(p => p.code);
            if (faltam.length > 0) {
              rateioParcial.push({
                nome: nomeLinha,
                rateioNome: rateioNomeById(rateioId),
                faltam,
                recebem: pares.filter(p => shares.has(p.crId)).map(p => p.code),
              });
            }
          }
          items.push({ ...base, aggregated: true, validCrs, shares, rateioOk });
        }
      } else {
        const nomeLinha = l.NOME_CUSTOM || 'Linha personalizada';
        const base = {
          type: 'custom' as const, formulaId: l.ID, codigo: l.CODIGO || null, nome: nomeLinha,
          displayNome: l.LABEL || nomeLinha, isInput, formula: r.formula || '', granular,
          formato: l.FORMATO || 'SEM_PREFIXO',
        };
        if (isInput) {
          if (granular) {
            for (const cr of crList) {
              for (let i = 0; i < 12; i++) {
                const mes = fiscalMonthNumbers[i];
                setCust(custByCr.get(cr.id)!, l, mes, getClvPkgValue(l.ID, mes, cr.id));
              }
            }
            for (let i = 0; i < 12; i++) {
              const mes = fiscalMonthNumbers[i];
              setCust(custTotal, l, mes, crList.reduce((s, cr) => s + getClvPkgValue(l.ID, mes, cr.id), 0));
            }
            crList.forEach(cr => items.push({ ...base, crId: cr.id, crSuffix: ` · ${cr.code}` }));
          } else {
            for (let i = 0; i < 12; i++) {
              const mes = fiscalMonthNumbers[i];
              const v = getClvPkgValue(l.ID, mes, 0);
              setCust(custTotal, l, mes, v);
              // escalar do pacote fica disponivel tambem nas formulas por CR
              crList.forEach(cr => setCust(custByCr.get(cr.id)!, l, mes, v));
            }
            items.push({ ...base, crId: 0 });
          }
        } else if (validFormula) {
          if (granular) {
            const totals = new Array(12).fill(0);
            for (const cr of crList) {
              for (let i = 0; i < 12; i++) {
                const mes = fiscalMonthNumbers[i];
                const v = evaluateFormula(r.formula, mes, configs, bmByCr.get(cr.id)!, custByCr.get(cr.id));
                setCust(custByCr.get(cr.id)!, l, mes, v);
                totals[i] += v;
              }
            }
            for (let i = 0; i < 12; i++) setCust(custTotal, l, fiscalMonthNumbers[i], totals[i]);
            crList.forEach(cr => items.push({ ...base, crId: cr.id, crSuffix: ` · ${cr.code}` }));
          } else {
            for (let i = 0; i < 12; i++) {
              const mes = fiscalMonthNumbers[i];
              const v = evaluateFormula(r.formula, mes, configs, bmTotal, custTotal);
              setCust(custTotal, l, mes, v);
              crList.forEach(cr => setCust(custByCr.get(cr.id)!, l, mes, v));
            }
            items.push({ ...base, crId: 0 });
          }
        } else {
          items.push({ ...base, crId: granular ? undefined : 0 });
        }
      }
    }

    return { driverObj, configs, linhas, items, crList, pairsByConta, bmByCr, bmTotal, custByCr, custTotal, semRateio, rateioParcial };
  };

  // Materializacao: persiste em ORCAMENTO_PACOTE os valores por CR derivados do
  // modelo (formulas e distribuicao por rateio) — e dai que DRE, Resumo e o
  // progresso do pacote leem. Converge: sem drift => sem writes. Tambem cobre o
  // "recalcula no ciclo aberto": rateio editado na aba Tipos de Rateio e
  // redistribuido na proxima abertura/edicao do pacote.
  const materializingRef = useRef(false);
  useEffect(() => {
    // No link publico a materializacao tambem roda: os saves fluem pela fila
    // publica (op pkgCells) — sem ela, formulas e rateios nao persistiriam.
    if (loading || !isPkg || !selectedPackage || readOnly) return;
    if (materializingRef.current) return;
    const state = computePkgModel(activeTab);
    if (!state) return;
    const writes: Array<{ contaId: number; mes: number; valor: number; crId: number }> = [];
    for (const it of state.items) {
      if (it.type !== 'account') continue;
      if (it.granular) {
        if (!it.hasFormula) continue; // input granular: o proprio grid grava no CR
        for (let i = 0; i < 12; i++) {
          const mes = fiscalMonthNumbers[i];
          const expected = Math.round(state.bmByCr.get(it.crId)?.get(`${it.contaId}_${mes}`) || 0);
          if (expected !== getBudgetValue(it.contaId, mes, it.crId)) {
            writes.push({ contaId: it.contaId, mes, valor: expected, crId: it.crId });
          }
        }
      } else {
        if (!it.rateioOk) continue;
        for (let i = 0; i < 12; i++) {
          const mes = fiscalMonthNumbers[i];
          const total = Math.round(state.bmTotal.get(`${it.contaId}_${mes}`) || 0);
          const dist = distributeTotal(total, it.shares);
          for (const crId of it.validCrs as Set<number>) {
            const expected = dist.get(crId) ?? 0;
            if (expected !== getBudgetValue(it.contaId, mes, crId)) {
              writes.push({ contaId: it.contaId, mes, valor: expected, crId });
            }
          }
        }
      }
    }
    if (writes.length === 0) return;
    materializingRef.current = true;
    (async () => {
      try {
        for (const w of writes) await saveBudgetCell(w.contaId, w.mes, w.valor, undefined, undefined, w.crId);
      } finally {
        materializingRef.current = false;
        setDataVersion(v => v + 1); // re-checa: dependencias em cadeia podem ter mudado
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, isPkg, activeTab, selectedCiclo, dataVersion, readOnly]);

  void 0; // saveHeadcountCell removed - using CONTRATACAO_PROJETADA instead

  // Grade de contratacoes (cargo x mes): a celula guarda a soma de QTD_VAGAS do cargo no mes.
  // Gravar = limpar as linhas da celula + inserir 1 linha com a qtd (0 = so limpa).
  const contratJustOf = (cargoId: number) =>
    contratacoes.find(c => Number(c.CARGO_ID) === cargoId && c.JUSTIFICATIVA)?.JUSTIFICATIVA || '';

  const saveContratCell = async (cargoId: number, mes: number, qtdRaw: string | number) => {
    if (!selectedCiclo || !selectedCR) return;
    const qtd = Math.max(0, Math.floor(Number(qtdRaw) || 0));
    const atual = contratacoes
      .filter(c => Number(c.CARGO_ID) === cargoId && Number(c.MES_ENTRADA) === mes)
      .reduce((s, c) => s + (Number(c.QTD_VAGAS) || 0), 0);
    if (qtd === atual) return;
    const justificativa = contratJustOf(cargoId);
    try {
      if (isPublic) {
        await publicOrcWrite('contratSetCell', { crId: selectedCR, cargoId, mes, qtd, justificativa });
      } else {
        const base = { cicloId: selectedCiclo, crId: selectedCR, cargoId, mes };
        await execSF(SF_PESSOAL.limparCelulaContrat, base);
        if (qtd > 0) {
          await execSF(SF_PESSOAL.inserirCelulaContrat, {
            ...base, qtd, justificativa: sqlEscape(justificativa), criadoEm: new Date().toISOString().slice(0, 19),
          });
        }
      }
      const cargo = cargos.find((c: any) => Number(c.ID) === cargoId);
      setContratacoes(prev => {
        const rest = prev.filter(c => !(Number(c.CARGO_ID) === cargoId && Number(c.MES_ENTRADA) === mes));
        if (qtd > 0) rest.push({
          CICLO_ID: selectedCiclo, CR_ID: selectedCR, CARGO_ID: cargoId, MES_ENTRADA: mes, MOTIVO: 'AUMENTO_QUADRO',
          QTD_VAGAS: qtd, JUSTIFICATIVA: justificativa, CARGO_NOME: cargo?.NOME || '', SALARIO_MEDIO: cargo?.SALARIO_MEDIO || 0,
        });
        return rest.sort((a, b) => Number(a.MES_ENTRADA) - Number(b.MES_ENTRADA));
      });
    } catch (e) { console.error(e); addToast('error', 'Erro ao salvar contratação'); }
  };

  const saveContratJustificativa = async (cargoId: number, texto: string) => {
    if (!selectedCiclo || !selectedCR) return;
    const justificativa = texto.trim().slice(0, 500);
    try {
      if (isPublic) await publicOrcWrite('contratJustificativa', { crId: selectedCR, cargoId, justificativa });
      else await execSF(SF_PESSOAL.justificativaContrat, { cicloId: selectedCiclo, crId: selectedCR, cargoId, justificativa: sqlEscape(justificativa) });
      setContratacoes(prev => prev.map(c => Number(c.CARGO_ID) === cargoId ? { ...c, JUSTIFICATIVA: justificativa } : c));
      setContratJustEdit(null);
      addToast('success', 'Justificativa salva');
    } catch (e) { console.error(e); addToast('error', 'Erro ao salvar justificativa'); }
  };

  const saveAumentoInline = async () => {
    if (!selectedCiclo || !aumentoColabId) return;
    try {
      if (isPublic) {
        // Upsert token-escopado + releitura do bloco (traz ID novo pro delete)
        await publicOrcWrite('aumentoUpsert', {
          crId: selectedCR, colaboradorId: aumentoColabId,
          percentual: Number(aumentoForm.PERCENTUAL), mesAplicacao: Number(aumentoForm.MES_APLICACAO),
          motivo: aumentoForm.MOTIVO,
        });
        const row = await fetchDetalheRow();
        if (row) setAumentosSalariais(jsonField(row.AUMENTOS));
      } else {
      const existing = await querySQL(`SELECT ID FROM AUMENTO_SALARIAL WHERE CICLO_ID = ${selectedCiclo} AND COLABORADOR_ID = ${aumentoColabId}`);
      const payload = {
        CICLO_ID: selectedCiclo, COLABORADOR_ID: aumentoColabId,
        PERCENTUAL: Number(aumentoForm.PERCENTUAL), MES_APLICACAO: Number(aumentoForm.MES_APLICACAO),
        MOTIVO: aumentoForm.MOTIVO, CRIADO_EM: new Date().toISOString().slice(0, 19),
      };
      if (existing.length > 0) {
        await patchRecordMitra({ projectId: pid, tableName: 'AUMENTO_SALARIAL', id: existing[0].ID, data: payload });
        setAumentosSalariais(prev => prev.map(a => a.ID === existing[0].ID ? { ...a, ...payload, ID: existing[0].ID } : a));
      } else {
        const created = await createRecordMitra({ projectId: pid, tableName: 'AUMENTO_SALARIAL', data: payload });
        const newId = (created as any)?.id ?? (created as any)?.ID ?? Date.now();
        setAumentosSalariais(prev => [...prev, { ...payload, ID: newId }]);
      }
      }
      setAumentoColabId(null);
      setAumentoForm({ PERCENTUAL: '', MES_APLICACAO: '1', MOTIVO: '' });
      addToast('success', 'Aumento programado salvo');
    } catch (e) { console.error(e); addToast('error', 'Erro ao salvar aumento'); }
  };

  const deleteAumentoInline = async (id: number) => {
    try {
      if (isPublic) await publicOrcWrite('aumentoDelete', { crId: selectedCR, id });
      else await deleteRecordMitra({ projectId: pid, tableName: 'AUMENTO_SALARIAL', id });
      setAumentosSalariais(prev => prev.filter(a => a.ID !== id));
      addToast('success', 'Aumento removido');
    } catch (e) { console.error(e); addToast('error', 'Erro ao remover'); }
  };

  const saveDesligamentoInline = async () => {
    if (!selectedCiclo || !selectedCR || !desligamentoColabId) return;
    const mesDesligamento = Number(desligamentoForm.MES_DESLIGAMENTO);
    try {
      if (isPublic) {
        await publicOrcWrite('desligamentoUpsert', {
          crId: selectedCR,
          colaboradorId: desligamentoColabId,
          mesDesligamento,
        });
      } else {
        await execSF(SF_PESSOAL.salvarDesligamento, {
          cicloId: selectedCiclo,
          crId: selectedCR,
          colaboradorId: desligamentoColabId,
          mesDesligamento,
          criadoEm: new Date().toISOString().slice(0, 19),
        });
      }
      const row = await fetchDetalheRow();
      const next = row
        ? jsonField(row.DESLIGAMENTOS)
        : desligamentosProjetados.filter((item: any) => item.COLABORADOR_ID !== desligamentoColabId);
      if (!row) next.push({ COLABORADOR_ID: desligamentoColabId, MES_DESLIGAMENTO: mesDesligamento });
      setDesligamentosProjetados(next);
      setDesligamentoColabId(null);
      await calculatePayroll(next, `Desligamento projetado para ${MONTHS_LOWER[mesDesligamento - 1]} e folha recalculada`);
    } catch (e) {
      console.error(e);
      addToast('error', 'Erro ao salvar desligamento');
    }
  };

  const deleteDesligamentoInline = async (id: number) => {
    if (!selectedCiclo || !selectedCR) return;
    try {
      if (isPublic) await publicOrcWrite('desligamentoDelete', { crId: selectedCR, id });
      else await execSF(SF_PESSOAL.excluirDesligamento, { id, cicloId: selectedCiclo, crId: selectedCR });
      const row = await fetchDetalheRow();
      const next = row ? jsonField(row.DESLIGAMENTOS) : desligamentosProjetados.filter((item: any) => item.ID !== id);
      setDesligamentosProjetados(next);
      setDesligamentoColabId(null);
      await calculatePayroll(next, 'Desligamento removido e folha recalculada');
    } catch (e) {
      console.error(e);
      addToast('error', 'Erro ao remover desligamento');
    }
  };

  const saveHistPremissa = async (contaId: number, percentual: number, modo: string, justificativa: string) => {
    if (!selectedCiclo || !selectedCR) return;
    try {
      if (isPublic) {
        // Upsert token-escopado (o servidor resolve existente vs novo)
        await publicOrcWrite('histPremissa', { crId: selectedCR, contaId, percentual, modo, justificativa: justificativa || '' });
        return;
      }
      // Upsert atomico (INSERT ... ON DUPLICATE KEY UPDATE sobre a UNIQUE
      // CICLO_ID+CR_ID+CONTA_ID). O SELECT-entao-decide que existia aqui abria
      // janela para dois saves quase simultaneos lerem "nao existe" e ambos
      // inserirem — foi assim que a tabela ganhou linhas duplicadas.
      await execSF(SF_IDS.upsertHistPremissa, {
        cicloId: selectedCiclo,
        crId: selectedCR,
        contaId,
        percentual,
        modo: modo === 'igual' ? 'igual' : 'sazonalidade',
        justificativa: sqlEscape(justificativa || '').slice(0, 500),
        agora: new Date().toISOString().slice(0, 19),
      });
    } catch (e) { console.error('Erro ao salvar premissa histórica:', e); }
  };

  // opts.silencioso: usado pelos botoes que aplicam a projecao em varias contas de
  // uma vez. Sem ele, cada conta soltava o seu proprio aviso e o gestor recebia uma
  // pilha de mensagens iguais por UMA acao — quem chama em lote avisa uma vez no fim.
  const applyHistorico = async (contaId: number, pct: number, mode2: 'sazonalidade' | 'igual' = 'sazonalidade', crId?: number, opts?: { silencioso?: boolean }) => {
    const forecastMonths = Array.from({ length: 12 }, (_, i) => i + 1).filter(m => !lockedCalendarMonths.has(m));
    if (forecastMonths.length === 0) {
      if (!opts?.silencioso) addToast('success', 'Todos os meses estão com realizado — nada a projetar');
      return;
    }
    // Projecao considera APENAS os meses a projetar: base = realizado (ano
    // anterior) somente desses meses; alvo = base * (1 + pct). Assim a soma do
    // que e gravado bate exatamente com a Previa de Valores acima.
    // Em modo pacote a linha e por CR: base e escrita usam o crId da linha.
    let forecastRealTotal = 0;
    for (const m of forecastMonths) forecastRealTotal += getRealizadoValue(contaId, m, crId);
    const targetTotal = Math.round(forecastRealTotal * (1 + pct / 100) * 100) / 100;
    if (mode2 === 'sazonalidade') {
      for (const m of forecastMonths) {
        const realVal = getRealizadoValue(contaId, m, crId);
        const proportion = forecastRealTotal > 0 ? realVal / forecastRealTotal : 1 / forecastMonths.length;
        const newVal = Math.round(targetTotal * proportion * 100) / 100;
        await saveBudgetCell(contaId, m, newVal, undefined, undefined, crId);
      }
    } else {
      const perMonth = Math.round((targetTotal / forecastMonths.length) * 100) / 100;
      for (const m of forecastMonths) await saveBudgetCell(contaId, m, perMonth, undefined, undefined, crId);
    }
    setDataVersion(v => v + 1);
    const justificativa = histJustificativas[contaId] || '';
    await saveHistPremissa(contaId, pct, mode2, justificativa);
    if (!opts?.silencioso) addToast('success', 'Projeção aplicada com sucesso');
  };

  const calcBenEnc = (salario: number, isCLT: boolean) => {
    let totalBen = 0, totalEnc = 0;
    if (isCLT) {
      beneficios.forEach((b: any) => { if (b.APLICA_CLT === 'true') { totalBen += b.TIPO === 'FIXO' ? Number(b.VALOR) : salario * (Number(b.PERCENTUAL) / 100); }});
      encargos.forEach((e: any) => { if (e.APLICA_CLT === 'true') totalEnc += salario * (Number(e.PERCENTUAL) / 100); });
    } else {
      beneficios.forEach((b: any) => { if (b.APLICA_PJ === 'true') { totalBen += b.TIPO === 'FIXO' ? Number(b.VALOR) : salario * (Number(b.PERCENTUAL) / 100); }});
    }
    return { ben: Math.round(totalBen * 100) / 100, enc: Math.round(totalEnc * 100) / 100 };
  };

  const handleCalculatePayrollClick = () => {
    if (!selectedCiclo || !selectedCR) return;
    if (orcamentoPessoal.length > 0) {
      setShowRecalcConfirm(true);
      return;
    }
    calculatePayroll();
  };

  async function calculatePayroll(desligamentosOverride?: any[], successMessage = 'Cálculo de folha concluído (com premissas aplicadas)!') {
    if (!selectedCiclo || !selectedCR) return;
    setCalculating(true);
    try {
      // A limpeza da projecao anterior acontece no servidor, dentro da mesma
      // chamada que grava a nova (SF 247 na rota interna, op pessoalRecalc da
      // SF 147 no link publico).
      const newRecords: any[] = [];

      // Current collaborators with dissídio + aumento salarial applied
      for (const col of colaboradores) {
        const baseSalario = Number(col.SALARIO) || 0;
        const empresaId = col.EMPRESA_ID;
        const dissidio = dissidios.find((d: any) => d.EMPRESA_ID === empresaId);
        const dissidioPct = dissidio ? Number(dissidio.PERCENTUAL) / 100 : 0;
        const dissidioMes = dissidio ? Number(dissidio.MES_APLICACAO) : 13; // 13 = never
        const aumento = aumentosSalariais.find((a: any) => a.COLABORADOR_ID === col.ID);
        const aumentoPct = aumento ? Number(aumento.PERCENTUAL) / 100 : 0;
        const aumentoMes = aumento ? Number(aumento.MES_APLICACAO) : 13;
        const desligamento = (desligamentosOverride || desligamentosProjetados)
          .find((item: any) => Number(item.COLABORADOR_ID) === Number(col.ID));
        const mesDesligamento = desligamento ? Number(desligamento.MES_DESLIGAMENTO) : null;

        for (let m = 1; m <= 12; m++) {
          if (!colaboradorTemCustoNoMes(m, mesDesligamento)) continue;
          let salario = baseSalario;
          if (m >= dissidioMes) salario = salario * (1 + dissidioPct);
          if (m >= aumentoMes) salario = salario * (1 + aumentoPct);
          salario = Math.round(salario * 100) / 100;
          const { ben, enc } = calcBenEnc(salario, col.TIPO_CONTRATO === 'CLT');
          newRecords.push({ CICLO_ID: selectedCiclo, CR_ID: selectedCR, COLABORADOR_ID: col.ID, MES: m, SALARIO: salario, BENEFICIOS: ben, ENCARGOS: enc, TOTAL: Math.round((salario + ben + enc) * 100) / 100 });
        }
      }

      // Contratações projetadas (from CONTRATACAO_PROJETADA instead of headcount grid)
      for (const cp of contratacoes) {
        const cargo = cargos.find((c: any) => c.ID === cp.CARGO_ID);
        if (!cargo) continue;
        const salario = Number(cargo.SALARIO_MEDIO) || 0;
        const mesEntrada = Number(cp.MES_ENTRADA);
        const qtdVagas = Number(cp.QTD_VAGAS) || 1;
        const { ben, enc } = calcBenEnc(salario, true);
        for (let mm = mesEntrada; mm <= 12; mm++) {
          for (let v = 0; v < qtdVagas; v++) {
            newRecords.push({ CICLO_ID: selectedCiclo, CR_ID: selectedCR, COLABORADOR_ID: null, MES: mm, SALARIO: salario, BENEFICIOS: ben, ENCARGOS: enc, TOTAL: Math.round((salario + ben + enc) * 100) / 100 });
          }
        }
      }

      // Also include legacy headcount grid entries if any exist
      cargos.forEach((cargo: any, ci: number) => {
        const salario = Number(cargo.SALARIO_MEDIO) || 0;
        const { ben, enc } = calcBenEnc(salario, true);
        for (let m = 1; m <= 12; m++) {
          const qty = headcountData[ci]?.[m - 1] || 0;
          if (qty > 0) for (let mm = m; mm <= 12; mm++) for (let q = 0; q < qty; q++) newRecords.push({ CICLO_ID: selectedCiclo, CR_ID: selectedCR, COLABORADOR_ID: null, MES: mm, SALARIO: salario, BENEFICIOS: ben, ENCARGOS: enc, TOTAL: Math.round((salario + ben + enc) * 100) / 100 });
        }
      });

      // Guarda contra falha silenciosa — total ou PARCIAL. A regra (e o porque
      // dela ser bloco a bloco) esta em lib/folha-lancamento.
      const avisoLancamento = avisoFolhaNaoLancada(
        newRecords,
        configsByDriver('PESSOAL').map((dc: any) => String(dc.CODIGO || '')),
      );

      if (isPublic) {
        // Op unico token-escopado: limparFolha + insert projecao + limparOrcamento
        // + gravarOrcamento (mesmas SQLs das SFs 58/60/61). Refresh via detalhe.
        await publicOrcWrite('pessoalRecalc', { crId: selectedCR, records: newRecords });
        const row = await fetchDetalheRow();
        if (row) {
          setBudgetData(jsonField(row.BUDGET));
          setOrcamentoPessoal(jsonField(row.ORCAMENTO_PESSOAL));
          setRealizadoData(jsonField(row.REALIZADO));
          setRealizadoAnoAtual(jsonField(row.REALIZADO_ATUAL));
        }
      } else {
      // Limpar folha + inserir projecao em lote + regravar contas de pessoal do
      // ORCAMENTO em UMA chamada. Antes eram 1 + ceil(N/50) chamadas REST
      // sequenciais (1 INSERT por linha no servidor) + 2 SFs — com 20
      // colaboradores, 240 inserts individuais: era isso que deixava o
      // recalculo lento.
      await execSF(SF_PESSOAL.gravarFolha, { cicloId: selectedCiclo, crId: selectedCR, records: newRecords });
      // Refresh data without triggering loading spinner (avoids screen flicker).
      // Reusa a SF SQL 125 (a mesma do loadData) — devolve BUDGET, ORCAMENTO_PESSOAL
      // e REALIZADO como JSON em ~ms, sem sandbox. controlCicloId 0: ORC_CONTROLE
      // nao muda com o recalculo, nao precisa reler.
      if (selectedCR && selectedCiclo) {
        const ciclo = ciclos.find((c: any) => c.ID === selectedCiclo);
        const anoAtual = ciclo?.ANO ?? new Date().getFullYear();
        const row = (await execSF(SF_IDS.hotOrcDetalheCr, {
          crId: selectedCR, cicloId: selectedCiclo, ano: anoAtual, anoPrev: anoAtual - 1,
          gestorId: gestorId || 0, controlCicloId: 0,
        }))?.[0] || {};
        setBudgetData(jsonField(row.BUDGET));
        setOrcamentoPessoal(jsonField(row.ORCAMENTO_PESSOAL));
        setRealizadoData(jsonField(row.REALIZADO));
        setRealizadoAnoAtual(jsonField(row.REALIZADO_ATUAL));
      }
      }
      // Sem `return` aqui: o early-return anterior saltava o setCalculating(false)
      // do fim da funcao e deixava o botao preso em "Calculando...".
      if (avisoLancamento) addToast('error', avisoLancamento);
      else addToast('success', successMessage);
    } catch (e) { console.error(e); addToast('error', 'Erro no cálculo'); }
    setCalculating(false);
  }

  // ──────────────────────────────────────────────────────────────────────
  // MATERIALIZACAO — um unico momento em que conta calculada vira numero no DRE.
  //
  // O DRE le a tabela ORCAMENTO por SQL puro; ele nao sabe o que e formula. Ja a
  // tela CALCULA a conta na hora. Se ninguem gravar o resultado, o gestor ve um
  // numero e o DRE soma outro — foi o caso da Receita de Produtos, que mostrava
  // 2,3 milhoes na tela com 14.840 gravados.
  //
  // Antes disso havia dois caminhos diferentes e nenhum completo: o modelo
  // customizado gravava a cada TECLA digitada (e so entao), e o modelo nativo
  // nao gravava nunca. Gravar por tecla tem dois defeitos: e uma rajada de
  // escritas por celula (o mesmo problema que tirou o imposto do afterChange) e,
  // pior, ignora tudo que muda sem ninguem digitar — trocar uma premissa geral
  // nao dispara tecla nenhuma, entao o DRE ficava com o numero velho.
  //
  // Agora e um so: CONFIRMAR o modelo materializa suas contas calculadas. E a
  // mesma regra que ja vale para a folha — o valor conta no DRE quando o modelo
  // esta calculado e confirmado. Mes fechado nao entra: ele vem do realizado.
  // ──────────────────────────────────────────────────────────────────────
  const [materializando, setMaterializando] = useState(false);
  // Espelho em ref do estado acima, lido por desconfirmarPorEdicao.
  //
  // A materializacao grava celula a celula pelo MESMO saveBudgetCell que o gestor
  // usa ao digitar — e digitar agora desfaz a confirmacao. Hoje isso nao se morde
  // porque aplicarConfirmacaoDriver materializa ANTES de por o modelo em
  // confirmedDrivers: durante a gravacao ele ainda nao esta confirmado, entao a
  // desconfirmacao ja sai pelo guard de "nao estava confirmado".
  //
  // Ou seja: a corretude depende de uma ordem sutil, a metros de distancia daqui e
  // sem nada que a sinalize. Esta trava torna a dependencia explicita — inverter
  // aquela ordem deixa de fazer o confirmar se autodesfazer em silencio. Ref, e
  // nao state, porque o loop de gravacao e assincrono e leria um valor congelado.
  const materializandoRef = useRef(false);

  const materializarCalculadas = async (driverName: string): Promise<boolean> => {
    // LACUNA CONHECIDA: modelo de pacote grava em ORCAMENTO_PACOTE, com mapa de
    // orcamento por CR, e ainda nao passa por aqui — la a conta calculada segue
    // sendo persistida na edicao da grade. Unificar exige portar o mapa por CR;
    // enquanto nao acontece, esta linha e o registro de que a lacuna existe.
    if (isPkg) return true;

    const formulaMap = getFormulaOverrideForDriver(driverName);
    if (formulaMap.size === 0) return true;
    const configs = configsByDriver(driverName);
    const contasDoModelo = new Set(configs.map((dc: any) => Number(dc.CONTA_ID)));

    setMaterializando(true);
    materializandoRef.current = true;
    try {
      const globalBudget = buildGlobalBudgetMap();
      const customBudget = buildCustomBudgetMap(driverName, globalBudget);
      const invalidas: string[] = [];

      for (const [contaId, f] of formulaMap) {
        // A linha pode citar uma conta que nao esta mapeada neste CR: nesse caso
        // a tela nem mostra a linha, e nao ha o que gravar.
        if (!contasDoModelo.has(Number(contaId))) continue;
        const codigo = configs.find((dc: any) => Number(dc.CONTA_ID) === Number(contaId))?.CODIGO || String(contaId);

        for (const mes of mesesMaterializaveis(ultimoMesRealizado)) {
          const bruto = evaluateFormula(f.formula, mes, driverConfigs, globalBudget, customBudget);
          const decisao = decidirGravacao(bruto, getBudgetValue(Number(contaId), mes));
          if (!decisao.gravar) {
            if (decisao.motivo === 'nao_finito' && !invalidas.includes(codigo)) invalidas.push(codigo);
            continue;
          }
          // O mapa tem de acompanhar o que acabou de ser calculado: uma conta
          // pode ser BASE de outra na mesma passada (o imposto incide sobre a
          // receita, e a receita tambem e calculada). Sem esta linha, a segunda
          // conta leria o retrato tirado ANTES desta materializacao e o imposto
          // sairia uma confirmacao atrasado.
          globalBudget.set(`${contaId}_${mes}`, decisao.valor);
          await saveBudgetCell(Number(contaId), mes, decisao.valor);
        }
      }

      if (invalidas.length > 0) addToast('error', avisoContasNaoCalculadas(invalidas));
      setDataVersion(v => v + 1);
      return true;
    } catch (e) {
      console.error('Erro ao materializar contas calculadas:', e);
      addToast('error', 'Erro ao gravar as contas calculadas do modelo');
      return false;
    } finally {
      setMaterializando(false);
      materializandoRef.current = false;
    }
  };

  // O imposto sobre receita NAO tem mais mecanismo proprio aqui.
  //
  // Ate aqui existia um recalcularImpostosReceita: ao confirmar a Receita, ele
  // lia a aliquota em PREMISSA_IMPOSTO, multiplicava pela soma das contas de
  // receita do CR e gravava. Era invisivel — quem abrisse o modelo via a conta
  // de imposto como um input comum, sem regra nenhuma escrita.
  //
  // Agora a regra mora no modelo, em linguagem de modelo:
  //     3.2.01 ISS = ({3.1.02} + {3.1.01} + {3.1.04}) * [P1] / 100
  // com [P1] apontando para a aliquota cadastrada em Premissas Gerais. O imposto
  // virou uma conta calculada como qualquer outra e entra no DRE pelo mesmo
  // caminho: materializarCalculadas, no confirmar.
  // Ver backend/imposto-no-modelo-receita.mjs.

  // Confirmar PESSOAL sem folha calculada nao e proibido, mas nao pode ser
  // silencioso: o gestor tem de assumir a escolha. A regra esta em
  // lib/folha-lancamento.
  const [confirmSemFolhaAberto, setConfirmSemFolhaAberto] = useState(false);

  const confirmDriver = async (driver: string) => {
    if (precisaAvisarFolhaNaoCalculada(driver, orcamentoPessoal)) {
      setConfirmSemFolhaAberto(true);
      return;
    }
    await aplicarConfirmacaoDriver(driver);
  };

  const aplicarConfirmacaoDriver = async (driver: string) => {
    // A materializacao vem ANTES de marcar como confirmado: se a gravacao
    // falhar, o modelo nao fica confirmado com numero defasado.
    if (!(await materializarCalculadas(driver))) return;
    const next = new Set(confirmedDrivers).add(driver);
    aplicarConfirmedDrivers(next);
    const csv = Array.from(next).join(',');
    if (isPublic) {
      // Op token-escopado: garante a linha de status e grava o CSV; quando todos
      // confirmados e PENDENTE -> CONFIRMADO (mesma regra do fluxo interno).
      // Pacote usa a op propria sobre PACOTE_STATUS (a linha ja existe do disparo).
      const nonPacoteTabs = availableTabs.filter(t => !t.isPacote);
      const allConfirmed = nonPacoteTabs.every(t => next.has(t.key));
      try {
        await flushPublicOrcQueue();
        if (isPkg && selectedPackage) {
          await publicOrcWrite('confirmPacote', { pacoteId: selectedPackage.ID, driversCsv: csv, allConfirmed });
          const base = statusRecord || { CICLO_ID: selectedCiclo, DRIVER_ID: selectedPackage.ID, GESTOR_ID: gestorId, STATUS: 'PENDENTE' };
          const newStatus = allConfirmed && base.STATUS === 'PENDENTE' ? 'CONFIRMADO' : base.STATUS;
          setStatusRecord({ ...base, STATUS: newStatus, DRIVERS_CONFIRMADOS: csv });
        } else {
          await publicOrcWrite('confirmDriver', { crId: selectedCR, driversCsv: csv, allConfirmed });
          const base = statusRecord || { CICLO_ID: selectedCiclo, CR_ID: selectedCR, GESTOR_ID: gestorId, STATUS: 'PENDENTE' };
          const newStatus = allConfirmed && base.STATUS === 'PENDENTE' ? 'CONFIRMADO' : base.STATUS;
          setStatusRecord({ ...base, STATUS: newStatus, DRIVERS_CONFIRMADOS: csv });
          if (selectedCR && onStatusChange) onStatusChange(selectedCR, newStatus, csv);
        }
      } catch (e) { console.error(e); addToast('error', 'Erro ao confirmar modelo'); return; }
      addToast('success', `Modelo ${availableTabs.find(t => t.key === driver)?.label || driver} confirmado!`);
      return;
    }
    let currentStatus = statusRecord;
    const tableName = isPkg ? 'PACOTE_STATUS' : 'ORCAMENTO_STATUS';
    if (!currentStatus) {
      try {
        const baseData: any = isPkg
          ? { CICLO_ID: selectedCiclo, DRIVER_ID: selectedPackage!.ID, GESTOR_ID: gestorId, STATUS: 'PENDENTE', DRIVERS_CONFIRMADOS: '' }
          : { CICLO_ID: selectedCiclo, CR_ID: selectedCR, GESTOR_ID: gestorId, STATUS: 'PENDENTE', DRIVERS_CONFIRMADOS: '' };
        const res = await createRecordMitra({ projectId: pid, tableName, data: baseData });
        const newId = (res as any)?.id || (res as any)?.ID || (res as any)?.result?.id;
        if (newId) {
          currentStatus = { ID: newId, ...baseData };
          setStatusRecord(currentStatus);
        } else {
          const rows = isPkg
            ? await querySQL(`SELECT * FROM PACOTE_STATUS WHERE CICLO_ID = ${selectedCiclo} AND DRIVER_ID = ${selectedPackage!.ID} LIMIT 1`)
            : await querySQL(`SELECT * FROM ORCAMENTO_STATUS WHERE CICLO_ID = ${selectedCiclo} AND CR_ID = ${selectedCR}${gestorId ? ` AND GESTOR_ID = ${gestorId}` : ''} LIMIT 1`);
          if (rows.length > 0) { currentStatus = rows[0]; setStatusRecord(rows[0]); }
          else { addToast('error', 'Erro ao criar registro de status'); return; }
        }
      } catch (e) { console.error(e); addToast('error', 'Erro ao criar registro de status'); return; }
    }
    try {
      const nonPacoteTabs = availableTabs.filter(t => !t.isPacote);
      const allConfirmed = nonPacoteTabs.every(t => next.has(t.key));
      const patchData: any = { DRIVERS_CONFIRMADOS: csv };
      if (allConfirmed && currentStatus.STATUS === 'PENDENTE') {
        patchData.STATUS = 'CONFIRMADO';
      }
      await patchRecordMitra({ projectId: pid, tableName, id: currentStatus.ID, data: patchData });
      setStatusRecord({ ...currentStatus, ...patchData });
      if (allConfirmed && currentStatus.STATUS === 'PENDENTE') {
        if (selectedCR && onStatusChange) onStatusChange(selectedCR, 'CONFIRMADO', csv);
      } else {
        if (selectedCR && onStatusChange) onStatusChange(selectedCR, currentStatus.STATUS, csv);
      }
    } catch (e) { console.error(e); addToast('error', 'Erro ao confirmar modelo'); return; }
    addToast('success', `Modelo ${availableTabs.find(t => t.key === driver)?.label || driver} confirmado!`);
  };


  // Desfaz a confirmacao de um modelo — permitido enquanto o CR nao foi
  // submetido/aprovado. Se todos estavam confirmados (status CONFIRMADO),
  // o CR volta a PENDENTE; demais status (ex: REPROVADO) sao preservados.
  const unconfirmDriver = async (driver: string, opts?: { porEdicao?: boolean; jaRetiradoDoRef?: boolean }) => {
    // Estado para o qual voltar se nada for gravado. Quando a chamada vem de
    // desconfirmarPorEdicao o driver JA saiu do ref (retirada otimista), entao o
    // "antes" tem de ser reconstruido — senao um erro deixaria o modelo pendente
    // na tela e confirmado no banco.
    const prev = new Set(confirmedDriversRef.current);
    if (opts?.jaRetiradoDoRef) prev.add(driver);

    const st = statusRecord?.STATUS || 'PENDENTE';
    if (st === 'SUBMETIDO' || st === 'APROVADO') {
      if (opts?.jaRetiradoDoRef) confirmedDriversRef.current = prev;
      return;
    }
    const next = new Set(confirmedDriversRef.current);
    next.delete(driver);
    aplicarConfirmedDrivers(next);
    const csv = Array.from(next).join(',');
    const newStatus = st === 'CONFIRMADO' ? 'PENDENTE' : st;
    const label = availableTabs.find(t => t.key === driver)?.label || toTitleCase(driver);
    try {
      if (isPublic) {
        await flushPublicOrcQueue();
        if (isPkg && selectedPackage) {
          await publicOrcWrite('confirmPacote', { pacoteId: selectedPackage.ID, driversCsv: csv, allConfirmed: false });
          const base = statusRecord || { CICLO_ID: selectedCiclo, DRIVER_ID: selectedPackage.ID, GESTOR_ID: gestorId, STATUS: 'PENDENTE' };
          setStatusRecord({ ...base, STATUS: newStatus, DRIVERS_CONFIRMADOS: csv });
        } else {
          await publicOrcWrite('confirmDriver', { crId: selectedCR, driversCsv: csv, allConfirmed: false });
          const base = statusRecord || { CICLO_ID: selectedCiclo, CR_ID: selectedCR, GESTOR_ID: gestorId, STATUS: 'PENDENTE' };
          setStatusRecord({ ...base, STATUS: newStatus, DRIVERS_CONFIRMADOS: csv });
          if (selectedCR && onStatusChange) onStatusChange(selectedCR, newStatus, csv);
        }
      } else if (statusRecord) {
        const patchData: any = { DRIVERS_CONFIRMADOS: csv };
        if (st === 'CONFIRMADO') patchData.STATUS = 'PENDENTE';
        await patchRecordMitra({ projectId: pid, tableName: isPkg ? 'PACOTE_STATUS' : 'ORCAMENTO_STATUS', id: statusRecord.ID, data: patchData });
        setStatusRecord({ ...statusRecord, ...patchData });
        if (selectedCR && onStatusChange) onStatusChange(selectedCR, patchData.STATUS || st, csv);
      }
    } catch (e) {
      console.error(e);
      aplicarConfirmedDrivers(prev);
      addToast('error', 'Erro ao desfazer confirmação');
      return;
    }
    if (opts?.porEdicao) {
      // Quem editou nao pediu para desconfirmar — o aviso tem de explicar por que
      // aconteceu e o que falta fazer, senao parece que a tela perdeu o trabalho.
      addToast('info', `${label} voltou a pendente: o valor mudou depois da confirmação. Confirme de novo para o DRE refletir.`);
      return;
    }
    addToast('success', `Confirmação de ${label} desfeita`);
  };

  // Controle de confirmacao usado no header de TODOS os modelos (nativos e
  // personalizados): botao Confirmar quando pendente; badge + Desfazer quando
  // confirmado (desfazer disponivel enquanto o CR nao foi submetido/aprovado).
  const renderConfirmControl = (driver: string, label: string) => {
    if (!readOnly && !confirmedDrivers.has(driver)) {
      // Confirmar grava as contas calculadas do modelo, e isso leva alguns
      // segundos. Sem o estado no botao, o clique pareceria ignorado e o usuario
      // clicaria de novo, disparando a gravacao em duplicata.
      return (
        <Button size="sm" onClick={() => confirmDriver(driver)} disabled={materializando}>
          <CheckCircle size={14} className="mr-1" />
          {materializando ? 'Gravando contas calculadas...' : `Confirmar ${label}`}
        </Button>
      );
    }
    const st = statusRecord?.STATUS || 'PENDENTE';
    const canUndo = !readOnly && confirmedDrivers.has(driver) && st !== 'SUBMETIDO' && st !== 'APROVADO';
    return (
      <div className="flex items-center gap-2">
        <Badge variant="success" dot>{label} confirmado</Badge>
        {canUndo && (
          <button onClick={() => unconfirmDriver(driver)}
            className="text-xs font-medium underline cursor-pointer border-0 bg-transparent p-0"
            style={{ color: 'var(--color-text-secondary)' }}
            title="Desfazer confirmação">
            Desfazer
          </button>
        )}
      </div>
    );
  };

  const renderHot = (key: string) => {
    setTimeout(() => { hotRefs.current[key]?.hotInstance?.render(); }, 50);
  };

  // Aprovacao do CR a partir da aba Resumo (admin/aprovador) — via SF 171:
  // o servidor valida a maquina de estados, exige motivo na reprovacao, grava
  // auditoria e notifica o gestor por e-mail (com o motivo e o link, se reprovado).
  const changeApprovalStatus = async (newStatus: 'APROVADO' | 'REPROVADO' | 'SUBMETIDO', comment?: string) => {
    if (!statusRecord) { addToast('error', `Status do ${isPkg ? 'pacote' : 'CR'} ainda nao foi criado`); return; }
    // OTIMISTA: a tela reflete a decisao NA HORA — a SF de transicao (sandbox +
    // e-mail de notificacao) leva segundos e o feedback visual nao pode esperar.
    // Se o servidor recusar, reverte o status local e avisa.
    const prev = statusRecord;
    const patchData: any = { STATUS: newStatus, ATUALIZADO_EM: new Date().toISOString().slice(0, 19) };
    if (newStatus === 'REPROVADO') patchData.COMENTARIO = comment ?? '';
    setStatusRecord({ ...prev, ...patchData });
    if (selectedCR && onStatusChange) onStatusChange(selectedCR, newStatus, prev.DRIVERS_CONFIRMADOS || '');
    addToast('success', newStatus === 'APROVADO' ? 'Orcamento aprovado!' : newStatus === 'REPROVADO' ? 'Orcamento reprovado.' : 'Orçamento devolvido para avaliação.');
    try {
      // Em modo pacote o statusRecord e uma linha de PACOTE_STATUS — a SF 171
      // precisa do tipo certo pra atuar na tabela certa e auditar como PACOTE.
      const out = await avaliarWorkflow({ tipo: isPkg ? 'PACOTE' : 'CR', statusId: prev.ID, acao: newStatus, comentario: comment, autor: getUser()?.NOME || '' });
      if (!out?.ok) {
        setStatusRecord(prev);
        if (selectedCR && onStatusChange) onStatusChange(selectedCR, prev.STATUS, prev.DRIVERS_CONFIRMADOS || '');
        addToast('error', avaliarErroMsg(out));
      }
    } catch (e) {
      console.error(e);
      setStatusRecord(prev);
      if (selectedCR && onStatusChange) onStatusChange(selectedCR, prev.STATUS, prev.DRIVERS_CONFIRMADOS || '');
      addToast('error', 'Erro ao atualizar status');
    }
  };

  const MONTHS_LOWER = monthsShort;

  // Detalhe Mensal — two modes: Orçado-only (default) and Real+Orçado
  // Modo pacote (grid CR a CR): CR da linha e sufixo do rotulo "CODIGO - Conta · CR001"
  const rowCrId = (dc: any): number | undefined =>
    isPkg && dc?.CR_ID != null ? Number(dc.CR_ID) : undefined;
  const rowCrSuffix = (dc: any): string =>
    isPkg && dc?.CR_ID != null ? ` · ${dc.CR_CODIGO || `CR${dc.CR_ID}`}` : '';

  const buildHistoricoData = (
    configs: any[],
    withReal: boolean,
    formulaMap?: Map<number, { formula: string }>,
    globalBudget?: Map<string, number>,
    customBudget?: Map<string, number>,
  ) => {
    const rows: any[][] = [];
    configs.forEach((dc: any) => {
      const crId = rowCrId(dc);
      // Sem prefixo 'ƒ' no texto: no padrao de modelo o icone de formula e
      // desenhado pelo renderer do rotulo, a partir do kind da linha.
      const label = dc.CODIGO + ' - ' + dc.CONTA_NOME + rowCrSuffix(dc);
      const row: any[] = [label];
      const calcBudget = (cm: number): number => {
        if (lockedCalendarMonths.has(cm)) return getRealizadoAtualValue(dc.CONTA_ID, cm, crId);
        if (formulaMap && formulaMap.has(dc.CONTA_ID) && globalBudget && customBudget) {
          return getEffectiveBudgetValue(dc.CONTA_ID, cm, formulaMap, globalBudget, customBudget);
        }
        return getBudgetValue(dc.CONTA_ID, cm, crId);
      };
      if (withReal) {
        let totalR = 0, totalO = 0;
        for (let i = 0; i < 12; i++) {
          const cm = fiscalMonthNumbers[i];
          const rv = getRealizadoValue(dc.CONTA_ID, cm, crId);
          const bv = calcBudget(cm);
          row.push(rv, bv);
          totalR += rv; totalO += bv;
        }
        row.push(totalR, totalO);
      } else {
        let totalO = 0;
        for (let i = 0; i < 12; i++) {
          const cm = fiscalMonthNumbers[i];
          const bv = calcBudget(cm);
          row.push(bv);
          totalO += bv;
        }
        row.push(totalO);
      }
      rows.push(row);
    });
    return rows;
  };

  // Cabecalhos e colunas dos dois modos do Detalhe Mensal saem do padrao de
  // modelo (lib/model-grid), nao mais de constantes locais.

  const colHeaders14 = ['Conta', ...MONTHS_LOWER, 'Total'];
  // As colunas das grades de modelo vem de colunasModelo14() — ver lib/model-grid.

  void dataVersion;
  const contasWithBudget = new Set(budgetData.filter((b: any) => b.VALOR != 0).map((b: any) => b.CONTA_ID));
  // Em modo pacote o progresso conta pares (conta, CR) — cada linha do grid CR a CR
  // e uma unidade de preenchimento.
  const contaCrWithBudget = new Set(budgetData.filter((b: any) => b.VALOR != 0).map((b: any) => `${b.CONTA_ID}_${b.CR_ID}`));
  // Modelo de pacote: par conta×CR conta como preenchido se foi LANCADO (linha
  // existe) — o rateio pode legitimamente zerar um CR (quantidade 0) e isso nao
  // pode travar o progresso/Submeter. Mesma regra do PKG_FILLED da SF 121.
  const contaCrTouched = new Set(budgetData.map((b: any) => `${b.CONTA_ID}_${b.CR_ID}`));
  const driverProgress = (driver: string) => {
    const cfgs = configsByDriver(driver);
    if (cfgs.length === 0) return 0;
    if (driver === 'PESSOAL') return orcamentoPessoal.length > 0 ? 100 : 0;
    const isPkgModelTab = isPkg && normalDrivers.find((d: any) => d.NOME === driver)?.ESCOPO === 'PACOTE';
    const filled = cfgs.filter((dc: any) =>
      isPkg && dc.CR_ID != null
        ? (isPkgModelTab ? contaCrTouched : contaCrWithBudget).has(`${dc.CONTA_ID}_${dc.CR_ID}`)
        : contasWithBudget.has(dc.CONTA_ID)
    ).length;
    return Math.round((filled / cfgs.length) * 100);
  };

  const fmtBRL = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v);

  // Lista de CRs do pacote (codigo + nome) — filtrada pelo MODELO ATIVO em modo pacote.
  // Cada modelo (BZ, Receita, BH, etc) so deve mostrar os CRs onde a conta aplica
  // para AQUELE modelo (uma conta com excecao Receita em CR007 nao aparece com CR007 em BZ).
  const pkgCrsList: Array<{ id: number; code: string; nome: string }> = (() => {
    if (!isPkg) return [];
    const map = new Map<number, { id: number; code: string; nome: string }>();
    for (const r of pkgConfigsRaw) {
      if (r.DRIVER_TIPO !== activeTab) continue;
      const id = Number(r.CR_ID);
      if (!map.has(id)) map.set(id, { id, code: r.CR_CODIGO || `CR${id}`, nome: r.CR_NOME || '' });
    }
    return Array.from(map.values()).sort((a, b) => a.code.localeCompare(b.code));
  })();

  // Filtros para o chart "Por CR": linhas apenas dos pares (CONTA_ID, CR_ID) que pertencem ao modelo atual.
  // Sem isso, a aba BZ mostraria tambem rows da Receita do mesmo CR/conta — duplicacao.
  const pkgModeloPairs: Set<string> = (() => {
    const s = new Set<string>();
    if (!isPkg) return s;
    for (const r of pkgConfigsRaw) {
      if (r.DRIVER_TIPO === activeTab) s.add(`${r.CONTA_ID}_${r.CR_ID}`);
    }
    return s;
  })();
  const filterRowsByModelo = (rows: any[]) =>
    isPkg ? rows.filter((r: any) => pkgModeloPairs.has(`${r.CONTA_ID}_${r.CR_ID}`)) : rows;
  const pkgBudgetRowsModelo = filterRowsByModelo(budgetData);
  const pkgRealAtualRowsModelo = filterRowsByModelo(realizadoAnoAtual);

  // Estado do modelo de pacote da aba ativa — calculado UMA vez por render e
  // compartilhado entre o pill de avisos de rateio (acima dos banners) e a
  // secao do grid do modelo.
  const pkgState = !loading && isPkg && activeTab && availableTabs.find(t => t.key === activeTab)?.isNormal
    ? computePkgModel(activeTab)
    : null;
  const rateioAvisosCount = pkgState ? pkgState.semRateio.length + pkgState.rateioParcial.length : 0;

  if (!selectedCR && !selectedPackage) {
    return (
      <Card className="text-center py-12">
        <FileSpreadsheet className="mx-auto mb-3" size={48} style={{ color: 'var(--color-text-muted)' }} />
        <p style={{ color: 'var(--color-text-secondary)' }}>Selecione um CR ou pacote para iniciar o lançamento</p>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {/* Modo avaliacao (CR submetido aberto por admin/aprovador): sem banner —
          os dados ficam em modo leitura (isEvaluation) e a decisao mora no header
          da pagina, ao lado do "Aguardando aprovação" (OrcamentoPage). */}

      {/* Barra de status do pacote — a aba Resumo nao existe em modo pacote, entao
          as acoes de aprovacao (antes no header do Resumo do Pacote) vivem aqui:
          admin/aprovador decide sobre SUBMETIDO e reabre APROVADO/REPROVADO. */}
      {!loading && isPkg && (() => {
        const currentUser = getUser();
        const canApprove = !isPublic && !!currentUser;
        const currentSt = statusRecord?.STATUS;
        const showApprovalActions = canApprove && (currentSt === 'SUBMETIDO' || currentSt === 'APROVADO' || currentSt === 'REPROVADO');
        if (!showApprovalActions) return null;
        const PILL: Record<string, { bg: string; fg: string; label: string }> = {
          SUBMETIDO: { bg: 'rgba(245,158,11,0.12)', fg: '#b45309', label: 'Submetido' },
          APROVADO: { bg: 'rgba(16,185,129,0.12)', fg: '#059669', label: 'Aprovado' },
          REPROVADO: { bg: 'rgba(239,68,68,0.12)', fg: '#b91c1c', label: 'Reprovado' },
        };
        const pill = PILL[currentSt] || PILL.SUBMETIDO;
        return (
          <div className="flex items-center justify-between gap-3 flex-wrap rounded-xl px-4 py-3"
            style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="text-sm font-semibold px-3 py-1.5 rounded-lg" style={{ backgroundColor: pill.bg, color: pill.fg }}>{pill.label}</span>
              {currentSt === 'SUBMETIDO' && (
                <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>Pacote aguardando avaliação</span>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => setHistoricoOpen(true)}
                title="Histórico"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
                style={{ color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}
              >
                <Clock size={14} /> Histórico
              </button>
              {currentSt === 'SUBMETIDO' && (
                <>
                  {/* Decisoes equivalentes: mesmos solidos e medidas — Reprovar
                      (vermelho) a esquerda, Aprovar (verde) a direita */}
                  <button
                    onClick={() => { setRejectComment(''); setRejectModalOpen(true); }}
                    className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white transition-opacity hover:opacity-90"
                    style={{ backgroundColor: '#ef4444', minWidth: 118 }}
                  >
                    <XCircle size={15} /> Reprovar
                  </button>
                  <button
                    onClick={() => changeApprovalStatus('APROVADO')}
                    className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white transition-opacity hover:opacity-90"
                    style={{ backgroundColor: '#10b981', minWidth: 118 }}
                  >
                    <CheckCircle size={15} /> Aprovar
                  </button>
                </>
              )}
              {/* Reabrir so faz sentido no APROVADO (desfazer a aprovacao e voltar
                  a avaliacao). REPROVADO ja esta com o gestor para corrigir e
                  resubmeter — botao aqui era redundante e confundia. */}
              {currentSt === 'APROVADO' && (
                <button
                  onClick={() => changeApprovalStatus('SUBMETIDO', '')}
                  className="text-sm font-medium px-3 py-1.5 rounded-lg transition-colors"
                  style={{ color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}
                >
                  Reabrir
                </button>
              )}
            </div>
          </div>
        );
      })()}

      {/* Driver tabs — navigation style. Em qualquer PACOTE (link publico OU
          visao do gestor) a barra some: o fluxo tem uma unica tela (o modelo do
          pacote), entao abas so poluiriam o cabecalho — a tela abre direto no
          detalhamento (activeTab ja e inicializado no modelo do proprio pacote). */}
      {!loading && availableTabs.length > 0 && !isPkg && (
        <div className="flex gap-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
          {availableTabs.map(tab => {
            const Icon = tab.icon;
            const pct = driverProgress(tab.key);
            const confirmed = confirmedDrivers.has(tab.key);
            const isReadonly = tab.isPacote && isPacoteReadonly(tab.key);
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className="relative flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium transition-all duration-200 focus:outline-none"
                style={{
                  color: isActive ? 'var(--color-primary)' : 'var(--color-text-muted)',
                }}
                onMouseEnter={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.color = 'var(--color-text)'; }}
                onMouseLeave={(e) => { if (!isActive) (e.currentTarget as HTMLElement).style.color = 'var(--color-text-muted)'; }}
              >
                <Icon size={15} style={{ opacity: isActive ? 1 : 0.6 }} />
                <span>{tab.label}</span>
                {isReadonly && <Lock size={11} style={{ color: 'var(--color-text-muted)', opacity: 0.6 }} />}
                {confirmed ? (
                  <CheckCircle size={13} className="text-emerald-500" />
                ) : pct > 0 ? (
                  <span className="text-[10px] font-normal px-1.5 py-0.5 rounded-full" style={{ backgroundColor: isActive ? 'var(--sidebar-item-active-bg)' : 'var(--bg-muted)', color: isActive ? 'var(--color-primary)' : 'var(--color-text-muted)' }}>{pct}%</span>
                ) : null}
                {/* Active underline indicator */}
                {isActive && (
                  <span className="absolute bottom-0 left-2 right-2 h-[2px] rounded-full" style={{ backgroundColor: 'var(--color-primary)' }} />
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Confirm CR bar removed — submission now done from PreenchimentoPage cards */}

      {/* Avisos de rateio do pacote — callout colapsavel acima do aviso de meses
          travados. Visual flat: mesmo card dos demais (surface + borda padrao),
          icone so colorido (sem chip/filete), divisor fino ao expandir. */}
      {rateioAvisosCount > 0 && pkgState && (
        <div
          className="rounded-xl overflow-hidden"
          style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)' }}
        >
          <button
            type="button"
            onClick={() => setShowRateioAvisos(v => !v)}
            aria-expanded={showRateioAvisos}
            className="w-full flex items-center gap-2.5 px-4 py-2.5 cursor-pointer"
            style={{ color: 'var(--color-text)', background: 'transparent', border: 'none' }}
          >
            <AlertCircle size={15} className="shrink-0" style={{ color: '#d97706' }} />
            <span className="text-[13px] font-medium">{rateioAvisosCount} aviso{rateioAvisosCount > 1 ? 's' : ''} de rateio neste modelo</span>
            <ChevronRight size={14} className="ml-auto transition-transform duration-200" style={{ color: 'var(--color-text-muted)', transform: showRateioAvisos ? 'rotate(90deg)' : 'none' }} />
          </button>
          {showRateioAvisos && (
            <div className="px-4 py-3 space-y-2" style={{ borderTop: '1px solid var(--color-border)' }}>
              {pkgState.semRateio.length > 0 && (
                <div className="flex items-start gap-2 text-xs leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                  <span className="mt-1.5 w-1 h-1 rounded-full shrink-0" style={{ backgroundColor: 'var(--color-text-muted)' }} />
                  <span>
                    {/* A orientação muda conforme quem está na tela: o gestor (rota pública)
                        não tem acesso à Modelagem, então é instruído a acionar o admin. */}
                    {pkgState.semRateio.length === 1
                      ? <>A linha <strong style={{ color: 'var(--color-text)' }}>{toTitleCase(pkgState.semRateio[0])}</strong> tem conta contábil e não é granular por CR — {isPublic
                          ? 'acione o administrador do orçamento para configurar o rateio e liberar o lançamento.'
                          : 'defina um rateio aplicado (com quantidades) na Modelagem para liberar o lançamento.'}</>
                      : <>{pkgState.semRateio.length} linhas com conta contábil estão sem rateio aplicado ({pkgState.semRateio.map(toTitleCase).join(', ')}) — {isPublic
                          ? 'acione o administrador do orçamento para configurar os rateios e liberar o lançamento.'
                          : 'defina os rateios na Modelagem para liberar o lançamento.'}</>}
                  </span>
                </div>
              )}
              {pkgState.rateioParcial.map((w) => (
                <div key={w.nome} className="flex items-start gap-2 text-xs leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                  <span className="mt-1.5 w-1 h-1 rounded-full shrink-0" style={{ backgroundColor: 'var(--color-text-muted)' }} />
                  <span>
                    O rateio <strong style={{ color: 'var(--color-text)' }}>{w.rateioNome}</strong> da linha <strong style={{ color: 'var(--color-text)' }}>{toTitleCase(w.nome)}</strong> não tem quantidade para {w.faltam.length === 1 ? 'o setor' : 'os setores'} <strong style={{ color: 'var(--color-text)' }}>{w.faltam.join(', ')}</strong> — o valor total está sendo distribuído apenas entre {w.recebem.join(', ')}. {isPublic
                      ? 'Acione o administrador do orçamento para incluir todos os setores.'
                      : 'Preencha as quantidades na aba Tipos de Rateio do Mapeamento para incluir todos os setores.'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* O aviso de meses travados saiu daqui: a faixa "Realizado · Bloqueado" no
          cabecalho da propria grade diz a mesma coisa, no lugar onde a informacao
          e usada. Duplicar virava mais uma caixa antes da tabela. */}

      {loading && (
        <Card className="text-center py-12">
          <div className="animate-spin w-8 h-8 border-4 border-t-transparent rounded-full mx-auto mb-3" style={{ borderColor: 'var(--color-primary)', borderTopColor: 'transparent' }} />
        </Card>
      )}

      {/* ===== RESUMO (so modo CR — em modo pacote a aba nao existe e a tela
          abre direto no modelo do pacote) ===== */}
      {!loading && !isPkg && activeTab === 'RESUMO' && (() => {
        const HIGHLIGHT_KEYS = ['receita líquida', 'receita liquida', 'lucro bruto', 'ebitda', 'resultado líquido', 'resultado liquido', 'resultado operacional'];
        const fmtScale = (v: number) => {
          if (v === 0 || Object.is(v, -0)) return '0';
          if (Math.abs(v) >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M';
          if (Math.abs(v) >= 1_000) return (v / 1_000).toFixed(1) + 'K';
          return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(v);
        };
        const fmtImpact = (v: number) => {
          if (v === 0 || Object.is(v, -0)) return '0';
          const sign = v > 0 ? '+' : '';
          if (Math.abs(v) >= 1_000_000) return sign + (v / 1_000_000).toFixed(1) + 'M';
          if (Math.abs(v) >= 1_000) return sign + (v / 1_000).toFixed(1) + 'K';
          return sign + new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(v);
        };

        // Soma anual por conta
        const sumYear = (data: any[], contaId: number) => {
          let sum = 0;
          for (const r of data) if (r.CONTA_ID === contaId) sum += Number(r.VALOR);
          return Math.round(sum);
        };
        // Orcado do CR = o que ele lancou (ORCAMENTO) + o que o pacote submetido
        // rateou para ele. Sem a segunda parcela o DRE do setor subestimava o
        // custo: o valor aparecia na aba Pacotes e sumia do resultado.
        // A versao de comparacao (orcadoControleData) ja vem somada da SF 125.
        const sumYearOrcado = (contaId: number) => sumYear(budgetData, contaId) + pkgOrcadoNoAno(contaId);

        const controlCiclo = ciclos.find((c: any) => c.ANO === cicloAno && c.VERSAO_CONTROLE === 'true' && c.ID !== selectedCiclo);
        const hasControle = !!controlCiclo;
        const compLabel = hasControle ? 'Versão controle' : 'Real Ano Anterior';
        const atualLabel = 'Versão atual';

        // Realizado do ANO CORRENTE por conta (meses fechados) — mesma fonte da
        // aba Receita (getRealizadoAtualValue), para o DRE bater com ela.
        const sumRealizadoAtual = (contaId: number) => {
          let s = 0;
          for (let i = 0; i < 12; i++) {
            const m = fiscalMonthNumbers[i];
            if (lockedCalendarMonths.has(m)) s += getRealizadoAtualValue(contaId, m);
          }
          return s;
        };

        // Build rows iguais ao Dashboard (mesma logica de subtotais agregados).
        // realizadoAtual = realizado dos meses fechados do ciclo corrente;
        // orcadoAtual = orcado dos meses abertos; forecast = soma dos dois.
        type ResumoRow = { label: string; isSubtotal: boolean; isHighlight: boolean; orcadoAtual: number; realizadoAtual: number; realizado: number; orcadoControle: number; prefixo: string; sinal: number };
        const rows: ResumoRow[] = [];
        let rR = 0, rA = 0, rC = 0, rRA = 0;
        dreConfig.forEach((line: any) => {
          const isHL = HIGHLIGHT_KEYS.some(k => String(line.NOME_LINHA).toLowerCase().includes(k));
          if (line.IS_SUBTOTAL === 'true') {
            rows.push({ label: line.NOME_LINHA, isSubtotal: true, isHighlight: isHL, orcadoAtual: rA, realizadoAtual: rRA, realizado: rR, orcadoControle: rC, prefixo: '', sinal: 1 });
          } else {
            const mc = allContas.filter((c: any) => String(c.CODIGO).startsWith(line.PREFIXO_CONTA));
            let rv = 0, av = 0, cv = 0, rav = 0;
            mc.forEach((c: any) => {
              rv += sumYear(realizadoData, c.ID);
              av += sumYearOrcado(c.ID);
              cv += sumYear(orcadoControleData, c.ID);
              rav += sumRealizadoAtual(c.ID);
            });
            rv *= line.SINAL; av *= line.SINAL; cv *= line.SINAL; rav *= line.SINAL;
            rR += rv; rA += av; rC += cv; rRA += rav;
            rows.push({ label: line.NOME_LINHA, isSubtotal: false, isHighlight: isHL, orcadoAtual: av, realizadoAtual: rav, realizado: rv, orcadoControle: cv, prefixo: line.PREFIXO_CONTA || '', sinal: Number(line.SINAL) });
          }
        });

        // Drill por conta: para uma linha (prefixo/sinal), retorna as contas que a
        // compoem com os mesmos valores da linha (Realizado, Orcado, soma).
        const contasDaLinha = (prefixo: string, sinal: number) => {
          if (!prefixo) return [] as any[];
          return allContas
            .filter((c: any) => String(c.CODIGO).startsWith(prefixo))
            .map((c: any) => ({
              id: c.ID, codigo: c.CODIGO, nome: c.NOME,
              realizado: sumYear(realizadoData, c.ID) * sinal,
              orcadoControle: sumYear(orcadoControleData, c.ID) * sinal,
              realizadoAtual: sumRealizadoAtual(c.ID) * sinal,
              orcadoAtual: sumYearOrcado(c.ID) * sinal,
            }))
            .filter((c: any) => c.realizado !== 0 || c.orcadoAtual !== 0 || c.orcadoControle !== 0 || c.realizadoAtual !== 0)
            .sort((a: any, b: any) => Math.abs(b.realizadoAtual + b.orcadoAtual) - Math.abs(a.realizadoAtual + a.orcadoAtual));
        };
        const toggleResumoLine = (prefixo: string) => {
          setExpandedResumoLines(prev => {
            const n = new Set(prev);
            n.has(prefixo) ? n.delete(prefixo) : n.add(prefixo);
            return n;
          });
        };

        const getBase = (row: ResumoRow) => hasControle ? row.orcadoControle : row.realizado;

        const displayRows = rows;

        const currentUser = getUser();
        // Aprovacao nunca aparece no link publico (mesmo com sessao admin residual
        // no localStorage do navegador — as acoes exigiriam auth que a pagina nao tem)
        const canApprove = !isPublic && !!currentUser;
        const currentSt = statusRecord?.STATUS;
        const showApprovalActions = canApprove && (currentSt === 'SUBMETIDO' || currentSt === 'APROVADO' || currentSt === 'REPROVADO');

        return (
          <div className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)' }}>
            {/* Header com toggle + acoes de aprovacao */}
            <div className="px-6 py-5 flex items-center justify-between" style={{ borderBottom: '1px solid var(--color-border)' }}>
              <div>
                <h3 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>DRE do CR</h3>
                <p className="mt-1" style={{ color: 'var(--color-text-secondary)', fontSize: '14px' }}>
                  {atualLabel} vs {compLabel} <span style={{ color: 'var(--color-text-muted)' }}>· clique numa linha para detalhar por conta</span>
                </p>
              </div>
              <div className="flex items-center gap-2">
              {showApprovalActions && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setHistoricoOpen(true)}
                    title="Histórico"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
                    style={{ color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}
                  >
                    <Clock size={14} /> Histórico
                  </button>
                  {currentSt === 'APROVADO' && (
                    <span className="text-sm font-semibold px-3 py-1.5 rounded-lg" style={{ backgroundColor: 'rgba(16, 185, 129, 0.12)', color: '#059669' }}>
                      Aprovado
                    </span>
                  )}
                  {currentSt === 'REPROVADO' && (
                    <span className="text-sm font-semibold px-3 py-1.5 rounded-lg" style={{ backgroundColor: 'rgba(239, 68, 68, 0.12)', color: '#b91c1c' }}>
                      Reprovado
                    </span>
                  )}
                  {/* Em modo avaliacao a decisao mora na barra fixa acima das
                      abas — sem botoes duplicados no header da DRE */}
                  {currentSt === 'SUBMETIDO' && !isEvaluation && (
                    <>
                      {/* Decisoes equivalentes: mesmos solidos e medidas — Reprovar
                          (vermelho) a esquerda, Aprovar (verde) a direita */}
                      <button
                        onClick={() => { setRejectComment(''); setRejectModalOpen(true); }}
                        className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white transition-opacity hover:opacity-90"
                        style={{ backgroundColor: '#ef4444', minWidth: 118 }}
                      >
                        <XCircle size={15} /> Reprovar
                      </button>
                      <button
                        onClick={() => changeApprovalStatus('APROVADO')}
                        className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white transition-opacity hover:opacity-90"
                        style={{ backgroundColor: '#10b981', minWidth: 118 }}
                      >
                        <CheckCircle size={15} /> Aprovar
                      </button>
                    </>
                  )}
                  {/* Reabrir so no APROVADO — REPROVADO ja voltou ao gestor */}
                  {currentSt === 'APROVADO' && (
                    <button
                      onClick={() => changeApprovalStatus('SUBMETIDO' as any, '')}
                      className="text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                      style={{ color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}
                    >
                      Reabrir
                    </button>
                  )}
                </div>
              )}
              </div>
            </div>

            {rows.length === 0 ? (
              <div className="text-center py-16 text-sm" style={{ color: 'var(--color-text-muted)' }}>
                Configure o DRE para visualizar
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
                  <colgroup>
                    <col style={{ width: '30%' }} />
                    {Array.from({ length: 5 + (hasControle ? 1 : 0) }).map((_, ci) => (
                      <col key={ci} style={{ width: `${70 / (5 + (hasControle ? 1 : 0))}%` }} />
                    ))}
                  </colgroup>
                  {/* Mesmo desenho do DRE do Dashboard: cabecalho enxuto com uma
                      unica divisoria suave e a coluna Orcado (a que esta sendo
                      trabalhada) em leve destaque. So estilo — colunas e dados iguais. */}
                  <thead className="sticky top-0 z-10" style={{ backgroundColor: 'var(--color-surface)' }}>
                    <tr style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>
                      <th className="text-left px-6 py-2 uppercase tracking-wide font-medium" style={thDreStyle}>Linha</th>
                      <th className="text-right px-4 py-2 uppercase tracking-wide font-medium" style={thDreStyle}>Real Ano Ant.</th>
                      {hasControle && <th className="text-right px-4 py-2 uppercase tracking-wide font-medium" style={thDreStyle}>{compLabel}</th>}
                      <th className="text-right px-4 py-2 uppercase tracking-wide font-medium" style={thDreStyle}>Realizado</th>
                      <th className="text-right px-4 py-2 uppercase tracking-wide font-medium" style={{ ...thDreStyle, backgroundColor: 'var(--dash-dre-atual-bg)' }}>Orçado</th>
                      <th className="text-right px-4 py-2 uppercase tracking-wide font-medium" style={thDreStyle}>Impacto</th>
                      <th className="text-right pl-4 pr-6 py-2 uppercase tracking-wide font-medium" style={thDreStyle}>Realizado + Orçado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayRows.map((row, i) => {
                      const base = getBase(row);
                      const impact = row.orcadoAtual - base;
                      // Impacto semantico: os valores ja tem o sinal do DRE aplicado
                      // (despesa negativa), entao impact>0 sempre significa "melhora o
                      // resultado" (receita subiu OU despesa caiu) => verde. O numero
                      // exibido usa o sinal do movimento real (rawImpact = impact*sinal),
                      // pra despesa que cai aparecer negativa e ainda assim verde.
                      const favorable = impact > 0;
                      const rawImpact = impact * row.sinal;
                      const impactColor = row.isSubtotal
                        ? 'transparent'
                        : favorable ? 'var(--dre-var-pos)' : impact < 0 ? 'var(--dre-var-neg)' : 'var(--color-text-muted)';

                      // Drill por conta: linhas de conta (nao subtotal) com prefixo
                      // podem expandir e mostrar as contas contabeis que as compoem.
                      const canDrill = !row.isSubtotal && !!row.prefixo;
                      const isExpanded = canDrill && expandedResumoLines.has(row.prefixo);
                      const subContas = isExpanded ? contasDaLinha(row.prefixo, row.sinal) : [];
                      const totalCols = 6 + (hasControle ? 1 : 0);

                      return (
                        <Fragment key={i}>
                        <tr
                          onClick={canDrill ? () => toggleResumoLine(row.prefixo) : undefined}
                          className={canDrill ? 'transition-colors' : undefined}
                          style={{
                            borderTop: row.isSubtotal ? '1px solid var(--dash-dre-sub-border)' : undefined,
                            backgroundColor: isExpanded ? 'var(--bg-active)' : undefined,
                            backgroundImage: row.isSubtotal && !isExpanded ? 'var(--dash-dre-sub-grad)' : undefined,
                            fontWeight: row.isSubtotal ? 600 : undefined,
                            cursor: canDrill ? 'pointer' : undefined,
                          }}
                          onMouseEnter={canDrill ? (e) => { if (!isExpanded) e.currentTarget.style.backgroundColor = 'var(--color-nav-hover)'; } : undefined}
                          onMouseLeave={canDrill ? (e) => { if (!isExpanded) e.currentTarget.style.backgroundColor = ''; } : undefined}
                        >
                          <td className="px-6 py-3" style={{ color: 'var(--color-text)', paddingLeft: row.isSubtotal ? 12 : 28 }}>
                            <span className="inline-flex items-center gap-1.5">
                              {canDrill && (
                                <ChevronRight size={13} style={{ color: 'var(--color-text-muted)', transform: isExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }} />
                              )}
                              {row.label}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>{fmtScale(row.realizado)}</td>
                          {hasControle && <td className="px-4 py-3 text-right tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>{fmtScale(row.orcadoControle)}</td>}
                          <td className="px-4 py-3 text-right tabular-nums" style={{ color: 'var(--color-text)' }}>{fmtScale(row.realizadoAtual)}</td>
                          <td className="px-4 py-3 text-right tabular-nums" style={{ color: 'var(--color-text)', backgroundColor: row.isSubtotal ? 'var(--dash-dre-atual-bg-sub)' : 'var(--dash-dre-atual-bg)' }}>{fmtScale(row.orcadoAtual)}</td>
                          <td className="px-4 py-3 text-right tabular-nums" style={{
                            color: impactColor,
                            fontWeight: impact !== 0 && !row.isSubtotal ? 500 : undefined,
                          }}>
                            {row.isSubtotal ? '' : fmtImpact(rawImpact)}
                          </td>
                          <td className="pl-4 pr-6 py-3 text-right tabular-nums" style={{ color: 'var(--color-text)' }}>
                            {fmtScale(row.realizadoAtual + row.orcadoAtual)}
                          </td>
                        </tr>
                        {isExpanded && subContas.length === 0 && (
                          <tr>
                            <td colSpan={totalCols} className="px-6 py-2 text-xs" style={{ paddingLeft: 48, color: 'var(--color-text-muted)' }}>
                              Sem contas com valores nesta linha
                            </td>
                          </tr>
                        )}
                        {isExpanded && subContas.map((sc: any) => {
                          const scBase = hasControle ? sc.orcadoControle : sc.realizado;
                          const scImpact = sc.orcadoAtual - scBase;
                          const scRawImpact = scImpact * row.sinal;
                          return (
                            <tr key={`${i}-${sc.id}`} style={{ backgroundColor: 'color-mix(in srgb, var(--color-surface) 96%, var(--color-border))' }}>
                              <td className="py-2" style={{ paddingLeft: 48, paddingRight: 24, color: 'var(--color-text-secondary)', fontSize: 13 }}>
                                {sc.codigo} - {sc.nome}
                              </td>
                              <td className="px-4 py-2 text-right tabular-nums" style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>{fmtScale(sc.realizado)}</td>
                              {hasControle && <td className="px-4 py-2 text-right tabular-nums" style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>{fmtScale(sc.orcadoControle)}</td>}
                              <td className="px-4 py-2 text-right tabular-nums" style={{ color: 'var(--color-text-secondary)', fontSize: 13 }}>{fmtScale(sc.realizadoAtual)}</td>
                              <td className="px-4 py-2 text-right tabular-nums" style={{ color: 'var(--color-text-secondary)', fontSize: 13, backgroundColor: 'var(--dash-dre-atual-bg)' }}>{fmtScale(sc.orcadoAtual)}</td>
                              <td className="px-4 py-2 text-right tabular-nums" style={{ fontSize: 13, color: scImpact > 0 ? 'var(--dre-var-pos)' : scImpact < 0 ? 'var(--dre-var-neg)' : 'var(--color-text-muted)' }}>
                                {fmtImpact(scRawImpact)}
                              </td>
                              <td className="pl-4 pr-6 py-2 text-right tabular-nums" style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{fmtScale(sc.realizadoAtual + sc.orcadoAtual)}</td>
                            </tr>
                          );
                        })}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })()}

      {/* ===== BASE_ZERO ===== */}
      {!loading && activeTab === 'BASE_ZERO' && (() => {
        const configs = configsByDriver('BASE_ZERO');
        if (configs.length === 0) return <Card className="text-center py-8" style={{ color: 'var(--color-text-secondary)' }}>Nenhuma conta mapeada para Base Zero neste CR</Card>;

        // BASE ZERO: cada conta = uma linha de input por mês.
        // Sem linhas personalizadas, sem fórmulas — o gestor recalcula tudo do zero.
        const driverObj = normalDrivers.find((d: any) => d.NOME === 'BASE_ZERO');
        const allDriverFormulas = driverObj ? allFormulas.filter((f: any) => f.DRIVER_ID === driverObj.ID) : [];
        const accountOrderMap = new Map<number, number>();
        allDriverFormulas.forEach((f: any) => { if (f.CONTA_ID) accountOrderMap.set(f.CONTA_ID, f.ORDEM ?? 9999); });

        const sortedConfigs = [...configs].sort((a: any, b: any) => {
          const oa = accountOrderMap.get(a.CONTA_ID) ?? 9999;
          const ob = accountOrderMap.get(b.CONTA_ID) ?? 9999;
          if (oa !== ob) return oa - ob;
          return (a.CODIGO || '').localeCompare(b.CODIGO || '');
        });

        const allItems: any[] = sortedConfigs.map((dc: any) => ({
          type: 'account' as const, contaId: dc.CONTA_ID, codigo: dc.CODIGO,
          nome: dc.CONTA_NOME, hasFormula: false, isOverride: false, formulaId: null,
          crId: rowCrId(dc), crSuffix: rowCrSuffix(dc),
          ordem: accountOrderMap.get(dc.CONTA_ID) ?? 9999,
        }));

        const tableData = allItems.map((item: any) => {
          const row: any[] = [item.codigo + ' - ' + item.nome + (item.crSuffix || '')];
          for (let i = 0; i < 12; i++) {
            const m = fiscalMonthNumbers[i];
            if (lockedCalendarMonths.has(m)) {
              row.push(getRealizadoAtualValue(item.contaId, m, item.crId));
            } else {
              row.push(getBudgetValue(item.contaId, m, item.crId));
            }
          }
          row.push(row.slice(1).reduce((s: number, v: number) => s + (Number(v) || 0), 0));
          return row;
        });


        const totRow: any[] = ['Total'];
        for (let m = 1; m <= 12; m++) {
          totRow.push(tableData.reduce((s: number, r: any, idx: number) => s + (allItems[idx]?.type === 'account' ? (Number(r[m]) || 0) : 0), 0));
        }
        totRow.push(tableData.reduce((s: number, r: any, idx: number) => s + (allItems[idx]?.type === 'account' ? (Number(r[13]) || 0) : 0), 0));
        tableData.push(totRow);
        const totalRowIdx = tableData.length - 1;

        // Base Zero nao tem formula nem premissa: toda linha e conta.
        const rowMeta: { kind: 'premise' | 'formula' | 'account' | 'total'; label: string }[] =
          allItems.map((item: any) => ({ kind: 'account', label: `${item.codigo} - ${item.nome}${item.crSuffix || ''}` }));
        rowMeta.push({ kind: 'total', label: 'Total' });

        return (
          <>
            {/* Uma moldura so. Antes eram duas concentricas — a borda do Card, 20px
                de respiro do CardContent e a borda propria da grade — que era o
                excesso de caixas em volta da tabela. Agora o Card e a unica
                moldura e a grade encosta nela; o overflow-hidden e o que faz os
                cantos da tabela seguirem o arredondado do Card. */}
            <Card className="overflow-hidden">
              <CardHeader>
                <div className="flex items-center justify-between gap-3 flex-wrap w-full">
                  <div>
                    <CardTitle>Lançamento Base Zero</CardTitle>
                  </div>
                  {renderConfirmControl('BASE_ZERO', 'Base Zero')}
                </div>
              </CardHeader>
              <GradeModelo
                dados={tableData}
                rowMeta={rowMeta}
                colHeaders={colHeaders14}
                colunaTravada={isColLocked}
                somenteLeitura={readOnly}
                rotuloOrcado={rotuloOrcado}
                moldura={false}
                aoAlterar={(changes: any, source: string, dadosVivos: any[][]) => {
                  if (!changes || source === 'loadData' || readOnly) return;
                  changes.forEach(([row, col, ov, nv]: any) => {
                    if (row >= totalRowIdx) return;
                    if (col < 1 || col > 12 || isColLocked(col)) return;
                    if (ov === nv) return;
                    const item = allItems[row];
                    if (!item) return;
                    saveBudgetCell(item.contaId, colToMonth(col), Number(nv) || 0, undefined, undefined, item.crId);
                    let rowT = 0; for (let m = 1; m <= 12; m++) rowT += Number(dadosVivos[row][m]) || 0;
                    dadosVivos[row][13] = rowT;
                  });

                  for (let c = 1; c <= 13; c++) {
                    let colT = 0;
                    for (let r = 0; r < totalRowIdx; r++) colT += Number(dadosVivos[r][c]) || 0;
                    dadosVivos[totalRowIdx][c] = colT;
                  }
                }}
              />
              {/* BASE_ZERO: tabela só com inputs por conta — sem legenda de fórmulas */}
            </Card>
            <ComparisonChart configs={configs} getRealizadoValue={getRealizadoValue} getBudgetValue={getBudgetValue} getRealizadoAtualValue={getRealizadoAtualValue} ultimoMesRealizado={ultimoMesRealizado} pkgCrs={isPkg ? pkgCrsList : undefined} pkgBudgetRows={isPkg ? pkgBudgetRowsModelo : undefined} pkgRealAtualRows={isPkg ? pkgRealAtualRowsModelo : undefined} />
          </>
        );
      })()}

      {/* ===== BASE_HISTORICO ===== */}
      {!loading && activeTab === 'BASE_HISTORICO' && (() => {
        const configs = configsByDriver('BASE_HISTORICO');
        if (configs.length === 0) return <Card className="text-center py-8" style={{ color: 'var(--color-text-secondary)' }}>Nenhuma conta mapeada para Base Histórica neste CR</Card>;
        const histFormulaMap = getFormulaOverrideForDriver('BASE_HISTORICO');
        const histGlobalBudget = buildGlobalBudgetMap();
        const histCustomBudget = buildCustomBudgetMap('BASE_HISTORICO', histGlobalBudget);
        const histHasFormula = (contaId: number) => histFormulaMap.has(contaId);
        // Em modo leitura (avaliacao do aprovador, submetido/aprovado, versao fechada)
        // a tabela nao deixa editar, mas as justificativas continuam consultaveis —
        // o aprovador precisa ler o motivo de cada variacao antes de decidir.
        const histJustCount = configs.filter((dc: any) => {
          if (histHasFormula(dc.CONTA_ID)) return false;
          const crId = rowCrId(dc);
          return !!histJustificativas[crId != null ? `${dc.CONTA_ID}_${crId}` : String(dc.CONTA_ID)];
        }).length;
        return (
          <>
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-3 flex-wrap w-full">
                  <div>
                    <CardTitle>Projeção Base Histórica</CardTitle>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {readOnly && (
                      <button
                        type="button"
                        onClick={() => setShowJustConsulta(true)}
                        title="Consultar as justificativas das variações"
                        className="h-8 px-2.5 inline-flex items-center gap-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer"
                        style={{ border: '1px solid var(--color-border)', color: histJustCount > 0 ? 'var(--color-primary)' : 'var(--color-text-secondary)', backgroundColor: 'var(--color-surface)' }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--sidebar-item-active-bg)'; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)'; }}>
                        <MessageSquare size={13} /> Justificativas ({histJustCount})
                      </button>
                    )}
                    {renderConfirmControl('BASE_HISTORICO', 'Base Histórica')}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full" style={{ borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                    <colgroup>
                      <col style={{ width: '25%' }} />
                      <col style={{ width: '12%' }} />
                      <col style={{ width: '10%' }} />
                      <col style={{ width: '13%' }} />
                      <col style={{ width: '17%' }} />
                      <col style={{ width: '23%' }} />
                    </colgroup>
                    <thead>
                      <tr style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>
                        <th className="text-left px-6 py-3 uppercase tracking-wide font-medium">Conta</th>
                        <th className="text-right px-3 py-3 uppercase tracking-wide font-medium">Ano Anterior</th>
                        <th className="text-center px-3 py-3 uppercase tracking-wide font-medium">% Variação</th>
                        <th className="text-right px-3 py-3 uppercase tracking-wide font-medium">Projetado</th>
                        <th className="text-center px-3 py-3 uppercase tracking-wide font-medium">Modo</th>
                        <th className="text-center px-6 py-3 uppercase tracking-wide font-medium">Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {configs.map((dc: any) => {
                        // Base do historico: soma o realizado (ano anterior) APENAS dos
                        // meses que serao projetados (meses abertos). Os meses ja realizados
                        // do ciclo atual nao entram na projecao — assim a Previa bate com a
                        // soma dos meses projetados no Detalhe Mensal abaixo.
                        // Em modo pacote cada linha e um (conta, CR) — premissas e valores por CR.
                        const crId = rowCrId(dc);
                        const hk = crId != null ? `${dc.CONTA_ID}_${crId}` : String(dc.CONTA_ID);
                        let totalReal = 0;
                        for (let m = 1; m <= 12; m++) if (!lockedCalendarMonths.has(m)) totalReal += getRealizadoValue(dc.CONTA_ID, m, crId);

                        const isFormula = histHasFormula(dc.CONTA_ID);
                        const formulaInfo = histFormulaMap.get(dc.CONTA_ID);

                        let totalOrcado = 0;
                        if (isFormula) {
                          for (let m = 1; m <= 12; m++) totalOrcado += getEffectiveBudgetValue(dc.CONTA_ID, m, histFormulaMap, histGlobalBudget, histCustomBudget);
                        } else {
                          for (let m = 1; m <= 12; m++) totalOrcado += getBudgetValue(dc.CONTA_ID, m, crId);
                        }

                        const pctStr = histPercents[hk] ?? '0';
                        const pct = Number(pctStr) || 0;
                        const projetado = isFormula ? totalOrcado : Math.round(totalReal * (1 + pct / 100));
                        const histMode = histModes[hk] || 'sazonalidade';
                        const justificativa = histJustificativas[hk] || '';
                        const hasOrcado = totalOrcado > 0;

                        if (isFormula) {
                          // Linha simplificada: calculada por fórmula, sem controles de premissa
                          return (
                            <tr key={hk} className="transition-colors" style={{ borderTop: '1px solid var(--color-border)' }}
                              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--row-hover)'; }}
                              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = ''; }}>
                              <td className="py-3 px-6" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                <span className="tabular-nums text-[11px]" style={{ color: 'var(--color-primary)' }}>ƒ</span>
                                <span className="tabular-nums text-[11px] ml-2" style={{ color: 'var(--color-text-muted)' }}>{dc.CODIGO}</span>
                                <span className="text-sm ml-2 font-medium" style={{ color: 'var(--color-text)' }}>{dc.CONTA_NOME}{rowCrSuffix(dc)}</span>
                              </td>
                              <td className="py-3 px-3 text-right tabular-nums text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>{fmtBRL(totalReal)}</td>
                              <td className="py-3 px-3 text-center text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>—</td>
                              <td className="py-3 px-3 text-right tabular-nums text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>
                                {fmtBRL(projetado)}
                                <span className="block text-[10px] font-normal mt-0.5" style={{ color: 'var(--color-text-secondary)' }} title={formulaInfo?.formula}>
                                  calculada por fórmula
                                </span>
                              </td>
                              <td className="py-3 px-3 text-center text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md" style={{ backgroundColor: 'var(--color-primary-bg)', color: 'var(--color-primary)' }}>
                                  Fórmula
                                </span>
                              </td>
                              <td className="py-3 px-6">
                                <div className="flex items-center justify-end gap-2">
                                  <span className="font-mono text-[10px] truncate max-w-[160px]" title={formulaInfo?.formula} style={{ color: 'var(--color-text-secondary)' }}>
                                    = {formulaInfo?.formula}
                                  </span>
                                  <span className="inline-flex items-center justify-center w-6 h-6 rounded-full flex-shrink-0" style={{ backgroundColor: 'rgba(16, 185, 129, 0.1)', color: '#10b981' }}>
                                    <CheckCircle size={12} />
                                  </span>
                                </div>
                              </td>
                            </tr>
                          );
                        }

                        return (
                          <tr key={hk} className="transition-colors" style={{ borderTop: '1px solid var(--color-border)' }}
                            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--row-hover)'; }}
                            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = ''; }}>
                            <td className="py-3 px-6" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              <span className="tabular-nums text-[11px]" style={{ color: 'var(--color-text-muted)' }}>{dc.CODIGO}</span>
                              <span className="text-sm ml-2 font-medium" style={{ color: 'var(--color-text)' }}>{dc.CONTA_NOME}{rowCrSuffix(dc)}</span>
                            </td>
                            <td className="py-3 px-3 text-right tabular-nums text-sm font-medium" style={{ color: 'var(--color-text)' }}>{fmtBRL(totalReal)}</td>
                            <td className="py-3 px-3 text-center">
                              <input type="text" inputMode="numeric"
                                disabled={readOnly}
                                className="w-full max-w-[64px] text-center text-sm h-8 rounded-md focus:outline-none focus:ring-1 mx-auto block"
                                style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', color: 'var(--color-text)', opacity: readOnly ? 0.6 : 1, cursor: readOnly ? 'not-allowed' : undefined }}
                                value={pctStr}
                                placeholder="0"
                                onFocus={(e) => { e.target.select(); }}
                                onChange={(e) => {
                                  const val = e.target.value.replace(/[^0-9.\-]/g, '');
                                  setHistPercents(prev => ({ ...prev, [hk]: val }));
                                }}
                                onBlur={(e) => {
                                  const val = Number(e.target.value) || 0;
                                  saveHistPremissa(dc.CONTA_ID, val, histMode, justificativa);
                                }}
                                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
                            </td>
                            <td className="py-3 px-3 text-right tabular-nums text-sm font-semibold" style={{ color: 'var(--color-primary)' }}>
                              {fmtBRL(projetado)}
                              {pct !== 0 && (
                                <span className={`block text-[10px] font-normal mt-0.5 ${pct > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                                  {pct > 0 ? '+' : ''}{fmtBRL(projetado - totalReal)}
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-3 text-center">
                              <div style={{ minWidth: '145px' }}>
                                <Select
                                  disabled={readOnly}
                                  options={[
                                    { value: 'sazonalidade', label: 'Sazonalidade' },
                                    { value: 'igual', label: 'Igual nos meses' },
                                  ]}
                                  value={histMode}
                                  onChange={(v) => {
                                    const newMode = v as 'sazonalidade' | 'igual';
                                    setHistModes(prev => ({ ...prev, [hk]: newMode }));
                                    saveHistPremissa(dc.CONTA_ID, pct, newMode, justificativa);
                                  }}
                                />
                              </div>
                            </td>
                            <td className="py-3 px-6">
                              <div className="grid gap-1.5" style={{ gridTemplateColumns: '1fr 1fr auto', alignItems: 'center' }}>
                                {/* Em modo leitura o botao continua abrindo o modal (so consulta):
                                    sem isso o aprovador via "Justificado" e nao conseguia ler o texto. */}
                                <button
                                  disabled={readOnly && !justificativa}
                                  onClick={() => { setJustContaId(dc.CONTA_ID); setJustHk(hk); setJustText(justificativa); setShowJustModal(true); }}
                                  title={readOnly ? (justificativa ? 'Ver justificativa da variação' : 'O gestor não justificou esta variação') : undefined}
                                  className="h-8 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap"
                                  style={{ border: '1px solid var(--color-border)', color: justificativa ? 'var(--color-primary)' : 'var(--color-text-secondary)', backgroundColor: justificativa ? 'var(--sidebar-item-active-bg)' : 'var(--color-surface)', opacity: readOnly && !justificativa ? 0.5 : 1, cursor: readOnly && !justificativa ? 'not-allowed' : 'pointer', pointerEvents: readOnly && !justificativa ? 'none' : undefined }}>
                                  {readOnly ? (justificativa ? 'Ver justificativa' : 'Sem justificativa') : (justificativa ? 'Justificado' : 'Justificar')}
                                </button>
                                <button disabled={readOnly} onClick={() => applyHistorico(dc.CONTA_ID, pct, histMode, crId)}
                                  className="h-8 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap"
                                  style={{ border: '1px solid var(--color-primary)', color: 'var(--color-primary)', backgroundColor: 'var(--color-surface)', opacity: readOnly ? 0.5 : 1, cursor: readOnly ? 'not-allowed' : 'pointer', pointerEvents: readOnly ? 'none' : undefined }}
                                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--sidebar-item-active-bg)'; }}
                                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)'; }}>
                                  Aplicar
                                </button>
                                <span className="inline-flex items-center justify-center w-6 h-6 rounded-full flex-shrink-0"
                                  style={hasOrcado
                                    ? { backgroundColor: 'rgba(16, 185, 129, 0.1)', color: '#10b981' }
                                    : { backgroundColor: 'var(--bg-muted)', color: 'var(--color-text-muted)' }}>
                                  <CheckCircle size={12} />
                                </span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Footer — bulk actions */}
                <div className="flex items-center gap-2 pt-3 mt-3" style={{ borderTop: '1px solid var(--color-border)' }}>
                  <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>Aplicar em todas:</span>
                  <input type="text" inputMode="numeric"
                    disabled={readOnly}
                    className="w-16 text-center text-sm h-8 rounded-md focus:outline-none focus:ring-1"
                    style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', color: 'var(--color-text)', opacity: readOnly ? 0.6 : 1, cursor: readOnly ? 'not-allowed' : undefined }}
                    placeholder="5"
                    value={histPercent}
                    onFocus={(e) => { e.target.select(); }}
                    onChange={(e) => setHistPercent(e.target.value.replace(/[^0-9.\-]/g, ''))}
                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
                  <button
                    disabled={readOnly}
                    onClick={async () => {
                      const pct = Number(histPercent) || 0;
                      let aplicadas = 0;
                      for (const dc of configs) {
                        if (histHasFormula(dc.CONTA_ID)) continue;
                        const crId = rowCrId(dc);
                        const hk = crId != null ? `${dc.CONTA_ID}_${crId}` : String(dc.CONTA_ID);
                        const histMode = histModes[hk] || 'sazonalidade';
                        await applyHistorico(dc.CONTA_ID, pct, histMode, crId, { silencioso: true });
                        setHistPercents(prev => ({ ...prev, [hk]: String(pct) }));
                        aplicadas++;
                      }
                      addToast('success', aplicadas === 1 ? 'Projeção aplicada em 1 conta' : `Projeção aplicada em ${aplicadas} contas`);
                    }}
                    className="h-8 px-3 text-xs font-medium rounded-md transition-colors"
                    style={{ border: '1px solid var(--color-primary)', color: 'var(--color-primary)', backgroundColor: 'var(--color-surface)', opacity: readOnly ? 0.5 : 1, cursor: readOnly ? 'not-allowed' : 'pointer', pointerEvents: readOnly ? 'none' : undefined }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--sidebar-item-active-bg)'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--color-surface)'; }}>
                    Aplicar % Único
                  </button>
                  <button
                    disabled={readOnly}
                    onClick={async () => {
                      let aplicadas = 0;
                      for (const dc of configs) {
                        if (histHasFormula(dc.CONTA_ID)) continue;
                        const crId = rowCrId(dc);
                        const hk = crId != null ? `${dc.CONTA_ID}_${crId}` : String(dc.CONTA_ID);
                        const pct = Number(histPercents[hk] || '0');
                        const histMode = histModes[hk] || 'sazonalidade';
                        await applyHistorico(dc.CONTA_ID, pct, histMode, crId, { silencioso: true });
                        aplicadas++;
                      }
                      addToast('success', aplicadas === 1 ? 'Projeção aplicada em 1 conta' : `Projeção aplicada em ${aplicadas} contas`);
                    }}
                    className="h-8 px-3 text-xs font-medium rounded-md transition-colors"
                    style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', backgroundColor: 'var(--color-surface)', opacity: readOnly ? 0.5 : 1, cursor: readOnly ? 'not-allowed' : 'pointer', pointerEvents: readOnly ? 'none' : undefined }}>
                    Aplicar Individuais
                  </button>
                </div>
              </CardContent>
            </Card>

            {/* Detail grid — spreadsheet with toggle Real/Orçado */}
            {/* Uma moldura so: o Card. Ver a nota no Lancamento Base Zero. */}
            <Card className="overflow-hidden">
              <CardHeader>
                <div className="flex items-center justify-between gap-3 flex-wrap w-full">
                  <div>
                    <CardTitle>Detalhe Mensal</CardTitle>
                  </div>
                  <button
                    onClick={() => { setShowHistReal(prev => !prev); setTimeout(() => renderHot('BASE_HISTORICO'), 100); }}
                    className="inline-flex items-center justify-center gap-2 font-medium rounded-lg transition-all duration-200 cursor-pointer active:scale-[0.97] focus:outline-none focus:ring-2 focus:ring-offset-2 border px-3 py-1.5 text-sm"
                    style={{
                      backgroundColor: 'var(--color-surface)',
                      borderColor: 'var(--color-border)',
                      color: showHistReal ? 'var(--color-primary)' : 'var(--color-text)',
                      boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
                    }}>
                    <Eye size={14} />
                    {showHistReal ? 'Real + Orçado' : 'Mostrar Real'}
                  </button>
                </div>
              </CardHeader>
              {(() => {
                // Uma so montagem para os dois modos: muda o layout do padrao, nao
                // a grade. A linha de Total nao existia aqui e passa a existir —
                // e parte do padrao de modelo.
                const dados = buildHistoricoData(configs, showHistReal, histFormulaMap, histGlobalBudget, histCustomBudget);
                const nColunas = showHistReal ? 27 : 14;
                const totalRow: any[] = ['Total'];
                for (let c = 1; c < nColunas; c++) {
                  totalRow.push(dados.reduce((s: number, r: any[]) => s + (Number(r[c]) || 0), 0));
                }
                dados.push(totalRow);
                const totalRowIdx = dados.length - 1;

                const rowMeta: { kind: 'premise' | 'formula' | 'account' | 'total'; label: string; formulaLabel?: string }[] =
                  configs.map((dc: any) => ({
                    kind: histHasFormula(dc.CONTA_ID) ? 'formula' : 'account',
                    label: dc.CODIGO + ' - ' + dc.CONTA_NOME + rowCrSuffix(dc),
                    formulaLabel: histFormulaMap.get(dc.CONTA_ID)?.formula,
                  }));
                rowMeta.push({ kind: 'total', label: 'Total' });

                return (
                  <GradeModelo
                    key={showHistReal ? 'hist-real' : 'hist-orcado'}
                    layout={showHistReal ? 'real-orcado' : 'meses'}
                    moldura={false}
                    dados={dados}
                    rowMeta={rowMeta}
                    colHeaders={showHistReal ? MONTHS_LOWER : colHeaders14}
                    colunaTravada={isColLocked}
                    somenteLeitura={readOnly}
                    rotuloOrcado={rotuloOrcado}
                    aoAlterar={(changes: any, source: string, dadosVivos: any[][]) => {
                      if (!changes || source === 'loadData' || readOnly) return;
                      changes.forEach(([row, col, ov, nv]: any) => {
                        if (row >= totalRowIdx || ov === nv) return;
                        const dcRow = configs[row];
                        if (!dcRow || histHasFormula(dcRow.CONTA_ID)) return;
                        // No pareado so a coluna par (Orcado) grava; a impar e o
                        // Real do ano anterior. No de meses, grava a coluna do mes.
                        const mesPos = showHistReal
                          ? (col >= 2 && col <= 24 && col % 2 === 0 ? col / 2 : 0)
                          : (col >= 1 && col <= 12 ? col : 0);
                        if (mesPos === 0 || isColLocked(mesPos)) return;
                        saveBudgetCell(dcRow.CONTA_ID, colToMonth(mesPos), Number(nv) || 0, undefined, undefined, rowCrId(dcRow));

                        const colTotal = showHistReal ? COL_TOTAL_ORCADO : 13;
                        let t = 0;
                        for (let m = 1; m <= 12; m++) t += Number(dadosVivos[row][showHistReal ? m * 2 : m]) || 0;
                        dadosVivos[row][colTotal] = t;
                      });
                      for (let c = 1; c < nColunas; c++) {
                        let colT = 0;
                        for (let r = 0; r < totalRowIdx; r++) colT += Number(dadosVivos[r][c]) || 0;
                        dadosVivos[totalRowIdx][c] = colT;
                      }
                    }}
                  />
                );
              })()}
            </Card>
            <ComparisonChart configs={configs} getRealizadoValue={getRealizadoValue} getBudgetValue={getBudgetValue} getRealizadoAtualValue={getRealizadoAtualValue} ultimoMesRealizado={ultimoMesRealizado} pkgCrs={isPkg ? pkgCrsList : undefined} pkgBudgetRows={isPkg ? pkgBudgetRowsModelo : undefined} pkgRealAtualRows={isPkg ? pkgRealAtualRowsModelo : undefined} />
          </>
        );
      })()}

      {/* ===== RECEITA (apenas quando o driver RECEITA é realmente nativo) ===== */}
      {!loading && activeTab === 'RECEITA' && isNativeDriverName('RECEITA') && (() => {
        const allReceitaConfigs = configsByDriver('RECEITA');
        if (allReceitaConfigs.length === 0) return <Card className="text-center py-8" style={{ color: 'var(--color-text-secondary)' }}>Nenhuma conta mapeada para Receita neste CR</Card>;

        // Separa contas de receita (TIPO=RECEITA) das contas de imposto (TIPO=IMPOSTO).
        // Qualquer outra conta mapeada para o driver RECEITA cai junto com as receitas e abre por produtos.
        const configs = allReceitaConfigs.filter((dc: any) => dc.TIPO !== 'IMPOSTO');
        const impostoConfigs = allReceitaConfigs.filter((dc: any) => dc.TIPO === 'IMPOSTO');

        // Override por formula configurada em /modelagem: contas marcadas TIPO=FORMULA
        // pulam o fluxo Ticket x Volumetria e usam evaluateFormula.
        const recFormulaMap = getFormulaOverrideForDriver('RECEITA');
        const recGlobalBudget = buildGlobalBudgetMap();
        const recCustomBudget = buildCustomBudgetMap('RECEITA', recGlobalBudget);
        const recHasFormula = (contaId: number) => recFormulaMap.has(contaId);

        // A regra do imposto e a formula da linha no modelo — nao ha mais
        // percentual vindo de uma tabela paralela. Imposto sem formula continua
        // sendo lancamento manual do gestor.
        const getRegraImposto = (contaId: number) => recFormulaMap.get(contaId)?.formula || '';

        return (
          <>
            {/* Uma moldura so: o Card. Ver a nota no Lancamento Base Zero.
                A secao de Impostos continua num CardContent proprio, abaixo da
                grade — ela e um bloco de conteudo, nao a tabela. */}
            <Card className="overflow-hidden">
              <CardHeader>
                <div className="flex items-center justify-between gap-3 flex-wrap w-full">
                  <div>
                    <CardTitle>Lançamento de Receita</CardTitle>
                  </div>
                  {renderConfirmControl('RECEITA', 'Receita')}
                </div>
              </CardHeader>
                  {(() => {
                    // UMA grade so: contas de input (editaveis no Orcado), contas com
                    // formula (calculadas, travadas em todos os meses) e o Total.
                    // Antes as contas com formula ficavam em cards acima da tabela e o
                    // total num card abaixo — o padrao da grade nao usa blocos soltos.
                    const contasInput = configs.filter((dc: any) => !recHasFormula(dc.CONTA_ID));
                    // Em modo pacote as configs vem por (conta, CR): dedup por conta,
                    // porque a linha de formula mostra o valor agregado.
                    const contasFormula = configs.filter((dc: any, i: number) =>
                      recHasFormula(dc.CONTA_ID) && configs.findIndex((o: any) => o.CONTA_ID === dc.CONTA_ID) === i);
                    if (contasInput.length === 0 && contasFormula.length === 0) return null;

                    // Tipo declarado aqui de proposito: o tsconfig usa
                    // verbatimModuleSyntax e importar tipo de outro arquivo quebra em runtime.
                    const rowMeta: { kind: 'account' | 'formula' | 'total'; label: string; formulaLabel?: string; isOverride?: boolean }[] = [];
                    const tableData: any[][] = [];

                    const totalDaLinha = (row: any[]) => row.slice(1).reduce((s: number, v: number) => s + (Number(v) || 0), 0);

                    for (const dc of contasInput) {
                      const crId = rowCrId(dc);
                      const label = `${dc.CODIGO} - ${dc.CONTA_NOME}${rowCrSuffix(dc)}`;
                      rowMeta.push({ kind: 'account', label });
                      const row: any[] = [label];
                      for (let i = 0; i < 12; i++) {
                        const m = fiscalMonthNumbers[i];
                        row.push(lockedCalendarMonths.has(m) ? getRealizadoAtualValue(dc.CONTA_ID, m, crId) : getBudgetValue(dc.CONTA_ID, m, crId));
                      }
                      row.push(totalDaLinha(row));
                      tableData.push(row);
                    }

                    for (const dc of contasFormula) {
                      const info = recFormulaMap.get(dc.CONTA_ID);
                      const label = `${dc.CODIGO} - ${dc.CONTA_NOME}`;
                      rowMeta.push({ kind: 'formula', label, formulaLabel: info?.formula, isOverride: info?.isOverride });
                      const row: any[] = [label];
                      for (let i = 0; i < 12; i++) {
                        row.push(getEffectiveBudgetValue(dc.CONTA_ID, fiscalMonthNumbers[i], recFormulaMap, recGlobalBudget, recCustomBudget));
                      }
                      row.push(totalDaLinha(row));
                      tableData.push(row);
                    }

                    const totRow: any[] = ['Total'];
                    for (let c = 1; c <= 13; c++) totRow.push(tableData.reduce((s: number, r: any) => s + (Number(r[c]) || 0), 0));
                    tableData.push(totRow);
                    rowMeta.push({ kind: 'total', label: 'Total' });
                    const totalRowIdx = tableData.length - 1;

                    return (
                      <GradeModelo
                        dados={tableData}
                        rowMeta={rowMeta}
                        colHeaders={colHeaders14}
                        colunaTravada={isColLocked}
                        somenteLeitura={readOnly}
                        rotuloOrcado={rotuloOrcado}
                        moldura={false}
                        aoAlterar={(changes: any, source: string, dadosVivos: any[][]) => {
                          if (!changes || source === 'loadData' || readOnly) return;
                          changes.forEach(([row, col, ov, nv]: any) => {
                            // Indice visual = fisico aqui: a grade nao ordena nem move linhas.
                            // So as linhas de input gravam — formula e Total ficam de fora.
                            if (row >= contasInput.length) return;
                            if (col < 1 || col > 12 || isColLocked(col)) return;
                            if (ov === nv) return;
                            const dc = contasInput[row];
                            if (!dc) return;
                            saveBudgetCell(dc.CONTA_ID, colToMonth(col), Number(nv) || 0, undefined, undefined, rowCrId(dc));
                            dadosVivos[row][13] = totalDaLinha(dadosVivos[row]);
                          });
                          // Totais recalculados sobre o array VIVO da grade: o
                          // tableData deste render ainda tem o valor de antes da
                          // edicao, porque a gravacao so volta do backend depois.
                          for (let c = 1; c <= 13; c++) {
                            let colT = 0;
                            for (let r = 0; r < totalRowIdx; r++) colT += Number(dadosVivos[r][c]) || 0;
                            dadosVivos[totalRowIdx][c] = colT;
                          }
                        }}
                      />
                    );
                  })()}

                  {/* ===== Impostos sobre Receita (expandable section) ===== */}
                  {impostoConfigs.length > 0 && (
                    <CardContent>
                    <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
                      <div
                        className="flex items-center justify-between px-4 py-3 cursor-pointer transition-colors"
                        style={{ backgroundColor: impostosExpanded ? 'var(--bg-muted)' : 'var(--color-surface)' }}
                        onClick={() => setImpostosExpanded(!impostosExpanded)}
                      >
                        <div className="flex items-center gap-3">
                          <span style={{ transform: impostosExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>
                            <ChevronRight size={16} />
                          </span>
                          <span className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>
                            Impostos sobre Receita
                          </span>
                          <Badge variant="warning">{impostoConfigs.length} {impostoConfigs.length === 1 ? 'imposto' : 'impostos'}</Badge>
                        </div>
                        <span className="text-sm font-semibold" style={{ color: '#ef4444' }}>
                          {formatCurrency(impostoConfigs.reduce((s: number, dc: any) => {
                            let t = 0;
                            for (let i = 0; i < 12; i++) {
                              const cm = fiscalMonthNumbers[i];
                              t += lockedCalendarMonths.has(cm) ? getRealizadoAtualValue(dc.CONTA_ID, cm, rowCrId(dc)) : getBudgetValue(dc.CONTA_ID, cm, rowCrId(dc));
                            }
                            return s + t;
                          }, 0))}
                        </span>
                      </div>

                      {impostosExpanded && (
                        <div className="px-4 pb-4 space-y-3" style={{ backgroundColor: 'var(--color-surface)' }}>
                          <p className="text-xs pt-2" style={{ color: 'var(--color-text-secondary)' }}>
                            A regra de cada imposto é a fórmula da linha no modelo de Receita, e a alíquota
                            vem da premissa citada nela. Os valores são gravados ao confirmar a Receita —
                            até lá, o que aparece aqui é o último valor confirmado.
                          </p>

                          {/* Tax table */}
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
                              <thead>
                                <tr style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>
                                  <th className="text-left px-6 py-3 uppercase tracking-wide font-medium" style={{ minWidth: 200 }}>Imposto</th>
                                  <th className="text-left px-3 py-3 uppercase tracking-wide font-medium" style={{ minWidth: 180 }}>Regra</th>
                                  {monthsShort.map((m: string) => (
                                    <th key={m} className="text-right px-3 py-3 uppercase tracking-wide font-medium" style={{ minWidth: 90 }}>{m}</th>
                                  ))}
                                  <th className="text-right px-6 py-3 uppercase tracking-wide font-medium" style={{ minWidth: 110 }}>Total</th>
                                </tr>
                              </thead>
                              <tbody>
                                {impostoConfigs.map((dc: any) => {
                                  const crId = rowCrId(dc);
                                  const regra = getRegraImposto(dc.CONTA_ID);
                                  let totalAnual = 0;
                                  const monthValues = [];
                                  for (let i = 0; i < 12; i++) {
                                    const cm = fiscalMonthNumbers[i];
                                    const val = lockedCalendarMonths.has(cm)
                                      ? getRealizadoAtualValue(dc.CONTA_ID, cm, crId)
                                      : getBudgetValue(dc.CONTA_ID, cm, crId);
                                    monthValues.push(val);
                                    totalAnual += val;
                                  }
                                  return (
                                    <tr key={`${dc.CONTA_ID}_${dc.CR_ID ?? ''}`} style={{ borderTop: '1px solid var(--color-border)' }}>
                                      <td className="py-3 px-6 text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                                        {dc.CODIGO} - {dc.CONTA_NOME}{rowCrSuffix(dc)}
                                      </td>
                                      <td className="py-3 px-3 text-left">
                                        {regra ? (
                                          <code className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{regra}</code>
                                        ) : (
                                          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>lançamento manual</span>
                                        )}
                                      </td>
                                      {monthValues.map((val, i) => (
                                        <td key={i} className="py-3 px-3 text-right tabular-nums text-sm" style={{ color: val > 0 ? '#ef4444' : 'var(--color-text-secondary)' }}>
                                          {formatCurrency(val)}
                                        </td>
                                      ))}
                                      <td className="py-3 px-6 text-right tabular-nums text-sm font-semibold" style={{ color: totalAnual > 0 ? '#ef4444' : 'var(--color-text-secondary)' }}>
                                        {formatCurrency(totalAnual)}
                                      </td>
                                    </tr>
                                  );
                                })}
                                {/* Totals row */}
                                <tr style={{ borderTop: '1px solid var(--color-border)', backgroundColor: 'var(--bg-muted)' }}>
                                  <td className="py-3 px-6 font-bold text-sm" style={{ color: 'var(--color-text)' }} colSpan={2}>
                                    Total Impostos
                                  </td>
                                  {monthsShort.map((_: string, i: number) => {
                                    const cm = fiscalMonthNumbers[i];
                                    let totalMes = 0;
                                    for (const dc of impostoConfigs) {
                                      totalMes += lockedCalendarMonths.has(cm)
                                        ? getRealizadoAtualValue(dc.CONTA_ID, cm, rowCrId(dc))
                                        : getBudgetValue(dc.CONTA_ID, cm, rowCrId(dc));
                                    }
                                    return (
                                      <td key={i} className="py-3 px-3 text-right tabular-nums text-sm font-bold" style={{ color: totalMes > 0 ? '#ef4444' : 'var(--color-text-secondary)' }}>
                                        {formatCurrency(totalMes)}
                                      </td>
                                    );
                                  })}
                                  <td className="py-3 px-6 text-right tabular-nums text-sm font-bold" style={{ color: '#ef4444' }}>
                                    {formatCurrency(impostoConfigs.reduce((s: number, dc: any) => {
                                      let t = 0;
                                      for (let i = 0; i < 12; i++) {
                                        const cm = fiscalMonthNumbers[i];
                                        t += lockedCalendarMonths.has(cm)
                                          ? getRealizadoAtualValue(dc.CONTA_ID, cm, rowCrId(dc))
                                          : getBudgetValue(dc.CONTA_ID, cm, rowCrId(dc));
                                      }
                                      return s + t;
                                    }, 0))}
                                  </td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                    </CardContent>
                  )}
            </Card>

            <ComparisonChart configs={configs} getRealizadoValue={getRealizadoValue} getBudgetValue={getBudgetValue} getRealizadoAtualValue={getRealizadoAtualValue} ultimoMesRealizado={ultimoMesRealizado} pkgCrs={isPkg ? pkgCrsList : undefined} pkgBudgetRows={isPkg ? pkgBudgetRowsModelo : undefined} pkgRealAtualRows={isPkg ? pkgRealAtualRowsModelo : undefined} />
          </>
        );
      })()}

      {/* ===== PESSOAL ===== */}
      {!loading && activeTab === 'PESSOAL' && (() => {
        const pessoalConfigs = configsByDriver('PESSOAL');
        const hasProjection = contratacoes.length > 0 || headcountData.some(row => row.some(v => v > 0));
        const activeDissidios = dissidios.filter((d: any) => colaboradores.some((c: any) => c.EMPRESA_ID === d.EMPRESA_ID));
        const hasOrcamento = orcamentoPessoal.length > 0;

        const toggleProjecao = (key: string) => {
          setExpandedProjecao(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
        };

        return (
          <>
            {/* ── PESSOAL — mesmo padrão Card do Receita ── */}
            <Card>
              <CardHeader>
                <div className="w-full">
                  {/* Linha 1: titulo a esquerda, todos os botoes a direita (mesma linha sempre) */}
                  <div className="flex items-center justify-between gap-3 w-full">
                    <CardTitle>Orçamento de Pessoal</CardTitle>
                    <div className="flex items-center gap-2 flex-wrap justify-end shrink-0">
                      <button onClick={() => setShowPremissasModal(true)}
                        className="inline-flex items-center justify-center gap-2 font-medium rounded-lg transition-all duration-200 cursor-pointer active:scale-[0.97] focus:outline-none focus:ring-2 focus:ring-offset-2 border px-3 py-1.5 text-sm"
                        style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)', boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)' }}>
                        <Eye size={14} /> Premissas
                      </button>
                      {!readOnly && (
                      <button onClick={handleCalculatePayrollClick} disabled={(colaboradores.length === 0 && !hasProjection) || calculating}
                        className="inline-flex items-center justify-center gap-2 font-medium rounded-lg transition-all duration-200 cursor-pointer active:scale-[0.97] focus:outline-none focus:ring-2 focus:ring-offset-2 border px-3 py-1.5 text-sm"
                        style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)', boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)' }}>
                        {calculating ? <span className="animate-spin">...</span> : <Calculator size={14} />}
                        {calculating ? 'Calculando...' : 'Calcular Folha'}
                      </button>
                      )}
                      {renderConfirmControl('PESSOAL', 'Pessoal')}
                    </div>
                  </div>
                  {/* Linha 2: chips de dissidio */}
                  {activeDissidios.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {activeDissidios.map((d: any) => (
                        <span key={d.ID} className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: 'var(--sidebar-item-active-bg)', color: 'var(--color-primary)' }}>
                          {d.EMPRESA_NOME}: dissídio {d.PERCENTUAL}% em {MONTHS_LOWER[d.MES_APLICACAO - 1]}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">

                  {/* ── SECTION: Quadro Atual — accordion style ── */}
                  <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border-light, var(--color-border))' }}>
                    <div className="flex items-center justify-between px-4 py-2.5 cursor-pointer transition-colors"
                      style={{ backgroundColor: expandedProjecao.has('section-quadro') ? '#f8faff' : 'var(--color-surface)' }}
                      onClick={() => toggleProjecao('section-quadro')}>
                      <div className="flex items-center gap-3">
                        <span style={{ transform: expandedProjecao.has('section-quadro') ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>
                          <ChevronRight size={16} />
                        </span>
                        <span className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>Quadro Atual</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{ backgroundColor: 'var(--sidebar-item-active-bg)', color: 'var(--color-primary)' }}>{colaboradores.length}</span>
                      </div>
                    </div>
                    {expandedProjecao.has('section-quadro') && (
                      <div className="px-4 pb-3 pt-1" style={{ backgroundColor: 'var(--color-surface)' }}>
                        {colaboradores.length === 0 ? (
                          <p className="text-center py-4 text-xs" style={{ color: 'var(--color-text-muted)' }}>Nenhum colaborador neste CR</p>
                        ) : (
                          <div>
                            {colaboradores.map((col: any, colIdx: number) => {
                              const salario = Number(col.SALARIO) || 0;
                              const aumento = aumentosSalariais.find((a: any) => a.COLABORADOR_ID === col.ID);
                              const desligamento = desligamentosProjetados.find((item: any) => Number(item.COLABORADOR_ID) === Number(col.ID));
                              return (
                                <div key={col.ID}>
                                  {colIdx > 0 && <div style={{ height: 1, backgroundColor: 'var(--border-light, var(--color-border))', opacity: 0.6 }} />}
                                  <div className="flex items-center py-2.5" style={{ minHeight: 40 }}>
                                    {/* Left: Name + tags */}
                                    <div className="flex items-center gap-2 min-w-0 flex-1">
                                      <span className="text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>{col.NOME}</span>
                                      <span className="text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0" style={{ backgroundColor: 'var(--sidebar-item-active-bg)', color: 'var(--color-primary)' }}>{col.TIPO_CONTRATO}</span>
                                      {col.CARGO && <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{col.CARGO}</span>}
                                    </div>
                                    {/* Right: Salary + personnel actions — fixed width for alignment */}
                                    <div className="flex items-center shrink-0 flex-wrap" style={{ width: 420, maxWidth: '100%', justifyContent: 'flex-end', gap: 12 }}>
                                      <span className="text-sm font-semibold tabular-nums" style={{ color: 'var(--color-text)', minWidth: 90, textAlign: 'right' }}>{formatCurrency(salario)}</span>
                                      <div style={{ width: 140 }} className="flex items-center justify-end">
                                        {aumento ? (
                                          <div className="flex items-center gap-1.5">
                                            <span className="flex items-center gap-0.5 text-[11px] font-medium text-emerald-600 whitespace-nowrap">
                                              <TrendingUp size={11} /> +{aumento.PERCENTUAL}% {MONTHS_LOWER[Number(aumento.MES_APLICACAO) - 1]}
                                            </span>
                                            {!readOnly && (
                                              <>
                                                <button className="p-0.5 rounded" style={{ color: 'var(--color-text-muted)' }} title="Editar"
                                                  onClick={() => { setDesligamentoColabId(null); setAumentoColabId(col.ID); setAumentoForm({ PERCENTUAL: String(aumento.PERCENTUAL), MES_APLICACAO: String(aumento.MES_APLICACAO), MOTIVO: aumento.MOTIVO || '' }); }}>
                                                  <CalendarClock size={12} />
                                                </button>
                                                <button className="p-0.5 rounded text-red-400 hover:text-red-500" title="Remover" onClick={() => deleteAumentoInline(aumento.ID)}>
                                                  <Trash2 size={12} />
                                                </button>
                                              </>
                                            )}
                                          </div>
                                        ) : !readOnly ? (
                                          <button onClick={() => { setDesligamentoColabId(null); setAumentoColabId(col.ID); setAumentoForm({ PERCENTUAL: '', MES_APLICACAO: '1', MOTIVO: '' }); }}
                                            className="flex items-center gap-0.5 text-[11px] font-medium transition-colors whitespace-nowrap"
                                            style={{ color: 'var(--color-primary)' }}>
                                            <Plus size={12} /> Aumento
                                          </button>
                                        ) : null}
                                      </div>
                                      <div style={{ width: 145 }} className="flex items-center justify-end">
                                        {desligamento ? (
                                          <div className="flex items-center gap-1.5">
                                            <span className="flex items-center gap-1 text-[11px] font-medium text-red-500 whitespace-nowrap" title="Custo zerado a partir de">
                                              <UserMinus size={11} /> Saída em {MONTHS_LOWER[Number(desligamento.MES_DESLIGAMENTO) - 1]}
                                            </span>
                                            {!readOnly && (
                                              <>
                                                <button className="p-0.5 rounded" style={{ color: 'var(--color-text-muted)' }} title="Editar desligamento"
                                                  onClick={() => { setAumentoColabId(null); setDesligamentoColabId(col.ID); setDesligamentoForm({ MES_DESLIGAMENTO: String(desligamento.MES_DESLIGAMENTO) }); }}>
                                                  <CalendarClock size={12} />
                                                </button>
                                                <button className="p-0.5 rounded text-red-400 hover:text-red-500" title="Remover desligamento" onClick={() => deleteDesligamentoInline(desligamento.ID)}>
                                                  <Trash2 size={12} />
                                                </button>
                                              </>
                                            )}
                                          </div>
                                        ) : !readOnly ? (
                                          <button onClick={() => { setAumentoColabId(null); setDesligamentoColabId(col.ID); setDesligamentoForm({ MES_DESLIGAMENTO: '1' }); }}
                                            className="flex items-center gap-1 text-[11px] font-medium text-red-500 transition-colors whitespace-nowrap">
                                            <UserMinus size={12} /> Demissão
                                          </button>
                                        ) : null}
                                      </div>
                                    </div>
                                  </div>
                                  {/* Inline aumento form — subtle container */}
                                  {aumentoColabId === col.ID && (
                                    <div className="pb-2.5 animate-fadeIn">
                                      <div className="flex gap-3 items-end p-2.5 rounded-md" style={{ border: '1px solid var(--border-light, var(--color-border))' }}>
                                        <div style={{ width: 70 }}>
                                          <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>%</label>
                                          <input type="number" className="w-full text-xs rounded-md px-2 focus:outline-none focus:ring-1"
                                            style={{ height: 30, border: '1px solid var(--border-light, var(--color-border))', backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' }}
                                            placeholder="%" value={aumentoForm.PERCENTUAL} onChange={e => setAumentoForm({ ...aumentoForm, PERCENTUAL: e.target.value })} />
                                        </div>
                                        <div style={{ width: 100 }}>
                                          <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>Mês</label>
                                          <Select
                                            options={MONTHS_LOWER.map((m, i) => ({ value: String(i + 1), label: m }))}
                                            value={String(aumentoForm.MES_APLICACAO)}
                                            onChange={(v) => setAumentoForm({ ...aumentoForm, MES_APLICACAO: v })}
                                            placeholder="Mês..."
                                          />
                                        </div>
                                        <div className="flex-1">
                                          <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>Motivo</label>
                                          <input className="w-full text-xs rounded-md px-2 focus:outline-none focus:ring-1"
                                            style={{ height: 30, border: '1px solid var(--border-light, var(--color-border))', backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' }}
                                            placeholder="Promoção, mérito..." value={aumentoForm.MOTIVO} onChange={e => setAumentoForm({ ...aumentoForm, MOTIVO: e.target.value })} />
                                        </div>
                                        <button onClick={saveAumentoInline} disabled={!aumentoForm.PERCENTUAL}
                                          className="text-[11px] font-medium rounded-md text-white disabled:opacity-50" style={{ height: 30, padding: '0 10px', backgroundColor: 'var(--color-primary)' }}>Salvar</button>
                                        <button onClick={() => setAumentoColabId(null)} className="text-[11px] rounded-md" style={{ height: 30, padding: '0 8px', border: '1px solid var(--border-light, var(--color-border))', color: 'var(--color-text-muted)' }}>✕</button>
                                      </div>
                                    </div>
                                  )}
                                  {desligamentoColabId === col.ID && (
                                    <div className="pb-2.5 animate-fadeIn">
                                      <div className="flex gap-3 items-end p-2.5 rounded-md" style={{ border: '1px solid var(--border-light, var(--color-border))' }}>
                                        <div style={{ width: 190 }}>
                                          <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>Custo zerado a partir de</label>
                                          <Select
                                            options={MONTHS_LOWER.map((month, index) => ({ value: String(index + 1), label: month }))}
                                            value={desligamentoForm.MES_DESLIGAMENTO}
                                            onChange={(value) => setDesligamentoForm({ MES_DESLIGAMENTO: value })}
                                          />
                                        </div>
                                        <p className="text-xs flex-1 pb-1" style={{ color: 'var(--color-text-secondary)' }}>
                                          Salário, benefícios e encargos serão zerados deste mês em diante.
                                        </p>
                                        <button onClick={saveDesligamentoInline}
                                          className="text-[11px] font-medium rounded-md text-white" style={{ height: 30, padding: '0 10px', backgroundColor: 'var(--color-primary)' }}>Salvar e recalcular</button>
                                        <button onClick={() => setDesligamentoColabId(null)} className="text-[11px] rounded-md" style={{ height: 30, padding: '0 8px', border: '1px solid var(--border-light, var(--color-border))', color: 'var(--color-text-muted)' }}>Cancelar</button>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* ── SECTION: Contratações Projetadas — grade cargo x mês (accordion) ──
                      A grade segue o padrao de modelo (GradeModelo / lib/model-grid):
                      Conta | Jan..Dez | Total, mesmas celulas, cabecalho e travas das
                      demais grades de lancamento. Cada cargo e uma linha de PREMISSA:
                      contratacao e insumo da folha, nao lancamento contabil — por isso
                      o mes fechado nao a trava (mesma regra das premissas da Receita). */}
                  {cargos.length > 0 && (() => {
                    const totalVagas = contratacoes.reduce((s, c) => s + (Number(c.QTD_VAGAS) || 0), 0);
                    const cellQtd = (cargoId: number, mes: number) => contratacoes
                      .filter(c => Number(c.CARGO_ID) === cargoId && Number(c.MES_ENTRADA) === mes)
                      .reduce((s, c) => s + (Number(c.QTD_VAGAS) || 0), 0);
                    const expanded = expandedProjecao.has('section-contrat');

                    // Linhas da grade: uma por cargo + Total. Coluna -> mes calendario via
                    // colToMonth (mesmo mapeamento fiscal das outras grades). Celula sem
                    // contratacao fica vazia (null) — a grade e esparsa e um mar de zeros
                    // esconderia as poucas vagas lancadas.
                    const contratRows: any[][] = cargos.map((cg: any) => {
                      const cargoId = Number(cg.ID);
                      const row: any[] = [`${cg.NOME} · ${formatCurrency(cg.SALARIO_MEDIO || 0)}`];
                      let tot = 0;
                      for (let col = 1; col <= 12; col++) { const q = cellQtd(cargoId, colToMonth(col)); row.push(q > 0 ? q : null); tot += q; }
                      row.push(tot);
                      return row;
                    });
                    const totRow: any[] = ['Total de contratações'];
                    for (let col = 1; col <= 13; col++) totRow.push(contratRows.reduce((s, r) => s + (Number(r[col]) || 0), 0));
                    contratRows.push(totRow);
                    const contratTotalIdx = contratRows.length - 1;
                    const contratMeta: { kind: 'premise' | 'formula' | 'account' | 'total'; label: string }[] =
                      cargos.map((cg: any) => ({ kind: 'premise', label: `${cg.NOME} · ${formatCurrency(cg.SALARIO_MEDIO || 0)}` }));
                    contratMeta.push({ kind: 'total', label: 'Total de contratações' });

                    // Justificativa por cargo: fica fora da grade (a grade so tem numero),
                    // listada abaixo para os cargos com vaga lancada ou texto ja gravado.
                    const cargosComJust = cargos.filter((cg: any) => {
                      const cargoId = Number(cg.ID);
                      return contratJustOf(cargoId) || contratJustEdit?.cargoId === cargoId ||
                        contratacoes.some(c => Number(c.CARGO_ID) === cargoId && (Number(c.QTD_VAGAS) || 0) > 0);
                    });
                    return (
                  <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border-light, var(--color-border))' }}>
                    <div className="flex items-center justify-between px-4 py-2.5 cursor-pointer transition-colors"
                      style={{ backgroundColor: expanded ? '#f8faff' : 'var(--color-surface)' }}
                      onClick={() => toggleProjecao('section-contrat')}>
                      <div className="flex items-center gap-3">
                        <span style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>
                          <ChevronRight size={16} />
                        </span>
                        <span className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>Contratações Projetadas</span>
                        {totalVagas > 0 && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{ backgroundColor: 'var(--sidebar-item-active-bg)', color: 'var(--color-primary)' }}>{totalVagas}</span>
                        )}
                      </div>
                      {!expanded && (
                        <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                          {totalVagas > 0 ? `${totalVagas} vaga(s) projetada(s)` : readOnly ? 'Nenhuma contratação projetada' : 'Informe a quantidade de contratações por cargo e mês'}
                        </span>
                      )}
                    </div>
                    {expanded && (
                      <div style={{ backgroundColor: 'var(--color-surface)', borderTop: '1px solid var(--color-border)' }}>
                        <GradeModelo
                          dados={contratRows}
                          rowMeta={contratMeta}
                          colHeaders={['Cargo', ...MONTHS_LOWER, 'Total']}
                          colunaTravada={isColLocked}
                          somenteLeitura={readOnly}
                          rotuloOrcado={rotuloOrcado}
                          moldura={false}
                          aoAlterar={(changes: any, source: string, dadosVivos: any[][]) => {
                            if (!changes || source === 'loadData' || readOnly) return;
                            changes.forEach(([row, col, ov, nv]: any) => {
                              if (row >= contratTotalIdx) return;
                              if (col < 1 || col > 12) return;
                              if (ov === nv) return;
                              // Linha resolvida pelo metadado (cargo), nunca pelo indice cru.
                              const cg = cargos[row];
                              if (!cg) return;
                              const qtd = Math.max(0, Math.floor(Number(nv) || 0));
                              dadosVivos[row][col] = qtd > 0 ? qtd : null;
                              saveContratCell(Number(cg.ID), colToMonth(col), qtd);
                              let rowT = 0; for (let m = 1; m <= 12; m++) rowT += Number(dadosVivos[row][m]) || 0;
                              dadosVivos[row][13] = rowT;
                            });
                            for (let c = 1; c <= 13; c++) {
                              let colT = 0;
                              for (let r = 0; r < contratTotalIdx; r++) colT += Number(dadosVivos[r][c]) || 0;
                              dadosVivos[contratTotalIdx][c] = colT;
                            }
                          }}
                        />

                        {/* Justificativas por cargo */}
                        {(cargosComJust.length > 0 || !readOnly) && (
                          <div className="px-5 py-3 space-y-2" style={{ borderTop: '1px solid var(--color-border)' }}>
                            <div className="flex items-center gap-2">
                              <MessageSquare size={13} style={{ color: 'var(--color-text-secondary)' }} />
                              <span className="text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--color-text-secondary)' }}>Justificativas</span>
                            </div>
                            {cargosComJust.length === 0 && (
                              <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                                Lance contratações na grade acima para poder justificar o cargo.
                              </p>
                            )}
                            {cargosComJust.map((cg: any) => {
                              const cargoId = Number(cg.ID);
                              const just = contratJustOf(cargoId);
                              const editingJust = contratJustEdit?.cargoId === cargoId;
                              return (
                                <div key={cargoId} className="flex items-start gap-3 rounded-lg px-3 py-2" style={{ backgroundColor: editingJust ? '#f8faff' : 'transparent', border: '1px solid ' + (editingJust ? 'var(--color-border)' : 'transparent') }}>
                                  <span className="text-sm font-medium shrink-0 pt-0.5" style={{ color: 'var(--color-text)', minWidth: 180 }}>{cg.NOME}</span>
                                  <div className="flex-1 min-w-0">
                                    {editingJust && !readOnly ? (
                                      <textarea rows={2} maxLength={500} autoFocus
                                        className="w-full text-sm rounded-lg px-2.5 py-2 focus:outline-none focus:ring-1 resize-y"
                                        style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' }}
                                        placeholder="Por que estas contratações são necessárias? (ex.: abertura de nova unidade, aumento de demanda...)"
                                        value={contratJustEdit!.texto}
                                        onChange={e => setContratJustEdit({ cargoId, texto: e.target.value })}
                                        onKeyDown={e => { if (e.key === 'Escape') setContratJustEdit(null); }}
                                      />
                                    ) : just ? (
                                      <p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--color-text)' }}>{just}</p>
                                    ) : (
                                      <p className="text-xs italic" style={{ color: 'var(--color-text-secondary)' }}>Sem justificativa</p>
                                    )}
                                  </div>
                                  {!readOnly && (
                                    editingJust ? (
                                      <div className="flex gap-1.5 shrink-0">
                                        <Button size="sm" onClick={() => saveContratJustificativa(cargoId, contratJustEdit!.texto)}>Salvar</Button>
                                        <Button size="sm" variant="secondary" onClick={() => setContratJustEdit(null)}>Cancelar</Button>
                                      </div>
                                    ) : (
                                      <Button size="sm" variant="secondary" onClick={() => setContratJustEdit({ cargoId, texto: just })}>
                                        {just ? 'Editar' : 'Justificar'}
                                      </Button>
                                    )
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {!readOnly && (
                          <p className="px-5 py-2 text-[11px]" style={{ color: 'var(--color-text-secondary)', borderTop: '1px solid var(--color-border)' }}>
                            Digite a quantidade de vagas em cada mês de entrada; a gravação é automática. Depois, clique em <strong>Calcular Folha</strong> para refletir na projeção.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                    );
                  })()}

                  {/* ── SECTION: Projeção Mensal — accordion style ── */}
                  {hasOrcamento && (
                    <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
                  {(() => {
                    // Pre-compute grand total for collapsed header display
                    let _headerGrandTotal = 0;
                    colaboradores.forEach((col: any) => {
                      for (let m = 1; m <= 12; m++) {
                        const e = orcamentoPessoal.find((o: any) => o.COLABORADOR_ID === col.ID && o.MES === m);
                        _headerGrandTotal += e ? Number(e.TOTAL) : 0;
                      }
                    });
                    contratacoes.forEach((cp: any) => {
                      const cargo = cargos.find((c: any) => c.ID === cp.CARGO_ID); if (!cargo) return;
                      const salario = Number(cargo.SALARIO_MEDIO) || 0; const { ben, enc } = calcBenEnc(salario, true);
                      const mesEntrada = Number(cp.MES_ENTRADA); const qtdVagas = Number(cp.QTD_VAGAS) || 1;
                      for (let m = mesEntrada; m <= 12; m++) _headerGrandTotal += (salario + ben + enc) * qtdVagas;
                    });
                    return (
                      <div className="flex items-center justify-between px-4 py-3 cursor-pointer transition-colors"
                        style={{ backgroundColor: expandedProjecao.has('section-proj') ? '#f8faff' : 'var(--color-surface)', borderBottom: expandedProjecao.has('section-proj') ? '1px solid var(--color-border)' : 'none' }}
                        onClick={() => toggleProjecao('section-proj')}>
                        <div className="flex items-center gap-3">
                          <span style={{ transform: expandedProjecao.has('section-proj') ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>
                            <ChevronRight size={16} />
                          </span>
                          <span className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>Projeção Mensal</span>
                        </div>
                        {expandedProjecao.has('section-proj') ? (
                          <div className="inline-flex rounded-lg border overflow-hidden shrink-0" style={{ borderColor: 'var(--color-border)' }} onClick={(e) => e.stopPropagation()}>
                            <button onClick={() => setPessoalProjView('colaborador')}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium transition-all duration-200 cursor-pointer"
                              style={{ backgroundColor: pessoalProjView === 'colaborador' ? 'var(--color-primary)' : 'var(--color-surface)', color: pessoalProjView === 'colaborador' ? '#fff' : 'var(--color-text)' }}>
                              <Users size={12} /> Por colaborador
                            </button>
                            <button onClick={() => setPessoalProjView('conta')}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium transition-all duration-200 cursor-pointer"
                              style={{ backgroundColor: pessoalProjView === 'conta' ? 'var(--color-primary)' : 'var(--color-surface)', color: pessoalProjView === 'conta' ? '#fff' : 'var(--color-text)', borderLeft: '1px solid var(--color-border)' }}>
                              <Layers size={12} /> Por conta
                            </button>
                          </div>
                        ) : (
                          <span className="font-bold text-sm tabular-nums" style={{ color: 'var(--color-primary)' }}>
                            Total: {_headerGrandTotal.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}
                          </span>
                        )}
                      </div>
                    );
                  })()}
                  {(() => {
                    // Projecao mensal aberta por CONTA CONTABIL: Salarios (5.1.01),
                    // Encargos (5.1.02) item a item (INSS, FGTS...) e Beneficios
                    // (5.1.03) item a item — cada item abre por colaborador.
                    const fmtNum = (v: number) => v ? v.toLocaleString('pt-BR', { maximumFractionDigits: 0 }) : '—';
                    interface ProjRow { key: string; label: string; badge?: string; color?: string; months: number[]; yearTotal: number; children?: ProjRow[] }
                    const sumRows = (rows: ProjRow[]): number[] => rows.reduce((acc, r) => acc.map((v, i) => v + r.months[i]), Array(12).fill(0));
                    const mkRow = (key: string, label: string, months: number[], extra: Partial<ProjRow> = {}): ProjRow =>
                      ({ key, label, months, yearTotal: months.reduce((s, v) => s + v, 0), ...extra });

                    // Base: salario mensal por colaborador (linhas gravadas) + contratacoes projetadas
                    interface Entry { label: string; badge?: string; isCLT: boolean; qty: number; sal: number[] }
                    const entries: Entry[] = [];
                    colaboradores.forEach((col: any) => {
                      const sal: number[] = [];
                      for (let m = 1; m <= 12; m++) {
                        const e = orcamentoPessoal.find((o: any) => o.COLABORADOR_ID === col.ID && o.MES === m);
                        sal.push(e ? Number(e.SALARIO) : 0);
                      }
                      entries.push({ label: col.NOME + (col.CARGO ? ` (${col.CARGO})` : ''), isCLT: col.TIPO_CONTRATO === 'CLT', qty: 1, sal });
                    });
                    contratacoes.forEach((cp: any) => {
                      const cargo = cargos.find((c: any) => c.ID === cp.CARGO_ID); if (!cargo) return;
                      const salario = Number(cargo.SALARIO_MEDIO) || 0;
                      const qtdVagas = Number(cp.QTD_VAGAS) || 1; const mesEntrada = Number(cp.MES_ENTRADA);
                      const sal: number[] = [];
                      for (let m = 1; m <= 12; m++) sal.push(m >= mesEntrada ? salario * qtdVagas : 0);
                      entries.push({ label: cp.CARGO_NOME + (qtdVagas > 1 ? ` (${qtdVagas}x)` : ''), badge: 'Novo', isCLT: true, qty: qtdVagas, sal });
                    });

                    // 5.1.01 — Salarios: abre por colaborador
                    const salChildren = entries.filter(en => en.sal.some(v => v > 0))
                      .map((en, i) => mkRow(`proj-sal-c${i}`, en.label, en.sal, { badge: en.badge }));
                    const catSalario = mkRow('proj-cat-sal', 'Salários — 5.1.01', sumRows(salChildren), { color: '#3B82F6', children: salChildren });

                    // 5.1.02 — Encargos: um item por encargo do ciclo, cada um abre por colaborador CLT
                    const encItems = encargos.filter((e: any) => e.APLICA_CLT === 'true').map((e: any, ei: number) => {
                      const pct = Number(e.PERCENTUAL) || 0;
                      const children = entries.filter(en => en.isCLT && en.sal.some(v => v > 0))
                        .map((en, i) => mkRow(`proj-enc-${ei}-c${i}`, en.label, en.sal.map(s => s * pct / 100), { badge: en.badge }));
                      return mkRow(`proj-enc-${ei}`, `${e.NOME} (${pct}%)`, sumRows(children), { color: '#F59E0B', children });
                    });
                    const catEncargos = mkRow('proj-cat-enc', 'Encargos — 5.1.02', sumRows(encItems), { color: '#F59E0B', children: encItems });

                    // 5.1.03 — Beneficios: um item por beneficio do ciclo, aberto por colaborador
                    // elegivel (CLT/PJ conforme flags); FIXO usa valor x vagas, senao % do salario
                    const benItems = beneficios.map((b: any, bi: number) => {
                      const isFixo = b.TIPO === 'FIXO';
                      const valor = Number(b.VALOR) || 0; const pct = Number(b.PERCENTUAL) || 0;
                      const children = entries
                        .filter(en => (en.isCLT ? b.APLICA_CLT === 'true' : b.APLICA_PJ === 'true') && en.sal.some(v => v > 0))
                        .map((en, i) => mkRow(`proj-ben-${bi}-c${i}`, en.label,
                          en.sal.map(s => s > 0 ? (isFixo ? valor * en.qty : s * pct / 100) : 0), { badge: en.badge }));
                      const sufixo = isFixo ? valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }) : `${pct}%`;
                      return mkRow(`proj-ben-${bi}`, `${b.NOME} (${sufixo})`, sumRows(children), { color: '#10B981', children });
                    }).filter(item => item.children && item.children.length > 0);
                    const catBeneficios = mkRow('proj-cat-ben', 'Benefícios — 5.1.03', sumRows(benItems), { color: '#10B981', children: benItems });

                    // Visao 'colaborador': cada colaborador e uma categoria que abre
                    // nas suas contas (salario, cada encargo INSS/FGTS, cada beneficio).
                    // Mesma matematica da visao por conta, so invertendo a hierarquia.
                    const colabCats = entries.filter(en => en.sal.some(v => v > 0)).map((en, i) => {
                      const children: ProjRow[] = [];
                      children.push(mkRow(`proj-col-${i}-sal`, 'Salários — 5.1.01', en.sal, { color: '#3B82F6' }));
                      if (en.isCLT) {
                        encargos.filter((e: any) => e.APLICA_CLT === 'true').forEach((e: any, ei: number) => {
                          const pct = Number(e.PERCENTUAL) || 0;
                          children.push(mkRow(`proj-col-${i}-enc-${ei}`, `${e.NOME} (${pct}%)`, en.sal.map(s => s * pct / 100), { color: '#F59E0B' }));
                        });
                      }
                      beneficios.forEach((b: any, bi: number) => {
                        const elegivel = en.isCLT ? b.APLICA_CLT === 'true' : b.APLICA_PJ === 'true';
                        if (!elegivel) return;
                        const isFixo = b.TIPO === 'FIXO';
                        const valor = Number(b.VALOR) || 0; const pct = Number(b.PERCENTUAL) || 0;
                        const sufixo = isFixo ? valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }) : `${pct}%`;
                        children.push(mkRow(`proj-col-${i}-ben-${bi}`, `${b.NOME} (${sufixo})`,
                          en.sal.map(s => s > 0 ? (isFixo ? valor * en.qty : s * pct / 100) : 0), { color: '#10B981' }));
                      });
                      return mkRow(`proj-col-${i}`, en.label, sumRows(children), { badge: en.badge, children });
                    });

                    const cats = pessoalProjView === 'colaborador' ? colabCats : [catSalario, catEncargos, catBeneficios];
                    const grandMonths = sumRows(cats); const grandTotal = grandMonths.reduce((s, v) => s + v, 0);

                    const renderRow = (row: ProjRow, level: number): React.ReactNode => {
                      const hasChildren = !!row.children?.length;
                      const isExpanded = expandedProjecao.has(row.key);
                      const isCat = level === 0;
                      const bg = isCat ? 'var(--color-surface)' : 'var(--bg-app)';
                      const txt = isCat ? 'var(--color-text)' : 'var(--color-text-secondary)';
                      return (
                        <React.Fragment key={row.key}>
                          <tr className={isCat ? 'pessoal-colab-row cursor-pointer' : hasChildren ? 'pessoal-sub-row cursor-pointer' : 'pessoal-sub-row'}
                            style={isCat ? { borderTop: '1px solid var(--color-border)' } : undefined}
                            onClick={hasChildren ? () => toggleProjecao(row.key) : undefined}>
                            <td className={isCat ? 'px-6 py-3 font-semibold sticky left-0 z-10' : 'py-1.5 sticky left-0 z-10'}
                              style={{ backgroundColor: bg, color: txt, paddingLeft: isCat ? undefined : 24 + level * 18 }}>
                              <div className="flex items-center gap-2">
                                {hasChildren ? (
                                  <span style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s', display: 'inline-flex' }}>
                                    <ChevronRight size={12} style={{ color: 'var(--color-text-muted)' }} />
                                  </span>
                                ) : <span style={{ width: 12, display: 'inline-flex' }} />}
                                {row.color && <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: row.color }} />}
                                {row.badge && <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold" style={{ backgroundColor: '#FEF3C7', color: '#92400E' }}>{row.badge}</span>}
                                <span style={{ fontSize: isCat ? undefined : 12 }}>{row.label}</span>
                              </div>
                            </td>
                            {row.months.map((v, mi) => (
                              <td key={mi} className={isCat ? 'text-right px-3 py-3 font-medium tabular-nums' : 'text-right px-3 py-1.5 tabular-nums'}
                                style={{ backgroundColor: bg, color: txt, fontSize: isCat ? undefined : 12 }}>{fmtNum(v)}</td>
                            ))}
                            <td className={isCat ? 'text-right px-6 py-3 font-bold tabular-nums' : 'text-right px-6 py-1.5 tabular-nums'}
                              style={isCat
                                ? { backgroundColor: '#f8faff', color: 'var(--color-text)' }
                                : { backgroundColor: bg, color: txt, fontSize: 12 }}>{fmtNum(row.yearTotal)}</td>
                          </tr>
                          {isExpanded && row.children?.map(child => renderRow(child, level + 1))}
                        </React.Fragment>
                      );
                    };

                    return expandedProjecao.has('section-proj') ? (
                      <div className="pessoal-proj-table overflow-x-auto" style={{ borderTop: 'none' }}>
                        <table className="w-full text-[13px]" style={{ minWidth: 1200, borderCollapse: 'separate', borderSpacing: 0 }}>
                          <thead>
                            <tr style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>
                              <th className="text-left px-6 py-3 uppercase tracking-wide font-medium sticky left-0 z-10" style={{ backgroundColor: 'var(--color-surface)', width: 260, minWidth: 260 }}>{pessoalProjView === 'colaborador' ? 'Colaborador' : 'Conta'}</th>
                              {MONTHS_LOWER.map(m => <th key={m} className="text-right px-3 py-3 uppercase tracking-wide font-medium" style={{ backgroundColor: 'var(--color-surface)' }}>{m}</th>)}
                              <th className="text-right px-6 py-3 uppercase tracking-wide font-medium" style={{ backgroundColor: 'var(--color-surface)' }}>Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {cats.map(cat => renderRow(cat, 0))}
                            {/* Grand total row */}
                            <tr style={{ borderTop: '1px solid var(--color-border)' }}>
                              <td className="px-6 py-3 font-bold sticky left-0 z-10" style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' }}>Total Geral Pessoal</td>
                              {grandMonths.map((v, mi) => <td key={mi} className="text-right px-3 py-3 font-bold tabular-nums" style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' }}>{fmtNum(v)}</td>)}
                              <td className="text-right px-6 py-3 font-bold tabular-nums" style={{ backgroundColor: '#f8faff', color: 'var(--color-text)' }}>{fmtNum(grandTotal)}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    ) : null;
                  })()}
                </div>
              )}

            </div>
          </CardContent>
        </Card>

            {/* Grafico padrao, o mesmo das outras abas: comparativo de ano anterior
                versus vigente, com a alternancia "Por Conta" ligada. Antes a folha
                tinha um grafico proprio, com outras cores, outra estrutura (so 2
                barras, sem o realizado do ano corrente) e o ano escrito no titulo. */}
            <ComparisonChart
              configs={pessoalConfigs}
              getRealizadoValue={getRealizadoValue}
              getBudgetValue={getBudgetValue}
              getRealizadoAtualValue={getRealizadoAtualValue}
              ultimoMesRealizado={ultimoMesRealizado}
              permitirPorConta
              pkgCrs={isPkg ? pkgCrsList : undefined}
              pkgBudgetRows={isPkg ? pkgBudgetRowsModelo : undefined}
              pkgRealAtualRows={isPkg ? pkgRealAtualRowsModelo : undefined}
            />
          </>
        );
      })()}

      {/* ===== MODELO DE PACOTE — linhas com granularidade por CR e rateio aplicado ===== */}
      {!loading && isPkg && (() => {
        const currentTab = availableTabs.find(t => t.key === activeTab);
        if (!currentTab || !currentTab.isNormal) return null;
        const state = pkgState; // calculado uma vez por render (tambem alimenta o pill de avisos)
        if (!state) return null;
        const { items, bmByCr, bmTotal, custByCr, custTotal, configs } = state;
        if (configs.length === 0) {
          return <Card className="text-center py-8" style={{ color: 'var(--color-text-muted)' }}>Nenhuma conta mapeada para {currentTab.label} neste pacote</Card>;
        }

        const custValOf = (item: any, mes: number): number => {
          const map = item.crId != null && item.crId !== 0 ? custByCr.get(item.crId) : custTotal;
          const key = item.codigo ? `${item.codigo}_${mes}` : `${item.nome}_${mes}`;
          return map?.get(key) ?? 0;
        };

        // Rotulo limpo: so codigo + nome (+ CR). O icone de formula e o recuo da
        // premissa vem do renderer da primeira coluna, nao de prefixo no texto;
        // o rateio da linha continua nos chips abaixo do grid.
        const rotuloDoItemPkg = (item: any) => item.type === 'account'
          ? `${item.codigo} - ${toTitleCase(item.nome)}${item.crSuffix || ''}`
          : `${item.displayNome}${item.crSuffix || ''}`;

        const tableData = items.map((item: any) => {
          if (item.type === 'account') {
            const row: any[] = [rotuloDoItemPkg(item)];
            for (let i = 0; i < 12; i++) {
              const m = fiscalMonthNumbers[i];
              if (lockedCalendarMonths.has(m)) {
                row.push(getRealizadoAtualValue(item.contaId, m, item.granular ? item.crId : undefined));
              } else if (item.hasFormula || item.aggregated) {
                const map = item.granular ? bmByCr.get(item.crId) : bmTotal;
                row.push(Math.round(map?.get(`${item.contaId}_${m}`) || 0));
              } else {
                row.push(getBudgetValue(item.contaId, m, item.crId));
              }
            }
            row.push(row.slice(1).reduce((s: number, v: number) => s + (Number(v) || 0), 0));
            return row;
          } else {
            const row: any[] = [rotuloDoItemPkg(item)];
            for (let i = 0; i < 12; i++) {
              const m = fiscalMonthNumbers[i];
              if (item.isInput) row.push(getClvPkgValue(item.formulaId, m, item.crId ?? 0));
              else row.push(Math.round(custValOf(item, m)));
            }
            row.push(row.slice(1).reduce((s: number, v: number) => s + (Number(v) || 0), 0));
            return row;
          }
        });

        // Total do modelo: soma apenas linhas de conta — linhas custom sao insumos
        const sumTotalizer = () => {
          const totRow: any[] = ['Total'];
          for (let c = 1; c <= 13; c++) {
            totRow.push(tableData.reduce((s: number, r: any, idx: number) => s + (items[idx]?.type === 'account' ? (Number(r[c]) || 0) : 0), 0));
          }
          return totRow;
        };
        tableData.push(sumTotalizer());
        const totalRowIdx = tableData.length - 1;

        const formulaCount = new Set(items.filter((it: any) => (it.type === 'account' && it.hasFormula) || (it.type === 'custom' && !it.isInput)).map((it: any) => it.formulaId)).size;

        // Classificacao por metadado do item. `bloqueada` cobre a regra so do
        // pacote: conta com rateio pendente nao aceita lancamento.
        const rowMeta: { kind: 'premise' | 'formula' | 'account' | 'total'; label: string; formulaLabel?: string; bloqueada?: boolean; formato?: string }[] =
          items.map((item: any) => {
            const label = rotuloDoItemPkg(item);
            const formato = item.formato;
            if (item.type === 'account') {
              return item.hasFormula
                ? { kind: 'formula', label, formato }
                : { kind: 'account', label, formato, bloqueada: !!(item.aggregated && !item.rateioOk) };
            }
            return item.isInput ? { kind: 'premise', label, formato } : { kind: 'formula', label, formato };
          });
        rowMeta.push({ kind: 'total', label: 'Total' });

        return (
          <>
          {/* Uma moldura so: o Card. Ver a nota no Lancamento Base Zero. */}
          <Card className="overflow-hidden">
            <CardHeader>
              {/* items-center: com o subtitulo fora, o header e uma linha so e o
                  botao Confirmar tem de centralizar com o titulo. */}
              <div className="flex items-center justify-between gap-3 w-full">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <CardTitle>{currentTab.label}</CardTitle>
                    {formulaCount > 0 && (
                      <Badge variant="info">{formulaCount} fórmula{formulaCount > 1 ? 's' : ''}</Badge>
                    )}
                  </div>
                </div>
                <div className="shrink-0">{renderConfirmControl(activeTab, currentTab.label)}</div>
              </div>
              {/* Avisos de rateio ficam no pill colapsavel acima dos banners da
                  pagina — aqui dentro empurravam o botao Confirmar do lugar padrao. */}
            </CardHeader>
              <GradeModelo
                dados={tableData}
                rowMeta={rowMeta}
                colHeaders={colHeaders14}
                colunaTravada={isColLocked}
                somenteLeitura={readOnly}
                rotuloOrcado={rotuloOrcado}
                moldura={false}
                aoAlterar={(changes: any, source: string) => {
                  if (!changes || source === 'loadData' || readOnly) return;
                  changes.forEach(([row, col, ov, nv]: any) => {
                    if (row >= totalRowIdx || col < 1 || col > 12 || ov === nv) return;
                    const item = items[row];
                    if (!item) return;
                    const mes = colToMonth(col);
                    const v = Number(nv) || 0;
                    if (item.type === 'account' && !item.hasFormula && !isColLocked(col)) {
                      if (item.granular) {
                        saveBudgetCell(item.contaId, mes, v, undefined, undefined, item.crId);
                      } else if (item.rateioOk) {
                        // valor unico -> distribui pelo rateio (renormalizado) e
                        // grava CR a CR; CRs fora do rateio recebem 0 (par lancado)
                        const dist = distributeTotal(v, item.shares);
                        for (const crId of item.validCrs as Set<number>) {
                          saveBudgetCell(item.contaId, mes, dist.get(crId) ?? 0, undefined, undefined, crId);
                        }
                      }
                    } else if (item.type === 'custom' && item.isInput) {
                      savePkgLineCell(item.formulaId, mes, v, item.crId ?? 0);
                    }
                    // formulas e derivados: a materializacao (useEffect) persiste apos os saves
                  });
                }}
              />
              {/* Os chips ficam num CardContent proprio, com o respiro do Card; a
                  grade acima e que encosta nas bordas. Guarda na condicao para
                  nao sobrar uma faixa vazia quando nao ha chip nenhum — hoje o
                  unico chip e o de rateio, entao e so ele que a condicao testa.
                  O chip que detalhava a formula ("L1 x L2") saiu: nesta visao o
                  gestor nao conhece os codigos de linha do modelo. */}
              {items.some((it: any) => it.type === 'account' && it.aggregated && it.rateioOk) && (
              <CardContent>
                {/* Chips de rateio: qual rateio divide cada linha de valor unico —
                    fora do rotulo da conta (nome longo + sufixo ficava ilegivel) */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-medium" style={{ color: 'var(--color-text-muted)' }}>Divisão entre setores:</span>
                  {items
                    .filter((it: any, i: number) => it.type === 'account' && it.aggregated && it.rateioOk
                      && items.findIndex((o: any) => o.type === 'account' && o.contaId === it.contaId) === i)
                    .map((it: any) => (
                      <span
                        key={'pkgr-' + it.contaId}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs cursor-default"
                        title={`O total lançado em ${it.codigo} - ${toTitleCase(it.nome)} é dividido entre os setores pelo rateio ${rateioNomeById(it.rateioId)}`}
                        style={{ border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-text-secondary)' }}
                      >
                        <Layers size={11} />
                        <span className="max-w-[170px] truncate">{it.codigo} - {toTitleCase(it.nome)}</span>
                        <span style={{ color: 'var(--color-text-muted)' }}>→ rateio {rateioNomeById(it.rateioId)}</span>
                      </span>
                    ))}
                </div>

                {/* Valor rateado por setor. O gestor lanca UM total na linha e o
                    sistema reparte entre os CRs — sem esta tabela ele so descobre
                    quanto foi para cada setor entrando CR a CR. Os numeros saem de
                    distributeTotal, a MESMA funcao usada no save (inclusive o
                    ajuste de arredondamento na ultima parcela), entao o que aparece
                    aqui e exatamente o que fica gravado. Mes fechado mostra o
                    realizado do proprio CR, igual a grade acima. */}
                {items
                  .filter((it: any, i: number) => it.type === 'account' && it.aggregated && it.rateioOk
                    && items.findIndex((o: any) => o.type === 'account' && o.contaId === it.contaId) === i)
                  .map((it: any) => {
                    const shares: Map<number, number> = it.shares;
                    // Maior parcela primeiro; CR sem quantidade no rateio (share 0)
                    // fica no fim, mostrando o zero que de fato e gravado nele.
                    const crIds = Array.from(it.validCrs as Set<number>)
                      .sort((a: number, b: number) => (shares.get(b) ?? 0) - (shares.get(a) ?? 0));
                    const distPorMes = fiscalMonthNumbers.map((m: number) =>
                      distributeTotal(Math.round(bmTotal.get(`${it.contaId}_${m}`) || 0), shares));
                    const linhas = crIds.map((crId: number) => {
                      const cfg = configs.find((c: any) => Number(c.CR_ID) === crId);
                      const share = shares.get(crId) ?? 0;
                      const nome = cfg?.CR_NOME ? `${cfg.CR_CODIGO} - ${toTitleCase(cfg.CR_NOME)}` : `CR ${crId}`;
                      const row: any[] = [`${nome} · ${(share * 100).toFixed(1)}%`];
                      fiscalMonthNumbers.forEach((m: number, i: number) => {
                        row.push(lockedCalendarMonths.has(m)
                          ? getRealizadoAtualValue(it.contaId, m, crId)
                          : (distPorMes[i].get(crId) ?? 0));
                      });
                      row.push(row.slice(1).reduce((s: number, v: number) => s + (Number(v) || 0), 0));
                      return row;
                    });
                    const totalRow: any[] = ['Total rateado'];
                    for (let c = 1; c <= 13; c++) {
                      totalRow.push(linhas.reduce((s: number, r: any[]) => s + (Number(r[c]) || 0), 0));
                    }
                    const rowMetaRateio: { kind: 'account' | 'total'; label: string }[] = [
                      ...linhas.map((r: any[]) => ({ kind: 'account' as const, label: String(r[0] ?? '') })),
                      { kind: 'total' as const, label: 'Total rateado' },
                    ];
                    return (
                      <div key={'pkgrt-' + it.contaId} className="mt-3 rounded-lg overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
                        <div
                          className="px-3 py-2 flex items-center gap-2 flex-wrap"
                          style={{ backgroundColor: 'var(--bg-app)', borderBottom: '1px solid var(--color-border)' }}
                        >
                          <Layers size={12} style={{ color: 'var(--color-text-muted)' }} />
                          <span className="text-[12px] font-medium" style={{ color: 'var(--color-text)' }}>
                            {it.codigo} - {toTitleCase(it.nome)}
                          </span>
                          <span className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
                            valor rateado por setor · rateio {rateioNomeById(it.rateioId)}
                          </span>
                        </div>
                        <GradeModelo
                          dados={[...linhas, totalRow]}
                          rowMeta={rowMetaRateio}
                          colHeaders={colHeaders14}
                          colunaTravada={isColLocked}
                          somenteLeitura
                          rotuloOrcado={rotuloOrcado}
                          moldura={false}
                          aoAlterar={() => {}}
                        />
                      </div>
                    );
                  })}
              </CardContent>
            )}
          </Card>
          <ComparisonChart configs={configs} getRealizadoValue={getRealizadoValue} getBudgetValue={getBudgetValue} getRealizadoAtualValue={getRealizadoAtualValue} ultimoMesRealizado={ultimoMesRealizado} pkgCrs={pkgCrsList} pkgBudgetRows={pkgBudgetRowsModelo} pkgRealAtualRows={pkgRealAtualRowsModelo} />
          </>
        );
      })()}

      {/* ===== NORMAL DRIVERS (with formula support + custom lines + override) ===== */}
      {!loading && (() => {
        const currentTab = availableTabs.find(t => t.key === activeTab);
        if (!currentTab || !currentTab.isNormal) return null;
        // Abas de MODELO DE PACOTE (ESCOPO='PACOTE') em modo pacote sao renderizadas
        // pela secao dedicada acima — esta secao segue servindo os modelos de CR.
        if (isPkg && normalDrivers.find((d: any) => d.NOME === activeTab)?.ESCOPO === 'PACOTE') return null;
        const configs = configsByDriver(activeTab);
        if (configs.length === 0) return <Card className="text-center py-8" style={{ color: 'var(--color-text-muted)' }}>Nenhuma conta mapeada para {currentTab.label} neste CR</Card>;

        const driverFormulas = getDriverFormulas(activeTab);
        const accountFormulas = driverFormulas.filter((f: any) => f.CONTA_ID);
        const customLines = driverFormulas.filter((f: any) => !f.CONTA_ID);

        const visibleCustomLines = customLines.filter((cl: any) => !isOrphanCustomLine(cl, accountFormulas, configs));

        const resolvedAccFormulas = accountFormulas.map((f: any) => {
          const r = resolveFormula(f);
          return { ...f, FORMULA: r.formula, TIPO: r.tipo, _isOverride: r.isOverride };
        });
        const resolvedFByContaId = new Map<number, any>();
        resolvedAccFormulas.forEach((f: any) => { resolvedFByContaId.set(f.CONTA_ID, f); });

        const resolvedCustLines = visibleCustomLines.map((cl: any) => {
          const r = resolveFormula(cl);
          return { ...cl, FORMULA: r.formula, TIPO: r.tipo, _isOverride: r.isOverride };
        });

        const driverObj = normalDrivers.find((d: any) => d.NOME === activeTab);
        const allDriverFormulas = driverObj ? allFormulas.filter((f: any) => f.DRIVER_ID === driverObj.ID) : [];

        const accountOrderMap = new Map<number, number>();
        allDriverFormulas.forEach((f: any) => { if (f.CONTA_ID) accountOrderMap.set(f.CONTA_ID, f.ORDEM ?? 9999); });

        const sortedConfigs = [...configs].sort((a: any, b: any) => {
          const oa = accountOrderMap.get(a.CONTA_ID) ?? 9999;
          const ob = accountOrderMap.get(b.CONTA_ID) ?? 9999;
          if (oa !== ob) return oa - ob;
          return (a.CODIGO || '').localeCompare(b.CODIGO || '');
        });

        const allItems = [
          ...sortedConfigs.map((dc: any) => {
            const rf = resolvedFByContaId.get(dc.CONTA_ID);
            return {
              type: 'account' as const, contaId: dc.CONTA_ID, codigo: dc.CODIGO,
              nome: dc.CONTA_NOME, hasFormula: !!rf && rf.TIPO === 'FORMULA',
              isOverride: rf?._isOverride || false,
              formulaId: rf?.ID || null,
              // Formato escolhido na coluna "Formato" do mapeamento. Conta sem
              // linha de calculo nao tem formato — cai no default.
              formato: rf?.FORMATO || 'SEM_PREFIXO',
              crId: rowCrId(dc), crSuffix: rowCrSuffix(dc),
              ordem: accountOrderMap.get(dc.CONTA_ID) ?? 9999,
            };
          }),
          ...resolvedCustLines.map((cl: any) => ({
            type: 'custom' as const, formulaId: cl.ID,
            codigo: cl.CODIGO || null,
            nome: cl.NOME_CUSTOM || 'Linha personalizada',
            displayNome: cl.LABEL || cl.NOME_CUSTOM || 'Linha personalizada',
            isInput: tipoLinha(cl) === 'INPUT',
            // Premissa nao e digitavel nem calculada por formula: le o valor
            // cadastrado em Premissas Gerais.
            isPremissa: tipoLinha(cl) === 'PREMISSA',
            premissaNome: cl.PREMISSA_NOME || '',
            isOverride: cl._isOverride || false,
            formula: cl.FORMULA || '',
            formato: cl.FORMATO || 'SEM_PREFIXO',
            ordem: cl.ORDEM ?? 9999,
          })),
        ].sort((a, b) => a.ordem - b.ordem);

        const customBudget = new Map<string, number>();
        // Referencia por [CODIGO] (padrao) e por [nome] (compatibilidade)
        const setCustomKeys = (cl: any, m: number, val: number) => {
          if (cl.NOME_CUSTOM) customBudget.set(`${cl.NOME_CUSTOM}_${m}`, val);
          if (cl.CODIGO) customBudget.set(`${cl.CODIGO}_${m}`, val);
        };
        resolvedCustLines.forEach((cl: any) => {
          for (let i = 0; i < 12; i++) {
            const m = fiscalMonthNumbers[i];
            const tipo = tipoLinha(cl);
            if (tipo === 'INPUT') {
              setCustomKeys(cl, m, getCustomLineValue(cl.ID, m));
            } else if (tipo === 'PREMISSA') {
              setCustomKeys(cl, m, valorPremissa(premissasMap, cl.PREMISSA_NOME, m));
            }
          }
        });

        // Mapas de orcamento por grupo: em modo CR ha 1 grupo (undefined); em modo
        // pacote ha 1 grupo por CR — cada linha (conta, CR) e uma unidade e as
        // formulas sao avaliadas dentro do proprio CR (referencias {CODIGO} resolvem
        // para o valor daquele CR, nao para a soma do pacote).
        const crGroups: Array<number | undefined> = isPkg
          ? Array.from(new Set(sortedConfigs.map((dc: any) => Number(dc.CR_ID))))
          : [undefined];
        const budgetMaps = new Map<string, Map<string, number>>();
        for (const g of crGroups) {
          const bm = new Map<string, number>();
          sortedConfigs.forEach((dc: any) => {
            if (g !== undefined && Number(dc.CR_ID) !== g) return;
            for (let i = 0; i < 12; i++) {
              const m = fiscalMonthNumbers[i];
              bm.set(`${dc.CONTA_ID}_${m}`, getBudgetValue(dc.CONTA_ID, m, g));
            }
          });
          resolvedAccFormulas.forEach((f: any) => {
            if (f.TIPO !== 'FORMULA') return;
            for (let i = 0; i < 12; i++) {
              const m = fiscalMonthNumbers[i];
              const val = evaluateFormula(f.FORMULA, m, sortedConfigs, bm, customBudget);
              bm.set(`${f.CONTA_ID}_${m}`, val);
            }
          });
          budgetMaps.set(String(g ?? ''), bm);
        }
        const mapFor = (crId?: number) => budgetMaps.get(String(crId ?? '')) || budgetMaps.values().next().value || new Map<string, number>();
        const currentBudget = mapFor(crGroups[0]);

        resolvedCustLines.filter((cl: any) => tipoLinha(cl) === 'FORMULA').forEach((cl: any) => {
          for (let i = 0; i < 12; i++) {
            const m = fiscalMonthNumbers[i];
            const val = evaluateFormula(cl.FORMULA || '', m, sortedConfigs, currentBudget, customBudget);
            setCustomKeys(cl, m, val);
          }
        });

        // Rotulo limpo: o icone de formula, o recuo da premissa e a marca de
        // override passam a vir do renderer da primeira coluna, nao de prefixo
        // no texto — prefixo desalinha a coluna e nao sobrevive a truncagem.
        const rotuloDoItem = (item: any) => item.type === 'account'
          ? `${item.codigo} - ${item.nome}${item.crSuffix || ''}`
          : item.displayNome;

        const tableData = allItems.map((item: any) => {
          if (item.type === 'account') {
            const row: any[] = [rotuloDoItem(item)];
            for (let i = 0; i < 12; i++) {
              const m = fiscalMonthNumbers[i];
              if (lockedCalendarMonths.has(m)) {
                row.push(getRealizadoAtualValue(item.contaId, m, item.crId));
              } else if (item.hasFormula) {
                row.push(Math.round(mapFor(item.crId).get(`${item.contaId}_${m}`) || 0));
              } else {
                row.push(getBudgetValue(item.contaId, m, item.crId));
              }
            }
            row.push(row.slice(1).reduce((s: number, v: number) => s + (Number(v) || 0), 0));
            return row;
          } else {
            const row: any[] = [rotuloDoItem(item)];
            for (let i = 0; i < 12; i++) {
              const m = fiscalMonthNumbers[i];
              if (item.isInput) {
                row.push(getCustomLineValue(item.formulaId, m));
              } else {
                const val = customBudget.get(`${item.nome}_${m}`) || 0;
                row.push(Math.round(val));
              }
            }
            row.push(row.slice(1).reduce((s: number, v: number) => s + (Number(v) || 0), 0));
            return row;
          }
        });

        const formulaCount = resolvedAccFormulas.filter((f: any) => f.TIPO === 'FORMULA').length + resolvedCustLines.filter((cl: any) => tipoLinha(cl) === 'FORMULA').length;

        // Linha Total: soma apenas linhas de conta (o que vai pra DRE) — linhas
        // custom sao insumos de formula (qtd, preco) e distorceriam o total
        // Recebe a grade como argumento: no afterChange quem vale e o array VIVO
        // do Handsontable, nao o tableData deste render (que ainda tem os valores
        // de antes da edicao).
        const sumTotalizer = (grade: any[][] = tableData) => {
          const totRow: any[] = ['Total'];
          for (let c = 1; c <= 13; c++) {
            totRow.push(grade.reduce((s: number, r: any, idx: number) => s + (allItems[idx]?.type === 'account' ? (Number(r[c]) || 0) : 0), 0));
          }
          return totRow;
        };
        tableData.push(sumTotalizer());
        const totalRowIdx = tableData.length - 1;

        // Classificacao das linhas por METADADO do item, nunca por indice: as
        // linhas entram, somem e trocam de ordem conforme o modelo.
        // Tipo declarado aqui porque o tsconfig usa verbatimModuleSyntax e
        // importar tipo de outro arquivo quebra em runtime.
        const rowMeta: { kind: 'premise' | 'formula' | 'account' | 'total'; label: string; formulaLabel?: string; isOverride?: boolean; formato?: string }[] =
          allItems.map((item: any) => {
            const label = rotuloDoItem(item);
            const formato = item.formato;
            if (item.type === 'account') {
              const rf = resolvedFByContaId.get(item.contaId);
              return item.hasFormula
                ? { kind: 'formula', label, formato, formulaLabel: rf?.FORMULA, isOverride: item.isOverride }
                : { kind: 'account', label, formato, isOverride: item.isOverride };
            }
            if (item.isInput) return { kind: 'premise', label, formato, isOverride: item.isOverride };
            // Premissa e travada na grade (o valor vem de Premissas Gerais), por
            // isso reusa o kind 'formula', que ja e o kind read-only. O rotulo
            // diz de onde o numero saiu.
            if (item.isPremissa) {
              return { kind: 'formula', label, formato, formulaLabel: `Premissa: ${item.premissaNome || '(não selecionada)'}`, isOverride: item.isOverride };
            }
            return { kind: 'formula', label, formato, formulaLabel: item.formula, isOverride: item.isOverride };
          });
        rowMeta.push({ kind: 'total', label: 'Total' });

        const recalcFormulas = (grade: any[][] = tableData) => {
          // Um mapa "updated" por grupo de CR (modo pacote: formulas avaliadas
          // dentro do proprio CR). Em modo CR ha so o grupo undefined.
          const updatedByGroup = new Map<string, Map<string, number>>();
          for (const g of crGroups) updatedByGroup.set(String(g ?? ''), new Map<string, number>());
          const groupOf = (item: any) => String(item.crId ?? '');
          const updCustom = new Map<string, number>();
          allItems.forEach((item: any, rowIdx: number) => {
            if (item.type === 'account') {
              const gm = updatedByGroup.get(groupOf(item));
              if (!gm) return;
              for (let i = 0; i < 12; i++) {
                const m = fiscalMonthNumbers[i];
                const cellVal = item.hasFormula ? 0 : (Number(grade[rowIdx][i + 1]) || 0);
                gm.set(`${item.contaId}_${m}`, cellVal);
              }
            } else if (item.isInput || item.isPremissa) {
              // Premissa entra junto com o input: as duas sao folhas (nao
              // dependem de outra linha) e o valor ja esta na grade. Se ficasse
              // de fora, toda formula que cita a premissa via [Lx] passaria a
              // valer zero no primeiro recalculo apos digitar uma celula.
              for (let i = 0; i < 12; i++) {
                const m = fiscalMonthNumbers[i];
                const v = Number(grade[rowIdx][i + 1]) || 0;
                updCustom.set(`${item.nome}_${m}`, v);
                if (item.codigo) updCustom.set(`${item.codigo}_${m}`, v);
              }
            }
          });

          resolvedAccFormulas.filter((f: any) => f.TIPO === 'FORMULA').forEach((f: any) => {
            allItems.forEach((it: any, rowIdx: number) => {
              if (it.type !== 'account' || it.contaId !== f.CONTA_ID) return;
              const gm = updatedByGroup.get(groupOf(it));
              if (!gm) return;
              for (let i = 0; i < 12; i++) {
                const m = fiscalMonthNumbers[i];
                const val = evaluateFormula(f.FORMULA, m, sortedConfigs, gm, updCustom);
                gm.set(`${f.CONTA_ID}_${m}`, val);
                grade[rowIdx][i + 1] = Math.round(val);
              }
              grade[rowIdx][13] = grade[rowIdx].slice(1, 13).reduce((s: number, v: number) => s + (Number(v) || 0), 0);
            });
          });

          resolvedCustLines.filter((cl: any) => tipoLinha(cl) === 'FORMULA').forEach((cl: any) => {
            const rowIdx = allItems.findIndex((it: any) => it.type === 'custom' && it.formulaId === cl.ID);
            if (rowIdx === -1) return;
            const firstGroup = updatedByGroup.get(String(crGroups[0] ?? '')) || new Map<string, number>();
            for (let i = 0; i < 12; i++) {
              const m = fiscalMonthNumbers[i];
              const val = evaluateFormula(cl.FORMULA || '', m, sortedConfigs, firstGroup, updCustom);
              if (cl.NOME_CUSTOM) updCustom.set(`${cl.NOME_CUSTOM}_${m}`, val);
              if (cl.CODIGO) updCustom.set(`${cl.CODIGO}_${m}`, val);
              grade[rowIdx][i + 1] = Math.round(val);
            }
            grade[rowIdx][13] = grade[rowIdx].slice(1, 13).reduce((s: number, v: number) => s + (Number(v) || 0), 0);
          });

          const tot = sumTotalizer(grade);
          for (let c = 1; c <= 13; c++) grade[totalRowIdx][c] = tot[c];
        };

        return (
          <>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3 flex-wrap w-full">
                <div>
                  <div className="flex items-center gap-2">
                    <CardTitle>{currentTab.label}</CardTitle>
                    {formulaCount > 0 && (
                      <Badge variant="info">{formulaCount} fórmula{formulaCount > 1 ? 's' : ''}</Badge>
                    )}
                  </div>
                </div>
                {/* Modelos personalizados tambem confirmam — eles contam no total
                    do workflow, entao sem isso o CR nunca chegaria a 100% */}
                {renderConfirmControl(activeTab, currentTab.label)}
              </div>
            </CardHeader>
              <GradeModelo
                dados={tableData}
                rowMeta={rowMeta}
                colHeaders={colHeaders14}
                colunaTravada={isColLocked}
                somenteLeitura={readOnly}
                rotuloOrcado={rotuloOrcado}
                moldura={false}
                aoAlterar={(changes: any, source: string, dadosVivos: any[][]) => {
                  if (!changes || source === 'loadData' || readOnly) return;
                  let needRecalc = false;
                  changes.forEach(([row, col, ov, nv]: any) => {
                    if (row >= totalRowIdx) return;
                    if (col >= 1 && col <= 12 && ov !== nv) {
                      const item = allItems[row];
                      if (!item) return;
                      if (item.type === 'account' && !item.hasFormula && !isColLocked(col)) {
                        saveBudgetCell(item.contaId, colToMonth(col), Number(nv) || 0, undefined, undefined, item.crId);
                        needRecalc = true;
                      } else if (item.type === 'custom' && item.isInput) {
                        saveCustomLineCell(item.formulaId, colToMonth(col), Number(nv) || 0);
                        needRecalc = true;
                      }
                    }
                  });
                  if (needRecalc && formulaCount > 0) {
                    // recalcFormulas escreve no array VIVO: e ele que esta na tela.
                    recalcFormulas(dadosVivos);
                    // Em modo pacote a conta calculada continua sendo gravada aqui
                    // (uma linha por CR, cada uma no proprio CR): a materializacao
                    // ao confirmar ainda nao cobre ORCAMENTO_PACOTE.
                    //
                    // Em modo CR nao se grava mais por tecla. O numero que o DRE le
                    // passa a sair de materializarCalculadas, no confirmar do modelo
                    // — ver a nota MATERIALIZACAO. Gravar aqui era uma rajada de
                    // escritas por celula e, ainda assim, deixava de fora tudo que
                    // muda sem ninguem digitar (uma premissa geral, por exemplo).
                    if (isPkg) {
                      resolvedAccFormulas.filter((f: any) => f.TIPO === 'FORMULA').forEach((f: any) => {
                        allItems.forEach((it: any, rowIdx: number) => {
                          if (it.type !== 'account' || it.contaId !== f.CONTA_ID) return;
                          for (let i = 0; i < 12; i++) {
                            const m = fiscalMonthNumbers[i];
                            saveBudgetCell(f.CONTA_ID, m, Number(dadosVivos[rowIdx][i + 1]) || 0, undefined, undefined, it.crId);
                          }
                        });
                      });
                    }
                  } else {
                    changes.forEach(([row, _col]: any) => {
                      if (row >= totalRowIdx) return;
                      let t = 0; for (let m = 1; m <= 12; m++) t += Number(dadosVivos[row][m]) || 0;
                      dadosVivos[row][13] = t;
                    });
                    const tot = sumTotalizer(dadosVivos);
                    for (let c = 1; c <= 13; c++) dadosVivos[totalRowIdx][c] = tot[c];
                  }
                }}
              />
              {/* Nao ha mais chip abaixo da grade nesta visao. O que existia aqui
                  detalhava a formula da linha ("= [L1]*[L2]"), e o gestor que
                  preenche nao conhece os codigos de linha do modelo — eles so
                  existem na tela de mapeamento. Quem precisa da formula continua
                  vendo o icone e o hover no rotulo da propria linha. */}
          </Card>
          <ComparisonChart configs={configs} getRealizadoValue={getRealizadoValue} getBudgetValue={getBudgetValue} getRealizadoAtualValue={getRealizadoAtualValue} ultimoMesRealizado={ultimoMesRealizado} pkgCrs={isPkg ? pkgCrsList : undefined} pkgBudgetRows={isPkg ? pkgBudgetRowsModelo : undefined} pkgRealAtualRows={isPkg ? pkgRealAtualRowsModelo : undefined} />
          </>
        );
      })()}

      {/* ===== PACOTES (aba consolidada — lista todos os pacotes do CR) ===== */}
      {!loading && activeTab === 'PACOTES' && (() => {
        if (pacoteTabs.length === 0) {
          return (
            <Card className="text-center py-12" style={{ color: 'var(--color-text-muted)' }}>
              Este CR não está vinculado a nenhum pacote.
            </Card>
          );
        }
        return (
          <div className="space-y-4">
            {pacoteTabs.map((pTab: any) => {
              const pCfgs = driverConfigs.filter((dc: any) => dc.DRIVER_TIPO === pTab.key);
              if (pCfgs.length === 0) {
                return (
                  <Card key={pTab.key} className="text-center py-6" style={{ color: 'var(--color-text-muted)' }}>
                    {pTab.label}: nenhuma conta mapeada neste CR.
                  </Card>
                );
              }
              // Dentro de um CR (!isPkg), a aba de Pacotes eh SEMPRE
              // somente visualizacao — independente de quem eh o gestor
              // do pacote. O CR enxerga os valores que o gestor do pacote
              // preencheu CR a CR (ORCAMENTO_PACOTE deste CR), sem editar.
              const isReadonly = !isPkg || isPacoteReadonly(pTab.key);
              const driverId = pTab.driverId;
              const pkgStatus = driverId ? pacoteStatusesByDriver[driverId] : null;
              const pkgStatusValue: string = (pkgStatus?.STATUS as string) || 'PENDENTE';
              const isCrViewOfPacote = !isPkg && isReadonly;
              const stillBeingFilled = pkgStatusValue === 'PENDENTE' || pkgStatusValue === 'CONFIRMADO';
              const wasReproved = pkgStatusValue === 'REPROVADO';

              if (isCrViewOfPacote && stillBeingFilled) {
                return (
                  <Card key={pTab.key} className="text-center py-10">
                    <Package size={36} className="mx-auto mb-2" style={{ color: 'var(--color-text-muted)' }} />
                    <p className="text-base font-medium mb-1" style={{ color: 'var(--color-text)' }}>
                      {pTab.label} ainda em preenchimento
                    </p>
                    <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                      Os valores deste pacote ficarão visíveis após o gestor do pacote submeter para aprovação.
                    </p>
                  </Card>
                );
              }

              const tableData = pCfgs.map((dc: any) => {
                const row: any[] = [dc.CODIGO + ' - ' + dc.CONTA_NOME];
                for (let i = 0; i < 12; i++) {
                  const cm = fiscalMonthNumbers[i];
                  // Valores do pacote para ESTE CR vem de ORCAMENTO_PACOTE
                  // (bloco PKG_BUDGET) — ORCAMENTO nao contem lancamentos de pacote.
                  row.push(lockedCalendarMonths.has(cm) ? getRealizadoAtualValue(dc.CONTA_ID, cm) : getPacoteBudgetValue(driverId, dc.CONTA_ID, cm));
                }
                row.push(row.slice(1).reduce((s: number, v: number) => s + (Number(v) || 0), 0));
                return row;
              });
              const totalRow: any[] = ['Total Geral'];
              for (let col = 1; col <= 13; col++) {
                totalRow.push(tableData.reduce((sum: number, row: any[]) => sum + (Number(row[col]) || 0), 0));
              }
              tableData.push(totalRow);
              const totalRowIdx = tableData.length - 1;

              // Visao do pacote dentro do CR: todas as linhas sao contas.
              const rowMeta: { kind: 'premise' | 'formula' | 'account' | 'total'; label: string }[] =
                tableData.slice(0, -1).map((r: any[]) => ({ kind: 'account', label: String(r[0] ?? '') }));
              rowMeta.push({ kind: 'total', label: 'Total Geral' });

              const pkgKey = `pkg-${pTab.key}`;
              const pkgExpanded = !collapsedPacotes.has(pkgKey);
              return (
                <div key={pTab.key} className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
                  {/* Header da seção — padrão das seções expansíveis de Pessoal */}
                  <div className="flex items-center justify-between px-4 py-3 cursor-pointer transition-colors"
                    style={{ backgroundColor: 'var(--color-bg)', borderBottom: pkgExpanded ? '1px solid var(--color-border)' : 'none' }}
                    onClick={() => togglePacote(pkgKey)}>
                    <div className="flex items-center gap-3">
                      <span style={{ transform: pkgExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>
                        <ChevronRight size={16} />
                      </span>
                      <span className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>{pTab.label}</span>
                      {isReadonly && (
                        <Tooltip
                          side="bottom"
                          maxWidth={320}
                          content={<span>Estes valores foram preenchidos pelo gestor do pacote e não podem ser editados aqui. Referem-se ao CR {pCfgs[0]?.CR_CODIGO}{pCfgs[0]?.CR_NOME ? ` — ${pCfgs[0].CR_NOME}` : ''}.</span>}>
                          <span className="inline-flex" onClick={(e) => e.stopPropagation()}>
                            <Badge variant="neutral"><Lock size={10} className="mr-1" /> Somente leitura</Badge>
                          </span>
                        </Tooltip>
                      )}
                    </div>
                  </div>
                  {pkgExpanded && (
                    <div style={{ backgroundColor: 'var(--color-surface)' }}>
                      {isCrViewOfPacote && wasReproved && (
                        <div className="m-4 mb-3 flex items-start gap-2 rounded-lg px-3 py-2.5 text-[12px]" style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
                          <AlertCircle size={13} className="mt-0.5 shrink-0" style={{ color: '#dc2626' }} />
                          <span><strong style={{ color: 'var(--color-text)' }}>Atenção:</strong> este pacote foi reprovado e aguarda nova submissão do gestor. Os valores exibidos podem mudar até que a reaprovação seja concluída.</span>
                        </div>
                      )}
                      {/* A secao expansivel ja e a moldura; a grade encosta nela. */}
                      <div className="overflow-hidden">
                        <GradeModelo
                          dados={tableData}
                          rowMeta={rowMeta}
                          colHeaders={colHeaders14}
                          colunaTravada={isColLocked}
                          somenteLeitura={readOnly || isReadonly}
                          rotuloOrcado={rotuloOrcadoPorStatus(isPkg ? statusRecord?.STATUS : pkgStatusValue)}
                          moldura={false}
                          aoAlterar={(changes: any, source: string, dadosVivos: any[][]) => {
                            if (!changes || source === 'loadData' || readOnly || isReadonly) return;
                            changes.forEach(([row, col, ov, nv]: any) => {
                              if (row >= totalRowIdx) return;
                              if (col >= 1 && col <= 12 && isColLocked(col)) return;
                              if (col >= 1 && col <= 12 && ov !== nv) {
                                saveBudgetCell(pCfgs[row].CONTA_ID, colToMonth(col), Number(nv) || 0);
                                let t = 0; for (let m = 1; m <= 12; m++) t += Number(dadosVivos[row][m]) || 0;
                                dadosVivos[row][13] = t;
                                for (let c = 1; c <= 13; c++) {
                                  let colT = 0;
                                  for (let r = 0; r < totalRowIdx; r++) colT += Number(dadosVivos[r][c]) || 0;
                                  dadosVivos[totalRowIdx][c] = colT;
                                }
                              }
                            });
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* Premissas modal (Benefícios + Encargos) */}
      <Modal isOpen={showPremissasModal} onClose={() => setShowPremissasModal(false)} title="Premissas de Benefícios e Encargos">
        {/* Corpo rolavel limitado ao viewport — sem isso, muitos beneficios/encargos
            fazem o modal ficar maior que a tela (e o body trava o scroll da pagina). */}
        <div className="space-y-6 overflow-y-auto pr-1" style={{ maxHeight: 'calc(100vh - 240px)' }}>
          <div>
            <h4 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--color-primary)' }} /> Benefícios (CLT)
            </h4>
            <div className="space-y-1">
              {beneficios.filter((b: any) => b.APLICA_CLT === 'true').map((b: any) => (
                <div key={b.ID} className="flex justify-between text-sm py-1.5 px-2 rounded-lg" style={{ backgroundColor: 'var(--bg-muted, #f8fafc)' }}>
                  <span style={{ color: 'var(--color-text-secondary)' }}>{b.NOME}</span>
                  <span className="font-medium tabular-nums" style={{ color: 'var(--color-text)' }}>{b.TIPO === 'FIXO' ? formatCurrency(Number(b.VALOR)) : `${b.PERCENTUAL}%`}</span>
                </div>
              ))}
              {beneficios.filter((b: any) => b.APLICA_CLT === 'true').length === 0 && (
                <p className="text-xs text-center py-2" style={{ color: 'var(--color-text-muted)' }}>Nenhum benefício CLT cadastrado</p>
              )}
            </div>
          </div>
          {beneficios.some((b: any) => b.APLICA_PJ === 'true') && (
            <div>
              <h4 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
                <span className="w-2 h-2 rounded-full bg-gray-400" /> Benefícios (PJ)
              </h4>
              <div className="space-y-1">
                {beneficios.filter((b: any) => b.APLICA_PJ === 'true').map((b: any) => (
                  <div key={b.ID} className="flex justify-between text-sm py-1.5 px-2 rounded-lg" style={{ backgroundColor: 'var(--bg-muted, #f8fafc)' }}>
                    <span style={{ color: 'var(--color-text-secondary)' }}>{b.NOME}</span>
                    <span className="font-medium tabular-nums" style={{ color: 'var(--color-text)' }}>{b.TIPO === 'FIXO' ? formatCurrency(Number(b.VALOR)) : `${b.PERCENTUAL}%`}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div>
            <h4 className="text-sm font-semibold mb-3 flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
              <span className="w-2 h-2 rounded-full bg-amber-500" /> Encargos (CLT)
            </h4>
            <div className="space-y-1">
              {encargos.filter((e: any) => e.APLICA_CLT === 'true').map((e: any) => (
                <div key={e.ID} className="flex justify-between text-sm py-1.5 px-2 rounded-lg" style={{ backgroundColor: 'var(--bg-muted, #f8fafc)' }}>
                  <span style={{ color: 'var(--color-text-secondary)' }}>{e.NOME}</span>
                  <span className="font-medium tabular-nums" style={{ color: 'var(--color-text)' }}>{e.PERCENTUAL}%</span>
                </div>
              ))}
              {encargos.filter((e: any) => e.APLICA_CLT === 'true').length === 0 && (
                <p className="text-xs text-center py-2" style={{ color: 'var(--color-text-muted)' }}>Nenhum encargo CLT cadastrado</p>
              )}
            </div>
          </div>
        </div>
        <div className="flex justify-end pt-4">
          <Button variant="secondary" onClick={() => setShowPremissasModal(false)}>Fechar</Button>
        </div>
      </Modal>

      {/* Justification modal */}
      <Modal isOpen={showJustModal} onClose={() => setShowJustModal(false)} title="Justificativa da Variação">
        <div className="space-y-4">
          {justContaId && (() => {
            const dc = driverConfigs.find((d: any) => d.CONTA_ID === justContaId);
            return dc ? (
              <div className="bg-[var(--bg-muted)] rounded-lg p-3 border border-[var(--border-light)]">
                <p className="text-xs font-medium uppercase tracking-wide mb-1">Conta</p>
                <p className="text-sm font-semibold text-[var(--color-text)]">{dc.CODIGO} - {dc.CONTA_NOME}</p>
                <p className="text-xs mt-1">
                  Variação: {histPercents[justHk ?? justContaId] || '0'}% | Modo: {(histModes[justHk ?? justContaId] || 'sazonalidade') === 'sazonalidade' ? 'Sazonalidade' : 'Igual nos meses'}
                </p>
              </div>
            ) : null;
          })()}
          <div>
            <label className="block text-sm font-medium text-[var(--color-text)] mb-1.5">Motivo da variação</label>
            {readOnly ? (
              // Consulta (aprovador / submetido / versao fechada): texto do gestor
              // como bloco, sem campo editavel — a justificativa nao muda aqui.
              <p className="text-sm whitespace-pre-wrap rounded-md px-3 py-2.5" style={{ backgroundColor: 'var(--bg-muted)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
                {justText || <span className="italic" style={{ color: 'var(--color-text-secondary)' }}>Sem justificativa</span>}
              </p>
            ) : (
              <textarea
                className="w-full border rounded-md px-3 py-2.5 text-sm focus:ring-2 focus:outline-none resize-none"
                rows={4}
                placeholder="Ex: Reajuste contratual de 5% previsto para março, novo contrato de manutenção..."
                value={justText}
                onChange={(e) => setJustText(e.target.value)}
              />
            )}
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="secondary" onClick={() => setShowJustModal(false)}>{readOnly ? 'Fechar' : 'Cancelar'}</Button>
            {!readOnly && <Button variant="primary" onClick={async () => {
              if (justContaId !== null) {
                const key = justHk ?? String(justContaId);
                setHistJustificativas(prev => ({ ...prev, [key]: justText }));
                const pct = Number(histPercents[key] || '0');
                const modo = histModes[key] || 'sazonalidade';
                await saveHistPremissa(justContaId, pct, modo, justText);
              }
              setShowJustModal(false);
              addToast('success', 'Justificativa salva');
            }}>
              <CheckCircle size={14} className="mr-1" /> Salvar
            </Button>}
          </div>
        </div>
      </Modal>

      {/* Consulta consolidada das justificativas da Base Historica (aprovador em modo leitura) */}
      <Modal isOpen={showJustConsulta} onClose={() => setShowJustConsulta(false)} title="Justificativas — Projeção Base Histórica" size="lg">
        {(() => {
          const consultaFormulaMap = getFormulaOverrideForDriver('BASE_HISTORICO');
          const rows = configsByDriver('BASE_HISTORICO')
            .filter((dc: any) => !consultaFormulaMap.has(dc.CONTA_ID))
            .map((dc: any) => {
              const crId = rowCrId(dc);
              const hk = crId != null ? `${dc.CONTA_ID}_${crId}` : String(dc.CONTA_ID);
              return {
                key: hk,
                label: `${dc.CODIGO} - ${dc.CONTA_NOME}${rowCrSuffix(dc)}`,
                pct: histPercents[hk] || '0',
                modo: histModes[hk] || 'sazonalidade',
                texto: (histJustificativas[hk] || '').trim(),
              };
            })
            // Justificadas primeiro; dentro de cada grupo mantem a ordem das contas
            .sort((a, b) => (b.texto ? 1 : 0) - (a.texto ? 1 : 0));
          const justificadas = rows.filter(r => r.texto).length;
          return (
            <div className="space-y-3">
              <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                {justificadas} de {rows.length} conta(s) com justificativa registrada pelo gestor.
              </p>
              {rows.length === 0 ? (
                <p className="text-sm text-center py-6" style={{ color: 'var(--color-text-secondary)' }}>Nenhuma conta na Base Histórica.</p>
              ) : (
                <div className="max-h-[60vh] overflow-y-auto space-y-2 pr-1">
                  {rows.map(r => (
                    <div key={r.key} className="rounded-md px-3 py-2.5" style={{ border: '1px solid var(--color-border)', backgroundColor: r.texto ? 'var(--color-surface)' : 'var(--bg-muted)' }}>
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{r.label}</span>
                        <span className="text-xs whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>
                          {Number(r.pct) >= 0 ? '+' : ''}{r.pct}% · {r.modo === 'igual' ? 'Igual nos meses' : 'Sazonalidade'}
                        </span>
                      </div>
                      {r.texto ? (
                        <p className="text-sm mt-1.5 whitespace-pre-wrap" style={{ color: 'var(--color-text)' }}>{r.texto}</p>
                      ) : (
                        <p className="text-xs mt-1.5 italic" style={{ color: 'var(--color-text-secondary)' }}>Sem justificativa</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <div className="flex justify-end pt-1">
                <Button variant="secondary" onClick={() => setShowJustConsulta(false)}>Fechar</Button>
              </div>
            </div>
          );
        })()}
      </Modal>

      <ConfirmDialog
        isOpen={showRecalcConfirm}
        onClose={() => setShowRecalcConfirm(false)}
        onConfirm={() => { setShowRecalcConfirm(false); calculatePayroll(); }}
        title="Recalcular folha"
        message="Esta versão já possui projeção de folha calculada. Recalcular irá substituir todos os valores pela lista de colaboradores atual. Deseja continuar?"
        confirmLabel="Recalcular"
      />

      <ConfirmDialog
        isOpen={confirmSemFolhaAberto}
        onClose={() => setConfirmSemFolhaAberto(false)}
        onConfirm={() => { setConfirmSemFolhaAberto(false); aplicarConfirmacaoDriver('PESSOAL'); }}
        title="Folha não calculada"
        message={AVISO_CONFIRMAR_SEM_FOLHA}
        confirmLabel="Confirmar mesmo assim"
      />
      <ToastContainer toasts={toasts} onRemove={removeToast} />

      {/* Modal de reprovacao do CR */}
      <Modal
        isOpen={rejectModalOpen}
        onClose={() => setRejectModalOpen(false)}
        title="Reprovar orçamento"
      >
        <div className="space-y-3">
          <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            Deixe um comentário explicando o motivo da reprovação. O gestor verá esta mensagem ao revisar o orçamento.
          </p>
          <textarea
            value={rejectComment}
            onChange={(e) => setRejectComment(e.target.value)}
            placeholder="Motivo da reprovação..."
            rows={4}
            className="w-full px-3 py-2 rounded-lg border outline-none text-sm resize-none"
            style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)', '--tw-ring-color': 'var(--color-primary-light)' } as any}
            autoFocus
          />
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setRejectModalOpen(false)}>Cancelar</Button>
            <Button
              variant="primary"
              onClick={() => {
                changeApprovalStatus('REPROVADO', rejectComment || '');
                setRejectModalOpen(false);
              }}
              style={{ backgroundColor: '#ef4444' }}
            >
              Reprovar
            </Button>
          </div>
        </div>
      </Modal>

      {/* Historico de auditoria do CR/pacote no ciclo */}
      <WorkflowHistorico
        isOpen={historicoOpen}
        onClose={() => setHistoricoOpen(false)}
        tipo={isPkg ? 'PACOTE' : 'CR'}
        refId={isPkg ? (selectedPackage?.ID ?? null) : selectedCR}
        cicloId={selectedCiclo}
        titulo={isPkg ? `Histórico — ${toTitleCase(selectedPackage?.NOME || 'Pacote')}` : 'Histórico do orçamento'}
      />
    </div>
  );
}
