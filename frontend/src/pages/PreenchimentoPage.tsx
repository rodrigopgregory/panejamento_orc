import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useSF, execSF, execSFCached, formatCurrency, avaliarWorkflow, avaliarErroMsg } from '../hooks/useMitraData';
import Button from '../components/ui/Button';
import Badge from '../components/ui/Badge';
import { ToastContainer } from '../components/ui/Toast';
import { useToast } from '../hooks/useToast';
import { registerAllModules } from 'handsontable/registry';
import numbro from 'numbro';
import { toTitleCase } from '../lib/utils';
import { getUser } from '../lib/auth';
import { escolherVersaoVigente, versaoEhFechada } from '../lib/versao-vigente';
// @ts-ignore — numbro language file has no type declarations
import numbroPtBR from 'numbro/languages/pt-BR';
import {
  ChevronRight, ChevronDown, ArrowLeft, Package,
  BarChart3, Check,
  Send, MessageSquare,
} from 'lucide-react';
import {
  CHART_COLORS, CHART_SEQUENCE,
  RechartsBar, XAxis, YAxis, CartesianGrid,
  Cell,
  ComposedChart, ChartContainer, ChartTooltip, ChartLegend,
} from '../components/ui/Chart';
type ChartConfig = { [k: string]: { label?: string; color?: string } };
import OrcamentoContent from '../components/OrcamentoContent';
import { Skeleton, SkeletonCard, SkeletonCards } from '../components/ui/Skeleton';

registerAllModules();
numbro.registerLanguage(numbroPtBR);
numbro.setLanguage('pt-BR');

// Campo JSON vindo de uma SF SQL (JSON_ARRAYAGG/JSON_OBJECT): pode chegar como string
// ou ja parseado. Sempre devolve um array.
function jsonField(v: any): any[] {
  if (v == null) return [];
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return []; } }
  return Array.isArray(v) ? v : [];
}

const STATUS_CONFIG: Record<string, { label: string; variant: 'neutral' | 'info' | 'success' | 'danger' | 'warning'; border: string }> = {
  PENDENTE: { label: 'Pendente', variant: 'warning', border: 'border-amber-200' },
  CONFIRMADO: { label: 'Confirmado', variant: 'info', border: 'border-sky-200' },
  SUBMETIDO: { label: 'Submetido', variant: 'warning', border: 'border-amber-200' },
  APROVADO: { label: 'Aprovado', variant: 'success', border: 'border-teal-200' },
  REPROVADO: { label: 'Reprovado', variant: 'danger', border: 'border-red-200' },
};

import { useFiscalYear } from '../hooks/useFiscalYear';
import MitraProductLockup from '../components/MitraProductLockup';

export default function PreenchimentoPage() {
  const { monthsShort: MONTHS_SHORT, fiscalMonthNumbers } = useFiscalYear();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const gestorId = Number(searchParams.get('gestor')) || null;
  const pkgParam = Number(searchParams.get('pkg')) || null;
  const fromKanban = searchParams.get('from') === 'kanban';
  const mode = searchParams.get('mode') || (fromKanban ? 'admin' : null);

  // SFs SQL dedicadas (sem sandbox, cacheadas): 103 ciclos != FECHADO, 104 CRs ativos,
  // 106 DRE config, 105 contas basicas.
  const { data: ciclos, loading: ciclosLoading } = useSF(103, {}, true);
  const { data: crs } = useSF(104, {}, true);
  // Pre-aquece o cache da SF 124 (hotOrcBase) — assim abrir um driver (OrcamentoContent)
  // paga so a chamada de detalhe (SF 125/126). Substitui os antigos warm-ups 105/106,
  // que ficaram orfaos depois que o componente migrou para os blocos JSON da 124.
  useEffect(() => { execSFCached(124, {}, 60_000).catch(() => {}); }, []);

  const [selectedCiclo, setSelectedCiclo] = useState<number | null>(null);
  const [selectedCR, setSelectedCR] = useState<number | null>(null);
  const [crProgress, setCrProgress] = useState<Record<number, { filled: number; total: number }>>({});
  const [statusCards, setStatusCards] = useState<any[]>([]);
  // Comeca TRUE: com statusCards/pacotes vazios a tela renderiza "Tudo pronto" /
  // "Tudo submetido", afirmando ao gestor que o orcamento esta concluido enquanto
  // a SF 121 ainda esta na rede. O gate cobre desde o primeiro frame (espera dos
  // ciclos, que disparam o loadKanban) ate o fim do loadKanban.
  const [kanbanLoading, setKanbanLoading] = useState(true);
  // Package state
  const [pacotes, setPacotes] = useState<any[]>([]);
  const [selectedPackage, setSelectedPackage] = useState<any>(null);
  // pkgOrcamento mantido apenas para limpar no back button; OrcamentoContent ja
  // carrega ORCAMENTO_PACOTE internamente em modo pacote.
  const [, setPkgOrcamento] = useState<any[]>([]);
  // pkgLoading mantido como setter para loadPackageDetail nao quebrar
  // (OrcamentoContent gerencia seu proprio loading state)
  const [, setPkgLoading] = useState(false);
  // Rateio state
  // rateioPercentuais carregado para uso futuro no save (T2): valor unico do gestor
  // sera dividido por essas % entre os CRs do pacote.
  const [, setRateioPercentuais] = useState<Record<number, string>>({});
  // Estados de rateio mantidos para uso futuro no save em modo pacote (T2):
  // valor unico do gestor sera dividido conforme RATEIO_CONFIG do pacote.
  const [, setRateioTipo] = useState('PERCENTUAL_FIXO');
  const [, setRateioBase] = useState('RECEITA');
  const [, setPkgCrValues] = useState<Record<number, Record<number, number>>>({});
  const [, setPkgRegras] = useState<any[]>([]);
  // Resumo tab no pacote
  // Tabs do pacote: 'RESUMO' | 'LANCAMENTO' (atual) | 'MODELO:<NOME>' (uma por modelo)
  
  const [, setPkgRealizadoData] = useState<any[]>([]);
  
  const [pacoteStatuses, setPacoteStatuses] = useState<any[]>([]);
  const [pacoteProgress, setPacoteProgress] = useState<Record<number, { filled: number; total: number }>>({});
  const [crFinancials, setCrFinancials] = useState<Record<number, { orcado: number; realizado: number }>>({});
  const { toasts, addToast, removeToast } = useToast();

  const [resumoMode, setResumoMode] = useState(false);
  const [resumoData, setResumoData] = useState<{
    totalOrcado: number;
    totalRealizado: number;
    byConta: { nome: string; codigo: string; valor: number; contaId: number }[];
    byMes: { mes: number; orcado: number; realizado: number; anterior: number }[];
    byDriver: { driver: string; valor: number; pct: number; realizado: number; contas: { nome: string; codigo: string; valor: number }[] }[];
  } | null>(null);
  const [resumoLoading, setResumoLoading] = useState(false);
  const [resumoDrillConta, setResumoDrillConta] = useState<{ contaId: number; nome: string } | null>(null);
  const [resumoDrillContaData, setResumoDrillContaData] = useState<any[] | null>(null);
  const [resumoDrillDriver, setResumoDrillDriver] = useState<string | null>(null);


  const cicloAtivo = ciclos.find((c: any) => c.ID === selectedCiclo);
  const ultimoMesRealizado = cicloAtivo?.ULTIMO_MES_REALIZADO ? Number(cicloAtivo.ULTIMO_MES_REALIZADO) : 0;

  useEffect(() => {
    if (ciclos.length > 0 && !selectedCiclo) setSelectedCiclo(escolherVersaoVigente(ciclos));
  }, [ciclos]);

  useEffect(() => {
    if (selectedCiclo && gestorId) { loadKanban(); return; }
    // Nao ha o que carregar (sem gestor na URL, ou nenhum ciclo aberto): libera o
    // gate para o estado real aparecer em vez de skeleton eterno.
    if (!ciclosLoading && (!gestorId || ciclos.length === 0)) setKanbanLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCiclo, gestorId, ciclosLoading, ciclos.length]);

  // Carrega TODO o kanban do gestor numa UNICA ida ao servidor (SF 121, JSON):
  // cards + financeiro/CR + pacotes + status de pacote + contagem de modelos.
  // Antes eram ~6 chamadas (cada uma ~200ms, com concorrencia limitada no servidor → ~1s).
  const loadKanban = async () => {
    if (!selectedCiclo || !gestorId) return;
    try {
      const ciclo = ciclos.find((c: any) => c.ID === selectedCiclo);
      const ano = ciclo ? ciclo.ANO : new Date().getFullYear();
      const res = await execSF(121, { cicloId: selectedCiclo, gestorId, ano });
      const row = res?.[0] || {};
      const cards = (jsonField(row.CARDS) as any[]).slice().sort((a, b) => String(a.CR_CODIGO || '').localeCompare(String(b.CR_CODIGO || '')));
      const fin = jsonField(row.FIN) as any[];
      const pacotes = (jsonField(row.PACOTES) as any[]).slice().sort((a, b) => String(a.NOME || '').localeCompare(String(b.NOME || '')));
      const pacoteStatus = jsonField(row.PACOTE_STATUS) as any[];
      const modelos = jsonField(row.MODELOS) as any[];
      const pkgTotais = jsonField(row.PKG_TOTAIS) as any[];
      const pkgFilled = jsonField(row.PKG_FILLED) as any[];

      setStatusCards(cards);
      setPacotes(pacotes);
      setPacoteStatuses(pacoteStatus);

      const finMap: Record<number, { orcado: number; realizado: number }> = {};
      for (const f of fin) finMap[Number(f.CR_ID)] = { orcado: Math.abs(Number(f.ORCADO) || 0), realizado: Math.abs(Number(f.REALIZADO) || 0) };
      setCrFinancials(finMap);

      // Progress por CR (mesma fonte viva do grid): total de modelos vem de MODELOS.
      const modelMap = new Map(modelos.map((m: any) => [Number(m.CR_ID), Number(m.TOTAL)]));
      const progress: Record<number, { filled: number; total: number }> = {};
      for (const card of cards) {
        const crId = Number(card.CR_ID);
        const totalModels = modelMap.get(crId) || 0;
        const st = card.STATUS;
        if (st === 'SUBMETIDO' || st === 'APROVADO' || st === 'CONFIRMADO') {
          progress[crId] = { total: totalModels, filled: totalModels };
        } else {
          const confirmed = card.DRIVERS_CONFIRMADOS ? card.DRIVERS_CONFIRMADOS.split(',').filter(Boolean).length : 0;
          progress[crId] = { total: totalModels, filled: Math.min(confirmed, totalModels) };
        }
      }
      setCrProgress(progress);

      // Progress por pacote: pares (conta, CR) preenchidos vs mapeados (blocos
      // PKG_FILLED/PKG_TOTAIS da SF 121). Pacote SUBMETIDO/APROVADO conta como 100%.
      const pkgStatusMap = new Map(pacoteStatus.map((s: any) => [s.DRIVER_ID, s.STATUS]));
      const pkgTotalMap = new Map(pkgTotais.map((t: any) => [Number(t.DRIVER_ID), Number(t.TOTAL) || 0]));
      const pkgFilledMap = new Map(pkgFilled.map((f: any) => [Number(f.DRIVER_ID), Number(f.FILLED) || 0]));
      const pkgProg: Record<number, { filled: number; total: number }> = {};
      for (const pkg of pacotes) {
        const done = ['SUBMETIDO', 'APROVADO'].includes(pkgStatusMap.get(pkg.ID) as string);
        const total = pkgTotalMap.get(Number(pkg.ID)) || 0;
        if (done) {
          pkgProg[pkg.ID] = { total: Math.max(total, 1), filled: Math.max(total, 1) };
        } else {
          pkgProg[pkg.ID] = { total: Math.max(total, 1), filled: Math.min(pkgFilledMap.get(Number(pkg.ID)) || 0, total) };
        }
      }
      setPacoteProgress(pkgProg);
      // finally: falha de rede nao pode deixar a tela presa no skeleton.
    } catch (e) { console.error(e); } finally { setKanbanLoading(false); }
  };


  const loadResumoData = useCallback(async () => {
    if (!resumoMode || !selectedCR || !selectedCiclo) return;
    setResumoLoading(true);
    setResumoData(null);
    setResumoDrillConta(null);
    setResumoDrillContaData(null);
    setResumoDrillDriver(null);
    try {
      const c = ciclos.find((ci: any) => ci.ID === selectedCiclo);
      const ano = c?.ANO || new Date().getFullYear();
      const anoAnterior = ano - 1;
      const ulMesReal = c?.ULTIMO_MES_REALIZADO ? Number(c.ULTIMO_MES_REALIZADO) : 0;

      // UMA ida (SF 127): orcado, realizado atual/anterior agregados e config
      // conta->driver como blocos JSON — eram 3 consultas sandbox + 1 SF.
      const resumoRow = (await execSF(127, { crId: Number(selectedCR), cicloId: selectedCiclo, ano, anoPrev: anoAnterior }))?.[0] || {};
      const orcRows = jsonField(resumoRow.ORC);
      const realRows = jsonField(resumoRow.REAL_ROWS);
      const realAntRows = jsonField(resumoRow.REAL_ANT);
      const drvCfgRows = jsonField(resumoRow.DRV_CFG);

      const driverByConta: Record<string, string> = {};
      drvCfgRows.forEach((r: any) => { if (r.CONTA_ID && r.DRIVER_TIPO) driverByConta[String(r.CONTA_ID)] = r.DRIVER_TIPO; });

      const orcAnnualByConta: Record<string, { codigo: string; nome: string; valor: number; contaId: number }> = {};
      const orcByMes = new Array(12).fill(0);
      const drvContas: Record<string, Set<number>> = {};
      const drvOrcByDriver: Record<string, number> = {};
      orcRows.forEach((r: any) => {
        const key = String(r.CONTA_ID);
        const v = Math.abs(Number(r.VALOR) || 0);
        if (!orcAnnualByConta[key]) orcAnnualByConta[key] = { codigo: r.CONTA_CODIGO, nome: r.CONTA_NOME, valor: 0, contaId: Number(r.CONTA_ID) };
        orcAnnualByConta[key].valor += v;
        const drv = driverByConta[key] || 'OUTROS';
        drvOrcByDriver[drv] = (drvOrcByDriver[drv] || 0) + v;
        if (!drvContas[drv]) drvContas[drv] = new Set();
        drvContas[drv].add(Number(r.CONTA_ID));
        const m = Number(r.MES);
        if (m >= 1 && m <= 12) orcByMes[m - 1] += v;
      });

      const realByMes = new Array(12).fill(0);
      const realByConta: Record<string, number> = {};
      realRows.forEach((r: any) => {
        const v = Math.abs(Number(r.VALOR) || 0);
        const m = Number(r.MES);
        if (m >= 1 && m <= 12) realByMes[m - 1] += v;
        realByConta[String(r.CONTA_ID)] = (realByConta[String(r.CONTA_ID)] || 0) + v;
      });

      const anteriorByMes = new Array(12).fill(0);
      realAntRows.forEach((r: any) => {
        const v = Math.abs(Number(r.VALOR) || 0);
        const m = Number(r.MES);
        if (m >= 1 && m <= 12) anteriorByMes[m - 1] += v;
      });

      const totalOrcado = Object.values(orcAnnualByConta).reduce((s, c) => s + c.valor, 0);
      const totalRealizado = realByMes.slice(0, ulMesReal).reduce((s, v) => s + v, 0);

      const byConta = Object.values(orcAnnualByConta)
        .map(c => ({ codigo: c.codigo, nome: c.nome, valor: c.valor, contaId: c.contaId }))
        .sort((a, b) => b.valor - a.valor);

      const byMes = Array.from({ length: 12 }, (_, i) => ({
        mes: i + 1, orcado: orcByMes[i], realizado: realByMes[i], anterior: anteriorByMes[i],
      }));

      const totalDrv = Object.values(drvOrcByDriver).reduce((s, v) => s + v, 0);
      const byDriver = Object.entries(drvOrcByDriver)
        .map(([driver, valor]) => {
          const realizadoDrv = Array.from(drvContas[driver] || []).reduce((s: number, cid: number) => s + (realByConta[String(cid)] || 0), 0);
          const contaIds = Array.from(drvContas[driver] || []);
          const contasList = contaIds
            .map(cid => orcAnnualByConta[String(cid)])
            .filter(Boolean)
            .map(c => ({ nome: c.nome, codigo: c.codigo, valor: c.valor }))
            .sort((a, b) => b.valor - a.valor);
          return { driver, valor, pct: totalDrv > 0 ? (valor / totalDrv) * 100 : 0, realizado: realizadoDrv, contas: contasList };
        })
        .sort((a, b) => b.valor - a.valor);

      setResumoData({ totalOrcado, totalRealizado, byConta, byMes, byDriver });
    } catch (e) { console.error('Resumo load error:', e); }
    setResumoLoading(false);
  }, [resumoMode, selectedCR, selectedCiclo, ciclos]);

  useEffect(() => {
    if (resumoMode && selectedCR && selectedCiclo) loadResumoData();
  }, [resumoMode, selectedCR, selectedCiclo, loadResumoData]);

  // Versao fechada entra so para consulta — nada de submeter nela. O botao ja
  // some pelo readOnly da grade, mas a submissao mora aqui e dispara e-mail aos
  // aprovadores, entao a guarda tem que estar tambem neste caminho.
  const cicloFechado = versaoEhFechada(ciclos, selectedCiclo);

  // Submissao passa pela SF 171 (avaliarWorkflowStatus): o servidor valida a
  // transicao, grava auditoria e notifica os aprovadores por e-mail.
  const submitCR = async (card: any) => {
    if (!card?.ID || cicloFechado) return;
    try {
      const out = await avaliarWorkflow({ tipo: 'CR', statusId: card.ID, acao: 'SUBMETIDO', autor: getUser()?.NOME || '' });
      if (!out?.ok) { addToast('error', avaliarErroMsg(out)); return; }
      setStatusCards(prev => prev.map(c => c.ID === card.ID ? { ...c, STATUS: 'SUBMETIDO' } : c));
      addToast('success', 'Orçamento submetido para aprovação!');
    } catch (e) { console.error(e); addToast('error', 'Erro ao submeter orçamento'); }
  };

  const submitPacote = async (driverId: number) => {
    if (!selectedCiclo || !gestorId || cicloFechado) return;
    try {
      const ps = pacoteStatuses.find((s: any) => s.DRIVER_ID === driverId);
      // sem linha de status ainda: a SF cria PENDENTE e transiciona para SUBMETIDO
      const out = ps
        ? await avaliarWorkflow({ tipo: 'PACOTE', statusId: ps.ID, acao: 'SUBMETIDO', autor: getUser()?.NOME || '' })
        : await avaliarWorkflow({ tipo: 'PACOTE', cicloId: selectedCiclo, driverId, gestorId, acao: 'SUBMETIDO', autor: getUser()?.NOME || '' });
      if (!out?.ok) { addToast('error', avaliarErroMsg(out)); return; }
      addToast('success', 'Pacote submetido para aprovação!');
      loadKanban();
    } catch (e) { console.error(e); addToast('error', 'Erro ao submeter pacote'); }
  };

  const loadPackageDetail = async (pkg: any) => {
    setPkgLoading(true);
    try {
      const cicloId = selectedCiclo;
      const cicloAtivo = ciclos.find((c: any) => c.ID === selectedCiclo);
      const prevYearPkg = (cicloAtivo?.ANO || new Date().getFullYear()) - 1;

      // TODAS as leituras numa UNICA ida ao servidor (SF 120, JSON): regras + ORCAMENTO_PACOTE +
      // RATEIO_CONFIG + RATEIO_CR + realizado ano-1. Antes eram 5-6 chamadas (~600ms-3s com a
      // concorrencia limitada do servidor); agora ~185ms.
      const res = await execSF(120, { pkgId: pkg.ID, cicloId, ano: prevYearPkg });
      const row = res?.[0] || {};
      const regrasData = jsonField(row.REGRAS);
      const orcRaw = jsonField(row.ORCAMENTO);
      const rcObj = row.RATEIO ? (typeof row.RATEIO === 'string' ? JSON.parse(row.RATEIO) : row.RATEIO) : null;
      const rc = rcObj ? [rcObj] : [];
      const rcrs = jsonField(row.RATEIO_CR);
      const realData = jsonField(row.REALIZADO);

      setPkgRegras(regrasData);

      // ORCAMENTO_PACOTE filtrado defensivamente pelos CRs/contas validos da config atual
      // (ignora linhas orfas se a config mudou depois de gravar valores).
      const validCrIds = new Set(regrasData.map((r: any) => Number(r.CR_ID)));
      const validContaIds = new Set(regrasData.map((r: any) => Number(r.CONTA_ID)));
      const orc = orcRaw.filter((o: any) => validCrIds.has(Number(o.CR_ID)) && validContaIds.has(Number(o.CONTA_ID)));
      setPkgOrcamento(orc);

      setPkgRealizadoData(regrasData.length > 0 ? realData : []);

      if (rc.length > 0) {
        setRateioTipo(rc[0].TIPO_RATEIO || 'PERCENTUAL_FIXO');
        setRateioBase(rc[0].BASE_PROPORCIONAL || 'RECEITA');
        const pcts: Record<number, string> = {};
        rcrs.forEach((r: any) => { pcts[r.CR_ID] = String(r.PERCENTUAL); });
        setRateioPercentuais(pcts);
      } else {
        setRateioTipo('PERCENTUAL_FIXO');
        setRateioBase('RECEITA');
        setRateioPercentuais({});
      }

      // pkgCrValues: a consulta antiga referenciava ORCAMENTO.DRIVER_TIPO, coluna que NAO existe —
      // sempre retornava vazio (falha silenciosa). Preservado como vazio.
      setPkgCrValues({});
    } catch (e) { console.error(e); }
    setPkgLoading(false);
  };

  // Auto-open package when navigated with ?pkg=ID
  const pkgAutoOpened = useRef(false);
  useEffect(() => {
    if (pkgParam && pacotes.length > 0 && selectedCiclo && !pkgAutoOpened.current) {
      const pkg = pacotes.find((p: any) => p.ID === pkgParam);
      if (pkg) { pkgAutoOpened.current = true; setSelectedPackage(pkg); loadPackageDetail(pkg); }
    }
  }, [pkgParam, pacotes, selectedCiclo]);

  // CRs validos pra o pacote selecionado (derivado da config atual via pkgRegras).
  // Quando navega com ?pkg=ID, evita flicker da CR List View enquanto o useEffect
  // de auto-open ainda nao rodou. Mostra um loader minimo no lugar.
  if (pkgParam && !selectedPackage) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--bg-app)' }}>
        <div className="animate-spin w-8 h-8 border-4 rounded-full" style={{ borderColor: 'var(--color-primary)', borderTopColor: 'transparent' }} />
      </div>
    );
  }

  // Helper de formatacao monetaria (BRL) usado em todo o componente.
  const fmtCurrency = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  // ──────── CR List View ────────
  if (!selectedCR && !selectedPackage) {
    return (
      <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-app)' }}>
        <header className="h-14 flex items-center justify-between px-6" style={{ backgroundColor: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
          <div className="flex items-center gap-3" style={{ color: 'var(--color-brand-ink)' }}>
            <MitraProductLockup product="FP&A" wordmarkHeight={16} />
            <span className="text-[11px] font-medium px-2.5 py-0.5 rounded-full" style={{ backgroundColor: 'var(--sidebar-item-active-bg)', color: 'var(--color-primary)' }}>
              Modo Preenchimento
            </span>
          </div>
          <div className="flex items-center gap-4">
                      </div>
        </header>

        <div className="px-6 py-8 space-y-10">
          {kanbanLoading ? (
            <>
              {/* Bloco de progresso — mesma moldura do renderProgressBlock */}
              <SkeletonCard className="p-5">
                <div className="flex items-center justify-between gap-6">
                  <div className="min-w-0 flex-1 flex flex-col gap-2.5">
                    <Skeleton className="h-5" style={{ width: '46%' }} />
                    <Skeleton className="h-3.5" style={{ width: '30%' }} />
                  </div>
                  <Skeleton style={{ width: 148, height: 42 }} />
                </div>
              </SkeletonCard>

              {/* Colunas: titulos sao estaticos e ficam; so os cards viram skeleton */}
              <div className="grid grid-cols-2 gap-6">
                <section>
                  <div className="flex items-baseline justify-between mb-3">
                    <h3 className="text-sm font-bold uppercase tracking-wide" style={{ color: 'var(--color-text)' }}>
                      A preencher
                    </h3>
                  </div>
                  <SkeletonCards count={3} height={128} className="flex flex-col gap-2.5" />
                </section>
                <section>
                  <div className="flex items-baseline justify-between mb-3">
                    <h3 className="text-sm font-bold uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>
                      Concluídos
                    </h3>
                  </div>
                  <SkeletonCards count={3} height={128} className="flex flex-col gap-2.5" />
                </section>
              </div>
            </>
          ) : (() => {
            // Determine mode: all CRs submitted/approved = post-submission
            const allCRsDone = statusCards.length > 0 && statusCards.every((c: any) => c.STATUS === 'SUBMETIDO' || c.STATUS === 'APROVADO');
            const allPkgsDone = pacotes.length === 0 || pacotes.every((pkg: any) => {
              const ps = pacoteStatuses.find((s: any) => s.DRIVER_ID === pkg.ID);
              const st = ps?.STATUS || 'PENDENTE';
              return st === 'SUBMETIDO' || st === 'APROVADO';
            });
            const isPostSubmission = allCRsDone && allPkgsDone;

            const crsDone = statusCards.filter((c: any) => c.STATUS === 'SUBMETIDO' || c.STATUS === 'APROVADO').length;
            const pendingCards = statusCards.filter((c: any) => c.STATUS !== 'SUBMETIDO' && c.STATUS !== 'APROVADO');
            const lockedCards = statusCards.filter((c: any) => c.STATUS === 'SUBMETIDO' || c.STATUS === 'APROVADO');

            // Pacotes — pendentes / concluídos (mesmo critério dos CRs)
            const pendingPkgs = pacotes.filter((pkg: any) => {
              const ps = pacoteStatuses.find((s: any) => s.DRIVER_ID === pkg.ID);
              const st = ps?.STATUS || 'PENDENTE';
              return st !== 'SUBMETIDO' && st !== 'APROVADO';
            });
            const pkgsDone = pacotes.length - pendingPkgs.length;

            // Totais agregando CRs + Pacotes
            const totalItens = statusCards.length + pacotes.length;
            const itensDone = crsDone + pkgsDone;
            const itensRestantes = totalItens - itensDone;
            const crsRestantes = statusCards.length - crsDone;
            const pkgsRestantes = pacotes.length - pkgsDone;


            // Impacto = volume financeiro realizado YTD (tamanho real do CR no ano).
            // Fallback para orçado se não houver realizado.
            const getImpact = (crId: number) => crFinancials[Number(crId)]?.realizado || crFinancials[Number(crId)]?.orcado || 0;

            // Prioridade visual: top 1/3 = Alta, mid = Média, bottom = Baixa
            const pendingImpacts = pendingCards.map((c: any) => getImpact(c.CR_ID)).sort((a, b) => b - a);
            const altaThreshold = pendingImpacts[Math.floor(pendingImpacts.length / 3) - 1] ?? Infinity;
            const baixaThreshold = pendingImpacts[Math.floor((pendingImpacts.length * 2) / 3)] ?? -Infinity;
            const getPriority = (impacto: number): { level: 'alta' | 'media' | 'baixa'; label: string; color: string; bg: string } => {
              if (pendingCards.length <= 1) return { level: 'media', label: 'Média', color: '#d97706', bg: 'color-mix(in srgb, #d97706 12%, transparent)' };
              if (impacto >= altaThreshold) return { level: 'alta', label: 'Alta', color: '#dc2626', bg: 'color-mix(in srgb, #dc2626 12%, transparent)' };
              if (impacto > baixaThreshold) return { level: 'media', label: 'Média', color: '#d97706', bg: 'color-mix(in srgb, #d97706 12%, transparent)' };
              return { level: 'baixa', label: 'Baixa', color: 'var(--color-text-muted)', bg: 'var(--bg-muted)' };
            };

            const topPendingCR = [...pendingCards].sort((a: any, b: any) => getImpact(b.CR_ID) - getImpact(a.CR_ID))[0];
            const topPendingPkg = pendingPkgs[0]; // primeiro pacote pendente quando não houver CR
            const hasNextAction = !!topPendingCR || !!topPendingPkg;

            const renderProgressBlock = () => {
              // Próxima ação: top CR pendente; se não houver, primeiro pacote pendente
              const nextLabel = topPendingCR
                ? topPendingCR.CR_NOME
                : topPendingPkg ? toTitleCase(topPendingPkg.NOME) : '';
              const breakdownParts: string[] = [];
              if (crsRestantes > 0) breakdownParts.push(`${crsRestantes} centro${crsRestantes !== 1 ? 's' : ''}`);
              if (pkgsRestantes > 0) breakdownParts.push(`${pkgsRestantes} pacote${pkgsRestantes !== 1 ? 's' : ''}`);
              const breakdown = breakdownParts.join(' e ');

              const triggerNext = () => {
                if (topPendingCR) { setResumoMode(false); setSelectedCR(topPendingCR.CR_ID); }
                else if (topPendingPkg) { setSelectedPackage(topPendingPkg); loadPackageDetail(topPendingPkg); }
              };

              return (
                <div className="rounded-xl p-5" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)' }}>
                  <div className="flex items-center justify-between gap-6">
                    <div className="min-w-0 flex-1">
                      <h1 className="font-semibold tracking-tight" style={{ color: 'var(--color-text)', fontSize: '20px' }}>
                        {itensRestantes > 0
                          ? <>Faltam <span className="tabular-nums" style={{ color: 'var(--color-primary)' }}>{itensRestantes}</span> de {totalItens} itens para concluir</>
                          : 'Tudo pronto'}
                      </h1>
                      {itensRestantes > 0 && (
                        <p className="text-sm mt-1.5" style={{ color: 'var(--color-text-secondary)' }}>
                          {breakdown && <span style={{ color: 'var(--color-text-muted)' }}>{breakdown} pendente{itensRestantes !== 1 ? 's' : ''}</span>}
                          {nextLabel && (
                            <>
                              <span style={{ color: 'var(--color-text-muted)' }}> · </span>
                              Próxima: <span className="font-semibold" style={{ color: 'var(--color-text)' }}>{nextLabel}</span>
                            </>
                          )}
                        </p>
                      )}
                      {itensRestantes === 0 && (
                        <p className="text-sm mt-1.5" style={{ color: 'var(--color-text-muted)' }}>
                          Orçamento submetido por completo
                        </p>
                      )}
                    </div>
                    <div className="flex-shrink-0 flex items-center gap-4">
                      {hasNextAction && (
                        <button onClick={triggerNext}
                          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-bold transition-all duration-200"
                          style={{ color: '#fff', backgroundColor: 'var(--color-primary)' }}
                          onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.88'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}>
                          Preencher agora <ChevronRight size={15} />
                        </button>
                      )}
                      <div className="text-right">
                        <span className="text-lg font-semibold tabular-nums" style={{ color: 'var(--color-text)' }}>
                          {itensDone} de {totalItens}
                        </span>
                        <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                          {itensRestantes > 0
                            ? `Falta${itensRestantes === 1 ? '' : 'm'} ${itensRestantes} para finalizar`
                            : 'concluídos'}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              );
            };

            // ── PENDENTE: action-oriented card with impact priority
            const renderPendingCR = (card: any, idx?: number) => {
              const p = crProgress[card.CR_ID] || { filled: 0, total: 0 };
              const pct = p.total > 0 ? Math.round((p.filled / p.total) * 100) : 0;
              const remaining = p.total - p.filled;
              const fin = crFinancials[Number(card.CR_ID)] || { orcado: 0, realizado: 0 };
              const impact = getImpact(card.CR_ID);
              const prio = getPriority(impact);
              const volumeLabel = fin.realizado > 0 && ultimoMesRealizado > 0
                ? `Volume YTD: ${fmtCurrency(fin.realizado)}`
                : fin.orcado > 0 ? `Orçado: ${fmtCurrency(fin.orcado)}` : '';
              const isTopPriority = idx === 0 && pendingCards.length > 1;
              return (
                <div key={card.ID} className="rounded-xl overflow-hidden transition-all duration-150 cursor-pointer"
                  style={{
                    backgroundColor: 'var(--color-surface)',
                    border: '1px solid var(--color-border)',
                  }}
                  onClick={() => setSelectedCR(card.CR_ID)}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-hover)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-surface)'; }}>
                  <div className="px-4 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1.5">
                          {isTopPriority ? (
                            <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded" style={{ color: prio.color, backgroundColor: prio.bg }}>Maior impacto</span>
                          ) : pct === 100 ? (
                            <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded" style={{ color: '#d97706', backgroundColor: 'color-mix(in srgb, #d97706 12%, transparent)' }}>Pronto para envio</span>
                          ) : (
                            <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded" style={{ color: 'var(--color-text-muted)', backgroundColor: 'var(--bg-muted)' }}>Pendente</span>
                          )}
                        </div>
                        <p className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>{card.CR_CODIGO} — {card.CR_NOME}</p>
                        <div className="flex items-center gap-3 mt-2 text-[12px]" style={{ color: 'var(--color-text-secondary)' }}>
                          <span className="font-medium" style={{ color: pct === 100 ? '#10b981' : 'var(--color-text)' }}>
                            {pct === 100 ? 'Pronto para envio' : `Faltam ${remaining} modelo${remaining !== 1 ? 's' : ''}`}
                          </span>
                          {volumeLabel && (
                            <span className="tabular-nums" style={{ color: 'var(--color-text-muted)' }}>{volumeLabel}</span>
                          )}
                        </div>
                        <div className="w-full rounded-full h-1.5 mt-2.5" style={{ backgroundColor: 'var(--bg-hover)' }}>
                          <div className="h-1.5 rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: pct === 100 ? '#10b981' : 'var(--color-primary, #75c95f)' }} />
                        </div>
                      </div>
                      <div className="flex-shrink-0 mt-1">
                        {pct === 100 && (card.STATUS === 'PENDENTE' || card.STATUS === 'CONFIRMADO') ? (
                          <button onClick={(e) => { e.stopPropagation(); submitCR(card); }}
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold transition-all duration-200"
                            style={{ color: '#fff', backgroundColor: '#10b981' }}
                            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#059669'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#10b981'; }}>
                            <Send size={13} /> Submeter
                          </button>
                        ) : (
                          <button onClick={(e) => { e.stopPropagation(); setResumoMode(false); setSelectedCR(card.CR_ID); }}
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold transition-all duration-200"
                            style={{ color: '#fff', backgroundColor: 'var(--color-primary)' }}
                            onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.88'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}>
                            Preencher agora <ChevronRight size={13} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            };

            // ── CONCLUÍDO: mesmo skeleton do pendente, com badge verde + botão Ver resumo verde
            const realLabel = ultimoMesRealizado > 0 ? `Realizado (${MONTHS_SHORT[0]}–${MONTHS_SHORT[ultimoMesRealizado - 1]})` : 'Realizado';
            const renderDoneCR = (card: any) => {
              const fin = crFinancials[Number(card.CR_ID)] || { orcado: 0, realizado: 0 };
              const variacao = fin.orcado !== 0 ? ((fin.realizado - fin.orcado) / Math.abs(fin.orcado)) * 100 : 0;
              const hasReal = fin.realizado !== 0 && ultimoMesRealizado > 0;
              const varColor = !hasReal ? 'var(--color-text-muted)' : Math.abs(variacao) <= 2 ? 'var(--color-text-muted)' : variacao > 0 ? 'var(--color-text-secondary)' : 'var(--color-text-secondary)';
              const varSign = variacao > 0 ? '+' : '';
              return (
                <div key={card.ID} className="rounded-xl overflow-hidden transition-all duration-150"
                  style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'color-mix(in srgb, #10b981 35%, transparent)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--color-border)'; }}>
                  <div className="px-4 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded" style={{ color: '#059669', backgroundColor: 'color-mix(in srgb, #10b981 12%, transparent)' }}>
                            <Check size={10} /> Submetido
                          </span>
                        </div>
                        <p className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>{card.CR_CODIGO} — {card.CR_NOME}</p>
                        <div className="flex items-center gap-3 mt-2 text-[12px] tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>
                          <span>Orçado: <span className="font-medium" style={{ color: 'var(--color-text)' }}>{fmtCurrency(fin.orcado)}</span></span>
                          {hasReal && (
                            <>
                              <span>{realLabel}: <span className="font-medium" style={{ color: 'var(--color-text)' }}>{fmtCurrency(fin.realizado)}</span></span>
                              <span style={{ color: varColor, fontWeight: 600 }}>{varSign}{variacao.toFixed(1)}%</span>
                            </>
                          )}
                        </div>
                        <div className="w-full rounded-full h-1.5 mt-2.5" style={{ backgroundColor: 'var(--bg-hover)' }}>
                          <div className="h-1.5 rounded-full" style={{ width: '100%', backgroundColor: '#10b981' }} />
                        </div>
                      </div>
                      <div className="flex-shrink-0 mt-1">
                        <button onClick={(e) => { e.stopPropagation(); setResumoMode(true); setSelectedCR(card.CR_ID); }}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold transition-all duration-200"
                          style={{ color: '#fff', backgroundColor: '#10b981' }}
                          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#059669'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#10b981'; }}>
                          Ver resumo <ChevronRight size={13} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            };

            // Legacy renderer kept for post-submission view (uses renderDoneCR style for locked, otherwise pending)
            const renderCRCard = (card: any) => {
              const isLocked = card.STATUS === 'SUBMETIDO' || card.STATUS === 'APROVADO';
              return isLocked ? renderDoneCR(card) : renderPendingCR(card);
            };

            // ── PENDING PACKAGE: mesma altura/skeleton dos cards de CR
            const renderPendingPkg = (pkg: any) => {
              const ps = pacoteStatuses.find((s: any) => s.DRIVER_ID === pkg.ID);
              const pkgSt = ps?.STATUS || 'PENDENTE';
              const pp = pacoteProgress[pkg.ID] || { filled: 0, total: 0 };
              const pkgPct = pp.total > 0 ? Math.round((pp.filled / pp.total) * 100) : 0;
              const openPkg = () => { setSelectedPackage(pkg); loadPackageDetail(pkg); };
              const hasStarted = pp.filled > 0;
              return (
                <div key={`pkg-${pkg.ID}`} className="rounded-xl overflow-hidden transition-all duration-150 cursor-pointer"
                  style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)' }}
                  onClick={openPkg}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'color-mix(in srgb, #d97706 35%, transparent)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--color-border)'; }}>
                  <div className="px-4 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded inline-flex items-center gap-1" style={{ color: '#d97706', backgroundColor: 'color-mix(in srgb, #d97706 12%, transparent)' }}>
                            <Package size={10} /> Pacote
                          </span>
                        </div>
                        <p className="font-semibold text-sm truncate" style={{ color: 'var(--color-text)' }}>{toTitleCase(pkg.NOME)}</p>
                        <div className="flex items-center gap-3 mt-2 text-[12px]" style={{ color: 'var(--color-text-secondary)' }}>
                          <span className="font-medium" style={{ color: pkgPct === 100 ? '#10b981' : 'var(--color-text)' }}>
                            {pkgPct === 100 ? 'Pronto para envio' : `Faltam ${pp.total - pp.filled} conta${(pp.total - pp.filled) !== 1 ? 's' : ''}`}
                          </span>
                        </div>
                        <div className="w-full rounded-full h-1.5 mt-2.5" style={{ backgroundColor: 'var(--bg-hover)' }}>
                          <div className="h-1.5 rounded-full transition-all duration-500" style={{ width: `${pkgPct}%`, backgroundColor: pkgPct === 100 ? '#10b981' : '#d97706' }} />
                        </div>
                      </div>
                      <div className="flex-shrink-0 mt-1">
                        {pkgPct === 100 && (pkgSt === 'PENDENTE' || pkgSt === 'CONFIRMADO') ? (
                          <button onClick={(e) => { e.stopPropagation(); submitPacote(pkg.ID); }}
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold transition-all duration-200"
                            style={{ color: '#fff', backgroundColor: '#10b981' }}
                            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#059669'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#10b981'; }}>
                            <Send size={13} /> Submeter
                          </button>
                        ) : (
                          <button onClick={(e) => { e.stopPropagation(); openPkg(); }}
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold transition-all duration-200"
                            style={{ color: '#fff', backgroundColor: 'var(--color-primary)' }}
                            onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.88'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}>
                            {hasStarted ? 'Continuar' : 'Preencher agora'} <ChevronRight size={13} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            };

            // ── DONE PACKAGE: mesmo skeleton do renderPendingPkg, badge verde + Ver resumo verde
            const renderDonePkg = (pkg: any) => {
              const ps = pacoteStatuses.find((s: any) => s.DRIVER_ID === pkg.ID);
              const pkgSt = ps?.STATUS || 'PENDENTE';
              const openPkg = () => { setSelectedPackage(pkg); loadPackageDetail(pkg); };
              return (
                <div key={`pkg-${pkg.ID}`} className="rounded-xl overflow-hidden transition-all duration-150"
                  style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'color-mix(in srgb, #10b981 35%, transparent)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--color-border)'; }}>
                  <div className="px-4 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded inline-flex items-center gap-1" style={{ color: '#059669', backgroundColor: 'color-mix(in srgb, #10b981 12%, transparent)' }}>
                            <Check size={10} /> {pkgSt === 'APROVADO' ? 'Aprovado' : 'Submetido'}
                          </span>
                        </div>
                        <p className="font-semibold text-sm truncate" style={{ color: 'var(--color-text)' }}>{toTitleCase(pkg.NOME)}</p>
                        <div className="flex items-center gap-3 mt-2 text-[12px]" style={{ color: 'var(--color-text-secondary)' }}>
                          <span className="inline-flex items-center gap-1.5" style={{ color: 'var(--color-text-muted)' }}>
                            <Package size={11} /> Pacote
                          </span>
                        </div>
                        <div className="w-full rounded-full h-1.5 mt-2.5" style={{ backgroundColor: 'var(--bg-hover)' }}>
                          <div className="h-1.5 rounded-full" style={{ width: '100%', backgroundColor: '#10b981' }} />
                        </div>
                      </div>
                      <div className="flex-shrink-0 mt-1">
                        <button onClick={(e) => { e.stopPropagation(); openPkg(); }}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold transition-all duration-200"
                          style={{ color: '#fff', backgroundColor: '#10b981' }}
                          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#059669'; }}
                          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#10b981'; }}>
                          Ver resumo <ChevronRight size={13} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            };

            const renderPkgCard = (pkg: any) => {
              const ps = pacoteStatuses.find((s: any) => s.DRIVER_ID === pkg.ID);
              const pkgSt = ps?.STATUS || 'PENDENTE';
              const isPkgLocked = pkgSt === 'SUBMETIDO' || pkgSt === 'CONFIRMADO' || pkgSt === 'APROVADO';
              return isPkgLocked ? renderDonePkg(pkg) : renderPendingPkg(pkg);
            };

            // ── Mode-based rendering ──
            return isPostSubmission ? (
              <>
                {renderProgressBlock()}

                <div className="flex flex-col gap-2.5">
                  {lockedCards.map(renderCRCard)}
                </div>

                {pacotes.length > 0 && (
                  <section>
                    <h3 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--color-text-muted)' }}>Pacotes</h3>
                    <div className="flex flex-col gap-2.5">
                      {pacotes.map(renderPkgCard)}
                    </div>
                  </section>
                )}
              </>
            ) : (
              <>
                {renderProgressBlock()}

                <div className="grid grid-cols-2 gap-6">
                  {/* Pendentes — stack de cards com prioridade visual */}
                  <section>
                    <div className="flex items-baseline justify-between mb-3">
                      <h3 className="text-sm font-bold uppercase tracking-wide" style={{ color: 'var(--color-text)' }}>
                        A preencher
                      </h3>
                      {itensRestantes > 0 && (
                        <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                          {pendingCards.length > 0 && pendingPkgs.length > 0
                            ? 'centros ordenados por impacto · pacotes ao final'
                            : pendingCards.length > 0 ? 'ordenados por impacto' : 'pacotes pendentes'}
                        </span>
                      )}
                    </div>
                    {itensRestantes === 0 ? (
                      <div className="rounded-xl p-8 text-center" style={{ backgroundColor: 'var(--color-surface)', border: '1px dashed var(--color-border)' }}>
                        <Check size={28} className="mx-auto mb-2" style={{ color: 'var(--color-text-muted)' }} />
                        <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Tudo submetido</p>
                        <p className="text-xs mt-1" style={{ color: 'var(--color-text-muted)' }}>Seu orçamento está completo</p>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2.5">
                        {[...pendingCards].sort((a: any, b: any) => getImpact(b.CR_ID) - getImpact(a.CR_ID)).map((card, idx) => renderPendingCR(card, idx))}
                        {pendingPkgs.map(renderPendingPkg)}
                      </div>
                    )}
                  </section>

                  {/* Concluídos — lista compacta de baixo peso visual */}
                  <section>
                    <div className="flex items-baseline justify-between mb-3">
                      <h3 className="text-sm font-bold uppercase tracking-wide" style={{ color: 'var(--color-text-muted)' }}>
                        Concluídos
                      </h3>
                      {(lockedCards.length > 0) && (
                        <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>orçado · realizado · variação</span>
                      )}
                    </div>
                    {(() => {
                      const lockedPkgs = pacotes.filter((pkg: any) => {
                        const ps = pacoteStatuses.find((s: any) => s.DRIVER_ID === pkg.ID);
                        const st = ps?.STATUS || 'PENDENTE';
                        return st === 'SUBMETIDO' || st === 'CONFIRMADO' || st === 'APROVADO';
                      });
                      const total = lockedCards.length + lockedPkgs.length;
                      if (total === 0) {
                        return (
                          <div className="rounded-xl p-6 text-center" style={{ backgroundColor: 'var(--color-surface)', border: '1px dashed var(--color-border)' }}>
                            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Itens concluídos aparecerão aqui</p>
                          </div>
                        );
                      }
                      return (
                        <div className="flex flex-col gap-2.5">
                          {lockedCards.map(renderDoneCR)}
                          {lockedPkgs.map(renderDonePkg)}
                        </div>
                      );
                    })()}
                  </section>
                </div>
              </>
            );
          })()}
        </div>

        <ToastContainer toasts={toasts} onRemove={removeToast} />
      </div>
    );
  }

  // ──────── Package Detail View ────────
  if (selectedPackage && !selectedCR) {
    const isPkgAprovado = (pacoteStatuses.find((s: any) => s.DRIVER_ID === selectedPackage.ID)?.STATUS) === 'APROVADO';

    return (
      <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-app)' }}>
        <div className="flex items-center gap-4 px-6 py-4" style={{ backgroundColor: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
          <button onClick={() => { if (fromKanban) { navigate(`/workflow?mode=${mode || 'admin'}`); } else { setSelectedPackage(null); setPkgOrcamento([]); setRateioPercentuais({}); setPkgRegras([]); loadKanban(); } }}
            className="p-2 rounded-xl transition-colors" style={{ color: 'var(--color-text-muted)' }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ''; }}>
            <ArrowLeft size={20} />
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3">
              <h1 className="font-semibold" style={{ color: 'var(--color-text)', fontSize: '20px' }}>Preenchimento de Orçamento</h1>
              <Badge variant="warning">Pacote</Badge>
            </div>
            <p className="text-sm mt-1 truncate" style={{ color: 'var(--color-text-secondary)' }}>{toTitleCase(selectedPackage.NOME)}</p>
          </div>
          <div className="flex items-center gap-3">
            {(() => {
              const ps = pacoteStatuses.find((s: any) => s.DRIVER_ID === selectedPackage.ID);
              const pkgStatus = ps?.STATUS || 'PENDENTE';
              const psConfig = STATUS_CONFIG[pkgStatus] || STATUS_CONFIG.PENDENTE;
              return (
                <>
                  <Badge variant={psConfig.variant}>{psConfig.label}</Badge>
                  {ps?.COMENTARIO && (
                    <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }} title={ps.COMENTARIO}>
                      <MessageSquare size={14} style={{ color: 'var(--semantic-danger, #dc2626)' }} />
                    </span>
                  )}
                  {(pkgStatus === 'PENDENTE' || pkgStatus === 'CONFIRMADO' || pkgStatus === 'REPROVADO') && (
                    <Button variant="primary" size="sm" onClick={() => submitPacote(selectedPackage.ID)}>
                      <Send size={13} /> Submeter Pacote
                    </Button>
                  )}
                  {pkgStatus === 'SUBMETIDO' && (
                    <span className="text-xs font-medium" style={{ color: 'var(--semantic-warning, #d97706)' }}>Aguardando aprovação</span>
                  )}
                  {pkgStatus === 'APROVADO' && (
                    <span className="text-xs font-medium flex items-center gap-1" style={{ color: '#10b981' }}>
                      <Check size={13} /> Aprovado
                    </span>
                  )}
                </>
              );
            })()}
          </div>
        </div>


        <div className="px-6 py-6 space-y-5">
          {/* OrcamentoContent gerencia seu proprio loading state — sem flicker duplo */}
          <OrcamentoContent
            gestorId={gestorId}
            selectedCR={null}
            selectedPackage={{ ID: selectedPackage.ID, NOME: selectedPackage.NOME, GESTOR_ID: selectedPackage.GESTOR_ID }}
            readOnly={isPkgAprovado}
          />
        </div>


        <ToastContainer toasts={toasts} onRemove={removeToast} />
      </div>
    );
  }

  // ──────── CR Detail View (budget entry) — uses shared OrcamentoContent ────────
  const cr = crs.find((c: any) => c.ID === selectedCR);

  // ──── Resumo BI View (read-only BI for submitted CR) ────
  if (resumoMode) {
    return (
      <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-app)' }}>
        <header className="h-14 flex items-center justify-between px-6" style={{ backgroundColor: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
          <div className="flex items-center gap-3">
            <button onClick={() => { setSelectedCR(null); setResumoMode(false); }}
              className="p-1.5 rounded-lg transition-colors" style={{ color: 'var(--color-text-secondary)' }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ''; }}>
              <ArrowLeft size={18} />
            </button>
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm" style={{ color: 'var(--color-text)' }}>{cr?.CODIGO} - {cr?.NOME}</span>
              <span className="text-[11px] font-medium px-2.5 py-0.5 rounded-full" style={{ backgroundColor: 'var(--sidebar-item-active-bg)', color: 'var(--color-primary)' }}>
                Resumo
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
                      </div>
        </header>

        <div className="px-6 py-6 space-y-6">
          {resumoLoading && (
            <div className="text-center py-16">
              <div className="animate-spin w-8 h-8 border-3 rounded-full mx-auto mb-3" style={{ borderColor: 'var(--color-primary)', borderTopColor: 'transparent' }} />
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>Carregando resumo...</p>
            </div>
          )}

          {!resumoLoading && resumoData && (() => {
            const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
            const fmtCompact = (v: number) => {
              const a = Math.abs(v);
              if (a >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(1)}M`;
              if (a >= 1_000) return `R$ ${(v / 1_000).toFixed(0)}K`;
              return `R$ ${Math.round(v).toLocaleString('pt-BR')}`;
            };
            const orcadoYTD = ultimoMesRealizado > 0
              ? resumoData.byMes.slice(0, ultimoMesRealizado).reduce((s, m) => s + m.orcado, 0)
              : 0;
            const variacao = orcadoYTD > 0
              ? ((resumoData.totalRealizado - orcadoYTD) / orcadoYTD) * 100
              : 0;
            const hasReal = ultimoMesRealizado > 0 && resumoData.totalRealizado > 0;
            const varColor = !hasReal ? 'var(--color-text-muted)' : Math.abs(variacao) <= 5 ? 'var(--color-text)' : variacao > 0 ? '#dc2626' : '#10b981';
            const varText = hasReal ? `${variacao > 0 ? '+' : ''}${variacao.toFixed(1)}%` : '—';

            const M_COLOR_REAL = '#f59e0b';
            const M_COLOR_PROJ = CHART_COLORS.primary;
            // Série única "Vigente": realizado e projetado dividem o mesmo eixo (continuidade).
            const monthlyChartData = MONTHS_SHORT.map((m, i) => {
              const calMonth = fiscalMonthNumbers[i];
              const mData = resumoData.byMes.find(x => x.mes === calMonth) || { orcado: 0, realizado: 0, anterior: 0 };
              const isReal = calMonth <= ultimoMesRealizado;
              return {
                mes: m,
                'Realizado anterior': Math.round(mData.anterior),
                Vigente: Math.round(isReal ? mData.realizado : mData.orcado),
                _orcado: Math.round(mData.orcado),
                _isReal: isReal,
              };
            });
            const monthlyChartCfg: ChartConfig = {
              'Realizado anterior': { label: 'Realizado anterior', color: CHART_COLORS.secondary },
              'Realizado': { label: 'Realizado', color: M_COLOR_REAL },
              'Projetado': { label: 'Projetado', color: M_COLOR_PROJ },
            };

            const MonthlyTooltip = ({ active, payload, label }: any) => {
              if (!active || !payload?.length) return null;
              const data = payload[0]?.payload;
              if (!data) return null;
              const anterior = data['Realizado anterior'] || 0;
              const vigente = data.Vigente || 0;
              const orcado = data._orcado || 0;
              const isReal = !!data._isReal;
              const pctVsAnterior = anterior !== 0 ? ((vigente - anterior) / Math.abs(anterior)) * 100 : 0;
              const pctVsOrcado = isReal && orcado !== 0 ? ((vigente - orcado) / Math.abs(orcado)) * 100 : 0;
              const fmtP = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
              const vigenteLabel = isReal ? 'Realizado' : 'Projetado';
              const vigenteColor = isReal ? M_COLOR_REAL : M_COLOR_PROJ;
              return (
                <div className="rounded-lg px-3 py-2 shadow-lg text-xs" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)' }}>
                  <p className="font-medium mb-1.5" style={{ color: 'var(--color-text)' }}>{label}</p>
                  <div className="flex items-center justify-between gap-4 py-0.5">
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block w-2 h-2 rounded-full" style={{ background: CHART_COLORS.secondary }} />
                      <span style={{ color: 'var(--color-text-secondary)' }}>Realizado anterior</span>
                    </span>
                    <span className="font-medium tabular-nums" style={{ color: 'var(--color-text)' }}>{formatCurrency(anterior)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4 py-0.5">
                    <span className="flex items-center gap-1.5">
                      <span className="inline-block w-2 h-2 rounded-full" style={{ background: vigenteColor }} />
                      <span style={{ color: 'var(--color-text-secondary)' }}>{vigenteLabel}</span>
                    </span>
                    <span className="font-medium tabular-nums" style={{ color: 'var(--color-text)' }}>{formatCurrency(vigente)}</span>
                  </div>
                  <div className="mt-1.5 pt-1.5" style={{ borderTop: '1px solid var(--color-border)' }}>
                    {isReal && (
                      <div className="flex justify-between gap-4 py-0.5">
                        <span style={{ color: 'var(--color-text-secondary)' }}>Real vs Orçado</span>
                        <span className="font-medium tabular-nums" style={{ color: pctVsOrcado >= 0 ? '#10b981' : '#ef4444' }}>{fmtP(pctVsOrcado)}</span>
                      </div>
                    )}
                    <div className="flex justify-between gap-4 py-0.5">
                      <span style={{ color: 'var(--color-text-secondary)' }}>{vigenteLabel} vs Anterior</span>
                      <span className="font-medium tabular-nums" style={{ color: pctVsAnterior >= 0 ? '#10b981' : '#ef4444' }}>{fmtP(pctVsAnterior)}</span>
                    </div>
                  </div>
                </div>
              );
            };
            const MonthlyLegend = () => (
              <div className="flex items-center justify-center gap-4 flex-wrap mt-2">
                {[
                  { label: 'Realizado anterior', color: CHART_COLORS.secondary },
                  { label: 'Realizado', color: M_COLOR_REAL },
                  { label: 'Projetado', color: M_COLOR_PROJ },
                ].map((it) => (
                  <span key={it.label} className="inline-flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--color-text-secondary)' }}>
                    <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: it.color }} />
                    {it.label}
                  </span>
                ))}
              </div>
            );

            const handleMonthlyBarClick = async (data: any) => {
              if (!data?.activePayload?.length) return;
              const mesLabel = data.activeLabel;
              const idx = MONTHS_SHORT.indexOf(mesLabel);
              if (idx < 0) return;
              const calMonth = fiscalMonthNumbers[idx];
              const contaName = `Mês ${mesLabel}`;
              setResumoDrillConta({ contaId: calMonth, nome: contaName });
              setResumoDrillContaData(null);
              const ano = cicloAtivo?.ANO || new Date().getFullYear();
              try {
                // UMA ida (SF 128): orcado/realizado/anterior do mes como blocos JSON.
                // Ordenacao VALOR DESC do original feita no cliente.
                const drillRow = (await execSF(128, { crId: Number(selectedCR), cicloId: selectedCiclo, ano, anoPrev: ano - 1, mes: calMonth }))?.[0] || {};
                const orcRows = jsonField(drillRow.ORC).sort((a: any, b: any) => (Number(b.VALOR) || 0) - (Number(a.VALOR) || 0));
                const realRows = jsonField(drillRow.REAL_ROWS);
                const antRows = jsonField(drillRow.REAL_ANT);
                const realMap: Record<string, number> = {};
                realRows.forEach((r: any) => { realMap[String(r.CONTA_ID)] = Number(r.VALOR) || 0; });
                const antMap: Record<string, number> = {};
                antRows.forEach((r: any) => { antMap[String(r.CONTA_ID)] = Number(r.VALOR) || 0; });
                setResumoDrillContaData(orcRows.map((r: any) => ({
                  nome: r.NOME, codigo: r.CODIGO,
                  orcado: Math.abs(Number(r.VALOR) || 0),
                  realizado: Math.abs(realMap[String(r.CONTA_ID)] || 0),
                  anterior: Math.abs(antMap[String(r.CONTA_ID)] || 0),
                })));
              } catch (e) { console.error('Drill error:', e); setResumoDrillContaData([]); }
            };

            const driverMax = resumoData.byDriver.length > 0 ? resumoData.byDriver[0].valor : 1;

            return (
              <div className="flex flex-col gap-6 animate-fadeIn">
                {/* ── 1) KPI STRIP ── */}
                <div className="rounded-xl px-6 py-5" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)' }}>
                  <div className="flex items-center divide-x" style={{ borderColor: 'var(--color-border)' }}>
                    <div className="flex-1 pr-6">
                      <div className="text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--color-text-muted)' }}>Orçado</div>
                      <div className="text-3xl font-semibold tabular-nums" style={{ color: 'var(--color-text)' }}>{fmt(resumoData.totalOrcado)}</div>
                      <div className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>Total anual {cicloAtivo ? cicloAtivo.ANO : ''}</div>
                    </div>
                    <div className="flex-1 px-6" style={{ borderColor: 'var(--color-border)' }}>
                      <div className="text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--color-text-muted)' }}>
                        {ultimoMesRealizado > 0 ? `Realizado (${MONTHS_SHORT[0]}–${MONTHS_SHORT[ultimoMesRealizado - 1]})` : 'Realizado'}
                      </div>
                      <div className="text-3xl font-semibold tabular-nums" style={{ color: hasReal ? 'var(--color-text)' : 'var(--color-text-muted)' }}>
                        {hasReal ? fmt(resumoData.totalRealizado) : '—'}
                      </div>
                      <div className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                        {hasReal ? `${ultimoMesRealizado} ${ultimoMesRealizado === 1 ? 'mês' : 'meses'} acumulado${ultimoMesRealizado === 1 ? '' : 's'}` : 'Sem realizado'}
                      </div>
                    </div>
                    <div className="flex-1 pl-6">
                      <div className="text-[10px] font-semibold uppercase tracking-widest mb-1" style={{ color: 'var(--color-text-muted)' }}>Variação</div>
                      <div className="text-3xl font-semibold tabular-nums" style={{ color: varColor }}>{varText}</div>
                      <div className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{hasReal ? 'Real vs orçado do período' : 'Aguardando realização'}</div>
                    </div>
                  </div>
                </div>

                {/* ── 2) GRÁFICO MENSAL — 3 barras (padrão ComparisonChart) ── */}
                {!resumoData.byMes.every(m => m.orcado === 0 && m.realizado === 0) && (
                  <div className="rounded-xl px-6 py-5" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)' }}>
                    {resumoDrillConta ? (
                      <>
                        <div className="flex items-center gap-2 mb-4">
                          <button onClick={() => { setResumoDrillConta(null); setResumoDrillContaData(null); }}
                            className="text-xs font-medium px-2 py-0.5 rounded-md transition-colors"
                            style={{ color: 'var(--color-primary)', backgroundColor: 'var(--sidebar-item-active-bg)' }}>
                            Mensal
                          </button>
                          <ChevronRight size={12} style={{ color: 'var(--color-text-muted)' }} />
                          <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{resumoDrillConta.nome} — por conta</span>
                        </div>
                        {resumoDrillContaData && resumoDrillContaData.length > 0 ? (
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead>
                                <tr style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>
                                  <th className="text-left px-6 py-3 uppercase tracking-wide font-medium">Conta</th>
                                  <th className="text-right px-3 py-3 uppercase tracking-wide font-medium">Realizado Ant.</th>
                                  <th className="text-right px-3 py-3 uppercase tracking-wide font-medium">Realizado</th>
                                  <th className="text-right px-3 py-3 uppercase tracking-wide font-medium">Orçado</th>
                                  <th className="text-right px-6 py-3 uppercase tracking-wide font-medium">Var %</th>
                                </tr>
                              </thead>
                              <tbody>
                                {resumoDrillContaData.map((c: any, i: number) => {
                                  const varPct = c.orcado > 0 ? ((c.realizado - c.orcado) / c.orcado) * 100 : 0;
                                  return (
                                    <tr key={i} className="group transition-colors" style={{ borderTop: '1px solid var(--color-border)' }}>
                                      <td className="px-6 py-3 text-sm" style={{ color: 'var(--color-text)' }}>
                                        <span className="text-xs font-medium" style={{ color: 'var(--color-text-secondary)' }}>{c.codigo}</span>
                                        <span className="ml-1.5">{c.nome}</span>
                                      </td>
                                      <td className="text-right px-3 py-3 tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>{fmtCompact(c.anterior)}</td>
                                      <td className="text-right px-3 py-3 tabular-nums font-medium" style={{ color: c.realizado > 0 ? '#f59e0b' : 'var(--color-text-secondary)' }}>{fmtCompact(c.realizado)}</td>
                                      <td className="text-right px-3 py-3 tabular-nums" style={{ color: 'var(--color-text)' }}>{fmtCompact(c.orcado)}</td>
                                      <td className="text-right px-6 py-3 tabular-nums font-medium" style={{ color: c.realizado > 0 ? (varPct >= 0 ? '#10b981' : '#ef4444') : 'var(--color-text-secondary)' }}>
                                        {c.realizado > 0 ? `${varPct >= 0 ? '+' : ''}${varPct.toFixed(1)}%` : '—'}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        ) : (
                          <p className="text-xs py-4 text-center" style={{ color: 'var(--color-text-muted)' }}>Carregando...</p>
                        )}
                      </>
                    ) : (
                      <>
                        <div className="flex items-baseline justify-between mb-1">
                          <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Comparativo Mensal</h3>
                          <p className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>Clique em um mês para detalhar por conta</p>
                        </div>
                        <p className="text-xs mb-3" style={{ color: 'var(--color-text-secondary)' }}>Ano anterior (realizado) versus ano vigente (realizado + projeção)</p>
                        <ChartContainer config={monthlyChartCfg} className="cursor-pointer" style={{ height: 280 }}>
                          <ComposedChart data={monthlyChartData} margin={{ top: 8, right: 12, left: 4, bottom: 4 }} barGap={2} barCategoryGap="20%"
                            onClick={handleMonthlyBarClick}>
                            <CartesianGrid vertical={false} />
                            <XAxis dataKey="mes" tickLine={false} axisLine={false} tickMargin={8} />
                            <YAxis tickLine={false} axisLine={false} width={55} />
                            <ChartTooltip content={<MonthlyTooltip />} cursor={{ fill: 'var(--bg-hover)' }} />
                            <ChartLegend content={<MonthlyLegend />} />
                            <RechartsBar dataKey="Realizado anterior" name="Realizado anterior" fill={CHART_COLORS.secondary} maxBarSize={40} radius={[4, 4, 0, 0]} />
                            <RechartsBar dataKey="Vigente" name="Vigente" maxBarSize={40} radius={[4, 4, 0, 0]}>
                              {monthlyChartData.map((d, i) => (
                                <Cell key={i} fill={d._isReal ? M_COLOR_REAL : M_COLOR_PROJ} />
                              ))}
                            </RechartsBar>
                          </ComposedChart>
                        </ChartContainer>
                      </>
                    )}
                  </div>
                )}

                {/* ── 3) CONTEÚDO EM 2 COLUNAS — Drivers + Contas ── */}
                <div className="grid gap-6" style={{ gridTemplateColumns: resumoData.byDriver.length > 0 && resumoData.byConta.length > 0 ? '1fr 1fr' : '1fr' }}>

                  {/* COLUNA ESQUERDA — Valor por driver */}
                  {resumoData.byDriver.length > 0 && (
                    <div className="rounded-xl px-6 py-5" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)' }}>
                      <div className="flex items-baseline justify-between mb-4">
                        <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Valor por driver</h3>
                        <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>{resumoData.byDriver.length} drivers</span>
                      </div>
                      <div className="flex flex-col gap-2 max-h-[480px] overflow-y-auto pr-1">
                        {resumoData.byDriver.map((d, i) => {
                          const widthPct = Math.max((d.valor / driverMax) * 100, 3);
                          const isExpanded = resumoDrillDriver === d.driver;
                          return (
                            <div key={i}>
                              <button
                                onClick={() => setResumoDrillDriver(isExpanded ? null : d.driver)}
                                className="w-full text-left group"
                              >
                                <div className="flex items-center gap-3 py-1.5">
                                  <div className="flex items-center gap-1" style={{ minWidth: 14 }}>
                                    {isExpanded ? <ChevronDown size={12} style={{ color: 'var(--color-primary)' }} /> : <ChevronRight size={12} style={{ color: 'var(--color-text-muted)' }} />}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-baseline justify-between gap-2 mb-1">
                                      <span className="text-[13px] font-medium truncate" style={{ color: 'var(--color-text)' }}>{toTitleCase(d.driver)}</span>
                                      <span className="text-[12px] tabular-nums flex-shrink-0" style={{ color: 'var(--color-text-secondary)' }}>
                                        {fmtCompact(d.valor)} <span className="text-[10px]" style={{ color: 'var(--color-text-muted)' }}>({d.pct.toFixed(0)}%)</span>
                                      </span>
                                    </div>
                                    <div className="rounded-full h-1.5" style={{ backgroundColor: 'var(--bg-hover)' }}>
                                      <div className="h-1.5 rounded-full transition-all" style={{ width: `${widthPct}%`, backgroundColor: CHART_SEQUENCE[i % CHART_SEQUENCE.length] }} />
                                    </div>
                                  </div>
                                </div>
                              </button>
                              {isExpanded && d.contas.length > 0 && (
                                <div className="ml-7 mt-1 mb-2 pl-3" style={{ borderLeft: '2px solid var(--color-border)' }}>
                                  {d.contas.map((c, ci) => {
                                    const cShare = d.valor > 0 ? (c.valor / d.valor) * 100 : 0;
                                    return (
                                      <div key={ci} className="flex items-baseline justify-between gap-2 py-1">
                                        <span className="text-[12px] truncate" style={{ color: 'var(--color-text-secondary)' }}>
                                          <span className="font-medium" style={{ color: 'var(--color-text-muted)' }}>{c.codigo}</span>
                                          <span className="ml-1">{c.nome}</span>
                                        </span>
                                        <span className="text-[11px] tabular-nums flex-shrink-0" style={{ color: 'var(--color-text-secondary)' }}>
                                          {fmtCompact(c.valor)} <span style={{ color: 'var(--color-text-muted)' }}>({cShare.toFixed(0)}%)</span>
                                        </span>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* COLUNA DIREITA — Top contas (complemento leve) */}
                  {resumoData.byConta.length > 0 && (
                    <div className="rounded-xl px-5 py-4" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)' }}>
                      <p className="text-[10px] font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--color-text-muted)' }}>Top contas por valor planejado</p>
                      {(() => {
                        const top5 = resumoData.byConta.slice(0, 5);
                        const max = top5[0]?.valor || 1;
                        return (
                          <ul className="flex flex-col gap-2">
                            {top5.map((c, i) => {
                              const widthPct = Math.max((c.valor / max) * 70, 3);
                              const sharePct = resumoData.totalOrcado > 0 ? (c.valor / resumoData.totalOrcado) * 100 : 0;
                              return (
                                <li key={i} className="flex items-center gap-2.5">
                                  <span className="text-[10px] font-semibold tabular-nums" style={{ color: 'var(--color-text-muted)', minWidth: 16, textAlign: 'right' }}>{i + 1}</span>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-baseline justify-between gap-2">
                                      <span className="text-[12px] truncate" style={{ color: 'var(--color-text)' }}>{c.nome}</span>
                                      <span className="text-[11px] tabular-nums flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>{sharePct.toFixed(0)}%</span>
                                    </div>
                                    <div className="rounded-full h-[3px] mt-0.5" style={{ backgroundColor: 'var(--bg-hover)' }}>
                                      <div className="h-[3px] rounded-full" style={{ width: `${widthPct}%`, backgroundColor: 'var(--color-primary)', opacity: Math.max(0.4, 1 - i * 0.15) }} />
                                    </div>
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        );
                      })()}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {!resumoLoading && !resumoData && (
            <div className="text-center py-16">
              <BarChart3 size={32} style={{ color: 'var(--color-text-muted)', margin: '0 auto 8px' }} />
              <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Nenhum dado disponível para exibição</p>
            </div>
          )}
        </div>

        <ToastContainer toasts={toasts} onRemove={removeToast} />
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-app)' }}>
      <header className="h-14 flex items-center justify-between px-6" style={{ backgroundColor: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
        <div className="flex items-center gap-3">
          <button onClick={() => { setSelectedCR(null); loadKanban(); }}
            className="p-1.5 rounded-lg transition-colors" style={{ color: 'var(--color-text-secondary)' }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ''; }}>
            <ArrowLeft size={18} />
          </button>
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm" style={{ color: 'var(--color-text)' }}>{cr?.CODIGO} - {cr?.NOME}</span>
            <span className="text-[11px] font-medium px-2.5 py-0.5 rounded-full" style={{ backgroundColor: 'var(--sidebar-item-active-bg)', color: 'var(--color-primary)' }}>Preenchimento</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {(() => {
            const card = statusCards.find((c: any) => Number(c.CR_ID) === selectedCR);
            if (!card) return null;
            const crSt = card.STATUS || 'PENDENTE';
            const stConfig = STATUS_CONFIG[crSt] || STATUS_CONFIG.PENDENTE;
            const p = crProgress[Number(selectedCR)] || { filled: 0, total: 0 };
            const allFilled = p.total > 0 && p.filled >= p.total;
            return (
              <>
                <Badge variant={stConfig.variant}>{stConfig.label}</Badge>
                {card.COMENTARIO && (
                  <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }} title={card.COMENTARIO}>
                    <MessageSquare size={14} style={{ color: 'var(--semantic-danger, #dc2626)' }} />
                  </span>
                )}
                {(crSt === 'PENDENTE' || crSt === 'CONFIRMADO' || crSt === 'REPROVADO') && (
                  <Button variant="primary" size="sm" onClick={() => submitCR(card)} disabled={!allFilled}>
                    <Send size={13} /> Submeter CR
                  </Button>
                )}
                {crSt === 'SUBMETIDO' && (
                  <span className="text-xs font-medium" style={{ color: 'var(--semantic-warning, #d97706)' }}>Aguardando aprovação</span>
                )}
                {crSt === 'APROVADO' && (
                  <span className="text-xs font-medium flex items-center gap-1" style={{ color: '#10b981' }}>
                    <Check size={13} /> Aprovado
                  </span>
                )}
              </>
            );
          })()}
        </div>
      </header>

      <div className="px-6 py-6">
        <OrcamentoContent gestorId={gestorId} selectedCR={selectedCR} readOnly={statusCards.find((c: any) => Number(c.CR_ID) === selectedCR)?.STATUS === 'APROVADO'} onStatusChange={(crId, status, driversConfirmados) => {
          setStatusCards(prev => prev.map(c => Number(c.CR_ID) === crId ? { ...c, STATUS: status, DRIVERS_CONFIRMADOS: driversConfirmados ?? c.DRIVERS_CONFIRMADOS } : c));
          if (driversConfirmados !== undefined) {
            setCrProgress(prev => {
              const old = prev[crId] || { total: 0, filled: 0 };
              const confirmed = driversConfirmados ? driversConfirmados.split(',').filter(Boolean).length : 0;
              return { ...prev, [crId]: { total: old.total, filled: Math.min(confirmed, old.total) } };
            });
          }
        }} />
      </div>

      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  );
}
