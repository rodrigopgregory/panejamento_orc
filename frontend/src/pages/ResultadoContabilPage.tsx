import { useState, useEffect, useMemo } from 'react';
import { useSF, jsonField, SF_IDS, execSF, sqlEscape, formatCurrency } from '../hooks/useMitraData';
import { useFiscalYear } from '../hooks/useFiscalYear';
import Select from '../components/ui/Select';
import MultiSelect from '../components/ui/MultiSelect';
import { SkeletonKpis, SkeletonTable } from '../components/ui/Skeleton';
import CabecalhoOrdenavel from '../components/ui/CabecalhoOrdenavel';
import { useOrdenacaoTabela } from '../hooks/useOrdenacaoTabela';
import ResumoRealizadoDashboard from '../components/ResumoRealizadoDashboard';
import { TabelaLancamentos, ColunasMenu } from '../components/TabelaLancamentos';
import { useColunasLancamentos, useOrdenacaoLancamentos } from '../hooks/useColunasLancamentos';
import { isReceitaTipo, isDespesaTipo } from '../lib/realizado-tipos';
import { FileBarChart, Search, TrendingUp, TrendingDown, DollarSign, ChevronRight, ChevronDown, LayoutDashboard, List } from 'lucide-react';

function fmtVal(v: number): string {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(v);
}

// Larguras da coluna de rotulo do resumo por conta. Ficam em constante porque
// thead e tbody precisam declarar o MESMO valor: as duas colunas sao sticky, e
// divergencia de um pixel entre cabecalho e celula desalinha o congelamento.
const W_CONTA = 240;
const W_CR = 168;

const TIPO_LABELS: Record<string, string> = {
  RECEITA: 'Receita',
  IMPOSTO: 'Impostos',
  CMV: 'CMV',
  DESPESA_PESSOAL: 'Despesa Pessoal',
  DESPESA_OPERACIONAL: 'Despesa Operacional',
  DESPESA_MARKETING: 'Despesa Marketing',
  DESPESA_ADMINISTRATIVA: 'Despesa Administrativa',
  RESULTADO_FINANCEIRO: 'Resultado Financeiro',
};

type PageTab = 'resumo' | 'lancamentos';
type GroupMode = 'conta' | 'tipo' | 'dre';

export default function ResultadoContabilPage() {
  const { monthsShort, fiscalMonthNumbers } = useFiscalYear();
  // Mount em 1 ida: SF 137 devolve CRS/ANOS/DRE_CONFIG/CONTAS como blocos JSON
  // (eram 4 chamadas sandbox). Ordenacoes dos ORDER BY originais no cliente.
  const { data: baseRows } = useSF(SF_IDS.hotResultadoBase, {}, true);
  const crs = useMemo(() => jsonField(baseRows?.[0]?.CRS).sort((a, b) => String(a.CODIGO ?? '').localeCompare(String(b.CODIGO ?? ''))), [baseRows]);
  const empresas = useMemo(() => jsonField(baseRows?.[0]?.EMPRESAS).sort((a, b) => String(a.NOME ?? '').localeCompare(String(b.NOME ?? ''))), [baseRows]);
  const anosDisponiveis = useMemo(() => jsonField(baseRows?.[0]?.ANOS).sort((a, b) => Number(b.ANO) - Number(a.ANO)), [baseRows]);
  const dreConfig = useMemo(() => jsonField(baseRows?.[0]?.DRE_CONFIG).sort((a, b) => Number(a.ORDEM) - Number(b.ORDEM)), [baseRows]);
  const allContas = useMemo(() => jsonField(baseRows?.[0]?.CONTAS).sort((a, b) => String(a.CODIGO ?? '').localeCompare(String(b.CODIGO ?? ''))), [baseRows]);
  const [selectedCRs, setSelectedCRs] = useState<string[]>([]);
  const [selectedEmpresa, setSelectedEmpresa] = useState('');
  const [selectedAno, setSelectedAno] = useState('');
  const [selectedMeses, setSelectedMeses] = useState<string[]>([]);
  const [selectedTipos, setSelectedTipos] = useState<string[]>([]);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<PageTab>('resumo');
  // Layout de colunas da tabela de lancamentos (ordem, visibilidade, largura).
  const colunasLanc = useColunasLancamentos();
  // Ordenacao das linhas: so a escolha mora aqui; quem ordena e a SF 101,
  // porque a tabela e paginada no banco.
  const ordemLanc = useOrdenacaoLancamentos();
  const [groupMode, setGroupMode] = useState<GroupMode>('conta');
  const [expandedTipos, setExpandedTipos] = useState<Set<string>>(new Set());

  // Ordenacao do resumo por conta. Diferente da tabela de lancamentos (paginada
  // no banco, ordenada pela SF), aqui as linhas do agregado ja estao todas na
  // memoria — entao ordena no cliente.
  //
  // So vale para a visao por conta: em "por tipo" as contas ficam aninhadas sob
  // o grupo, e em "por linha DRE" a ordem E a estrutura do DRE (subtotais
  // acumulam as linhas acima), ordenar ali produziria um demonstrativo errado.
  const colunasResumo = useMemo(() => [
    { key: 'conta', dirInicial: 'asc' as const, valor: (l: any) => `${l.codigo ?? ''} ${l.nome ?? ''}`.trim() },
    { key: 'cr', dirInicial: 'asc' as const, valor: (l: any) => `${l.crCodigo ?? ''} ${l.crNome ?? ''}`.trim() },
    { key: 'total', dirInicial: 'desc' as const, valor: (l: any) => Object.values(l.meses as Record<number, number>).reduce((a, b) => a + b, 0) },
    ...fiscalMonthNumbers.map((cm) => ({
      key: `mes_${cm}`,
      dirInicial: 'desc' as const,
      valor: (l: any) => (l.meses as Record<number, number>)[cm] || 0,
    })),
  ], [fiscalMonthNumbers]);
  const ordemResumo = useOrdenacaoTabela(colunasResumo);

  // Debounce search input to keep typing fluid (avoids re-filtering ~700+ rows on every keystroke)
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    if (!selectedAno && anosDisponiveis.length > 0) {
      const currentYear = String(new Date().getFullYear());
      const hasCurrentYear = anosDisponiveis.some((a: any) => String(a.ANO) === currentYear);
      setSelectedAno(hasCurrentYear ? currentYear : String(anosDisponiveis[0].ANO));
    }
  }, [anosDisponiveis, selectedAno]);

  const queryAno = selectedAno || String(new Date().getFullYear());
  const crFilterCsv = selectedCRs.map((id) => Number(id)).filter(Boolean).join(',');
  const singleCRSelected = selectedCRs.length === 1;
  const filteredCrs = useMemo(
    () => selectedEmpresa ? crs.filter((cr: any) => String(cr.EMPRESA_ID) === selectedEmpresa) : crs,
    [crs, selectedEmpresa],
  );

  // Agregado por (conta, CR, mes) direto do banco (SF 100) — alimenta as visoes conta/tipo/DRE
  // e os cards. Volume-safe: nunca traz linha crua ao browser para somar; a soma vem do banco.
  const [aggRows, setAggRows] = useState<any[]>([]);
  const [aggLoading, setAggLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setAggLoading(true);
    execSF(100, { ano: queryAno, empresaId: selectedEmpresa, crIds: crFilterCsv })
      .then((rows) => { if (!cancelled) setAggRows(rows); })
      .catch((e) => console.error('Realizado agregado:', e))
      .finally(() => { if (!cancelled) setAggLoading(false); });
    return () => { cancelled = true; };
  }, [queryAno, selectedEmpresa, crFilterCsv]);

  // Visao "Lancamentos" — linhas cruas paginadas + filtradas no banco (SF 101/102).
  const LANC_PAGE = 100;
  const [lancRows, setLancRows] = useState<any[]>([]);
  const [lancTotal, setLancTotal] = useState(0);
  const [lancSoma, setLancSoma] = useState(0);
  const [lancPage, setLancPage] = useState(0);
  // Inicia em true: a visao padrao e "lancamentos" e a busca so dispara no efeito
  // abaixo. Com false, o primeiro paint caia no estado vazio ("Nenhum dado de
  // realizado encontrado") antes mesmo da rede responder.
  const [lancLoading, setLancLoading] = useState(true);
  const mesesCsv = selectedMeses.join(',');
  const tiposCsv = selectedTipos.join(',');
  useEffect(() => { setLancPage(0); }, [queryAno, selectedEmpresa, crFilterCsv, mesesCsv, tiposCsv, search, ordemLanc.ordemCampo, ordemLanc.ordemDir]);
  useEffect(() => {
    if (activeTab !== 'lancamentos') return;
    let cancelled = false;
    setLancLoading(true);
    const busca = sqlEscape(search.trim());
    const flt = { ano: queryAno, empresaId: selectedEmpresa, crIds: crFilterCsv, meses: mesesCsv, tipos: tiposCsv, busca };
    Promise.all([
      execSF(101, { ...flt, ordemCampo: ordemLanc.ordemCampo, ordemDir: ordemLanc.ordemDir, limit: LANC_PAGE, offset: lancPage * LANC_PAGE }),
      execSF(102, flt),
    ]).then(([list, resumo]: any[]) => {
      if (cancelled) return;
      setLancRows(list.map((row: any) => ({
        id: row.ID, ano: Number(row.ANO), mes: Number(row.MES),
        empresaId: row.EMPRESA_ID, empresaNome: row.EMPRESA_NOME,
        crId: row.CR_ID, crCodigo: row.CR_CODIGO, crNome: row.CR_NOME,
        contaId: row.CONTA_ID, codigo: row.CONTA_CODIGO, nome: row.CONTA_NOME,
        tipo: row.CONTA_TIPO || 'OUTROS', valor: Math.round(Number(row.VALOR || 0)),
      })));
      setLancTotal(Number(resumo?.[0]?.TOTAL) || 0);
      setLancSoma(Number(resumo?.[0]?.SOMA) || 0);
    }).catch((e) => console.error('Realizado lancamentos:', e))
      .finally(() => { if (!cancelled) setLancLoading(false); });
    return () => { cancelled = true; };
  }, [activeTab, queryAno, selectedEmpresa, crFilterCsv, mesesCsv, tiposCsv, search, lancPage, ordemLanc.ordemCampo, ordemLanc.ordemDir]);

  const contaMap = new Map<string, { contaId: number; codigo: string; nome: string; tipo: string; crNome: string; crCodigo: string; meses: Record<number, number> }>();
  for (const row of aggRows) {
    const key = `${row.CONTA_ID}_${row.CR_ID}`;
    if (!contaMap.has(key)) {
      contaMap.set(key, {
        contaId: row.CONTA_ID,
        codigo: row.CONTA_CODIGO,
        nome: row.CONTA_NOME,
        tipo: row.CONTA_TIPO,
        crNome: row.CR_NOME,
        crCodigo: row.CR_CODIGO,
        meses: {},
      });
    }
    const entry = contaMap.get(key)!;
    entry.meses[row.MES] = (entry.meses[row.MES] || 0) + Number(row.VALOR || 0);
  }
  const allRows = Array.from(contaMap.values());

  // Group by TIPO
  const tipoGrouped = useMemo(() => {
    const map = new Map<string, { tipo: string; label: string; meses: Record<number, number>; contas: typeof allRows }>();
    for (const row of allRows) {
      const tipo = row.tipo || 'OUTROS';
      if (!map.has(tipo)) {
        map.set(tipo, { tipo, label: TIPO_LABELS[tipo] || tipo, meses: {}, contas: [] });
      }
      const entry = map.get(tipo)!;
      entry.contas.push(row);
      for (const [m, v] of Object.entries(row.meses)) {
        entry.meses[Number(m)] = (entry.meses[Number(m)] || 0) + v;
      }
    }
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [allRows]);

  // Group by DRE lines (same logic as DREPage)
  const dreGrouped = useMemo(() => {
    if (dreConfig.length === 0 || allContas.length === 0) return [];

    // Indice conta -> mes -> soma, construido UMA vez sobre allRows. Sem ele, gv()
    // varreria allRows a cada (linha DRE x conta x mes) — O(D x C x 12 x linhas),
    // que trava o browser com volume real de lancamentos. Com o indice, gv() e O(1).
    const idx = new Map<number, Record<number, number>>();
    for (const row of allRows) {
      let byMes = idx.get(row.contaId);
      if (!byMes) { byMes = {}; idx.set(row.contaId, byMes); }
      for (const [m, v] of Object.entries(row.meses)) {
        byMes[Number(m)] = (byMes[Number(m)] || 0) + v;
      }
    }
    const gv = (contaId: number, mes: number) => Math.round(idx.get(contaId)?.[mes] || 0);

    const result: { nome: string; isSubtotal: boolean; meses: Record<number, number> }[] = [];
    const running = new Array(12).fill(0);

    for (const line of dreConfig) {
      const isSub = line.IS_SUBTOTAL === 'true';
      const sinal = Number(line.SINAL) || 1;

      if (isSub) {
        const meses: Record<number, number> = {};
        for (let m = 1; m <= 12; m++) meses[m] = running[m - 1];
        result.push({ nome: line.NOME_LINHA, isSubtotal: true, meses });
      } else {
        const prefix = line.PREFIXO_CONTA || '';
        const matchingContas = allContas.filter((c: any) => c.CODIGO?.startsWith(prefix));
        const meses: Record<number, number> = {};

        for (let m = 1; m <= 12; m++) {
          let val = 0;
          for (const ct of matchingContas) {
            val += gv(ct.ID, m);
          }
          val *= sinal;
          meses[m] = val;
          running[m - 1] += val;
        }
        result.push({ nome: line.NOME_LINHA, isSubtotal: false, meses });
      }
    }
    return result;
  }, [dreConfig, allContas, allRows]);

  // Summary cards
  const summaryCards = useMemo(() => {
    const byTipo = new Map<string, number>();
    for (const row of allRows) {
      const tipo = row.tipo || 'OUTROS';
      const total = Object.values(row.meses).reduce((a, b) => a + b, 0);
      byTipo.set(tipo, (byTipo.get(tipo) || 0) + total);
    }

    let receitas = 0;
    let despesas = 0;
    for (const [tipo, val] of byTipo.entries()) {
      if (isReceitaTipo(tipo)) receitas += val;
      else if (isDespesaTipo(tipo)) despesas += val;
    }

    const resultado = receitas - despesas;
    const contasDistintas = new Set(allRows.map(r => r.contaId)).size;

    return { receitas, despesas, resultado, contasDistintas };
  }, [allRows]);

  // Visao de lancamentos: linhas ja vêm paginadas/filtradas/ordenadas do banco (SF 101).
  const lancamentos = lancRows;

  const tiposDisponiveis = useMemo(() => {
    const s = new Set<string>();
    aggRows.forEach((r: any) => { if (r.CONTA_TIPO) s.add(r.CONTA_TIPO); });
    return Array.from(s).sort();
  }, [aggRows]);

  const toggleTipo = (tipo: string) => {
    setExpandedTipos(prev => {
      const next = new Set(prev);
      if (next.has(tipo)) next.delete(tipo);
      else next.add(tipo);
      return next;
    });
  };

  // Search filter
  const filteredContas = ordemResumo.ordenar(allRows.filter((r) =>
    r.codigo?.toLowerCase().includes(search.toLowerCase()) ||
    r.nome?.toLowerCase().includes(search.toLowerCase()) ||
    r.crNome?.toLowerCase().includes(search.toLowerCase())
  ));
  const filteredTipo = tipoGrouped.filter((r) =>
    r.label.toLowerCase().includes(search.toLowerCase()) ||
    r.tipo.toLowerCase().includes(search.toLowerCase()) ||
    r.contas.some(c => c.nome?.toLowerCase().includes(search.toLowerCase()) || c.codigo?.toLowerCase().includes(search.toLowerCase()))
  );
  const filteredDre = search.trim()
    ? dreGrouped.filter((r) => r.nome.toLowerCase().includes(search.toLowerCase()))
    : dreGrouped;

  const anoOptions = anosDisponiveis.length > 0
    ? anosDisponiveis.map((a: any) => ({ value: String(a.ANO), label: String(a.ANO) }))
    : [{ value: String(new Date().getFullYear()), label: String(new Date().getFullYear()) }];

  const loading = activeTab === 'lancamentos' ? (lancLoading && lancRows.length === 0) : aggLoading;
  const hasData = activeTab === 'lancamentos' ? (lancTotal > 0 || aggRows.length > 0) : aggRows.length > 0;
  const lancTotalPages = Math.max(1, Math.ceil(lancTotal / LANC_PAGE));

  return (
    <div className="space-y-6 animate-fadeIn">
      <div>
        <h1 className="font-semibold" style={{ color: 'var(--color-text)', fontSize: '20px' }}>Resultado Contábil</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>
          Dados de realizado contábil por conta e centro de resultado
        </p>
      </div>

      <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="Visões do resultado contábil" style={{ borderBottom: '1px solid var(--color-border)' }}>
        {([
          { key: 'resumo', label: 'Resumo do realizado', icon: LayoutDashboard },
          { key: 'lancamentos', label: 'Lançamentos contábeis', icon: List },
        ] as const).map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActiveTab(tab.key)}
              className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-all duration-200 relative"
              style={{ color: active ? 'var(--color-primary)' : 'var(--color-text-secondary)' }}
            >
              <Icon size={15} />
              {tab.label}
              {active && <span className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full" style={{ backgroundColor: 'var(--color-primary)' }} />}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3 w-full">
        <div className="flex-1 min-w-[180px]">
          <Select
            label=""
            options={[{ value: '', label: 'Todas as empresas' }, ...empresas.map((empresa: any) => ({ value: String(empresa.ID), label: empresa.NOME }))]}
            value={selectedEmpresa}
            onChange={(value) => { setSelectedEmpresa(value); setSelectedCRs([]); }}
          />
        </div>
        <div className="flex-1 min-w-[180px]">
          <Select label="" options={anoOptions} value={selectedAno}
            onChange={(v) => setSelectedAno(v)} />
        </div>
        <div className="flex-1 min-w-[240px]">
          <MultiSelect
            options={filteredCrs.map((cr: any) => ({ value: String(cr.ID), label: `${cr.CODIGO} - ${cr.NOME}` }))}
            values={selectedCRs} onChange={setSelectedCRs}
            allLabel="Todos os centros de resultado" placeholder="Todos os centros de resultado"
          />
        </div>
        {activeTab === 'resumo' ? (
          <div className="flex-1 min-w-[180px]">
            <Select label=""
              options={[
                { value: 'conta', label: 'Resumo por conta' },
                { value: 'tipo', label: 'Resumo por tipo' },
                ...(dreConfig.length > 0 ? [{ value: 'dre', label: 'Resumo por linha DRE' }] : []),
              ]}
              value={groupMode} onChange={(v) => { setGroupMode(v as GroupMode); setExpandedTipos(new Set()); ordemResumo.limparOrdem(); }} />
          </div>
        ) : (
          <>
            <div className="flex-1 min-w-[180px]">
              <MultiSelect
                options={monthsShort.map((m: string, i: number) => ({ value: String(fiscalMonthNumbers[i]), label: m }))}
                values={selectedMeses} onChange={setSelectedMeses}
                allLabel="Todos os meses" placeholder="Todos os meses"
              />
            </div>
            <div className="flex-1 min-w-[180px]">
              <MultiSelect
                options={tiposDisponiveis.map((t: string) => ({ value: t, label: TIPO_LABELS[t] || t }))}
                values={selectedTipos} onChange={setSelectedTipos}
                allLabel="Todos os tipos" placeholder="Todos os tipos"
              />
            </div>
          </>
        )}
      </div>

      {loading ? (
        <>
          {activeTab === 'resumo' && <SkeletonKpis count={4} />}
          <SkeletonTable columns={5} rows={10} />
        </>
      ) : !hasData ? (
        <div className="rounded-xl text-center py-12" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)' }}>
          <FileBarChart size={32} className="mx-auto mb-3" style={{ color: 'var(--color-text-muted)' }} />
          <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>Nenhum dado de realizado encontrado</p>
          <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>Ajuste os filtros ou importe dados de realizado</p>
        </div>
      ) : (
        <>
          {/* Summary cards */}
          {activeTab === 'resumo' && <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded-xl p-5 min-w-0 overflow-hidden border" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)' }}>
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: 'color-mix(in srgb, #10b981 14%, transparent)' }}>
                  <TrendingUp size={22} style={{ color: '#10b981' }} strokeWidth={2.5} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>Receitas</p>
                  <p className="text-xl font-bold tabular-nums truncate" style={{ color: 'var(--color-text)' }} title={formatCurrency(summaryCards.receitas)}>
                    {formatCurrency(summaryCards.receitas)}
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-xl p-5 min-w-0 overflow-hidden border" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)' }}>
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: 'color-mix(in srgb, #ef4444 14%, transparent)' }}>
                  <TrendingDown size={22} style={{ color: '#ef4444' }} strokeWidth={2.5} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>Despesas</p>
                  <p className="text-xl font-bold tabular-nums truncate" style={{ color: 'var(--color-text)' }} title={formatCurrency(summaryCards.despesas)}>
                    {formatCurrency(summaryCards.despesas)}
                  </p>
                </div>
              </div>
            </div>

            {(() => {
              const resColor = summaryCards.resultado >= 0 ? '#10b981' : '#ef4444';
              return (
                <div className="rounded-xl p-5 min-w-0 overflow-hidden border" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)' }}>
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: `color-mix(in srgb, ${resColor} 14%, transparent)` }}>
                      <DollarSign size={22} style={{ color: resColor }} strokeWidth={2.5} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>Resultado</p>
                      <p className="text-xl font-bold tabular-nums truncate" style={{ color: 'var(--color-text)' }} title={formatCurrency(summaryCards.resultado)}>
                        {formatCurrency(summaryCards.resultado)}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })()}

            <div className="rounded-xl p-5 min-w-0 overflow-hidden border" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)' }}>
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: 'color-mix(in srgb, #8b5cf6 14%, transparent)' }}>
                  <FileBarChart size={22} style={{ color: '#8b5cf6' }} strokeWidth={2.5} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>Contas</p>
                  <p className="text-xl font-bold tabular-nums truncate" style={{ color: 'var(--color-text)' }}>
                    {summaryCards.contasDistintas}
                  </p>
                  <p className="text-xs truncate" style={{ color: 'var(--color-text-muted)' }}>{allRows.length} lançamentos</p>
                </div>
              </div>
            </div>
          </div>}

          {/* === DASHBOARD do resumo — visoes graficas sobre o mesmo aggRows dos KPIs === */}
          {activeTab === 'resumo' && (
            <ResumoRealizadoDashboard
              aggRows={aggRows}
              monthsShort={monthsShort}
              fiscalMonthNumbers={fiscalMonthNumbers}
              tipoLabels={TIPO_LABELS}
            />
          )}

          {/* === LANÇAMENTOS view (default) === */}
          {activeTab === 'lancamentos' && (
            <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)' }}>
              <div className="px-5 py-3 flex items-center gap-3" style={{ borderBottom: '1px solid var(--color-border)' }}>
                <div className="relative flex-1 max-w-md">
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--color-text-muted)' }} />
                  <input
                    className="w-full pl-8 pr-3 py-1.5 rounded-md text-[13px] border bg-transparent focus:outline-none focus:ring-1"
                    style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                    placeholder="Buscar empresa, conta, código ou setor"
                    value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
                  />
                </div>
                <span className="text-[12px] ml-auto whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>
                  {lancTotal} lançamento{lancTotal === 1 ? '' : 's'}
                </span>
                <span className="text-[12px] tabular-nums whitespace-nowrap" style={{ color: 'var(--color-text)', fontWeight: 500 }}>
                  {formatCurrency(lancSoma)}
                </span>
                <ColunasMenu estado={colunasLanc} />
              </div>
              <div className="overflow-x-auto" style={{ maxHeight: '72vh' }}>
                <TabelaLancamentos
                  lancamentos={lancamentos}
                  estado={colunasLanc}
                  ordenacao={ordemLanc}
                  monthsShort={monthsShort}
                  fiscalMonthNumbers={fiscalMonthNumbers}
                  tipoLabels={TIPO_LABELS}
                />
              </div>
              {lancTotal > LANC_PAGE && (
                <div className="flex items-center justify-between px-5 py-3" style={{ borderTop: '1px solid var(--color-border)' }}>
                  <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                    {lancPage * LANC_PAGE + 1}–{Math.min((lancPage + 1) * LANC_PAGE, lancTotal)} de {lancTotal}
                  </span>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setLancPage((p) => Math.max(0, p - 1))} disabled={lancPage === 0}
                      className="px-3 py-1.5 rounded-md text-[13px] border disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)', backgroundColor: 'transparent' }}>Anterior</button>
                    <span className="text-xs tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>Página {lancPage + 1} de {lancTotalPages}</span>
                    <button onClick={() => setLancPage((p) => Math.min(lancTotalPages - 1, p + 1))} disabled={lancPage >= lancTotalPages - 1}
                      className="px-3 py-1.5 rounded-md text-[13px] border disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)', backgroundColor: 'transparent' }}>Próxima</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* === RESUMOS PIVOT (Por conta / Por tipo / Por DRE) === */}
          {activeTab === 'resumo' && (
          <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)' }}>
            <div className="px-5 py-3 flex items-center gap-3" style={{ borderBottom: '1px solid var(--color-border)' }}>
              <span className="text-[13px] font-medium" style={{ color: 'var(--color-text)' }}>
                {groupMode === 'conta' ? 'Detalhamento por conta, CR e mês' : groupMode === 'tipo' ? 'Resumo por tipo de conta' : 'Resumo por linha do DRE'}
              </span>
              {groupMode === 'conta' && (
                <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                  Clique no cabeçalho para ordenar
                </span>
              )}
            </div>
            <div className="overflow-x-auto"><table className="min-w-full text-sm">
                <thead>
                  <tr style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>
                    {groupMode === 'conta' ? (
                      <CabecalhoOrdenavel
                        campo="conta" rotulo="Conta"
                        ordem={ordemResumo.ordem} onOrdenar={ordemResumo.alternarOrdem}
                        className="text-left px-6 py-3 uppercase tracking-wide font-medium sticky left-0 z-10 whitespace-nowrap"
                        style={{ backgroundColor: 'var(--color-surface)', width: W_CONTA, minWidth: W_CONTA, maxWidth: W_CONTA, boxSizing: 'border-box', borderRight: singleCRSelected ? '1px solid var(--color-border)' : undefined }}
                      />
                    ) : (
                      <th className="text-left px-6 py-3 uppercase tracking-wide font-medium sticky left-0 z-10 whitespace-nowrap" style={{ backgroundColor: 'var(--color-surface)', boxSizing: 'border-box' }}>
                        {groupMode === 'tipo' ? 'Tipo' : 'Linha DRE'}
                      </th>
                    )}
                    {groupMode === 'conta' && !singleCRSelected && (
                      <CabecalhoOrdenavel
                        campo="cr" rotulo="CR"
                        ordem={ordemResumo.ordem} onOrdenar={ordemResumo.alternarOrdem}
                        className="text-left px-3 py-3 uppercase tracking-wide font-medium whitespace-nowrap sticky z-10"
                        style={{ left: W_CONTA, backgroundColor: 'var(--color-surface)', width: W_CR, minWidth: W_CR, maxWidth: W_CR, boxSizing: 'border-box', borderRight: '1px solid var(--color-border)' }}
                      />
                    )}
                    {monthsShort.map((m, i) => (
                      groupMode === 'conta' ? (
                        <CabecalhoOrdenavel
                          key={i} campo={`mes_${fiscalMonthNumbers[i]}`} rotulo={m} alinhamento="right"
                          ordem={ordemResumo.ordem} onOrdenar={ordemResumo.alternarOrdem}
                          className="text-right px-3 py-3 uppercase tracking-wide font-medium whitespace-nowrap"
                        />
                      ) : (
                        <th key={i} className="text-right px-3 py-3 uppercase tracking-wide font-medium whitespace-nowrap">{m}</th>
                      )
                    ))}
                    {groupMode === 'conta' ? (
                      <CabecalhoOrdenavel
                        campo="total" rotulo="Total" alinhamento="right"
                        ordem={ordemResumo.ordem} onOrdenar={ordemResumo.alternarOrdem}
                        className="text-right px-6 py-3 uppercase tracking-wide font-medium whitespace-nowrap"
                      />
                    ) : (
                      <th className="text-right px-6 py-3 uppercase tracking-wide font-medium">Total</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {/* === CONTA view === */}
                  {groupMode === 'conta' && filteredContas.map((row, idx) => {
                    const total = Object.values(row.meses).reduce((a, b) => a + b, 0);
                    return (
                      <tr key={idx} style={{ borderTop: '1px solid var(--color-border)' }}>
                        <td className="py-3 px-6 sticky left-0 z-10 text-sm whitespace-nowrap overflow-hidden" style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text)', width: W_CONTA, minWidth: W_CONTA, maxWidth: W_CONTA, boxSizing: 'border-box', textOverflow: 'ellipsis', borderRight: singleCRSelected ? '1px solid var(--color-border)' : undefined }}
                          title={`${row.codigo} ${row.nome}`}>
                          <span className="text-sm tabular-nums" style={{ color: 'var(--color-text)' }}>{row.codigo}</span>
                          <span className="ml-2">{row.nome}</span>
                        </td>
                        {!singleCRSelected && (
                          <td className="py-3 px-3 text-sm whitespace-nowrap overflow-hidden sticky z-10" style={{ left: W_CONTA, backgroundColor: 'var(--color-surface)', color: 'var(--color-text)', width: W_CR, minWidth: W_CR, maxWidth: W_CR, boxSizing: 'border-box', textOverflow: 'ellipsis', borderRight: '1px solid var(--color-border)' }}
                            title={`${row.crCodigo} - ${row.crNome}`}>
                            {row.crCodigo} - {row.crNome}
                          </td>
                        )}
                        {fiscalMonthNumbers.map((cm, i) => (
                          <td key={i} className="py-3 px-3 text-right text-sm tabular-nums" style={{ color: 'var(--color-text)' }}>
                            {row.meses[cm] ? fmtVal(row.meses[cm]) : '-'}
                          </td>
                        ))}
                        <td className="py-3 px-6 text-right text-sm font-medium tabular-nums" style={{ color: 'var(--color-text)' }}>
                          {fmtVal(total)}
                        </td>
                      </tr>
                    );
                  })}

                  {/* === TIPO view with drill-down === */}
                  {groupMode === 'tipo' && filteredTipo.map((row) => {
                    const total = Object.values(row.meses).reduce((a, b) => a + b, 0);
                    const isExpanded = expandedTipos.has(row.tipo);
                    return (
                      <TipoRow key={row.tipo} row={row} total={total} isExpanded={isExpanded}
                        onToggle={() => toggleTipo(row.tipo)}
                        fiscalMonthNumbers={fiscalMonthNumbers} singleCRSelected={singleCRSelected} />
                    );
                  })}

                  {/* === DRE view === */}
                  {groupMode === 'dre' && filteredDre.map((row, idx) => {
                    const total = Object.values(row.meses).reduce((a, b) => a + b, 0);
                    return (
                      <tr key={idx}
                        style={{
                          borderTop: '1px solid var(--border-light)',
                          backgroundColor: row.isSubtotal ? 'var(--bg-hover)' : undefined,
                        }}
                      >
                        <td className="py-3 px-6 sticky left-0 z-10 text-sm" style={{
                          backgroundColor: row.isSubtotal ? 'var(--bg-hover)' : 'var(--color-surface)',
                          color: 'var(--color-text)',
                          fontWeight: row.isSubtotal ? 700 : 500,
                        }}>
                          {row.nome}
                        </td>
                        {fiscalMonthNumbers.map((cm, i) => (
                          <td key={i} className="py-3 px-3 text-right text-sm tabular-nums" style={{
                            color: 'var(--color-text)',
                            fontWeight: row.isSubtotal ? 700 : 400,
                          }}>
                            {row.meses[cm] ? fmtVal(row.meses[cm]) : '-'}
                          </td>
                        ))}
                        <td className="py-3 px-6 text-right text-sm tabular-nums" style={{
                          color: 'var(--color-text)',
                          fontWeight: row.isSubtotal ? 700 : 600,
                        }}>
                          {fmtVal(total)}
                        </td>
                      </tr>
                    );
                  })}

                  {((groupMode === 'conta' && filteredContas.length === 0) ||
                    (groupMode === 'tipo' && filteredTipo.length === 0) ||
                    (groupMode === 'dre' && filteredDre.length === 0)) && (
                    <tr>
                      <td colSpan={14 + (groupMode === 'conta' && !singleCRSelected ? 1 : 0)} className="text-center py-8" style={{ color: 'var(--color-text-muted)' }}>
                        Nenhum resultado encontrado
                      </td>
                    </tr>
                  )}
                </tbody>
              </table></div>
          </div>
          )}
        </>
      )}
    </div>
  );
}

function TipoRow({ row, total, isExpanded, onToggle, fiscalMonthNumbers, singleCRSelected }: {
  row: { tipo: string; label: string; meses: Record<number, number>; contas: { contaId: number; codigo: string; nome: string; tipo: string; crNome: string; crCodigo: string; meses: Record<number, number> }[] };
  total: number; isExpanded: boolean; onToggle: () => void;
  fiscalMonthNumbers: number[]; singleCRSelected: boolean;
}) {
  const ChevronIcon = isExpanded ? ChevronDown : ChevronRight;
  return (
    <>
      <tr className="cursor-pointer select-none"
        style={{ borderTop: '1px solid var(--color-border)' }}
        onClick={onToggle}
      >
        <td className="py-3 px-6 sticky left-0 z-10 text-sm font-medium" style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' }}>
          <div className="flex items-center gap-1.5">
            <ChevronIcon size={14} style={{ color: 'var(--color-text)', flexShrink: 0 }} />
            <span>{row.label}</span>
            <span className="ml-1 text-sm" style={{ color: 'var(--color-text)' }}>({row.contas.length})</span>
          </div>
        </td>
        {fiscalMonthNumbers.map((cm, i) => (
          <td key={i} className="py-3 px-3 text-right text-sm tabular-nums font-medium" style={{ color: 'var(--color-text)' }}>
            {row.meses[cm] ? fmtVal(row.meses[cm]) : '-'}
          </td>
        ))}
        <td className="py-3 px-6 text-right text-sm font-bold tabular-nums" style={{ color: 'var(--color-text)' }}>
          {fmtVal(total)}
        </td>
      </tr>
      {isExpanded && row.contas.map((conta, idx) => {
        const contaTotal = Object.values(conta.meses).reduce((a, b) => a + b, 0);
        return (
          <tr key={`${conta.contaId}_${conta.crCodigo}_${idx}`}
            style={{ borderTop: '1px solid var(--border-light)', backgroundColor: 'var(--bg-app, var(--bg-hover))' }}
          >
            <td className="py-3 px-6 pl-9 sticky left-0 z-10 text-sm" style={{ backgroundColor: 'var(--bg-app, var(--color-surface))', color: 'var(--color-text)' }}>
              <span className="text-sm tabular-nums" style={{ color: 'var(--color-text)' }}>{conta.codigo}</span>
              <span className="ml-2 text-sm" style={{ color: 'var(--color-text)' }}>{conta.nome}</span>
              {!singleCRSelected && (
                <span className="ml-2 text-sm" style={{ color: 'var(--color-text)' }}>({conta.crCodigo})</span>
              )}
            </td>
            {fiscalMonthNumbers.map((cm, i) => (
              <td key={i} className="py-3 px-3 text-right text-sm tabular-nums" style={{ color: 'var(--color-text)' }}>
                {conta.meses[cm] ? fmtVal(conta.meses[cm]) : '-'}
              </td>
            ))}
            <td className="py-3 px-6 text-right text-sm font-medium tabular-nums" style={{ color: 'var(--color-text)' }}>
              {fmtVal(contaTotal)}
            </td>
          </tr>
        );
      })}
    </>
  );
}
