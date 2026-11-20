import { useState, useEffect, useMemo, useCallback, useRef, Fragment } from 'react';
import { createPortal } from 'react-dom';
import { execSF, execSFCached, SF_IDS, MONTHS } from '../hooks/useMitraData';
import { useFiscalYear } from '../hooks/useFiscalYear';
import {
  Eye, EyeOff, ChevronDown, ArrowLeft,
  TrendingUp, TrendingDown, DollarSign, Percent, Search,
  ChevronRight, Building2, ListTree, Landmark, Layers,
} from 'lucide-react';
import MultiSelect from '../components/ui/MultiSelect';
import { SkeletonKpis, SkeletonTable } from '../components/ui/Skeleton';

// Coluna em destaque do DRE Mensal — recebe o mesmo cinza que a coluna
// "Versão atual" tem no Dashboard (token --dash-dre-atual-bg).
const LABEL_CONSOLIDADO = 'Orçado + realizado';

type DrillLevel = 'conta' | 'cr' | 'empresa';
interface DrillState { lineLabel: string; prefixo: string; sinal: number; level: DrillLevel; crId?: number; crLabel?: string; empresaId?: number; empresaLabel?: string }

interface DRELine {
  label: string;
  isSubtotal: boolean;
  isHighlight: boolean;
  prefixo: string;
  sinal: number;
  orcValues: number[];
  realValues: number[];
  realAtualValues: number[];
  consolidadoValues: number[];
  totalOrc: number;
  totalReal: number;
  totalRealAtual: number;
  totalConsolidado: number;
}

// De onde o menu foi aberto: 'raiz' = linha do DRE (oferece todas as
// perspectivas); 'cr'/'empresa' = linha ja dentro de um drill (oferece a
// abertura por conta contabil daquele CR/empresa).
type DrillOrigem = 'raiz' | 'cr' | 'empresa';
interface DrillMenu { x: number; y: number; prefixo: string; sinal: number; label: string; origem: DrillOrigem; refId?: number }

// ─── Formatting ──────────────────────────────────────────
function fmtVal(v: number): string {
  if (Math.abs(v) >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M';
  if (Math.abs(v) >= 1_000) return (v / 1_000).toFixed(0) + 'K';
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(v);
}
function fmtFull(v: number): string {
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(v);
}
function fmtPct(v: number): string {
  if (!isFinite(v) || isNaN(v)) return '-';
  return (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
}
function pctChange(curr: number, prev: number): number {
  if (prev === 0) return curr === 0 ? 0 : 100;
  return ((curr - prev) / Math.abs(prev)) * 100;
}

const HIGHLIGHT_KEYS = ['receita líquida', 'receita liquida', 'lucro bruto', 'ebitda', 'resultado líquido', 'resultado liquido', 'resultado operacional'];

// Dica flutuante do drill. Mede antes de posicionar (como o Tooltip do design
// system) para nao vazar da viewport perto da borda da tela.
function DicaDrill({ x, y, texto }: { x: number; y: number; texto: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    const w = r?.width || 0;
    const h = r?.height || 0;
    let left = x + 14;
    let top = y + 18;
    if (left + w > window.innerWidth - 8) left = Math.max(8, x - w - 14);
    if (top + h > window.innerHeight - 8) top = Math.max(8, y - h - 12);
    setPos({ top, left });
  }, [x, y, texto]);
  return createPortal(
    <div
      ref={ref}
      role="tooltip"
      className="pointer-events-none fixed z-[1000] animate-fadeIn rounded-md px-2.5 py-1.5 text-[11px] leading-snug shadow-md"
      style={{
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        visibility: pos ? 'visible' : 'hidden',
        backgroundColor: 'var(--color-text)',
        color: 'var(--color-surface)',
        width: 'max-content',
        maxWidth: 280,
      }}
    >
      {texto}
    </div>,
    document.body,
  );
}

export default function DREPage() {
  // Não há perfis no app: o DRE nunca trava o recorte num gestor específico
  // (lockedGestorId indefinido => gestorCRIds = null = ver tudo). O gancho
  // continua aqui porque o resto da tela deriva o filtro dele.
  const lockedGestorId: number | undefined = undefined;
  // Leituras de base via SFs SQL dedicadas (~8ms no banco), em paralelo e com
  // cache TTL — navegar de volta pra ca dentro do TTL nao refaz nenhuma chamada.
  const [baseData, setBaseData] = useState<any[][]>([]);
  const [baseDataLoading, setBaseDataLoading] = useState(true);
  useEffect(() => {
    (async () => {
      try {
        const rows = await Promise.all([
          execSFCached(SF_IDS.baseCiclos),
          execSFCached(SF_IDS.baseDreConfig),
          execSFCached(SF_IDS.baseContas),
          execSFCached(SF_IDS.baseCrs),
          execSFCached(SF_IDS.baseEmpresas),
          lockedGestorId !== undefined
            ? execSFCached(SF_IDS.baseGestorCrs, { gestorId: Number(lockedGestorId) })
            : Promise.resolve([]),
        ]);
        setBaseData(rows);
      } catch (e) { console.error(e); }
      setBaseDataLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const ciclos = baseData[0] || [];
  const dreConfig = baseData[1] || [];
  const contas = baseData[2] || [];
  const crs = baseData[3] || [];
  const empresas = baseData[4] || [];
  const gestorCRsRaw = baseData[5] || [];
  const gestorCRIds: number[] | null = lockedGestorId !== undefined
    ? gestorCRsRaw.map((r: any) => Number(r.CR_ID)).filter((n: number) => Number.isFinite(n))
    : null;
  const isLockedGestor = gestorCRIds !== null;
  // CSV de CRs do gestor logado para o param crIds das SFs. Lista vazia
  // (gestor sem CR mapeado) vira '-1' pra filtrar tudo, em vez de '' (que
  // mostraria a empresa inteira).
  const gestorCrCsv = isLockedGestor
    ? (gestorCRIds.length > 0 ? gestorCRIds.join(',') : '-1')
    : '';
  const { fiscalMonthNumbers, monthsShort, monthsFull } = useFiscalYear();

  const [selectedCiclo, setSelectedCiclo] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [mesInicio, setMesInicio] = useState(1);
  const [mesFim, setMesFim] = useState(12);
  const [showColPicker, setShowColPicker] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [drill, setDrill] = useState<DrillState | null>(null);
  const [drillLines, setDrillLines] = useState<DRELine[]>([]);
  const [drillLoading, setDrillLoading] = useState(false);
  const [dreLines, setDreLines] = useState<DRELine[]>([]);
  const [selectedCRs, setSelectedCRs] = useState<string[]>([]);
  const crFilterCsv = selectedCRs.length > 0 ? selectedCRs.join(',') : '';
  const hasCRFilter = selectedCRs.length > 0;
  const [kpis, setKpis] = useState({ receitaLiq: 0, receitaLiqReal: 0, ebitda: 0, ebitdaReal: 0, resultadoLiq: 0, resultadoLiqReal: 0, margemEbitda: 0 });
  const [drillMenu, setDrillMenu] = useState<DrillMenu | null>(null);
  // Abertura por conta contabil acontece inline, abaixo do rotulo da linha (CR/Empresa seguem em drill).
  const [expandedContas, setExpandedContas] = useState<Record<string, DRELine[]>>({});
  const [expandingConta, setExpandingConta] = useState<string | null>(null);

  // O realizado do ano atual e opcional na visao inicial: fica disponivel no
  // seletor sem apertar a grade quando ainda nao ha execucao relevante.
  const [showRealAa, setShowRealAa] = useState(true);
  const [showOrc, setShowOrc] = useState(true);
  const [showRealAtual, setShowRealAtual] = useState(false);
  const [showConsolidado, setShowConsolidado] = useState(true);
  const drillMenuRef = useRef<HTMLDivElement>(null);
  // Clique simples da linha (abrir contas) espera um instante para ter certeza
  // de que nao e a primeira metade de um duplo clique (drill). Sem isso o duplo
  // clique disparava expandir + recolher antes de o menu aparecer.
  const cliqueLinhaRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (cliqueLinhaRef.current) clearTimeout(cliqueLinhaRef.current); }, []);

  // Dica de hover: o duplo clique e o gatilho do drill, mas so quem ja sabe
  // descobre. Passar o cursor sobre uma linha detalhavel avisa — com um atraso
  // curto, para nao piscar enquanto o olho percorre a tabela.
  const [dicaDrill, setDicaDrill] = useState<{ x: number; y: number } | null>(null);
  const dicaTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dicaPosRef = useRef({ x: 0, y: 0 });
  const esconderDicaDrill = useCallback(() => {
    if (dicaTimerRef.current) { clearTimeout(dicaTimerRef.current); dicaTimerRef.current = null; }
    setDicaDrill(null);
  }, []);
  const agendarDicaDrill = useCallback((e: React.MouseEvent) => {
    dicaPosRef.current = { x: e.clientX, y: e.clientY };
    if (dicaTimerRef.current) clearTimeout(dicaTimerRef.current);
    dicaTimerRef.current = setTimeout(() => { dicaTimerRef.current = null; setDicaDrill({ ...dicaPosRef.current }); }, 550);
  }, []);
  // Enquanto a dica ainda nao apareceu ela acompanha o cursor; depois fica parada.
  const moverDicaDrill = useCallback((e: React.MouseEvent) => {
    if (dicaTimerRef.current) dicaPosRef.current = { x: e.clientX, y: e.clientY };
  }, []);
  useEffect(() => () => { if (dicaTimerRef.current) clearTimeout(dicaTimerRef.current); }, []);


  const baseLoading = baseDataLoading;

  // Auto-select current version and comparison
  useEffect(() => {
    if (ciclos.length > 0 && !selectedCiclo) {
      const atual = ciclos.find((c: any) => c.VERSAO_ATUAL === 'true');
      setSelectedCiclo(atual?.ID || ciclos[0].ID);
    }
  }, [ciclos]);

  const visibleMonths = useMemo(() => {
    return fiscalMonthNumbers.slice(mesInicio - 1, mesFim);
  }, [mesInicio, mesFim, fiscalMonthNumbers]);

  useEffect(() => {
    // Aguarda gestorCRsRaw carregar antes de buildar o DRE — evita race onde
    // a primeira buildDRE roda sem filtro (sem o IN dos CRs do gestor) e o
    // resultado dela ganha a corrida com a segunda chamada (com filtro).
    if (selectedCiclo && dreConfig.length > 0 && !baseDataLoading) {
      buildDRE();
    } else if (!baseDataLoading) {
      // Sem ciclo / sem config de DRE: nada a montar. Encerra o loading para
      // exibir o estado vazio em vez do spinner eterno.
      setLoading(false);
    }
  }, [selectedCiclo, dreConfig, contas, mesInicio, mesFim, selectedCRs, gestorCrCsv, baseDataLoading]);

  const ciclo = useMemo(() => ciclos.find((c: any) => c.ID === selectedCiclo), [ciclos, selectedCiclo]);
  const buildDRE = async () => {
    if (!selectedCiclo || dreConfig.length === 0) { setLoading(false); return; }
    setLoading(true);
    const c = ciclos.find((ci: any) => ci.ID === selectedCiclo);
    if (!c) { setLoading(false); return; }
    try {
      const crCsv = hasCRFilter ? crFilterCsv : gestorCrCsv;

      const [realizadoAaRows, orcadoRows, realizadoAtualRows] = await Promise.all([
        execSF(SF_IDS.dreRealizadoPorConta, { ano: c.ANO - 1, crIds: crCsv, contaIds: '', empresaId: '' }),
        execSF(SF_IDS.dreOrcadoPorConta, { cicloId: selectedCiclo, crIds: crCsv, contaIds: '' }),
        execSF(SF_IDS.dreRealizadoPorConta, { ano: c.ANO, crIds: crCsv, contaIds: '', empresaId: '' }),
      ]);

      // Indexa em Map (lookup O(1)) — com volume real de dados, find() em array
      // dentro do loop de linhas x contas x meses vira gargalo de CPU.
      const toMap = (rows: any[]) => {
        const m = new Map<string, number>();
        rows.forEach((r: any) => m.set(`${r.CONTA_ID}:${r.MES}`, Math.round(Number(r.VALOR))));
        return m;
      };
      const realizadoAa = toMap(realizadoAaRows), orcado = toMap(orcadoRows), realizadoAtual = toMap(realizadoAtualRows);
      const gv = (data: Map<string, number>, contaId: number, mes: number) => data.get(`${contaId}:${mes}`) || 0;

      const lines: DRELine[] = [];
      const rO = new Array(12).fill(0), rAa = new Array(12).fill(0), rAtual = new Array(12).fill(0), rConsolidado = new Array(12).fill(0);

      dreConfig.forEach((line: any) => {
        const isSub = line.IS_SUBTOTAL === 'true';
        const isHL = HIGHLIGHT_KEYS.some(k => line.NOME_LINHA.toLowerCase().includes(k));
        if (isSub) {
          const ov = visibleMonths.map(m => rO[m - 1]);
          const rv = visibleMonths.map(m => rAa[m - 1]);
          const realAtualValues = visibleMonths.map(m => rAtual[m - 1]);
          const consolidadoValues = visibleMonths.map(m => rConsolidado[m - 1]);
          lines.push({ label: line.NOME_LINHA, isSubtotal: true, isHighlight: isHL, prefixo: '', sinal: 1, orcValues: ov, realValues: rv, realAtualValues, consolidadoValues, totalOrc: ov.reduce((a, b) => a + b, 0), totalReal: rv.reduce((a, b) => a + b, 0), totalRealAtual: realAtualValues.reduce((a, b) => a + b, 0), totalConsolidado: consolidadoValues.reduce((a, b) => a + b, 0) });
        } else {
          const mc = contas.filter((ct: any) => ct.CODIGO.startsWith(line.PREFIXO_CONTA));
          const ov: number[] = [], rv: number[] = [], realAtualValues: number[] = [], consolidadoValues: number[] = [];
          for (const m of visibleMonths) {
            let o = 0, rAaValue = 0, rAtualValue = 0, consolidado = 0;
            mc.forEach((ct: any) => {
              const key = `${ct.ID}:${m}`;
              const orcValue = gv(orcado, ct.ID, m);
              o += orcValue;
              rAaValue += gv(realizadoAa, ct.ID, m);
              const atual = gv(realizadoAtual, ct.ID, m);
              rAtualValue += atual;
              consolidado += realizadoAtual.has(key) ? atual : orcValue;
            });
            o *= line.SINAL; rAaValue *= line.SINAL; rAtualValue *= line.SINAL; consolidado *= line.SINAL;
            ov.push(o); rv.push(rAaValue); realAtualValues.push(rAtualValue); consolidadoValues.push(consolidado);
            rO[m - 1] += o; rAa[m - 1] += rAaValue; rAtual[m - 1] += rAtualValue; rConsolidado[m - 1] += consolidado;
          }
          lines.push({ label: line.NOME_LINHA, isSubtotal: false, isHighlight: isHL, prefixo: line.PREFIXO_CONTA || '', sinal: line.SINAL, orcValues: ov, realValues: rv, realAtualValues, consolidadoValues, totalOrc: ov.reduce((a, b) => a + b, 0), totalReal: rv.reduce((a, b) => a + b, 0), totalRealAtual: realAtualValues.reduce((a, b) => a + b, 0), totalConsolidado: consolidadoValues.reduce((a, b) => a + b, 0) });
        }
      });
      setDreLines(lines);

      // KPIs
      const fs = (kws: string[]) => lines.find(l => l.isSubtotal && kws.some(k => l.label.toLowerCase().includes(k)));
      const rl = fs(['receita líquida', 'receita liquida']);
      const eb = fs(['ebitda']);
      const subs = lines.filter(l => l.isSubtotal);
      const res = fs(['resultado líquido', 'resultado liquido', 'lucro']) || subs[subs.length - 1];
      setKpis({
        receitaLiq: rl?.totalOrc || 0, receitaLiqReal: rl?.totalReal || 0,
        ebitda: eb?.totalOrc || 0, ebitdaReal: eb?.totalReal || 0,
        resultadoLiq: res?.totalOrc || 0, resultadoLiqReal: res?.totalReal || 0,
        margemEbitda: (rl?.totalOrc || 0) !== 0 ? ((eb?.totalOrc || 0) / (rl?.totalOrc || 1)) * 100 : 0,
      });
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  const handleDrillByCR = useCallback(async (prefixo: string, sinal: number, label: string) => {
    if (!selectedCiclo) return;
    const c = ciclos.find((ci: any) => ci.ID === selectedCiclo);
    if (!c) return;
    const mc = contas.filter((ct: any) => ct.CODIGO.startsWith(prefixo));
    if (!mc.length) { setDrill({ lineLabel: label, prefixo, sinal, level: 'cr' }); setDrillLines([]); return; }
    const ids = mc.map((ct: any) => ct.ID).join(',');
    setDrill({ lineLabel: label, prefixo, sinal, level: 'cr' }); setDrillLoading(true);
    try {
      // O drill herda o filtro de CR da tela: detalhar uma linha ja filtrada e
      // ver TODOS os CRs devolveria numeros que nao somam o que esta na grade.
      const crCsv = hasCRFilter ? crFilterCsv : gestorCrCsv;
      const [oR, rR, rAtualR] = await Promise.all([
        execSF(SF_IDS.dreOrcadoPorCr, { cicloId: selectedCiclo, contaIds: ids, crIds: crCsv }),
        execSF(SF_IDS.dreRealizadoPorCr, { ano: c.ANO - 1, contaIds: ids, crIds: crCsv }),
        execSF(SF_IDS.dreRealizadoPorCr, { ano: c.ANO, contaIds: ids, crIds: crCsv }),
      ]);
      const gv = (d: any[], crId: number, m: number) => { const e = d.find((x: any) => x.CR_ID === crId && x.MES === m); return e ? Math.round(Number(e.VALOR)) : 0; };
      const allCrIds = new Set([...oR.map((r: any) => r.CR_ID), ...rR.map((r: any) => r.CR_ID), ...rAtualR.map((r: any) => r.CR_ID)]);
      const lines: (DRELine & { crId?: number })[] = [];
      allCrIds.forEach(crId => {
        const cr = crs.find((c: any) => c.ID === crId);
        const ov = visibleMonths.map(m => gv(oR, crId, m) * sinal);
        const rv = visibleMonths.map(m => gv(rR, crId, m) * sinal);
        const realAtualValues = visibleMonths.map(m => gv(rAtualR, crId, m) * sinal);
        const consolidadoValues = visibleMonths.map((m, i) => rAtualR.some((r: any) => r.CR_ID === crId && r.MES === m) ? realAtualValues[i] : ov[i]);
        lines.push({ label: cr ? cr.NOME : `CR ${crId}`, isSubtotal: false, isHighlight: false, prefixo, sinal, orcValues: ov, realValues: rv, realAtualValues, consolidadoValues, totalOrc: ov.reduce((a, b) => a + b, 0), totalReal: rv.reduce((a, b) => a + b, 0), totalRealAtual: realAtualValues.reduce((a, b) => a + b, 0), totalConsolidado: consolidadoValues.reduce((a, b) => a + b, 0), crId });
      });
      lines.sort((a, b) => Math.abs(b.totalOrc) - Math.abs(a.totalOrc));
      setDrillLines(lines);
    } catch (e) { console.error(e); }
    setDrillLoading(false);
  }, [selectedCiclo, ciclos, contas, visibleMonths, crs, hasCRFilter, crFilterCsv, gestorCrCsv]);


  // ── Drill: quais perspectivas a linha aceita e como abrir o menu ──────
  //
  // Gatilho do drill: DUPLO CLIQUE na linha (ou o icone que aparece no rotulo).
  // O clique simples abre as contas contabeis, entao ele e adiado por um
  // instante (cliqueLinhaRef) e cancelado quando vira duplo clique — senao o
  // duplo clique disparava expandir + recolher (duas chamadas de SF) antes de o
  // menu aparecer. O menu tambem nao depende mais de haver ou nao filtro de CR.
  const podeDetalharLinha = useCallback((line: any): boolean => {
    if (line.isSubtotal) return false;
    if (!drill) return !!line.prefixo;
    if (drill.level === 'cr') return !!line.crId;
    if (drill.level === 'empresa') return !!line.empresaId;
    return false;
  }, [drill]);

  // A dica anuncia exatamente as perspectivas que o menu vai oferecer daquele
  // ponto da navegacao — prometer "empresa" sem empresa cadastrada seria mentira.
  const dicaDrillTexto = useMemo(() => {
    const partes: string[] = [];
    if (!drill) {
      if (crs.length > 0) partes.push('centro de resultado');
      if (empresas.length > 0) partes.push('empresa');
    }
    partes.push('conta contábil');
    const lista = partes.length > 1
      ? `${partes.slice(0, -1).join(', ')} ou ${partes[partes.length - 1]}`
      : partes[0];
    return `Duplo clique para detalhar por ${lista}`;
  }, [drill, crs.length, empresas.length]);

  const abrirMenuDrill = useCallback((e: React.MouseEvent, line: any) => {
    e.preventDefault();
    e.stopPropagation();
    if (!podeDetalharLinha(line)) return;
    const origem: DrillOrigem = !drill ? 'raiz' : (drill.level as DrillOrigem);
    const refId = origem === 'cr' ? line.crId : origem === 'empresa' ? line.empresaId : undefined;
    // Ancora no ponto do clique, mas sem deixar o menu sair da viewport.
    const x = Math.min(e.clientX, window.innerWidth - 200);
    const y = Math.min(e.clientY, window.innerHeight - 180);
    setDrillMenu({ x: Math.max(8, x), y: Math.max(8, y), prefixo: line.prefixo, sinal: line.sinal, label: line.label, origem, refId });
  }, [drill, podeDetalharLinha]);

  const cancelarCliqueLinha = () => {
    if (cliqueLinhaRef.current) { clearTimeout(cliqueLinhaRef.current); cliqueLinhaRef.current = null; }
  };

  // Duplo clique na linha ou no agrupador: cancela o clique simples pendente e
  // abre a lista de perspectivas do drill.
  const duploCliqueLinha = useCallback((e: React.MouseEvent, line: any) => {
    cancelarCliqueLinha();
    esconderDicaDrill();
    abrirMenuDrill(e, line);
  }, [abrirMenuDrill, esconderDicaDrill]);

  // Filtros gerais mudaram: a abertura em tela perderia a validade, entao fecha.
  useEffect(() => { setExpandedContas({}); }, [mesInicio, mesFim, crFilterCsv, selectedCiclo]);

  const toggleExpandConta = useCallback(async (prefixo: string, sinal: number) => {
    if (expandedContas[prefixo]) { setExpandedContas(prev => { const n = { ...prev }; delete n[prefixo]; return n; }); return; }
    if (!selectedCiclo) return;
    const c = ciclos.find((ci: any) => ci.ID === selectedCiclo);
    if (!c) return;
    const mc = contas.filter((ct: any) => String(ct.CODIGO || '').startsWith(prefixo));
    if (!mc.length) { setExpandedContas(prev => ({ ...prev, [prefixo]: [] })); return; }
    const ids = mc.map((ct: any) => ct.ID).join(',');
    setExpandingConta(prefixo);
    try {
      const crCsv = hasCRFilter ? crFilterCsv : gestorCrCsv;
      const [oR, rR, rAtualR] = await Promise.all([
        execSF(SF_IDS.dreOrcadoPorConta, { cicloId: selectedCiclo, crIds: crCsv, contaIds: ids }),
        execSF(SF_IDS.dreRealizadoPorConta, { ano: c.ANO - 1, crIds: crCsv, contaIds: ids, empresaId: '' }),
        execSF(SF_IDS.dreRealizadoPorConta, { ano: c.ANO, crIds: crCsv, contaIds: ids, empresaId: '' }),
      ]);
      const gv = (d: any[], cid: number, m: number) => { const e = d.find((x: any) => x.CONTA_ID === cid && x.MES === m); return e ? Math.round(Number(e.VALOR)) : 0; };
      const filhas: DRELine[] = mc.map((conta: any) => {
        const ov = visibleMonths.map(m => gv(oR, conta.ID, m) * sinal);
        const rv = visibleMonths.map(m => gv(rR, conta.ID, m) * sinal);
        const realAtualValues = visibleMonths.map(m => gv(rAtualR, conta.ID, m) * sinal);
        const consolidadoValues = visibleMonths.map((m, i) => rAtualR.some((r: any) => r.CONTA_ID === conta.ID && r.MES === m) ? realAtualValues[i] : ov[i]);
        return { label: `${conta.CODIGO} - ${conta.NOME}`, isSubtotal: false, isHighlight: false, prefixo: conta.CODIGO, sinal, orcValues: ov, realValues: rv, realAtualValues, consolidadoValues, totalOrc: ov.reduce((a, b) => a + b, 0), totalReal: rv.reduce((a, b) => a + b, 0), totalRealAtual: realAtualValues.reduce((a, b) => a + b, 0), totalConsolidado: consolidadoValues.reduce((a, b) => a + b, 0) };
      });
      setExpandedContas(prev => ({ ...prev, [prefixo]: filhas }));
    } catch (e) { console.error(e); }
    setExpandingConta(null);
  }, [expandedContas, selectedCiclo, ciclos, contas, visibleMonths, hasCRFilter, crFilterCsv, gestorCrCsv]);

  const handleDrillByEmpresa = useCallback(async (prefixo: string, sinal: number, label: string) => {
    if (!selectedCiclo) return;
    const c = ciclos.find((ci: any) => ci.ID === selectedCiclo);
    if (!c) return;
    const mc = contas.filter((ct: any) => ct.CODIGO.startsWith(prefixo));
    if (!mc.length) { setDrill({ lineLabel: label, prefixo, sinal, level: 'empresa' }); setDrillLines([]); return; }
    const ids = mc.map((ct: any) => ct.ID).join(',');
    setDrill({ lineLabel: label, prefixo, sinal, level: 'empresa' }); setDrillLoading(true);
    try {
      const crCsv = hasCRFilter ? crFilterCsv : gestorCrCsv;
      const [oR, rR, rAtualR] = await Promise.all([
        execSF(SF_IDS.dreOrcadoPorEmpresa, { cicloId: selectedCiclo, contaIds: ids, crIds: crCsv }),
        execSF(SF_IDS.dreRealizadoPorEmpresa, { ano: c.ANO - 1, contaIds: ids, crIds: crCsv }),
        execSF(SF_IDS.dreRealizadoPorEmpresa, { ano: c.ANO, contaIds: ids, crIds: crCsv }),
      ]);
      const gv = (d: any[], empId: number, m: number) => { const e = d.find((x: any) => x.EMPRESA_ID === empId && x.MES === m); return e ? Math.round(Number(e.VALOR)) : 0; };
      const allIds = new Set([...oR.map((r: any) => r.EMPRESA_ID), ...rR.map((r: any) => r.EMPRESA_ID), ...rAtualR.map((r: any) => r.EMPRESA_ID)]);
      const lines: (DRELine & { empresaId?: number })[] = [];
      allIds.forEach(empId => {
        const emp = empresas.find((e: any) => e.ID === empId);
        const ov = visibleMonths.map(m => gv(oR, empId, m) * sinal);
        const rv = visibleMonths.map(m => gv(rR, empId, m) * sinal);
        const realAtualValues = visibleMonths.map(m => gv(rAtualR, empId, m) * sinal);
        const consolidadoValues = visibleMonths.map((m, i) => rAtualR.some((r: any) => r.EMPRESA_ID === empId && r.MES === m) ? realAtualValues[i] : ov[i]);
        lines.push({ label: emp ? emp.NOME : `Empresa ${empId}`, isSubtotal: false, isHighlight: false, prefixo, sinal, orcValues: ov, realValues: rv, realAtualValues, consolidadoValues, totalOrc: ov.reduce((a, b) => a + b, 0), totalReal: rv.reduce((a, b) => a + b, 0), totalRealAtual: realAtualValues.reduce((a, b) => a + b, 0), totalConsolidado: consolidadoValues.reduce((a, b) => a + b, 0), empresaId: empId });
      });
      lines.sort((a, b) => Math.abs(b.totalOrc) - Math.abs(a.totalOrc));
      setDrillLines(lines);
    } catch (e) { console.error(e); }
    setDrillLoading(false);
  }, [selectedCiclo, ciclos, contas, visibleMonths, empresas, hasCRFilter, crFilterCsv, gestorCrCsv]);

  const handleDrillEmpresaToConta = useCallback(async (empresaId: number, empresaLabel: string) => {
    if (!selectedCiclo || !drill) return;
    const c = ciclos.find((ci: any) => ci.ID === selectedCiclo);
    if (!c) return;
    setDrill(prev => prev ? { ...prev, level: 'conta', empresaId, empresaLabel } : prev);
    setDrillLoading(true);
    try {
      const mc = contas.filter((ct: any) => ct.CODIGO.startsWith(drill.prefixo));
      if (!mc.length) { setDrillLines([]); setDrillLoading(false); return; }
      const ids = mc.map((ct: any) => ct.ID).join(',');
      const crIdsOfEmpresa = crs.filter((cr: any) => cr.EMPRESA_ID === empresaId).map((cr: any) => cr.ID);
      const crIn = crIdsOfEmpresa.length ? crIdsOfEmpresa.join(',') : '0';
      const [oR, rR, rAtualR] = await Promise.all([
        execSF(SF_IDS.dreOrcadoPorConta, { cicloId: selectedCiclo, crIds: crIn, contaIds: ids }),
        execSF(SF_IDS.dreRealizadoPorConta, { ano: c.ANO - 1, crIds: '', contaIds: ids, empresaId: String(empresaId) }),
        execSF(SF_IDS.dreRealizadoPorConta, { ano: c.ANO, crIds: '', contaIds: ids, empresaId: String(empresaId) }),
      ]);
      const gv = (d: any[], cid: number, m: number) => { const e = d.find((x: any) => x.CONTA_ID === cid && x.MES === m); return e ? Math.round(Number(e.VALOR)) : 0; };
      setDrillLines(mc.map((conta: any) => {
        const ov = visibleMonths.map(m => gv(oR, conta.ID, m) * drill.sinal);
        const rv = visibleMonths.map(m => gv(rR, conta.ID, m) * drill.sinal);
        const realAtualValues = visibleMonths.map(m => gv(rAtualR, conta.ID, m) * drill.sinal);
        const consolidadoValues = visibleMonths.map((m, i) => rAtualR.some((r: any) => r.CONTA_ID === conta.ID && r.MES === m) ? realAtualValues[i] : ov[i]);
        return { label: `${conta.CODIGO} - ${conta.NOME}`, isSubtotal: false, isHighlight: false, prefixo: conta.CODIGO, sinal: drill.sinal, orcValues: ov, realValues: rv, realAtualValues, consolidadoValues, totalOrc: ov.reduce((a, b) => a + b, 0), totalReal: rv.reduce((a, b) => a + b, 0), totalRealAtual: realAtualValues.reduce((a, b) => a + b, 0), totalConsolidado: consolidadoValues.reduce((a, b) => a + b, 0) };
      }));
    } catch (e) { console.error(e); }
    setDrillLoading(false);
  }, [selectedCiclo, ciclos, contas, visibleMonths, drill, crs]);

  const handleDrillCrToConta = useCallback(async (crId: number, crLabel: string) => {
    if (!selectedCiclo || !drill) return;
    const c = ciclos.find((ci: any) => ci.ID === selectedCiclo);
    if (!c) return;
    setDrill(prev => prev ? { ...prev, level: 'conta', crId, crLabel } : prev);
    setDrillLoading(true);
    try {
      const mc = contas.filter((ct: any) => ct.CODIGO.startsWith(drill.prefixo));
      if (!mc.length) { setDrillLines([]); setDrillLoading(false); return; }
      const ids = mc.map((ct: any) => ct.ID).join(',');
      const [oR, rR, rAtualR] = await Promise.all([
        execSF(SF_IDS.dreOrcadoPorConta, { cicloId: selectedCiclo, crIds: String(crId), contaIds: ids }),
        execSF(SF_IDS.dreRealizadoPorConta, { ano: c.ANO - 1, crIds: String(crId), contaIds: ids, empresaId: '' }),
        execSF(SF_IDS.dreRealizadoPorConta, { ano: c.ANO, crIds: String(crId), contaIds: ids, empresaId: '' }),
      ]);
      const gv = (d: any[], cid: number, m: number) => { const e = d.find((x: any) => x.CONTA_ID === cid && x.MES === m); return e ? Math.round(Number(e.VALOR)) : 0; };
      setDrillLines(mc.map((conta: any) => {
        const ov = visibleMonths.map(m => gv(oR, conta.ID, m) * drill.sinal);
        const rv = visibleMonths.map(m => gv(rR, conta.ID, m) * drill.sinal);
        const realAtualValues = visibleMonths.map(m => gv(rAtualR, conta.ID, m) * drill.sinal);
        const consolidadoValues = visibleMonths.map((m, i) => rAtualR.some((r: any) => r.CONTA_ID === conta.ID && r.MES === m) ? realAtualValues[i] : ov[i]);
        return { label: `${conta.CODIGO} - ${conta.NOME}`, isSubtotal: false, isHighlight: false, prefixo: conta.CODIGO, sinal: drill.sinal, orcValues: ov, realValues: rv, realAtualValues, consolidadoValues, totalOrc: ov.reduce((a, b) => a + b, 0), totalReal: rv.reduce((a, b) => a + b, 0), totalRealAtual: realAtualValues.reduce((a, b) => a + b, 0), totalConsolidado: consolidadoValues.reduce((a, b) => a + b, 0) };
      }));
    } catch (e) { console.error(e); }
    setDrillLoading(false);
  }, [selectedCiclo, ciclos, contas, visibleMonths, drill]);

  const activeLines = useMemo(() => {
    const lines = drill ? drillLines : dreLines;
    if (!searchTerm.trim()) return lines;
    const t = searchTerm.toLowerCase();
    const matches = lines.filter(l => !l.isSubtotal && l.label.toLowerCase().includes(t));
    if (matches.length === 0) return [];
    const matchSet = new Set(matches);
    return lines.filter(l => l.isSubtotal || matchSet.has(l));
  }, [drill, drillLines, dreLines, searchTerm]);

  const activeLoading = drill ? drillLoading : loading;
  const monthOptions = Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: monthsFull[i] }));

  const varColor = (pct: number) => {
    if (pct > 2) return 'var(--dre-var-pos)';
    if (pct < -2) return 'var(--dre-var-neg)';
    return 'var(--color-text-muted)';
  };

  // ─── KPI card ──────────────────────────
  // Mesmo padrao de icone do Dashboard: bolha cinza neutra + icone azul.
  const KPI = ({ label, orc, real, icon: Icon }: { label: string; orc: number; real: number; icon: any }) => {
    const v = pctChange(orc, real);
    return (
      <div className="rounded-xl p-5 border" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: 'color-mix(in srgb, #3b82f6 12%, transparent)' }}>
            <Icon size={18} style={{ color: '#3b82f6' }} strokeWidth={2} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>{label}</p>
            <p className="text-xl font-semibold tabular-nums" style={{ color: 'var(--color-text)' }}>{fmtVal(orc)}</p>
            <div className="flex items-center gap-1.5">
              <span className="text-xs tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>Real A.A. {fmtVal(real)}</span>
              <span className="text-xs font-semibold tabular-nums" style={{ color: varColor(v) }}>{fmtPct(v)}</span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ─── Table cell render ─────────────────
  const visibleSeriesCount = [showRealAa, showOrc, showRealAtual, showConsolidado].filter(Boolean).length;
  const lastVisibleSeries = showConsolidado ? 'consolidado' : showRealAtual ? 'realAtual' : showOrc ? 'orc' : 'realAa';
  const hiddenColCount = [!showRealAa, !showOrc, !showRealAtual, !showConsolidado].filter(Boolean).length;

  const ValCell = ({ realAa, orc, realAtual, consolidado, isSub, isHL, isLast }: { realAa: number; orc: number; realAtual: number; consolidado: number; isSub: boolean; isHL: boolean; isLast?: boolean }) => {
    const rowCls = `${isSub ? ' dre-sub' : ''}${isHL ? ' dre-hl' : ''}`;

    return (
      <>
        {showRealAa && <td className={`dre-cell dre-real${lastVisibleSeries === 'realAa' && isLast ? ' dre-month-sep' : ''}${rowCls}`}><div className="dre-val">{fmtFull(realAa)}</div></td>}
        {showOrc && <td className={`dre-cell${lastVisibleSeries === 'orc' && isLast ? ' dre-month-sep' : ''}${rowCls}`}><div className="dre-val">{fmtFull(orc)}</div></td>}
        {showRealAtual && <td className={`dre-cell dre-real${lastVisibleSeries === 'realAtual' && isLast ? ' dre-month-sep' : ''}${rowCls}`}><div className="dre-val">{fmtFull(realAtual)}</div></td>}
        {showConsolidado && <td className={`dre-cell dre-col-atual${lastVisibleSeries === 'consolidado' && isLast ? ' dre-month-sep' : ''}${rowCls}`}><div className="dre-val">{fmtFull(consolidado)}</div></td>}
      </>
    );
  };

  const TotalCell = ({ realAa, orc, realAtual, consolidado, isSub, isHL }: { realAa: number; orc: number; realAtual: number; consolidado: number; isSub: boolean; isHL: boolean }) => {
    const rowCls = `${isSub ? ' dre-sub' : ''}${isHL ? ' dre-hl' : ''}`;
    return (
      <>
        {showRealAa && <td className={`dre-cell dre-total dre-real${rowCls}`}><div className="dre-val">{fmtFull(realAa)}</div></td>}
        {showOrc && <td className={`dre-cell dre-total${rowCls}`}><div className="dre-val">{fmtFull(orc)}</div></td>}
        {showRealAtual && <td className={`dre-cell dre-total dre-real${rowCls}`}><div className="dre-val">{fmtFull(realAtual)}</div></td>}
        {showConsolidado && <td className={`dre-cell dre-total dre-col-atual${rowCls}`}><div className="dre-val">{fmtFull(consolidado)}</div></td>}
      </>
    );
  };

  const monthColSpan = visibleSeriesCount || 1;
  const subLabels = [
    showRealAa && 'Realizado A.A.',
    showOrc && 'Orçado',
    showRealAtual && 'Realizado atual',
    showConsolidado && LABEL_CONSOLIDADO,
  ].filter(Boolean) as string[];

  return (
    <div className="animate-fadeIn" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Header — refined title hierarchy */}
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-semibold" style={{ color: 'var(--color-text)', fontSize: '20px' }}>DRE Mensal</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>
            {ciclo ? `${ciclo.NOME} ${ciclo.ANO} — ${monthsShort[mesInicio - 1]} a ${monthsShort[mesFim - 1]}` : 'Demonstrativo de Resultado do Exercício'}
          </p>
        </div>

        {/* Filtros gerais (periodo e CR) — afetam KPIs e tabela, por isso ficam no topo. */}
        <div className="dre-filters flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1.5" style={{ color: 'var(--color-text-muted)' }}>
          <select className="dre-filter-select" style={{ width: 120 }} value={mesInicio}
            onChange={(e) => { setMesInicio(Number(e.target.value)); setDrill(null); }}>
            {monthOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <span className="text-xs font-medium">a</span>
          <select className="dre-filter-select" style={{ width: 120 }} value={mesFim}
            onChange={(e) => { setMesFim(Number(e.target.value)); setDrill(null); }}>
            {monthOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        {/* Filtro de CR — admin ve todos; gestor ve so os seus */}
        {(() => {
          const visibleCRs = isLockedGestor
            ? crs.filter((cr: any) => gestorCRIds?.includes(cr.ID))
            : crs;
          if (visibleCRs.length === 0) return null;
          return (
            <div className="w-56">
              <MultiSelect
                values={selectedCRs}
                onChange={(vals) => { setSelectedCRs(vals); setDrill(null); }}
                allLabel={isLockedGestor ? 'Todos os meus CRs' : 'Todos os CRs'}
                options={visibleCRs.map((cr: any) => ({ value: String(cr.ID), label: cr.NOME }))}
              />
            </div>
          );
        })()}
        </div>
      </div>

      {/* KPI strip — enquanto a rede responde, skeleton no lugar dos zeros iniciais.
          Usa `loading` (buildDRE) e nao `activeLoading`: o drill so troca as linhas
          da tabela, os KPIs continuam valendo. Gatear no drill faria a faixa inteira
          piscar para voltar com exatamente os mesmos numeros. */}
      {(baseLoading || loading) ? (
        <SkeletonKpis count={4} className="grid grid-cols-2 lg:grid-cols-4 gap-3" />
      ) : (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KPI label="Receita Líquida" orc={kpis.receitaLiq} real={kpis.receitaLiqReal} icon={DollarSign} />
        <KPI label="EBITDA" orc={kpis.ebitda} real={kpis.ebitdaReal} icon={TrendingUp} />
        <KPI label="Resultado" orc={kpis.resultadoLiq} real={kpis.resultadoLiqReal} icon={kpis.resultadoLiq >= 0 ? TrendingUp : TrendingDown} />
        <div className="rounded-xl p-5 border" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: 'color-mix(in srgb, #3b82f6 12%, transparent)' }}>
              <Percent size={18} style={{ color: '#3b82f6' }} strokeWidth={2} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>Margem EBITDA</p>
              <p className="text-xl font-semibold tabular-nums" style={{ color: 'var(--color-text)' }}>{kpis.margemEbitda.toFixed(1)}%</p>
              <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                Real A.A. {kpis.receitaLiqReal !== 0 ? ((kpis.ebitdaReal / kpis.receitaLiqReal) * 100).toFixed(1) : '0.0'}%
              </p>
            </div>
          </div>
        </div>
      </div>
      )}

      {/* Controls — compact filter bar */}
      <div className="dre-filters flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-muted)' }} />
          <input type="text" placeholder="Buscar..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-8 pr-3 text-xs w-full rounded-lg transition-all duration-200 focus:outline-none focus:ring-2 focus:border-transparent"
            style={{ height: 32, backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)', boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)', '--tw-ring-color': 'var(--color-primary-light)' } as any} />
        </div>

        <div className="relative">
          <button onClick={() => setShowColPicker(!showColPicker)} className={`inline-flex items-center gap-1.5 px-3 text-xs rounded-lg transition-all duration-200 cursor-pointer ${hiddenColCount > 0 ? 'font-bold' : 'font-medium'}`}
            style={{ height: 32, border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', backgroundColor: 'var(--color-surface)', boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)' }}>
            {hiddenColCount > 0 ? <EyeOff size={14} /> : <Eye size={14} />}
            <span className="whitespace-nowrap">Exibir colunas</span>
            <ChevronDown size={12} />
          </button>
          {showColPicker && (
            <div className="absolute z-30 mt-1 rounded-lg shadow-lg p-1.5 min-w-[190px] animate-scaleIn" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              {[
                { label: 'Realizado A.A.', active: showRealAa, toggle: () => { if (showRealAa && visibleSeriesCount <= 1) return; setShowRealAa(v => !v); } },
                { label: 'Orçado', active: showOrc, toggle: () => { if (showOrc && visibleSeriesCount <= 1) return; setShowOrc(v => !v); } },
                { label: 'Realizado atual', active: showRealAtual, toggle: () => { if (showRealAtual && visibleSeriesCount <= 1) return; setShowRealAtual(v => !v); } },
                { label: 'Orçado + realizado', active: showConsolidado, toggle: () => { if (showConsolidado && visibleSeriesCount <= 1) return; setShowConsolidado(v => !v); } },
              ].map(opt => (
                <button key={opt.label} onClick={opt.toggle} className="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-md text-xs font-medium transition-all"
                  style={{ color: opt.active ? 'var(--color-primary)' : 'var(--color-text-muted)', backgroundColor: opt.active ? 'var(--color-primary-bg)' : 'transparent' }}>
                  {opt.active ? <Eye size={14} /> : <EyeOff size={14} />}
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>

      </div>

      {/* Drill breadcrumb */}
      {drill && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <button onClick={() => { setDrill(null); setSearchTerm(''); }}
            className="flex items-center gap-1 text-xs font-medium rounded-md px-2 py-1 hover:underline"
            style={{ color: 'var(--color-primary)' }}>
            <ArrowLeft size={13} /> DRE
          </button>
          <ChevronRight size={13} style={{ color: 'var(--color-text-muted)' }} />
          {drill.level === 'cr' ? (
            <div className="flex items-center gap-1.5">
              <Building2 size={14} style={{ color: 'var(--color-text-muted)' }} />
              <span className="font-medium text-sm" style={{ color: 'var(--color-text)' }}>{drill.lineLabel}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{ backgroundColor: 'var(--bg-active)', color: 'var(--color-primary)' }}>por CR</span>
            </div>
          ) : drill.level === 'empresa' ? (
            <div className="flex items-center gap-1.5">
              <Landmark size={14} style={{ color: 'var(--color-text-muted)' }} />
              <span className="font-medium text-sm" style={{ color: 'var(--color-text)' }}>{drill.lineLabel}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{ backgroundColor: 'var(--bg-active)', color: 'var(--color-primary)' }}>por Empresa</span>
            </div>
          ) : drill.crLabel ? (
            <>
              <button onClick={() => { handleDrillByCR(drill.prefixo, drill.sinal, drill.lineLabel); setSearchTerm(''); }}
                className="flex items-center gap-1 text-xs font-medium rounded-md px-2 py-1 hover:underline"
                style={{ color: 'var(--color-primary)' }}>
                <Building2 size={13} /> {drill.lineLabel}
              </button>
              <ChevronRight size={13} style={{ color: 'var(--color-text-muted)' }} />
              <span className="font-medium text-sm" style={{ color: 'var(--color-text)' }}>{drill.crLabel}</span>
            </>
          ) : drill.empresaLabel ? (
            <>
              <button onClick={() => { handleDrillByEmpresa(drill.prefixo, drill.sinal, drill.lineLabel); setSearchTerm(''); }}
                className="flex items-center gap-1 text-xs font-medium rounded-md px-2 py-1 hover:underline"
                style={{ color: 'var(--color-primary)' }}>
                <Landmark size={13} /> {drill.lineLabel}
              </button>
              <ChevronRight size={13} style={{ color: 'var(--color-text-muted)' }} />
              <span className="font-medium text-sm" style={{ color: 'var(--color-text)' }}>{drill.empresaLabel}</span>
            </>
          ) : (
            <span className="font-medium text-sm" style={{ color: 'var(--color-text)' }}>{drill.lineLabel}</span>
          )}
        </div>
      )}

      {/* DRE Table */}
      {(baseLoading || activeLoading) ? (
        <SkeletonTable columns={8} rows={15} firstColWidth="240px" />
      ) : (
      <div className="dre-table-wrap rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)' }}>
        {activeLines.length === 0 ? (
          searchTerm.trim() ? (
            <div className="text-center py-16" style={{ color: 'var(--color-text-muted)' }}>
              <div className="flex flex-col items-center gap-2">
                <Search size={24} style={{ color: 'var(--color-text-muted)', opacity: 0.5 }} />
                <p className="text-sm font-medium">Nenhum resultado encontrado para "{searchTerm}"</p>
                <p className="text-xs">Tente buscar por outro termo</p>
              </div>
            </div>
          ) : (
            <div className="text-center py-16 text-sm" style={{ color: 'var(--color-text-muted)' }}>Sem dados para exibir</div>
          )
        ) : (
          <div className="overflow-x-auto">
            <table className="dre-table w-full">
              <thead className="sticky top-0 z-10" style={{ backgroundColor: 'var(--color-surface)', boxShadow: '0 1px 0 0 var(--color-border)' }}>
                {/* Row 1: Month names — centered over their column group */}
                <tr>
                  <th className="dre-th dre-th-label sticky left-0 z-10" rowSpan={monthColSpan > 1 ? 2 : 1} style={{ backgroundColor: 'var(--color-surface)', verticalAlign: 'middle' }}>Conta / Linha</th>
                  {visibleMonths.map((m, mIdx) => {
                    const isLastMonth = mIdx === visibleMonths.length - 1;
                    const sepCls = !isLastMonth ? ' dre-th-month-sep' : '';
                    return (
                      <th key={m} colSpan={monthColSpan} className={`dre-th dre-th-month${sepCls}`} style={{ textAlign: 'center' }}>
                        {MONTHS[m - 1]}
                      </th>
                    );
                  })}
                  <th colSpan={monthColSpan} className="dre-th dre-th-total" style={{ textAlign: 'center' }}>Total</th>
                </tr>
                {monthColSpan > 1 && <tr>
                  {visibleMonths.map((m, mIdx) => {
                    const isLastMonth = mIdx === visibleMonths.length - 1;
                    return (
                      <Fragment key={m}>
                        {subLabels.map((sl, slIdx) => {
                          const sepCls = (slIdx === subLabels.length - 1 && !isLastMonth) ? ' dre-th-sub-sep' : '';
                          const atualCls = sl === LABEL_CONSOLIDADO ? ' dre-col-atual' : '';
                          return <th key={`${m}-${sl}`} className={`dre-th-sub${sepCls}${atualCls}`} style={{ textAlign: 'center' }}>{sl}</th>;
                        })}
                      </Fragment>
                    );
                  })}
                  {subLabels.map(sl => <th key={`total-${sl}`} className={`dre-th-sub${sl === LABEL_CONSOLIDADO ? ' dre-col-atual' : ''}`} style={{ textAlign: 'center' }}>{sl}</th>)}
                </tr>}
              </thead>
              <tbody>
                {activeLines.map((line, idx) => {
                  const canDrill = !line.isSubtotal && (
                    (!drill && line.prefixo) ||
                    (drill?.level === 'cr' && (line as any).crId) ||
                    (drill?.level === 'empresa' && (line as any).empresaId)
                  );
                  return (
                  <Fragment key={idx}>
                  <tr
                    className={`dre-row ${line.isSubtotal ? 'dre-row-sub' : ''} ${line.isHighlight ? 'dre-row-hl' : ''} ${canDrill ? 'dre-row-drill' : ''}`}
                    onClick={() => {
                      esconderDicaDrill();
                      if (drill || line.isSubtotal || !line.prefixo) return;
                      cancelarCliqueLinha();
                      cliqueLinhaRef.current = setTimeout(() => { cliqueLinhaRef.current = null; toggleExpandConta(line.prefixo, line.sinal); }, 250);
                    }}
                    onDoubleClick={(e) => duploCliqueLinha(e, line)}
                    // Duplo clique nao deve selecionar o texto da linha.
                    onMouseDown={(e) => { if (e.detail > 1) e.preventDefault(); }}
                    onMouseEnter={(e) => { if (canDrill) agendarDicaDrill(e); }}
                    onMouseMove={(e) => { if (canDrill) moverDicaDrill(e); }}
                    onMouseLeave={esconderDicaDrill}
                  >
                    <td className={`dre-label sticky left-0 z-10 ${line.isSubtotal ? 'dre-sub' : ''} ${line.isHighlight ? 'dre-hl' : ''}`}
                      style={{ backgroundColor: line.isSubtotal ? 'var(--dre-sub-bg)' : line.isHighlight ? 'var(--dre-hl-bg)' : 'var(--color-surface)' }}>
                      {/* Botao de secao expansivel: abre as contas contabeis na propria visao principal. */}
                      {!drill && line.prefixo && !line.isSubtotal ? (
                        <span className="inline-flex items-center gap-1">
                          <button type="button"
                            onClick={(e) => { e.stopPropagation(); toggleExpandConta(line.prefixo, line.sinal); }}
                            onDoubleClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center justify-center rounded cursor-pointer border-0 bg-transparent p-0"
                            style={{ color: 'var(--color-text-muted)', width: 14, height: 14 }}
                            title={expandedContas[line.prefixo] ? 'Fechar contas contábeis' : 'Abrir contas contábeis'}>
                            {expandedContas[line.prefixo] ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                          </button>
                          <span>{line.label}</span>
                          {/* Afordancia explicita do drill: o duplo clique
                              continua valendo, mas ninguem descobre sozinho. */}
                          <button type="button"
                            onClick={(e) => { e.stopPropagation(); abrirMenuDrill(e, line); }}
                            onDoubleClick={(e) => e.stopPropagation()}
                            className="dre-drill-btn inline-flex items-center justify-center rounded cursor-pointer border-0 bg-transparent p-0"
                            style={{ color: 'var(--color-text-muted)', width: 16, height: 16 }}
                            title="Detalhar por...">
                            <Layers size={12} />
                          </button>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          <span>{line.label}</span>
                          {podeDetalharLinha(line) && (
                            <button type="button"
                              onClick={(e) => { e.stopPropagation(); abrirMenuDrill(e, line); }}
                              onDoubleClick={(e) => e.stopPropagation()}
                              className="dre-drill-btn inline-flex items-center justify-center rounded cursor-pointer border-0 bg-transparent p-0"
                              style={{ color: 'var(--color-text-muted)', width: 16, height: 16 }}
                              title="Detalhar por...">
                              <Layers size={12} />
                            </button>
                          )}
                        </span>
                      )}
                    </td>
                    {line.orcValues.map((ov, i) => {
                      const isLastMonth = i === visibleMonths.length - 1;
                      return <ValCell key={i} realAa={line.realValues[i]} orc={ov} realAtual={line.realAtualValues[i]} consolidado={line.consolidadoValues[i]} isSub={line.isSubtotal} isHL={line.isHighlight} isLast={!isLastMonth} />;
                    })}
                    <TotalCell realAa={line.totalReal} orc={line.totalOrc} realAtual={line.totalRealAtual} consolidado={line.totalConsolidado} isSub={line.isSubtotal} isHL={line.isHighlight} />
                  </tr>
                  {/* Abertura por conta contabil: linhas filhas logo abaixo do rotulo */}
                  {!drill && line.prefixo && expandingConta === line.prefixo && (
                    <tr className="dre-row dre-row-child">
                      <td className="dre-label sticky left-0 z-10" style={{ backgroundColor: 'var(--color-surface)' }}>Carregando contas...</td>
                      <td colSpan={(visibleMonths.length + 1) * monthColSpan} />
                    </tr>
                  )}
                  {!drill && line.prefixo && expandedContas[line.prefixo]?.length === 0 && (
                    <tr className="dre-row dre-row-child">
                      <td className="dre-label sticky left-0 z-10">Nenhuma conta contábil vinculada a esta linha</td>
                      <td colSpan={(visibleMonths.length + 1) * monthColSpan} />
                    </tr>
                  )}
                  {!drill && line.prefixo && (expandedContas[line.prefixo] || []).map((child, cIdx) => (
                    <tr key={`${idx}-c${cIdx}`} className="dre-row dre-row-child">
                      <td className="dre-label sticky left-0 z-10" style={{ backgroundColor: 'var(--color-surface)' }}>
                        <span>{child.label}</span>
                      </td>
                      {child.orcValues.map((ov, i) => (
                        <ValCell key={i} realAa={child.realValues[i]} orc={ov} realAtual={child.realAtualValues[i]} consolidado={child.consolidadoValues[i]} isSub={false} isHL={false} isLast={i !== visibleMonths.length - 1} />
                      ))}
                      <TotalCell realAa={child.totalReal} orc={child.totalOrc} realAtual={child.totalRealAtual} consolidado={child.totalConsolidado} isSub={false} isHL={false} />
                    </tr>
                  ))}
                  </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      )}
      {!drill && <p className="text-[10px] text-center" style={{ color: 'var(--color-text-muted)' }}>Clique na linha para abrir as contas contábeis · duplo clique (ou o ícone da linha) para detalhar por CR, empresa ou conta</p>}
      {(drill?.level === 'cr' || drill?.level === 'empresa') && <p className="text-[10px] text-center" style={{ color: 'var(--color-text-muted)' }}>Duplo clique (ou o ícone da linha) para detalhar por conta contábil</p>}

      {/* Dica de hover: avisa que o duplo clique abre o drill da linha */}
      {dicaDrill && !drillMenu && <DicaDrill x={dicaDrill.x} y={dicaDrill.y} texto={dicaDrillTexto} />}

      {/* Menu de perspectivas do drill — compacto, padrao do design system */}
      {drillMenu && (() => {
        const m = drillMenu;
        const fechar = () => setDrillMenu(null);
        // Perspectivas oferecidas conforme o ponto da navegacao e o que existe
        // de fato na base (sem CR cadastrado nao ha o que detalhar por CR).
        const opcoes: { icone: any; rotulo: string; acao: () => void }[] = [];
        if (m.origem === 'raiz') {
          if (crs.length > 0) opcoes.push({ icone: Building2, rotulo: 'Centro de resultado', acao: () => handleDrillByCR(m.prefixo, m.sinal, m.label) });
          if (empresas.length > 0) opcoes.push({ icone: Landmark, rotulo: 'Empresa', acao: () => handleDrillByEmpresa(m.prefixo, m.sinal, m.label) });
          opcoes.push({ icone: ListTree, rotulo: 'Conta contábil', acao: () => toggleExpandConta(m.prefixo, m.sinal) });
        } else if (m.origem === 'cr' && m.refId !== undefined) {
          opcoes.push({ icone: ListTree, rotulo: 'Conta contábil', acao: () => handleDrillCrToConta(m.refId!, m.label) });
        } else if (m.origem === 'empresa' && m.refId !== undefined) {
          opcoes.push({ icone: ListTree, rotulo: 'Conta contábil', acao: () => handleDrillEmpresaToConta(m.refId!, m.label) });
        }
        if (opcoes.length === 0) return null;
        return (
          <>
            <div className="fixed inset-0 z-40" onClick={fechar} onContextMenu={(e) => { e.preventDefault(); fechar(); }} />
            <div ref={drillMenuRef} className="fixed z-50 animate-scaleIn py-0.5"
              style={{
                left: m.x, top: m.y, minWidth: 180, transformOrigin: 'top left',
                backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border)',
                borderRadius: 16, boxShadow: 'var(--shadow-pop)',
              }}>
              <div className="px-3 py-2" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <span className="rotulo-secao" style={{ fontSize: 10 }}>Detalhar por</span>
                <div className="truncate mt-0.5" style={{ fontSize: 12, color: 'var(--fg-subtle)', maxWidth: 200 }}>{m.label}</div>
              </div>
              {opcoes.map((o) => {
                const Icone = o.icone;
                return (
                  <button key={o.rotulo} onClick={() => { fechar(); o.acao(); }}
                    className="popover-item"
                    style={{ fontWeight: 500 }}>
                    <Icone size={15} style={{ color: 'var(--accent)' }} />
                    {o.rotulo}
                  </button>
                );
              })}
            </div>
          </>
        );
      })()}

      {showColPicker && <div className="fixed inset-0 z-20" onClick={() => setShowColPicker(false)} />}

    </div>
  );
}
