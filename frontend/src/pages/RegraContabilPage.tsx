import { useState, useMemo, useEffect, useRef } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import ModelagemPage from './ModelagemPage';
import { useSF, jsonField, SF_IDS, createRecord, removeRecord, batchCreate, updateRecord, querySQL, execSF } from '../hooks/useMitraData';
import { Card } from '../components/ui/Card';
import MultiSelect from '../components/ui/MultiSelect';
import { ToastContainer } from '../components/ui/Toast';
import { useToast } from '../hooks/useToast';
import { Search, Check, Users, Building2, ChevronDown, ChevronLeft, ChevronRight, Plus, Sparkles, Layers, CheckCircle2, Package, Calculator, Percent, Pencil, Trash2, HelpCircle, Bell, Info, AlertCircle } from 'lucide-react';
import Tooltip from '../components/ui/Tooltip';
import Modal from '../components/ui/Modal';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import { toTitleCase, tipoLabel, driverLabel } from '../lib/utils';
import { Skeleton, SkeletonTable, SkeletonListItems } from '../components/ui/Skeleton';

type TabKey = 'cr' | 'conta' | 'rateio' | 'modelo';

const PAGE_SIZE = 50;

// Rodapé de paginação (mesmo padrão da tela Dados de Integração) — só aparece quando há mais de uma página
function PaginationFooter({ page, total, onGo }: { page: number; total: number; onGo: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (pages <= 1) return null;
  const from = page * PAGE_SIZE + 1;
  const to = Math.min((page + 1) * PAGE_SIZE, total);
  return (
    <div className="flex items-center justify-between px-5 py-3" style={{ borderTop: '1px solid var(--color-border)' }}>
      <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
        Mostrando {from}–{to} de {total} contas
      </span>
      <div className="flex items-center gap-2">
        <button
          onClick={() => onGo(page - 1)} disabled={page === 0}
          className="p-1.5 rounded-lg border cursor-pointer disabled:opacity-40 disabled:cursor-default transition-all duration-200"
          style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          title="Página anterior"
        ><ChevronLeft size={15} /></button>
        <span className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>{page + 1} / {pages}</span>
        <button
          onClick={() => onGo(page + 1)} disabled={page >= pages - 1}
          className="p-1.5 rounded-lg border cursor-pointer disabled:opacity-40 disabled:cursor-default transition-all duration-200"
          style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          title="Próxima página"
        ><ChevronRight size={15} /></button>
      </div>
    </div>
  );
}

export default function RegraContabilPage() {
  // Mount em 1 ida: SF 131 devolve os 7 blocos como JSON (eram 7 chamadas sandbox).
  // Os refetch individuais viram o refetch da SF (atualiza todos os blocos de uma vez).
  const { data: hotRows, loading: hotLoading, refetch: refetchHot } = useSF(SF_IDS.hotRegrasBase, {});
  // Skeleton so no primeiro carregamento: os refetch pos-mutacao (toggle de celula,
  // etc.) tambem ligam `loading` e nao devem piscar a matriz inteira.
  const initialLoading = hotLoading && !hotRows?.length;
  const byCodigo = (a: any, b: any) => String(a.CODIGO ?? '').localeCompare(String(b.CODIGO ?? ''));
  const crs = useMemo(() => jsonField(hotRows?.[0]?.CRS).sort(byCodigo), [hotRows]);
  const contas = useMemo(() => jsonField(hotRows?.[0]?.CONTAS).sort(byCodigo), [hotRows]);
  const crContas = useMemo(() => jsonField(hotRows?.[0]?.CR_CONTAS), [hotRows]);
  const gestoresCR = useMemo(() => jsonField(hotRows?.[0]?.GESTORES_CR), [hotRows]);
  const drivers = useMemo(() => jsonField(hotRows?.[0]?.DRIVERS).sort((a: any, b: any) => String(a.TIPO_DRIVER ?? '').localeCompare(String(b.TIPO_DRIVER ?? '')) || String(a.NOME ?? '').localeCompare(String(b.NOME ?? ''))), [hotRows]);
  const contaDrivers = useMemo(() => jsonField(hotRows?.[0]?.CONTA_DRIVERS), [hotRows]);
  const excecoes = useMemo(() => jsonField(hotRows?.[0]?.EXCECOES), [hotRows]);
  const rateios = useMemo(() => jsonField(hotRows?.[0]?.RATEIOS).sort((a: any, b: any) => String(a.NOME ?? '').localeCompare(String(b.NOME ?? ''))), [hotRows]);
  const rateioItens = useMemo(() => jsonField(hotRows?.[0]?.RATEIO_ITENS), [hotRows]);
  const rateioUsos = useMemo(() => jsonField(hotRows?.[0]?.RATEIO_USOS), [hotRows]);
  const refetchCrContas = refetchHot;
  const refetchContaDrivers = refetchHot;
  const refetchExcecoes = refetchHot;

  const { toasts, addToast, removeToast } = useToast();

  // Aba inicial: respeita ?tab=cr|conta|modelo ou ?novo=modelo|pacote
  const initialTab: TabKey = (() => {
    if (typeof window === 'undefined') return 'cr';
    const sp = new URLSearchParams(window.location.search);
    if (sp.get('novo') === 'modelo' || sp.get('tab') === 'modelo') return 'modelo';
    if (sp.get('tab') === 'conta') return 'conta';
    if (sp.get('tab') === 'rateio') return 'rateio';
    return 'cr';
  })();
  const [tab, setTab] = useState<TabKey>(initialTab);
  const [, setSearchParams] = useSearchParams();
  const [pendingCreateMode, setPendingCreateMode] = useState<'NORMAL' | 'PACOTE' | null>(null);

  // Rota escolhida na UI antes do driver ser definido (transitória, por conta).
  // A rota persistida é derivada do ESCOPO do driver da conta — este override só
  // vive enquanto o usuário trocou a rota e ainda não escolheu o driver/pacote.
  const [rotaOverride, setRotaOverride] = useState<Record<number, 'CR' | 'PACOTE'>>({});

  // Helper que troca a aba e mantém a URL em sync (pra expand de outras telas funcionar sempre)
  const changeTab = (next: TabKey) => {
    setTab(next);
    setSearchParams((prev) => {
      const sp = new URLSearchParams(prev);
      sp.set('tab', next);
      return sp;
    }, { replace: true });
  };

  // Reage a mudança de ?tab=... na URL (caso o usuário já esteja na página)
  const location = useLocation();
  useEffect(() => {
    const sp = new URLSearchParams(location.search);
    const t = sp.get('tab');
    if (t === 'cr' || t === 'conta' || t === 'rateio' || t === 'modelo') setTab(t);
  }, [location.search]);

  const [contaSearch, setContaSearch] = useState('');
  const [tipoFilters, setTipoFilters] = useState<string[]>([]);
  const [crFilters, setCrFilters] = useState<string[]>([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [bulkBusyCol, setBulkBusyCol] = useState<number | null>(null);
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyConfirming, setHistoryConfirming] = useState(false);
  const [historySuggestions, setHistorySuggestions] = useState<any[]>([]);
  const [selectedHistoryPairs, setSelectedHistoryPairs] = useState<Set<string>>(new Set());

  const crContaLookup = useMemo(() => {
    const m = new Map<string, number>();
    crContas.forEach((c: any) => m.set(`${c.CR_ID}-${c.CONTA_ID}`, c.ID));
    return m;
  }, [crContas]);

  const contasPorCR = useMemo(() => {
    const m = new Map<number, number>();
    crContas.forEach((c: any) => m.set(c.CR_ID, (m.get(c.CR_ID) || 0) + 1));
    return m;
  }, [crContas]);

  const gestoresPorCR = useMemo(() => {
    const m = new Map<number, string>();
    (gestoresCR || []).forEach((g: any) => m.set(g.CR_ID, g.GESTORES || ''));
    return m;
  }, [gestoresCR]);

  const tipoValues = useMemo(
    () => [...new Set(contas.map((c: any) => c.TIPO).filter(Boolean))].sort() as string[],
    [contas]
  );

  // Setores exibidos como COLUNAS da matriz. Filtro vazio = todos; a ordem original
  // (por codigo) e preservada porque filtramos a lista de origem.
  const crsVisiveis = useMemo(() => {
    if (crFilters.length === 0) return crs;
    const sel = new Set(crFilters);
    return crs.filter((cr: any) => sel.has(String(cr.ID)));
  }, [crs, crFilters]);

  const tipoFiltersSet = useMemo(() => new Set(tipoFilters), [tipoFilters]);
  const filteredContas = useMemo(() => {
    return contas.filter((c: any) => {
      if (tipoFilters.length > 0 && !tipoFiltersSet.has(c.TIPO)) return false;
      if (contaSearch.trim()) {
        const s = contaSearch.toLowerCase();
        return c.CODIGO.toLowerCase().includes(s) || c.NOME.toLowerCase().includes(s);
      }
      return true;
    });
  }, [contas, tipoFilters, tipoFiltersSet, contaSearch]);

  // Paginação da matriz (aba Setores e contas) — client-side, volta pra página 1 ao mudar filtros
  const [crPage, setCrPage] = useState(0);
  useEffect(() => { setCrPage(0); }, [contaSearch, tipoFilters]);
  const crPageSafe = Math.min(crPage, Math.max(0, Math.ceil(filteredContas.length / PAGE_SIZE) - 1));
  const pagedContas = useMemo(
    () => filteredContas.slice(crPageSafe * PAGE_SIZE, (crPageSafe + 1) * PAGE_SIZE),
    [filteredContas, crPageSafe]
  );

  // Marca/desmarca o vinculo de UMA celula da matriz (conta × setor)
  const toggleCell = async (crId: number, contaId: number) => {
    const key = `${crId}-${contaId}`;
    setBusyKey(key);
    try {
      const existingId = crContaLookup.get(key);
      if (existingId) {
        await removeRecord('CR_CONTA', existingId);
      } else {
        await createRecord('CR_CONTA', {
          CR_ID: crId,
          CONTA_ID: contaId,
          ATIVO: true,
          CRIADO_EM: new Date().toISOString().slice(0, 19),
        });
      }
      refetchCrContas();
    } catch {
      addToast('error', 'Erro ao atualizar vínculo');
    }
    setBusyKey(null);
  };

  // Marca/desmarca a coluna inteira (todas as contas filtradas para um setor)
  const toggleColuna = async (cr: any) => {
    if (filteredContas.length === 0) return;
    const allMarked = filteredContas.every((c: any) => crContaLookup.has(`${cr.ID}-${c.ID}`));
    setBulkBusyCol(cr.ID);
    try {
      if (allMarked) {
        const toRemove = filteredContas
          .map((c: any) => crContaLookup.get(`${cr.ID}-${c.ID}`))
          .filter((id): id is number => typeof id === 'number');
        await Promise.all(toRemove.map((id) => removeRecord('CR_CONTA', id)));
        addToast('success', `${toRemove.length} conta${toRemove.length === 1 ? '' : 's'} desvinculada${toRemove.length === 1 ? '' : 's'} de ${toTitleCase(cr.NOME)}`);
      } else {
        const now = new Date().toISOString().slice(0, 19);
        const toCreate = filteredContas
          .filter((c: any) => !crContaLookup.has(`${cr.ID}-${c.ID}`))
          .map((c: any) => ({ CR_ID: cr.ID, CONTA_ID: c.ID, ATIVO: true, CRIADO_EM: now }));
        if (toCreate.length > 0) await batchCreate('CR_CONTA', toCreate);
        addToast('success', `${toCreate.length} conta${toCreate.length === 1 ? '' : 's'} vinculada${toCreate.length === 1 ? '' : 's'} a ${toTitleCase(cr.NOME)}`);
      }
      refetchCrContas();
    } catch {
      addToast('error', 'Erro ao atualizar vínculos em lote');
    }
    setBulkBusyCol(null);
  };

  const historyPairKey = (item: any) => `${item.CR_ID}:${item.CONTA_ID}`;

  const openHistoryPreview = async () => {
    setHistoryModalOpen(true);
    setHistoryLoading(true);
    setHistorySuggestions([]);
    setSelectedHistoryPairs(new Set());
    try {
      const suggestions = await execSF(SF_IDS.mapearHistoricoPrevia, {});
      setHistorySuggestions(suggestions);
      setSelectedHistoryPairs(new Set(suggestions.map(historyPairKey)));
    } catch {
      addToast('error', 'Não foi possível analisar o histórico contábil');
      setHistoryModalOpen(false);
    } finally {
      setHistoryLoading(false);
    }
  };

  const toggleHistoryPair = (key: string) => {
    setSelectedHistoryPairs((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const confirmHistoryMapping = async () => {
    const selected = historySuggestions.filter((item) => selectedHistoryPairs.has(historyPairKey(item)));
    if (selected.length === 0) return;
    setHistoryConfirming(true);
    try {
      await execSF(SF_IDS.mapearHistoricoConfirmar, {
        ano: Number(selected[0].ANO_REFERENCIA),
        paresCsv: selected.map(historyPairKey).join(','),
      });
      await refetchHot();
      addToast('success', `${selected.length} vínculo${selected.length === 1 ? '' : 's'} criado${selected.length === 1 ? '' : 's'} pelo histórico`);
      setHistoryModalOpen(false);
    } catch {
      addToast('error', 'Não foi possível confirmar os vínculos históricos');
    } finally {
      setHistoryConfirming(false);
    }
  };

  // ─── Subcomponentes ───
  function StatusChip({ children, tone = 'default' }: { children: React.ReactNode; tone?: 'default' | 'primary' | 'ok' | 'warn' }) {
    const stylesMap: Record<string, React.CSSProperties> = {
      default: { backgroundColor: 'var(--color-bg)', color: 'var(--color-text-secondary)' },
      primary: { backgroundColor: 'var(--color-primary-bg)', color: 'var(--color-primary)' },
      ok: { backgroundColor: 'var(--color-primary-bg)', color: 'var(--color-primary)' },
      warn: { backgroundColor: 'var(--color-primary-bg)', color: 'var(--color-primary)' },
    };
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md whitespace-nowrap" style={stylesMap[tone]}>
        {children}
      </span>
    );
  }

  function TabHelp() {
    const [open, setOpen] = useState(false);
    const wrapRef = useRef<HTMLDivElement>(null);
    const help = {
      cr: {
        title: 'Setores e contas',
        body: 'Marque as interseções em que a conta é orçada no setor. Clique no cabeçalho de um setor para marcar ou desmarcar todas as contas filtradas de uma vez.',
      },
      conta: {
        title: 'Drivers por conta',
        body: 'Escolha primeiro a rota da conta. A rota CR lista modelos de projeção; a rota Pacote lista pacotes corporativos. Use Personalizar por CR quando setores da mesma conta precisarem de drivers diferentes.',
      },
      rateio: {
        title: 'Tipos de rateio',
        body: 'Crie rateios reutilizáveis por quantidade ou percentual. Eles podem ser aplicados nas linhas dos pacotes para distribuir um valor único entre os setores.',
      },
      modelo: {
        title: 'Modelos de projeção',
        body: 'Consulte modelos nativos, modelos por setor e pacotes. Selecione um item para ver as contas incluídas, os setores cobertos e as exceções.',
      },
    }[tab];

    useEffect(() => {
      if (!open) return;
      const onDown = (e: MouseEvent) => {
        if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
      };
      const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
      document.addEventListener('mousedown', onDown);
      document.addEventListener('keydown', onKey);
      return () => {
        document.removeEventListener('mousedown', onDown);
        document.removeEventListener('keydown', onKey);
      };
    }, [open]);

    return (
      <div ref={wrapRef} className="relative shrink-0">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="h-9 inline-flex items-center gap-1.5 px-3 rounded-lg border text-[12px] font-medium transition-colors"
          style={{ borderColor: open ? 'var(--color-primary)' : 'var(--color-border)', backgroundColor: open ? 'var(--color-primary-bg)' : 'var(--color-surface)', color: open ? 'var(--color-primary)' : 'var(--color-text-secondary)' }}
        >
          <HelpCircle size={14} /> Ajuda
        </button>
        {open && (
          <div
            className="absolute right-0 top-full mt-2 z-40 w-[340px] max-w-[80vw] rounded-xl p-4 animate-scaleIn"
            style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', boxShadow: '0 14px 34px -12px rgba(15, 23, 42, 0.24)' }}
          >
            <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
              <span className="w-7 h-7 rounded-full inline-flex items-center justify-center" style={{ backgroundColor: 'var(--color-primary-bg)', color: 'var(--color-primary)' }}>
                <HelpCircle size={14} />
              </span>
              {help.title}
            </div>
            <p className="mt-2 text-[12px] leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>{help.body}</p>
          </div>
        )}
      </div>
    );
  }

  // ============================================================
  // TAB 2 — POR CONTA (atribuição de modelo / pacote)
  // ============================================================
  // Modelos separados por ESCOPO: rota CR usa modelos de CR; rota Pacote usa
  // pacotes (modelos de pacote — os conceitos se fundiram: o pacote É o modelo
  // de pacote, e escolhê-lo na coluna Driver define a rota da conta).
  const modelosCR = useMemo(() => drivers.filter((d: any) => d.TIPO_DRIVER !== 'PACOTE' && d.ESCOPO !== 'PACOTE'), [drivers]);
  const modelosPacote = useMemo(() => drivers.filter((d: any) => d.TIPO_DRIVER !== 'PACOTE' && d.ESCOPO === 'PACOTE'), [drivers]);

  const contaDriverByConta = useMemo(() => {
    const m = new Map<number, any>();
    contaDrivers.forEach((cd: any) => m.set(cd.CONTA_ID, cd));
    return m;
  }, [contaDrivers]);

  const driverById = useMemo(() => {
    const m = new Map<number, any>();
    drivers.forEach((d: any) => m.set(d.ID, d));
    return m;
  }, [drivers]);

  // Conceito fundido: a rota é derivada do ESCOPO do driver escolhido.
  // Driver com ESCOPO='PACOTE' = conta em pacote (o driver É o pacote);
  // qualquer outro driver = rota CR (bottom-up). CONTA_DRIVER.PACOTE_ID
  // está deprecado (zerado na migração da fusão).
  const deriveRota = (cd: any | undefined | null): { calcDriverId: number | null; emPacote: boolean } => {
    if (!cd || cd.DRIVER_ID == null) return { calcDriverId: null, emPacote: false };
    const drv = driverById.get(cd.DRIVER_ID);
    return { calcDriverId: cd.DRIVER_ID, emPacote: drv?.ESCOPO === 'PACOTE' };
  };
  // Rota efetiva da conta na UI: override transitório > derivada do driver
  const rotaDaConta = (contaId: number, der: { emPacote: boolean }): 'CR' | 'PACOTE' =>
    rotaOverride[contaId] ?? (der.emPacote ? 'PACOTE' : 'CR');

  // CRs vinculados a cada conta (CR_CONTA)
  const crsPorConta = useMemo(() => {
    // Dedupe defensivo: Set garante que cada CR aparece uma vez por conta,
    // mesmo se CR_CONTA tiver linhas duplicadas (race condition de double-click).
    const m = new Map<number, Set<number>>();
    crContas.forEach((r: any) => {
      if (!m.has(r.CONTA_ID)) m.set(r.CONTA_ID, new Set());
      m.get(r.CONTA_ID)!.add(r.CR_ID);
    });
    const out = new Map<number, number[]>();
    m.forEach((set, contaId) => out.set(contaId, Array.from(set)));
    return out;
  }, [crContas]);

  // Excecoes por conta: contaId -> Map<crId, excecao>
  const excecoesPorConta = useMemo(() => {
    const m = new Map<number, Map<number, any>>();
    excecoes.forEach((e: any) => {
      if (!m.has(e.CONTA_ID)) m.set(e.CONTA_ID, new Map());
      m.get(e.CONTA_ID)!.set(e.CR_ID, e);
    });
    return m;
  }, [excecoes]);

  const crById = useMemo(() => {
    const m = new Map<number, any>();
    crs.forEach((c: any) => m.set(c.ID, c));
    return m;
  }, [crs]);

  // Resumo geral das contas — alimenta os chips de status dos dois passos
  const resumoContas = useMemo(() => {
    let semSetor = 0, semDriver = 0, emPacote = 0, personalizadas = 0;
    contas.forEach((c: any) => {
      if (!crsPorConta.get(c.ID)?.length) semSetor += 1;
      const der = deriveRota(contaDriverByConta.get(c.ID));
      if (der.calcDriverId == null) semDriver += 1;
      if (der.emPacote) emPacote += 1;
      if ((excecoesPorConta.get(c.ID)?.size || 0) > 0) personalizadas += 1;
    });
    return { semSetor, semDriver, emPacote, personalizadas };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contas, crsPorConta, contaDriverByConta, excecoesPorConta, driverById]);

  const [contaTabSearch, setContaTabSearch] = useState('');
  const [contaTabTipos, setContaTabTipos] = useState<string[]>([]);
  const [contaTabModelos, setContaTabModelos] = useState<string[]>([]); // valores: 'sem', 'modelo', 'pacote'
  const [busyContaId, setBusyContaId] = useState<number | null>(null);
  const [expandedContaId, setExpandedContaId] = useState<number | null>(null);
  const [busyExcecaoKey, setBusyExcecaoKey] = useState<string | null>(null);
  // Conta aguardando confirmacao de "limpar personalizacoes por CR"
  const [confirmClearContaId, setConfirmClearContaId] = useState<number | null>(null);
  const [clearingPersonalizacoes, setClearingPersonalizacoes] = useState(false);

  // Remove todas as excecoes por CR de uma conta (desliga o "Personalizar por CR")
  const clearPersonalizacoes = async () => {
    if (confirmClearContaId == null) return;
    const excs = excecoesPorConta.get(confirmClearContaId);
    if (!excs || excs.size === 0) { setConfirmClearContaId(null); return; }
    setClearingPersonalizacoes(true);
    try {
      for (const exc of excs.values()) {
        await removeRecord('CONTA_DRIVER_EXCECAO', exc.ID);
      }
      addToast('success', 'Personalizações por setor removidas — a conta volta a usar só a regra geral');
      refetchExcecoes();
      setExpandedContaId(null);
    } catch { addToast('error', 'Erro ao remover personalizações'); }
    setClearingPersonalizacoes(false);
    setConfirmClearContaId(null);
  };

  // ============================================================
  // TAB 3 — TIPOS DE RATEIO (cadastro reutilizável, aplicado por linha
  // nos modelos de pacote via coluna "Rateio aplicado")
  // ============================================================
  const [expandedRateioId, setExpandedRateioId] = useState<number | null>(null);
  const [rateioModalOpen, setRateioModalOpen] = useState(false);
  const [rateioEditId, setRateioEditId] = useState<number | null>(null); // null = criando
  const [rateioNome, setRateioNome] = useState('');
  const [rateioDesc, setRateioDesc] = useState('');
  // Como o rateio e informado: 'QUANTIDADE' (ex.: pessoas por CR, % derivado) ou
  // 'PERCENTUAL' (digita o % de cada CR direto). Escolhido na criacao, imutavel depois.
  const [rateioTipo, setRateioTipo] = useState<'QUANTIDADE' | 'PERCENTUAL'>('QUANTIDADE');
  const [savingRateio, setSavingRateio] = useState(false);
  const [confirmDeleteRateio, setConfirmDeleteRateio] = useState<any | null>(null);
  const [deletingRateio, setDeletingRateio] = useState(false);
  // Rascunho local dos inputs de quantidade (`${rateioId}-${crId}` -> texto digitado)
  const [qtyDrafts, setQtyDrafts] = useState<Map<string, string>>(new Map());
  const [savingQtyKey, setSavingQtyKey] = useState<string | null>(null);

  const rateioItemLookup = useMemo(() => {
    const m = new Map<string, any>();
    rateioItens.forEach((it: any) => m.set(`${it.RATEIO_ID}-${it.CR_ID}`, it));
    return m;
  }, [rateioItens]);

  const rateioTipoOf = (r: any): 'QUANTIDADE' | 'PERCENTUAL' =>
    String(r?.TIPO || '').toUpperCase() === 'PERCENTUAL' ? 'PERCENTUAL' : 'QUANTIDADE';

  const rateioUsoById = useMemo(() => {
    const m = new Map<number, number>();
    rateioUsos.forEach((u: any) => m.set(Number(u.RATEIO_ID), Number(u.QTD)));
    return m;
  }, [rateioUsos]);

  const parseQty = (raw: string): number => {
    const n = parseFloat(String(raw).trim().replace(',', '.'));
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };

  // Quantidade efetiva de um (rateio, CR): rascunho em edição ou valor salvo
  const qtyOf = (rateioId: number, crId: number): number => {
    const key = `${rateioId}-${crId}`;
    const draft = qtyDrafts.get(key);
    if (draft != null) return parseQty(draft);
    const item = rateioItemLookup.get(key);
    return item ? Number(item.QUANTIDADE) || 0 : 0;
  };

  const totalQtyOf = (rateioId: number): number =>
    crs.reduce((acc: number, cr: any) => acc + qtyOf(rateioId, cr.ID), 0);

  const crsComQtdOf = (rateioId: number): number =>
    crs.reduce((acc: number, cr: any) => acc + (qtyOf(rateioId, cr.ID) > 0 ? 1 : 0), 0);

  // Persiste a quantidade de um (rateio, CR) no blur do input
  const saveRateioQty = async (rateioId: number, crId: number) => {
    const key = `${rateioId}-${crId}`;
    const draft = qtyDrafts.get(key);
    if (draft == null) return;
    const num = parseQty(draft);
    const item = rateioItemLookup.get(key);
    const saved = item ? Number(item.QUANTIDADE) || 0 : 0;
    if (num === saved) {
      setQtyDrafts((prev) => { const m = new Map(prev); m.delete(key); return m; });
      return;
    }
    setSavingQtyKey(key);
    try {
      if (item) await updateRecord('RATEIO_ITEM', item.ID, { QUANTIDADE: num });
      else await createRecord('RATEIO_ITEM', { RATEIO_ID: rateioId, CR_ID: crId, QUANTIDADE: num });
      // Dar quantidade a um setor e dizer que ele participa do rateio — entao a
      // conta da linha de pacote passa a ser dele. Sem este vinculo o setor era
      // descartado da divisao e os percentuais renormalizavam nos outros, sem
      // aviso. Best-effort: falhar aqui nao pode derrubar o save da quantidade.
      try { await execSF(SF_IDS.sincronizarCrContaRateio, {}); } catch { /* sincroniza na proxima */ }
      await refetchHot();
      setQtyDrafts((prev) => { const m = new Map(prev); m.delete(key); return m; });
    } catch { addToast('error', 'Erro ao salvar a quantidade do rateio'); }
    setSavingQtyKey(null);
  };

  const openCreateRateio = () => { setRateioEditId(null); setRateioNome(''); setRateioDesc(''); setRateioTipo('QUANTIDADE'); setRateioModalOpen(true); };
  const openEditRateio = (r: any) => { setRateioEditId(r.ID); setRateioNome(r.NOME || ''); setRateioDesc(r.DESCRICAO || ''); setRateioTipo(rateioTipoOf(r)); setRateioModalOpen(true); };

  const handleSaveRateio = async () => {
    const nome = rateioNome.trim();
    if (!nome) { addToast('error', 'Informe um nome para o rateio'); return; }
    if (rateios.some((r: any) => r.NOME.toLowerCase() === nome.toLowerCase() && r.ID !== rateioEditId)) {
      addToast('error', `Já existe um rateio chamado "${nome}"`);
      return;
    }
    setSavingRateio(true);
    try {
      if (rateioEditId != null) {
        await updateRecord('RATEIO', rateioEditId, { NOME: nome, DESCRICAO: rateioDesc.trim() || null });
        addToast('success', 'Rateio atualizado');
      } else {
        const res: any = await createRecord('RATEIO', {
          NOME: nome, DESCRICAO: rateioDesc.trim() || null, TIPO: rateioTipo, ATIVO: true,
          CRIADO_EM: new Date().toISOString().slice(0, 19),
        });
        const newId = res?.id ?? res?.result?.id ?? res?.ID;
        if (typeof newId === 'number') setExpandedRateioId(newId);
        addToast('success', rateioTipo === 'PERCENTUAL'
          ? 'Rateio criado — informe o percentual de cada setor'
          : 'Rateio criado — informe as quantidades por setor');
      }
      refetchHot();
      setRateioModalOpen(false);
    } catch { addToast('error', 'Erro ao salvar o rateio'); }
    setSavingRateio(false);
  };

  const handleDeleteRateio = async () => {
    if (!confirmDeleteRateio) return;
    setDeletingRateio(true);
    try {
      const itens = rateioItens.filter((it: any) => it.RATEIO_ID === confirmDeleteRateio.ID);
      for (const it of itens) await removeRecord('RATEIO_ITEM', it.ID);
      await removeRecord('RATEIO', confirmDeleteRateio.ID);
      addToast('success', 'Rateio excluído');
      if (expandedRateioId === confirmDeleteRateio.ID) setExpandedRateioId(null);
      refetchHot();
    } catch { addToast('error', 'Erro ao excluir o rateio'); }
    setDeletingRateio(false);
    setConfirmDeleteRateio(null);
  };

  const contaTabTiposSet = useMemo(() => new Set(contaTabTipos), [contaTabTipos]);
  const contaTabModelosSet = useMemo(() => new Set(contaTabModelos), [contaTabModelos]);
  const filteredContasTab2 = useMemo(() => {
    return contas.filter((c: any) => {
      if (contaTabTipos.length > 0 && !contaTabTiposSet.has(c.TIPO)) return false;
      const cd = contaDriverByConta.get(c.ID);
      const der = deriveRota(cd);
      if (contaTabModelos.length > 0) {
        // determinar status desta conta (rota derivada do escopo do driver)
        let status: string;
        if (!cd || der.calcDriverId == null) status = 'sem';
        else if (der.emPacote) status = 'pacote';
        else status = 'modelo';
        if (!contaTabModelosSet.has(status)) return false;
      }
      if (contaTabSearch.trim()) {
        const s = contaTabSearch.toLowerCase();
        return c.CODIGO.toLowerCase().includes(s) || c.NOME.toLowerCase().includes(s);
      }
      return true;
    });
  }, [contas, contaTabTipos, contaTabTiposSet, contaTabModelos, contaTabModelosSet, contaTabSearch, contaDriverByConta, driverById]);

  // Paginação da lista (aba Drivers por conta) — client-side, volta pra página 1 ao mudar filtros
  const [contaTabPage, setContaTabPage] = useState(0);
  useEffect(() => { setContaTabPage(0); }, [contaTabSearch, contaTabTipos, contaTabModelos]);
  const contaTabPageSafe = Math.min(contaTabPage, Math.max(0, Math.ceil(filteredContasTab2.length / PAGE_SIZE) - 1));
  const pagedContasTab2 = useMemo(
    () => filteredContasTab2.slice(contaTabPageSafe * PAGE_SIZE, (contaTabPageSafe + 1) * PAGE_SIZE),
    [filteredContasTab2, contaTabPageSafe]
  );

  // Grava o driver da conta na CONTA_DRIVER (DRIVER_ID). A rota é consequência:
  // driver com ESCOPO='PACOTE' coloca a conta no pacote; os demais são rota CR.
  // keepOverride mantém a rota escolhida na UI quando o driver é só limpo.
  const setContaDriver = async (contaId: number, newDriverId: number | null, opts?: { keepOverride?: boolean }) => {
    setBusyContaId(contaId);
    try {
      const old = contaDriverByConta.get(contaId);
      if ((old?.DRIVER_ID ?? null) !== newDriverId) {
        if (newDriverId == null) {
          if (old) await removeRecord('CONTA_DRIVER', old.ID);
        } else if (old) {
          await updateRecord('CONTA_DRIVER', old.ID, { DRIVER_ID: newDriverId, PACOTE_ID: null });
        } else {
          await createRecord('CONTA_DRIVER', {
            CONTA_ID: contaId,
            DRIVER_ID: newDriverId,
            PACOTE_ID: null,
            CRIADO_EM: new Date().toISOString().slice(0, 19),
          });
        }
        // Rota pacote: garante a linha da conta no pacote — o grid do gestor é
        // dirigido pelas linhas (DRIVER_FORMULA); sem linha a conta não aparece
        // no preenchimento (espelho do sync que o editor faz no outro sentido).
        const novoDriver = newDriverId != null ? driverById.get(newDriverId) : null;
        if (novoDriver?.ESCOPO === 'PACOTE') {
          try {
            const has = await querySQL(`SELECT ID FROM DRIVER_FORMULA WHERE DRIVER_ID = ${newDriverId} AND CONTA_ID = ${contaId} LIMIT 1`);
            if (has.length === 0) {
              await createRecord('DRIVER_FORMULA', {
                DRIVER_ID: newDriverId, CONTA_ID: contaId, TIPO: 'INPUT', FORMULA: '',
                ORDEM: 0, ESCONDER: false, NEGRITO: false, FORMATO: 'SEM_PREFIXO',
              });
            }
          } catch { /* editor recria a linha ao abrir — não bloqueia a rota */ }
        }
        refetchContaDrivers();
      }
      if (!opts?.keepOverride) {
        setRotaOverride((prev) => {
          if (!(contaId in prev)) return prev;
          const next = { ...prev };
          delete next[contaId];
          return next;
        });
      }
    } catch (e) {
      console.error(e);
      addToast('error', 'Erro ao atualizar mapeamento da conta');
    }
    setBusyContaId(null);
  };

  // Troca a rota (CR/Pacote) da conta. Se o driver atual não pertence à nova
  // rota, ele é limpo — o usuário escolhe o modelo/pacote na coluna Driver.
  // Indo para pacote, remove as personalizações por CR (pacote segue só a regra geral).
  const setContaRota = async (contaId: number, rota: 'CR' | 'PACOTE') => {
    const der = deriveRota(contaDriverByConta.get(contaId));
    if (rotaDaConta(contaId, der) === rota) return;
    setRotaOverride((prev) => ({ ...prev, [contaId]: rota }));
    const calcDriver = der.calcDriverId != null ? driverById.get(der.calcDriverId) : null;
    const driverPertence = calcDriver ? (calcDriver.ESCOPO === 'PACOTE') === (rota === 'PACOTE') : true;
    if (calcDriver && !driverPertence) await setContaDriver(contaId, null, { keepOverride: true });
    if (rota === 'PACOTE') {
      const excs = excecoesPorConta.get(contaId);
      if (excs && excs.size > 0) {
        try {
          for (const exc of excs.values()) await removeRecord('CONTA_DRIVER_EXCECAO', exc.ID);
          addToast('success', 'Personalizações por CR removidas — contas em pacote seguem só a regra geral');
          refetchExcecoes();
        } catch { addToast('error', 'Erro ao remover personalizações por CR da conta'); }
      }
    }
  };

  // Override por (CR, conta): null = remove a exceção (volta a herdar a regra geral)
  const setExcecao = async (contaId: number, crId: number, newDriverId: number | null) => {
    const key = `${contaId}-${crId}`;
    setBusyExcecaoKey(key);
    try {
      const existing = excecoesPorConta.get(contaId)?.get(crId) || null;
      if (existing && existing.DRIVER_ID === newDriverId) { setBusyExcecaoKey(null); return; }
      if (existing) await removeRecord('CONTA_DRIVER_EXCECAO', existing.ID);
      if (newDriverId != null) {
        await createRecord('CONTA_DRIVER_EXCECAO', {
          CR_ID: crId,
          CONTA_ID: contaId,
          DRIVER_ID: newDriverId,
          ATIVO: true,
          CRIADO_EM: new Date().toISOString().slice(0, 19),
        });
      }
      refetchExcecoes();
    } catch (e) { console.error(e); addToast('error', 'Erro ao atualizar exceção por setor'); }
    setBusyExcecaoKey(null);
  };

  // Picker do DRIVER de calculo da conta. As opções dependem da ROTA escolhida:
  // rota CR (bottom-up) lista modelos de CR; rota Pacote lista modelos de pacote.
  function DriverPicker({ contaId, currentDriverId, emPacote }: { contaId: number; currentDriverId: number | null; emPacote: boolean }) {
    const [open, setOpen] = useState(false);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const current = currentDriverId != null ? driverById.get(currentDriverId) : null;
    const currentLabel = !current ? (emPacote ? 'Sem pacote' : 'Sem driver') : driverLabel(current.NOME);
    const opcoes = emPacote ? modelosPacote : modelosCR;

    useEffect(() => {
      if (!open) return;
      const onClick = (e: MouseEvent) => {
        if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
      };
      const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
      document.addEventListener('mousedown', onClick);
      document.addEventListener('keydown', onKey);
      return () => {
        document.removeEventListener('mousedown', onClick);
        document.removeEventListener('keydown', onKey);
      };
    }, [open]);

    const pick = async (driverId: number | null) => {
      setOpen(false);
      // Ao limpar o driver em rota pacote, fixa a rota na UI (senão a linha
      // voltaria para CR e a lista filtrada mudaria embaixo do usuário).
      if (driverId == null && emPacote) setRotaOverride((prev) => ({ ...prev, [contaId]: 'PACOTE' }));
      await setContaDriver(contaId, driverId, { keepOverride: driverId == null && emPacote });
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && currentDriverId != null) {
        e.preventDefault();
        pick(null);
      }
    };

    return (
      <div ref={wrapperRef} className="relative w-44 shrink-0">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          onKeyDown={handleKeyDown}
          title={current ? 'Delete para limpar' : undefined}
          className="w-full h-8 pl-3 pr-2.5 text-[12px] rounded-lg border text-left flex items-center justify-between transition-all"
          style={{
            backgroundColor: 'var(--color-surface)',
            borderColor: open ? 'var(--color-primary)' : 'var(--color-border)',
            color: current ? 'var(--color-text)' : 'var(--color-text-secondary)',
            boxShadow: open ? '0 0 0 2px color-mix(in srgb, var(--color-primary) 10%, transparent)' : 'none',
          }}
        >
          <span className="inline-flex items-center gap-1.5 truncate">
            <Calculator size={12} className="shrink-0" style={{ color: 'var(--color-text-secondary)' }} />
            <span className="truncate">{currentLabel}</span>
          </span>
          <ChevronDown size={14} className={`transition-transform shrink-0 ml-2 ${open ? 'rotate-180' : ''}`} style={{ color: 'var(--color-text-secondary)' }} />
        </button>
        {open && (
          <div
            className="absolute left-0 top-full mt-1.5 w-60 rounded-xl z-50 p-1.5 animate-scaleIn"
            style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 14px 34px -12px rgba(15, 23, 42, 0.24)' }}
          >
            <div className="max-h-[320px] overflow-y-auto">
              <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
                {emPacote ? 'Pacotes' : 'Modelos de projeção'}
              </div>
              {opcoes.length === 0 && (
                <div className="px-3 py-2 text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
                  {emPacote ? 'Nenhum pacote criado ainda.' : 'Nenhum modelo de CR criado ainda.'}
                </div>
              )}
              {opcoes.map((d: any) => {
                const sel = currentDriverId === d.ID;
                return (
                  <button
                    key={d.ID}
                    type="button"
                    onClick={() => pick(d.ID)}
                    className="w-full flex items-center justify-between px-2.5 py-2 text-[12px] text-left rounded-lg transition-colors"
                    style={{ color: 'var(--color-text)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-hover)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                  >
                    <span className="truncate">{driverLabel(d.NOME)}</span>
                    {sel && <Check size={13} className="shrink-0 ml-2" style={{ color: 'var(--color-primary)' }} />}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => { setOpen(false); setPendingCreateMode(emPacote ? 'PACOTE' : 'NORMAL'); changeTab('modelo'); }}
                className="w-full flex items-center gap-1 px-2.5 py-2 text-[11px] text-left rounded-lg transition-colors"
                style={{ color: 'var(--color-primary)' }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-hover)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
              >
                <Plus size={11} /> {emPacote ? 'Novo pacote' : 'Novo modelo'}
              </button>

              <button
                type="button"
                onClick={() => pick(null)}
                className="w-full flex items-center justify-between px-2.5 py-2 mt-1 text-[12px] text-left rounded-lg transition-colors"
                style={{ color: 'var(--color-text)' }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-hover)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
              >
                <span>{emPacote ? 'Sem pacote' : 'Sem driver'}</span>
                {!current && <Check size={13} className="shrink-0 ml-2" style={{ color: 'var(--color-primary)' }} />}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Picker da ROTA da conta: CR (bottom-up) ou Pacote. A rota filtra o que a
  // coluna Driver lista — modelos de CR ou pacotes (modelos de pacote).
  function RotaPicker({ contaId, rota }: { contaId: number; rota: 'CR' | 'PACOTE' }) {
    const [open, setOpen] = useState(false);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const isPacote = rota === 'PACOTE';

    useEffect(() => {
      if (!open) return;
      const onClick = (e: MouseEvent) => {
        if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
      };
      const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
      document.addEventListener('mousedown', onClick);
      document.addEventListener('keydown', onKey);
      return () => {
        document.removeEventListener('mousedown', onClick);
        document.removeEventListener('keydown', onKey);
      };
    }, [open]);

    const pick = async (novaRota: 'CR' | 'PACOTE') => {
      setOpen(false);
      await setContaRota(contaId, novaRota);
    };

    const OPCOES: Array<{ rota: 'CR' | 'PACOTE'; label: string; hint: string }> = [
      { rota: 'CR', label: 'CR (bottom-up)', hint: 'Cada gestor lança no próprio CR' },
      { rota: 'PACOTE', label: 'Pacote', hint: 'Lançada pelo responsável do pacote (top-down)' },
    ];

    return (
      <div ref={wrapperRef} className="relative w-52 shrink-0">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="w-full h-8 pl-3 pr-2.5 text-[12px] rounded-lg border text-left flex items-center justify-between transition-all"
          style={{
            backgroundColor: isPacote ? 'var(--color-primary-bg)' : 'var(--color-surface)',
            borderColor: isPacote ? 'var(--color-primary)' : 'var(--color-border)',
            color: isPacote ? 'var(--color-primary)' : 'var(--color-text)',
            boxShadow: open ? '0 0 0 2px color-mix(in srgb, var(--color-primary) 10%, transparent)' : 'none',
          }}
        >
          <span className="inline-flex items-center gap-1.5 truncate">
            {isPacote
              ? <Package size={12} className="shrink-0" />
              : <Building2 size={12} className="shrink-0" style={{ color: 'var(--color-text-secondary)' }} />}
            <span className="truncate">{isPacote ? 'Pacote' : 'CR (bottom-up)'}</span>
          </span>
          <ChevronDown size={14} className={`transition-transform shrink-0 ml-2 ${open ? 'rotate-180' : ''}`} style={{ color: 'var(--color-text-secondary)' }} />
        </button>
        {open && (
          <div
            className="absolute left-0 top-full mt-1.5 w-64 rounded-xl z-50 p-1.5 animate-scaleIn"
            style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 14px 34px -12px rgba(15, 23, 42, 0.24)' }}
          >
            {OPCOES.map((opt) => {
              const sel = rota === opt.rota;
              return (
                <button
                  key={opt.rota}
                  type="button"
                  onClick={() => pick(opt.rota)}
                  className="w-full flex items-start justify-between px-2.5 py-2 rounded-lg text-left transition-colors"
                  style={{ color: 'var(--color-text)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-hover)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                >
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 text-[13px]">
                      {opt.rota === 'PACOTE'
                        ? <Package size={12} className="shrink-0" style={{ color: 'var(--color-primary)' }} />
                        : <Building2 size={12} className="shrink-0" style={{ color: 'var(--color-text-secondary)' }} />}
                      {opt.label}
                    </span>
                    <span className="block text-[11px] mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>{opt.hint}</span>
                  </span>
                  {sel && <Check size={13} className="shrink-0 ml-2 mt-0.5" style={{ color: 'var(--color-primary)' }} />}
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // Picker de exceção por (CR, conta). Null = herdar a regra geral.
  // A exceção altera SOMENTE o modelo (driver de cálculo) para o CR específico.
  // A rota (CR/Pacote) é definida na regra geral e não muda por exceção.
  function CRDriverPicker({ contaId, crId, currentDriverId, globalDriverId, busy }: {
    contaId: number; crId: number; currentDriverId: number | null;
    globalDriverId: number | null; busy: boolean;
  }) {
    const [open, setOpen] = useState(false);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const current = currentDriverId != null ? driverById.get(currentDriverId) : null;
    const globalDriver = globalDriverId != null ? driverById.get(globalDriverId) : null;

    // No contexto da exceção, só NORMAL importa (rota não muda por CR).
    const labelOf = (d: any) => d && d.TIPO_DRIVER !== 'PACOTE' ? driverLabel(d.NOME) : 'Sem modelo';

    const currentLabel = current ? labelOf(current) : `Igual à regra geral · ${labelOf(globalDriver)}`;

    useEffect(() => {
      if (!open) return;
      const onClick = (e: MouseEvent) => {
        if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
      };
      const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
      document.addEventListener('mousedown', onClick);
      document.addEventListener('keydown', onKey);
      return () => {
        document.removeEventListener('mousedown', onClick);
        document.removeEventListener('keydown', onKey);
      };
    }, [open]);

    const pick = async (driverId: number | null) => {
      setOpen(false);
      await setExcecao(contaId, crId, driverId);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && currentDriverId != null) {
        e.preventDefault();
        pick(null);
      }
    };

    return (
      <div ref={wrapperRef} className="relative w-64 shrink-0">
        <button
          type="button"
          disabled={busy}
          onClick={() => setOpen((o) => !o)}
          onKeyDown={handleKeyDown}
          title={current ? 'Delete para voltar a usar a regra geral' : undefined}
          className="w-full h-8 pl-3 pr-2.5 text-[12px] rounded-lg border text-left flex items-center justify-between transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          style={{
            backgroundColor: 'var(--color-surface)',
            borderColor: current ? 'var(--color-primary)' : 'var(--color-border)',
            color: current ? 'var(--color-text)' : 'var(--color-text-secondary)',
            boxShadow: open ? '0 0 0 2px color-mix(in srgb, var(--color-primary) 10%, transparent)' : 'none',
          }}
        >
          <span className="truncate">{currentLabel}</span>
          <ChevronDown size={13} className={`transition-transform shrink-0 ml-2 ${open ? 'rotate-180' : ''}`} style={{ color: 'var(--color-text-secondary)' }} />
        </button>
        {open && (
          <div
            className="absolute right-0 top-full mt-1.5 w-72 rounded-xl z-50 p-1.5 animate-scaleIn"
            style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 14px 34px -12px rgba(15, 23, 42, 0.24)' }}
          >
            <div className="max-h-[320px] overflow-y-auto">
              <button
                type="button"
                onClick={() => pick(null)}
                className="w-full flex items-center justify-between px-2.5 py-2 text-[12px] rounded-lg text-left transition-colors"
                style={{ color: 'var(--color-text)' }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-hover)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
              >
                <span className="truncate">Igual à regra geral · {labelOf(globalDriver)}</span>
                {!current && <Check size={13} className="shrink-0 ml-2" style={{ color: 'var(--color-primary)' }} />}
              </button>

              <div className="my-1 mx-3" style={{ borderTop: '1px solid var(--color-border)' }}></div>

              <div className="px-3 pt-1 pb-1 text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
                Modelos de projeção
              </div>
              {modelosCR.map((d: any) => {
                const sel = currentDriverId === d.ID;
                return (
                  <button
                    key={d.ID}
                    type="button"
                    onClick={() => pick(d.ID)}
                    className="w-full flex items-center justify-between px-2.5 py-2 text-[12px] rounded-lg text-left transition-colors"
                    style={{ color: 'var(--color-text)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-hover)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                  >
                    <span className="truncate">{driverLabel(d.NOME)}</span>
                    {sel && <Check size={13} className="shrink-0 ml-2" style={{ color: 'var(--color-primary)' }} />}
                  </button>
                );
              })}

            </div>
          </div>
        )}
      </div>
    );
  }

  // ============================================================
  // INSIGHTS (botão no header externo da tela Mapeamento)
  // ============================================================
  function AiInsights() {
    const [open, setOpen] = useState(false);
    const wrapRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      if (!open) return;
      const onDown = (e: MouseEvent) => {
        if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
      };
      document.addEventListener('mousedown', onDown);
      return () => document.removeEventListener('mousedown', onDown);
    }, [open]);

    const contaDriverByConta = useMemo(() => {
      const m = new Map<number, any>();
      contaDrivers.forEach((cd: any) => m.set(cd.CONTA_ID, cd));
      return m;
    }, [contaDrivers]);
    const contasSemModelo = useMemo(() => contas.filter((c: any) => {
      const mapping = contaDriverByConta.get(c.ID);
      return !mapping || mapping.DRIVER_ID == null;
    }), [contas, contaDriverByConta]);
    const contasMapeadasEmAlgumCR = useMemo(() => {
      const s = new Set<number>();
      crContas.forEach((r: any) => s.add(r.CONTA_ID));
      return s;
    }, [crContas]);
    const contasSemSetor = useMemo(() => contas.filter((c: any) => !contasMapeadasEmAlgumCR.has(c.ID)), [contas, contasMapeadasEmAlgumCR]);

    const total = contasSemModelo.length + contasSemSetor.length;
    const hasAlerts = total > 0;

    // O alerta veste a familia de atencao (laranja), nao a cor de marca: em roxo ele
    // se confundia com os botoes de acao da barra e nao comunicava "olhe isto".
    // O fundo e quase branco de proposito — o peso fica na borda e no texto, para
    // o botao nao virar um bloco de cor no meio da barra.
    return (
      <div ref={wrapRef} className="relative shrink-0">
        <button
          onClick={() => setOpen((v) => !v)}
          className="relative h-9 inline-flex items-center gap-1.5 px-3 rounded-lg border transition-colors cursor-pointer"
          style={{ backgroundColor: hasAlerts || open ? 'var(--color-alerta-bg)' : 'var(--color-surface)', borderColor: hasAlerts || open ? 'var(--color-alerta-border)' : 'var(--color-border)', color: hasAlerts || open ? 'var(--color-alerta-text)' : 'var(--color-text-secondary)', boxShadow: 'none' }}
          onMouseEnter={(e) => { if (!open) e.currentTarget.style.backgroundColor = 'var(--color-alerta-bg)'; }}
          onMouseLeave={(e) => { if (!open && !hasAlerts) e.currentTarget.style.backgroundColor = 'var(--color-surface)'; }}
          title="Pontos de atenção"
        >
          <Bell size={14} style={{ color: hasAlerts || open ? 'var(--color-alerta-icon)' : undefined }} />
          <span className="text-[12px] font-medium">Pontos de atenção</span>
          {hasAlerts && <span className="min-w-[18px] h-[18px] px-1 rounded-full inline-flex items-center justify-center text-[10px] font-bold tabular-nums ml-0.5" style={{ backgroundColor: 'var(--color-alerta-text)', color: '#fff' }}>{total}</span>}
        </button>
        {open && (
          <div
            className="absolute right-0 top-full mt-2 z-50 rounded-xl shadow-lg overflow-hidden animate-scaleIn"
            style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', width: 340 }}
          >
            <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--color-border)' }}>
              <div className="text-[13px] font-semibold" style={{ color: 'var(--color-text)' }}>
                {hasAlerts ? 'Pontos de atenção' : 'Tudo configurado'}
              </div>
            </div>

            {!hasAlerts ? (
              <div className="px-4 py-6 text-center">
                <CheckCircle2 size={18} className="mx-auto mb-2" style={{ color: 'var(--color-primary)' }} />
                <div className="text-[12px] font-medium" style={{ color: 'var(--color-text)' }}>Nenhum alerta</div>
                <p className="text-[11px] mt-1" style={{ color: 'var(--color-text-secondary)' }}>
                  Todas as contas estão vinculadas a um modelo e mapeadas em pelo menos um setor.
                </p>
              </div>
            ) : (
              <div className="py-1">
                <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-1.5">
                      <Layers size={12} style={{ color: 'var(--color-text-secondary)' }} />
                      <span className="text-[12px] font-medium" style={{ color: 'var(--color-text)' }}>Contas sem modelo</span>
                    </div>
                    <span className="text-[11px] tabular-nums font-medium" style={{ color: contasSemModelo.length > 0 ? 'var(--color-alerta-text)' : 'var(--color-text-secondary)' }}>
                      {contasSemModelo.length}
                    </span>
                  </div>
                  {contasSemModelo.length > 0 ? (
                    <>
                      <p className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>Não serão calculadas no orçamento.</p>
                      <ul className="text-[11px] mt-1.5 space-y-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                        {contasSemModelo.slice(0, 4).map((c: any) => (
                          <li key={c.ID} className="truncate">
                            <span className="font-mono">{c.CODIGO}</span> · {toTitleCase(c.NOME)}
                          </li>
                        ))}
                        {contasSemModelo.length > 4 && (<li>+ {contasSemModelo.length - 4} outra{contasSemModelo.length - 4 === 1 ? '' : 's'}</li>)}
                      </ul>
                      <button
                        onClick={() => { setOpen(false); changeTab('conta'); }}
                        className="mt-2 text-[11px] font-medium cursor-pointer transition-colors"
                        style={{ color: 'var(--color-primary)' }}
                      >
                        Ir para o passo 2 · Drivers por conta →
                      </button>
                    </>
                  ) : (
                    <p className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>Todas têm um modelo.</p>
                  )}
                </div>
                <div className="px-4 py-3">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-1.5">
                      <Users size={12} style={{ color: 'var(--color-text-secondary)' }} />
                      <span className="text-[12px] font-medium" style={{ color: 'var(--color-text)' }}>Contas sem setor</span>
                    </div>
                    <span className="text-[11px] tabular-nums font-medium" style={{ color: contasSemSetor.length > 0 ? 'var(--color-alerta-text)' : 'var(--color-text-secondary)' }}>
                      {contasSemSetor.length}
                    </span>
                  </div>
                  {contasSemSetor.length > 0 ? (
                    <>
                      <p className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>Não aparecem em nenhum CR.</p>
                      <ul className="text-[11px] mt-1.5 space-y-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                        {contasSemSetor.slice(0, 4).map((c: any) => (
                          <li key={c.ID} className="truncate">
                            <span className="font-mono">{c.CODIGO}</span> · {toTitleCase(c.NOME)}
                          </li>
                        ))}
                        {contasSemSetor.length > 4 && (<li>+ {contasSemSetor.length - 4} outra{contasSemSetor.length - 4 === 1 ? '' : 's'}</li>)}
                      </ul>
                      <button
                        onClick={() => { setOpen(false); changeTab('cr'); }}
                        className="mt-2 text-[11px] font-medium cursor-pointer transition-colors"
                        style={{ color: 'var(--color-primary)' }}
                      >
                        Ir para o passo 1 · Setores e contas →
                      </button>
                    </>
                  ) : (
                    <p className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>Todas estão em algum setor.</p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="animate-fadeIn">
      {/* CABEÇALHO + TABS — sticky no topo */}
      <div
        className={`sticky -top-8 z-40 -mx-8 -mt-8 px-8 pt-8 pb-3 ${tab === 'rateio' ? 'mb-3 space-y-4' : 'mb-6 space-y-6'}`}
        style={{ backgroundColor: 'var(--bg-app)' }}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--color-text)' }}>
              Mapeamento
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <AiInsights />
          </div>
        </div>

        {/* TABS — passos do fluxo de mapeamento */}
        <div className="flex items-center gap-1 border-b" style={{ borderColor: 'var(--color-border)' }}>
          {([
            { key: 'cr', step: '1', label: 'Setores e contas' },
            { key: 'conta', step: '2', label: 'Drivers por conta' },
            { key: 'rateio', step: '3', label: 'Tipos de rateio' },
            { key: 'modelo', step: null, label: 'Modelos de projeção' },
          ] as const).map((t) => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => changeTab(t.key)}
                className="px-4 py-2 text-sm font-medium transition-colors relative inline-flex items-center gap-2"
                style={{
                  color: active ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                  borderBottom: active ? '2px solid var(--color-primary)' : '2px solid transparent',
                  marginBottom: '-1px',
                }}
              >
                {t.step && (
                  <span
                    className="inline-flex items-center justify-center w-[18px] h-[18px] rounded-full text-[10px] font-bold shrink-0"
                    style={{
                      backgroundColor: active ? 'var(--color-primary)' : 'var(--color-bg)',
                      color: active ? '#fff' : 'var(--color-text-secondary)',
                      border: active ? 'none' : '1px solid var(--color-border)',
                    }}
                  >
                    {t.step}
                  </span>
                )}
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-6">

      {tab === 'cr' && (
      <div className="space-y-4">
        {/* Filtros + resumo */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--color-text-secondary)' }} />
            <input
              type="text"
              placeholder="Buscar conta"
              value={contaSearch}
              onChange={(e) => setContaSearch(e.target.value)}
              onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--color-primary)'; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--color-border)'; }}
              className="w-full pl-8 pr-3 py-2 text-sm rounded-lg border bg-transparent focus:outline-none"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            />
          </div>
          <div className="w-44 shrink-0">
            <MultiSelect
              values={tipoFilters}
              onChange={setTipoFilters}
              allLabel="Todos os tipos"
              options={tipoValues.map((t) => ({ value: t, label: tipoLabel(t) }))}
            />
          </div>
          <div className="w-52 shrink-0">
            <MultiSelect
              values={crFilters}
              onChange={setCrFilters}
              allLabel="Todos os setores"
              options={crs.map((cr: any) => ({ value: String(cr.ID), label: `${cr.CODIGO} — ${toTitleCase(cr.NOME)}` }))}
            />
          </div>
          <button
            type="button"
            onClick={openHistoryPreview}
            disabled={historyLoading}
            className="h-10 inline-flex items-center gap-2 px-3 rounded-lg border text-sm font-medium transition-colors disabled:opacity-50"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)', backgroundColor: 'var(--color-surface)' }}
          >
            <Sparkles size={14} style={{ color: 'var(--color-primary)' }} />
            Mapear por histórico
          </button>
          <div className="ml-auto flex items-center gap-1.5 shrink-0">
            {resumoContas.semSetor > 0 && (
              <StatusChip tone="warn">{resumoContas.semSetor} conta{resumoContas.semSetor === 1 ? '' : 's'} sem setor</StatusChip>
            )}
            {initialLoading ? (
              <Skeleton className="h-3" style={{ width: 160 }} />
            ) : (
              <span className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
                {filteredContas.length} de {contas.length} contas · {crFilters.length > 0 ? `${crsVisiveis.length} de ${crs.length}` : crs.length} setores
              </span>
            )}
          </div>
          <TabHelp />
        </div>

        {/* Matriz contas × setores */}
        {initialLoading ? (
          <SkeletonTable columns={7} rows={10} firstColWidth="260px" />
        ) : (
        <Card className="overflow-hidden">
          {crs.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              Nenhum setor cadastrado ainda.
            </div>
          ) : filteredContas.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              Nenhuma conta encontrada com os filtros atuais.
            </div>
          ) : (
            <>
            <div className="overflow-auto" style={{ maxHeight: '64vh' }}>
              <table className="text-sm" style={{ borderCollapse: 'separate', borderSpacing: 0, minWidth: '100%' }}>
                <thead>
                  <tr>
                    <th
                      className="sticky top-0 left-0 z-30 text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider"
                      style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)', minWidth: 260 }}
                    >
                      Conta
                    </th>
                    {crsVisiveis.map((cr: any) => {
                      const total = contasPorCR.get(cr.ID) || 0;
                      const gestores = gestoresPorCR.get(cr.ID) || '';
                      const allMarked = filteredContas.length > 0 && filteredContas.every((c: any) => crContaLookup.has(`${cr.ID}-${c.ID}`));
                      const colBusy = bulkBusyCol === cr.ID;
                      return (
                        <th
                          key={cr.ID}
                          className="sticky top-0 z-20 px-2 py-2 text-center align-bottom"
                          style={{ backgroundColor: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)', borderLeft: '1px solid var(--color-border)', minWidth: 108, maxWidth: 140 }}
                        >
                          <button
                            type="button"
                            onClick={() => !colBusy && toggleColuna(cr)}
                            disabled={colBusy}
                            title={`${cr.CODIGO} — ${toTitleCase(cr.NOME)}${gestores ? ` · ${gestores}` : ''} — clique para ${allMarked ? 'desmarcar' : 'marcar'} todas as contas filtradas`}
                            className="w-full rounded-md px-1 py-1 transition-colors cursor-pointer disabled:opacity-50"
                            style={{ backgroundColor: 'transparent' }}
                            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-hover)'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                          >
                            <div className="font-mono text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>{cr.CODIGO}</div>
                            <div className="text-[11px] font-semibold leading-tight truncate" style={{ color: 'var(--color-text)' }}>
                              {toTitleCase(cr.NOME)}
                            </div>
                            <div className="text-[10px] mt-0.5 tabular-nums" style={{ color: total === 0 ? 'var(--color-primary)' : 'var(--color-text-secondary)' }}>
                              {total} conta{total === 1 ? '' : 's'}
                            </div>
                          </button>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {pagedContas.map((conta: any) => {
                    const nSetores = crsPorConta.get(conta.ID)?.length || 0;
                    return (
                      <tr key={conta.ID} className="group">
                        <td
                          className="sticky left-0 z-10 px-4 py-2"
                          style={{ backgroundColor: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}
                        >
                          <div className="text-[13px] font-medium truncate" style={{ color: 'var(--color-text)' }}>
                            {toTitleCase(conta.NOME)}
                          </div>
                          <div className="text-[11px] mt-0.5 flex items-center gap-1.5" style={{ color: 'var(--color-text-secondary)' }}>
                            <span className="font-mono">{conta.CODIGO}</span>
                            <span aria-hidden>·</span>
                            <span>{tipoLabel(conta.TIPO)}</span>
                            <span aria-hidden>·</span>
                            <span style={{ color: nSetores === 0 ? 'var(--color-primary)' : 'var(--color-text-secondary)' }}>
                              {nSetores} setor{nSetores === 1 ? '' : 'es'}
                            </span>
                          </div>
                        </td>
                        {crsVisiveis.map((cr: any) => {
                          const key = `${cr.ID}-${conta.ID}`;
                          const checked = crContaLookup.has(key);
                          const cellBusy = busyKey === key || bulkBusyCol === cr.ID;
                          return (
                            <td
                              key={cr.ID}
                              className="text-center px-2 py-2 cursor-pointer transition-colors"
                              style={{ borderBottom: '1px solid var(--color-border)', borderLeft: '1px solid var(--color-border)', opacity: cellBusy ? 0.5 : 1, backgroundColor: 'transparent' }}
                              onClick={() => !cellBusy && toggleCell(cr.ID, conta.ID)}
                              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-hover)'; }}
                              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                            >
                              <div
                                className="w-4 h-4 rounded border inline-flex items-center justify-center align-middle"
                                style={{
                                  backgroundColor: checked ? 'var(--color-primary)' : 'var(--color-surface)',
                                  borderColor: checked ? 'var(--color-primary)' : 'var(--color-border)',
                                }}
                              >
                                {checked && <Check size={11} style={{ color: '#fff' }} />}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <PaginationFooter page={crPageSafe} total={filteredContas.length} onGo={setCrPage} />
            </>
          )}
        </Card>
        )}
      </div>
      )}

      {tab === 'conta' && (
        <div className="space-y-4">
          {/* Filtros sem container — inline */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--color-text-secondary)' }} />
              <input
                type="text"
                placeholder="Buscar conta"
                value={contaTabSearch}
                onChange={(e) => setContaTabSearch(e.target.value)}
                onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--color-primary)'; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--color-border)'; }}
                className="w-full pl-8 pr-3 py-2 text-sm rounded-lg border bg-transparent focus:outline-none"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              />
            </div>
            <div className="w-44 shrink-0">
              <MultiSelect
                values={contaTabTipos}
                onChange={setContaTabTipos}
                allLabel="Todos os tipos"
                options={tipoValues.map((t) => ({ value: t, label: tipoLabel(t) }))}
              />
            </div>
            <div className="w-44 shrink-0">
              <MultiSelect
                values={contaTabModelos}
                onChange={setContaTabModelos}
                allLabel="Todos"
                options={[
                  { value: 'modelo', label: 'Com modelo' },
                  { value: 'pacote', label: 'Em pacote' },
                  { value: 'sem', label: 'Sem modelo' },
                ]}
              />
            </div>
            <div className="ml-auto flex items-center gap-1.5 shrink-0 flex-wrap">
              {resumoContas.semDriver > 0 && (
                <button
                  type="button"
                  onClick={() => setContaTabModelos(contaTabModelos.length === 1 && contaTabModelos[0] === 'sem' ? [] : ['sem'])}
                  className="cursor-pointer"
                  title="Filtrar contas sem driver"
                >
                  <StatusChip tone="warn">{resumoContas.semDriver} sem driver</StatusChip>
                </button>
              )}
              {resumoContas.emPacote > 0 && (
                <button
                  type="button"
                  onClick={() => setContaTabModelos(contaTabModelos.length === 1 && contaTabModelos[0] === 'pacote' ? [] : ['pacote'])}
                  className="cursor-pointer"
                  title="Filtrar contas em pacote"
                >
                  <StatusChip tone="primary"><Package size={11} /> {resumoContas.emPacote} em pacote</StatusChip>
                </button>
              )}
              {resumoContas.personalizadas > 0 && (
                <StatusChip>{resumoContas.personalizadas} personalizada{resumoContas.personalizadas === 1 ? '' : 's'} por CR</StatusChip>
              )}
              <span className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
                {filteredContasTab2.length} de {contas.length}
              </span>
            </div>
            <TabHelp />
          </div>

          {/* Lista */}
          <Card>
            {/* A aba e alcancavel por URL (?tab=conta) vinda de outras telas, entao
                tambem precisa do gate — senao abre afirmando que nao ha conta. */}
            {initialLoading ? (
              <SkeletonListItems count={8} height={40} className="p-4" />
            ) : filteredContasTab2.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                Nenhuma conta encontrada com os filtros atuais.
              </div>
            ) : (
              <div>
                {/* Cabeçalho de colunas */}
                <div
                  className="px-5 py-2 flex items-center gap-3"
                  style={{ borderBottom: '1px solid var(--color-border)' }}
                >
                  <div className="flex-1 text-[12px] font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
                    Conta
                  </div>
                  <div className="w-52 shrink-0 text-[12px] font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
                    Rota
                  </div>
                  <div className="w-44 shrink-0 text-[12px] font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
                    Driver
                  </div>
                  <div className="w-56 shrink-0 text-[12px] font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
                    Personalizar por CR
                  </div>
                </div>
                {pagedContasTab2.map((conta: any, idx: number) => {
                  const cd = contaDriverByConta.get(conta.ID);
                  const der = deriveRota(cd);
                  const rota = rotaDaConta(conta.ID, der);
                  const emPacote = rota === 'PACOTE';
                  const busy = busyContaId === conta.ID;
                  const crIdsDestaConta = crsPorConta.get(conta.ID) || [];
                  const crsDestaConta = crIdsDestaConta
                    .map((id) => crById.get(id))
                    .filter(Boolean)
                    .sort((a: any, b: any) => String(a.CODIGO).localeCompare(String(b.CODIGO)));
                  const numExcecoes = excecoesPorConta.get(conta.ID)?.size || 0;
                  const expanded = expandedContaId === conta.ID;
                  return (
                    <div
                      key={conta.ID}
                      style={{
                        borderTop: idx === 0 ? 'none' : '1px solid var(--color-border)',
                      }}
                    >
                      <div
                        className="px-5 py-3 flex items-center gap-3 transition-colors"
                        style={{ opacity: busy ? 0.6 : 1 }}
                        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-hover)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] font-medium truncate flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
                            <span className="truncate">{toTitleCase(conta.NOME)}</span>
                            {der.calcDriverId == null && !emPacote && (
                              <StatusChip tone="warn">Sem driver</StatusChip>
                            )}
                            {emPacote && der.calcDriverId == null && (
                              <StatusChip tone="warn">Sem pacote</StatusChip>
                            )}
                          </div>
                          <div className="text-[11px] mt-0.5 flex items-center gap-1.5" style={{ color: 'var(--color-text-secondary)' }}>
                            <span className="font-mono">{conta.CODIGO}</span>
                            <span aria-hidden>·</span>
                            <span>{tipoLabel(conta.TIPO)}</span>
                            <span aria-hidden>·</span>
                            <span style={{ color: crsDestaConta.length === 0 ? 'var(--color-primary)' : 'var(--color-text-secondary)' }}>
                              {crsDestaConta.length === 0 ? 'Sem setor — marque no passo 1' : `${crsDestaConta.length} setor${crsDestaConta.length === 1 ? '' : 'es'}`}
                            </span>
                          </div>
                        </div>
                        <RotaPicker contaId={conta.ID} rota={rota} />
                        <DriverPicker contaId={conta.ID} currentDriverId={der.calcDriverId} emPacote={emPacote} />
                        <Tooltip
                          side="top"
                          disabled={!emPacote && crsDestaConta.length >= 2}
                          content={
                            emPacote
                              ? 'Contas em pacote não têm personalização por CR — a granularidade é definida nas linhas do pacote'
                              : crsDestaConta.length === 0
                              ? 'Vincule essa conta a setores primeiro'
                              : 'Conta com apenas um setor'
                          }
                        >
                          {(() => {
                            const ligado = !emPacote && (expanded || numExcecoes > 0);
                            return (
                          <button
                            type="button"
                            onClick={() => setExpandedContaId(expanded ? null : conta.ID)}
                            disabled={emPacote || crsDestaConta.length < 2}
                            className="w-56 h-8 shrink-0 pl-3 pr-2.5 rounded-lg border text-left flex items-center justify-between transition-all disabled:opacity-40 disabled:cursor-not-allowed relative text-[12px]"
                            style={{
                              backgroundColor: expanded ? 'var(--color-primary-bg)' : 'var(--color-surface)',
                              color: ligado ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                              borderColor: ligado ? 'var(--color-primary)' : 'var(--color-border)',
                            }}
                          >
                            <span className="inline-flex items-center gap-2 truncate">
                              <span
                                aria-hidden
                                className="relative inline-flex shrink-0 rounded-full transition-colors"
                                style={{ width: 26, height: 14, backgroundColor: ligado ? 'var(--color-primary)' : 'var(--color-border)' }}
                              >
                                <span
                                  className="absolute rounded-full transition-all"
                                  style={{ width: 10, height: 10, top: 2, left: ligado ? 14 : 2, backgroundColor: '#fff' }}
                                />
                              </span>
                              <span className="truncate">Personalizar por CR</span>
                              {numExcecoes > 0 && (
                                <span
                                  className="inline-flex items-center justify-center min-w-[18px] h-4 px-1 rounded-full text-[10px] font-bold shrink-0"
                                  style={{ backgroundColor: 'var(--color-primary)', color: '#fff' }}
                                >
                                  {numExcecoes}
                                </span>
                              )}
                            </span>
                            <ChevronDown
                              size={14}
                              className={`transition-transform shrink-0 ml-2 absolute right-2 top-1/2 -translate-y-1/2 ${expanded ? 'rotate-180' : ''}`}
                              style={{ color: 'var(--color-text-secondary)' }}
                            />
                          </button>
                            );
                          })()}
                        </Tooltip>
                      </div>
                      {expanded && !emPacote && (
                        <div className="px-5 pb-4 animate-fadeIn">
                          <div className="text-[11px] mb-2 mt-1 flex items-center justify-between gap-3" style={{ color: 'var(--color-text-secondary)' }}>
                            <span>
                              {numExcecoes > 0
                                ? `${numExcecoes} setor${numExcecoes === 1 ? '' : 'es'} com driver diferente da regra geral.`
                                : 'Escolha o driver de cada setor. Os que ficarem como "Igual à regra geral" continuam seguindo o driver único da conta.'}
                            </span>
                            {numExcecoes > 0 && (
                              <button
                                type="button"
                                onClick={() => setConfirmClearContaId(conta.ID)}
                                className="shrink-0 font-medium cursor-pointer transition-colors underline"
                                style={{ color: 'var(--color-text-secondary)' }}
                                onMouseEnter={(e) => { e.currentTarget.style.color = '#dc2626'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-secondary)'; }}
                              >
                                Limpar personalizações
                              </button>
                            )}
                          </div>
                          <div className="rounded-lg" style={{ border: '1px solid var(--color-border)' }}>
                            {crsDestaConta.length === 0 ? (
                              <div className="px-3 py-4 text-center text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
                                Esta conta ainda não foi vinculada a nenhum setor. Vincule em "Por setor" primeiro.
                              </div>
                            ) : (
                              crsDestaConta.map((cr: any, i: number) => {
                                const exc = excecoesPorConta.get(conta.ID)?.get(cr.ID) || null;
                                const exBusy = busyExcecaoKey === `${conta.ID}-${cr.ID}`;
                                return (
                                  <div
                                    key={cr.ID}
                                    className="px-3 py-2 flex items-center justify-between gap-3"
                                    style={{
                                      borderTop: i === 0 ? 'none' : '1px solid var(--color-border)',
                                      opacity: exBusy ? 0.6 : 1,
                                    }}
                                  >
                                    <div className="min-w-0 flex-1 flex items-baseline gap-2">
                                      <span className="font-mono text-[11px] shrink-0" style={{ color: 'var(--color-text-secondary)' }}>{cr.CODIGO}</span>
                                      <span className="text-[12px] font-medium truncate" style={{ color: 'var(--color-text)' }}>{toTitleCase(cr.NOME)}</span>
                                    </div>
                                    <CRDriverPicker
                                      contaId={conta.ID}
                                      crId={cr.ID}
                                      currentDriverId={exc ? exc.DRIVER_ID : null}
                                      globalDriverId={der.calcDriverId}
                                      busy={exBusy}
                                    />
                                  </div>
                                );
                              })
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
                <PaginationFooter page={contaTabPageSafe} total={filteredContasTab2.length} onGo={setContaTabPage} />
              </div>
            )}
          </Card>
        </div>
      )}

      {tab === 'rateio' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Rateios cadastrados</h2>
              <p className="mt-1" style={{ color: 'var(--color-text-secondary)', fontSize: '14px' }}>
                {rateios.length} tipo{rateios.length === 1 ? '' : 's'} disponível{rateios.length === 1 ? '' : 'is'} para aplicação
              </p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <TabHelp />
              <button
                type="button"
                onClick={openCreateRateio}
                className="h-8 shrink-0 inline-flex items-center gap-1.5 px-3 text-[13px] rounded-lg text-white font-medium transition-opacity cursor-pointer hover:opacity-90"
                style={{ backgroundColor: 'var(--color-primary)' }}
              >
                <Plus size={14} /> Novo rateio
              </button>
            </div>
          </div>

          {/* Idem aba conta: alcancavel por URL, precisa do gate antes do vazio real. */}
          {initialLoading ? (
          <Card>
              <SkeletonListItems count={4} height={44} className="p-4" />
          </Card>
          ) : rateios.length === 0 ? (
          <Card>
              <div className="px-5 py-12 text-center">
                <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3" style={{ backgroundColor: 'var(--color-primary-bg)', color: 'var(--color-primary)' }}>
                  <Percent size={20} />
                </div>
                <div className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Nenhum rateio cadastrado ainda</div>
                <p className="text-[12px] mt-1 max-w-md mx-auto" style={{ color: 'var(--color-text-secondary)' }}>
                  Crie um rateio (ex.: "Rateio por pessoal") escolhendo se ele é informado por quantidade (o sistema gera o percentual) ou por percentual direto.
                </p>
              </div>
          </Card>
          ) : (
              <div className="space-y-2">
                {rateios.map((r: any) => {
                  const expanded = expandedRateioId === r.ID;
                  const total = totalQtyOf(r.ID);
                  const nCrs = crsComQtdOf(r.ID);
                  const usos = rateioUsoById.get(r.ID) || 0;
                  const tipoPct = rateioTipoOf(r) === 'PERCENTUAL';
                  // Percentual: alerta quando a soma digitada nao fecha em 100 (a
                  // distribuicao renormaliza, mas o usuario deve saber)
                  const somaPctDivergente = tipoPct && total > 0 && Math.abs(total - 100) > 0.01;
                  const orientacao = tipoPct
                    ? 'Informe os percentuais por setor. Valores zerados ficam fora do rateio e somas diferentes de 100% são normalizadas.'
                    : 'Informe a quantidade por setor. O percentual é calculado automaticamente e valores zerados ficam fora do rateio.';
                  return (
                    <section
                      key={r.ID}
                      className="rounded-lg overflow-hidden"
                      style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}
                    >
                      {/* Cabeçalho compacto — nome, tags discretas, status e ações em uma linha */}
                      <div
                        className="pl-4 pr-2 py-2 flex items-center gap-3 cursor-pointer transition-colors"
                        onClick={() => setExpandedRateioId(expanded ? null : r.ID)}
                        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-hover)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                      >
                        <div className="min-w-0 flex-1 flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold truncate" style={{ color: 'var(--color-text)' }}>{toTitleCase(r.NOME)}</span>
                          <span className="font-mono text-[10px] shrink-0" style={{ color: 'var(--color-text-secondary)', opacity: 0.7 }}>Rateio #{r.ID}</span>
                          <span aria-hidden className="text-[10px] shrink-0" style={{ color: 'var(--color-text-secondary)', opacity: 0.4 }}>·</span>
                          <span className="text-[10px] shrink-0" style={{ color: 'var(--color-text-secondary)', opacity: 0.7 }}>{tipoPct ? 'Percentual' : 'Quantidade'}</span>
                          {usos > 0 && (
                            <span className="text-[11px] shrink-0 ml-1" style={{ color: 'var(--color-text-secondary)' }}>
                              · Aplicado a {usos} linha{usos === 1 ? '' : 's'} de modelo
                            </span>
                          )}
                          {nCrs === 0 && <StatusChip tone="warn">{tipoPct ? 'Sem percentuais' : 'Sem quantidades'}</StatusChip>}
                          {somaPctDivergente && <StatusChip tone="warn">Soma ≠ 100%</StatusChip>}
                        </div>
                        <div className="shrink-0 flex items-center gap-0.5">
                          <Tooltip side="top" content="Editar rateio">
                            <button
                              type="button"
                              aria-label={`Editar ${toTitleCase(r.NOME)}`}
                              onClick={(e) => { e.stopPropagation(); openEditRateio(r); }}
                              className="w-8 h-8 inline-flex items-center justify-center rounded-md transition-colors cursor-pointer"
                              style={{ color: 'var(--color-text-secondary)' }}
                              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-bg)'; e.currentTarget.style.color = 'var(--color-text)'; }}
                              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--color-text-secondary)'; }}
                            >
                              <Pencil size={14} />
                            </button>
                          </Tooltip>
                          <Tooltip side="top" content={usos > 0 ? 'Este rateio está aplicado em linhas de modelo — remova as aplicações antes de excluir' : 'Excluir rateio'}>
                            <button
                              type="button"
                              aria-label={`Excluir ${toTitleCase(r.NOME)}`}
                              disabled={usos > 0}
                              onClick={(e) => { e.stopPropagation(); setConfirmDeleteRateio(r); }}
                              className="w-8 h-8 inline-flex items-center justify-center rounded-md transition-colors cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed"
                              style={{ color: 'var(--color-text-secondary)' }}
                              onMouseEnter={(e) => { if (usos === 0) { e.currentTarget.style.backgroundColor = '#fef2f2'; e.currentTarget.style.color = '#dc2626'; } }}
                              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--color-text-secondary)'; }}
                            >
                              <Trash2 size={14} />
                            </button>
                          </Tooltip>
                          <Tooltip side="top" content={expanded ? 'Recolher rateio' : 'Expandir rateio'}>
                            <button
                              type="button"
                              aria-label={`${expanded ? 'Recolher' : 'Expandir'} ${toTitleCase(r.NOME)}`}
                              onClick={(e) => { e.stopPropagation(); setExpandedRateioId(expanded ? null : r.ID); }}
                              className="w-8 h-8 inline-flex items-center justify-center rounded-md transition-colors"
                              style={{ color: 'var(--color-text-secondary)' }}
                              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-bg)'; }}
                              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                            >
                              <ChevronDown size={15} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
                            </button>
                          </Tooltip>
                        </div>
                      </div>
                      {expanded && (
                        <div className="animate-fadeIn" style={{ borderTop: '1px solid var(--color-border)' }}>
                          {/* Descrição curta + orientação em ícone de informação (tooltip) */}
                          <div className="px-4 py-1.5 flex items-center gap-1.5 text-[12px] min-w-0" style={{ color: 'var(--color-text-secondary)' }}>
                            <span className="truncate">
                              {nCrs === 0 ? 'Nenhum setor incluído' : `${nCrs} setor${nCrs === 1 ? '' : 'es'} incluído${nCrs === 1 ? '' : 's'}`}
                              {' · '}Critério: {r.DESCRICAO || (tipoPct ? 'percentual informado' : 'quantidade informada')}
                            </span>
                            <Tooltip side="top" content={orientacao}>
                              <span className="shrink-0 inline-flex items-center justify-center cursor-help" style={{ color: 'var(--color-text-secondary)' }}>
                                <Info size={13} />
                              </span>
                            </Tooltip>
                          </div>
                          <div className="overflow-x-auto">
                            <table className="w-full" style={{ borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: 420 }}>
                              <colgroup>
                                <col />
                                <col style={{ width: '128px' }} />
                                <col style={{ width: '108px' }} />
                              </colgroup>
                              <thead>
                                <tr style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>
                                  <th className="text-left px-4 py-3 uppercase tracking-wide font-medium">Setor</th>
                                  <th className="text-right px-3 py-3 uppercase tracking-wide font-medium">{tipoPct ? 'Percentual' : 'Quantidade'}</th>
                                  <th className="text-right px-4 py-3 uppercase tracking-wide font-medium">{tipoPct ? 'Efetivo' : 'Percentual'}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {crs.map((cr: any) => {
                                  const key = `${r.ID}-${cr.ID}`;
                                  const draft = qtyDrafts.get(key);
                                  const item = rateioItemLookup.get(key);
                                  const savedQty = item ? Number(item.QUANTIDADE) || 0 : 0;
                                  const qty = draft != null ? parseQty(draft) : savedQty;
                                  const pct = total > 0 && qty > 0 ? (qty / total) * 100 : 0;
                                  const savingThis = savingQtyKey === key;
                                  return (
                                    <tr
                                      key={cr.ID}
                                      className="transition-colors"
                                      style={{ borderTop: '1px solid var(--color-border)', opacity: savingThis ? 0.6 : 1 }}
                                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--row-hover)'; }}
                                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.backgroundColor = ''; }}
                                    >
                                      {/* Setor: código em texto discreto + nome (mesmo padrão da Base Histórica) */}
                                      <td className="py-3 px-4" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        <span className="tabular-nums text-[11px]" style={{ color: 'var(--color-text-muted)' }}>{cr.CODIGO}</span>
                                        <span className="text-sm ml-2 font-medium" style={{ color: 'var(--color-text)' }}>{toTitleCase(cr.NOME)}</span>
                                      </td>
                                      <td className="py-3 px-3 text-right">
                                        <input
                                          type="text"
                                          inputMode="decimal"
                                          value={draft != null ? draft : (savedQty > 0 ? String(savedQty).replace('.', ',') : '')}
                                          placeholder="0"
                                          disabled={savingThis}
                                          onChange={(e) => {
                                            const v = e.target.value;
                                            setQtyDrafts((prev) => { const m = new Map(prev); m.set(key, v); return m; });
                                          }}
                                          onFocus={(e) => { e.target.select(); e.currentTarget.style.borderColor = 'var(--color-primary)'; e.currentTarget.style.boxShadow = '0 0 0 2px var(--color-primary-bg)'; }}
                                          onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.boxShadow = 'none'; saveRateioQty(r.ID, cr.ID); }}
                                          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                                          className="w-[76px] h-8 px-2.5 text-sm text-right rounded-md border focus:outline-none tabular-nums transition-all block ml-auto"
                                          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' }}
                                        />
                                      </td>
                                      <td className="py-3 px-4 text-right tabular-nums text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                                        {qty > 0 ? `${pct.toFixed(1).replace('.', ',')}%` : '—'}
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                              <tfoot>
                                <tr style={{ borderTop: '1px solid var(--color-border)' }}>
                                  <td className="py-3 px-4 text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                                    <span className="inline-flex items-center gap-2">
                                      Total
                                      <Tooltip side="top" content={total > 0 ? (somaPctDivergente ? 'Soma diferente de 100% — será normalizada' : '100% validado') : 'Sem valores informados'}>
                                        <span
                                          className="inline-flex items-center justify-center w-6 h-6 rounded-full flex-shrink-0 cursor-help"
                                          style={total > 0 && !somaPctDivergente
                                            ? { backgroundColor: 'rgba(16, 185, 129, 0.1)', color: '#10b981' }
                                            : total > 0
                                              ? { backgroundColor: 'rgba(220, 38, 38, 0.1)', color: '#dc2626' }
                                              : { backgroundColor: 'var(--bg-muted)', color: 'var(--color-text-muted)' }}
                                        >
                                          {total > 0 && !somaPctDivergente
                                            ? <CheckCircle2 size={12} />
                                            : total > 0
                                              ? <AlertCircle size={12} />
                                              : <Info size={12} />}
                                        </span>
                                      </Tooltip>
                                    </span>
                                  </td>
                                  <td className="py-3 px-3 text-right tabular-nums text-sm font-semibold" style={somaPctDivergente ? { color: '#dc2626' } : { color: 'var(--color-text)' }}>
                                    {tipoPct
                                      ? (total > 0 ? `${String(Math.round(total * 100) / 100).replace('.', ',')}%` : '—')
                                      : String(Math.round(total * 10000) / 10000).replace('.', ',')}
                                  </td>
                                  <td className="py-3 px-4 text-right tabular-nums text-sm font-semibold" style={somaPctDivergente ? { color: '#dc2626' } : { color: 'var(--color-text)' }}>
                                    {total > 0 ? '100%' : '—'}
                                  </td>
                                </tr>
                              </tfoot>
                            </table>
                          </div>
                        </div>
                      )}
                    </section>
                  );
                })}
              </div>
          )}
        </div>
      )}

      {tab === 'modelo' && (
        <ModelagemPage
          embedded
          initialCreateMode={pendingCreateMode}
          onCreateModeConsumed={() => setPendingCreateMode(null)}
        />
      )}
      </div>

      <Modal
        isOpen={historyModalOpen}
        onClose={() => { if (!historyConfirming) setHistoryModalOpen(false); }}
        title="Prévia do mapeamento por histórico"
        size="xl"
      >
        <div className="space-y-4">
          <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
            A análise considera lançamentos contábeis do ano anterior e sugere contas que tiveram movimento em cada setor, mas ainda não possuem vínculo ativo. Revise a prévia antes de confirmar.
          </p>

          {historyLoading ? (
            <div className="py-12 text-center text-sm" style={{ color: 'var(--color-text-secondary)' }}>Analisando lançamentos contábeis...</div>
          ) : historySuggestions.length === 0 ? (
            <div className="py-10 px-5 rounded-xl text-center" style={{ backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
              <CheckCircle2 size={28} className="mx-auto mb-2" style={{ color: 'var(--color-primary)' }} />
              <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Nenhum vínculo novo sugerido</p>
              <p className="text-xs mt-1" style={{ color: 'var(--color-text-secondary)' }}>As contas com movimento no ano anterior já estão vinculadas aos respectivos setores.</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                  Ano analisado: <strong style={{ color: 'var(--color-text)' }}>{historySuggestions[0]?.ANO_REFERENCIA}</strong> · {selectedHistoryPairs.size} de {historySuggestions.length} selecionados
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedHistoryPairs(selectedHistoryPairs.size === historySuggestions.length ? new Set() : new Set(historySuggestions.map(historyPairKey)))}
                  className="text-xs font-medium"
                  style={{ color: 'var(--color-primary)' }}
                >
                  {selectedHistoryPairs.size === historySuggestions.length ? 'Desmarcar todos' : 'Selecionar todos'}
                </button>
              </div>

              <div className="rounded-xl overflow-x-auto" style={{ border: '1px solid var(--color-border)' }}>
                <div className="min-w-[720px] grid grid-cols-[36px_minmax(220px,1fr)_minmax(180px,0.8fr)_150px] gap-3 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--color-text-secondary)', backgroundColor: 'var(--color-surface)' }}>
                  <span />
                  <span>Conta</span>
                  <span>Setor sugerido</span>
                  <span className="text-right">Evidência</span>
                </div>
                <div className="min-w-[720px] max-h-[48vh] overflow-y-auto divide-y" style={{ borderColor: 'var(--color-border)' }}>
                  {historySuggestions.map((item) => {
                    const key = historyPairKey(item);
                    const selected = selectedHistoryPairs.has(key);
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => toggleHistoryPair(key)}
                        className="w-full grid grid-cols-[36px_minmax(220px,1fr)_minmax(180px,0.8fr)_150px] gap-3 items-center px-4 py-3 text-left transition-colors"
                        style={{ backgroundColor: 'var(--color-surface)' }}
                      >
                        <span className="w-5 h-5 rounded-md inline-flex items-center justify-center" style={{ border: `1px solid ${selected ? 'var(--color-primary)' : 'var(--color-border)'}`, backgroundColor: selected ? 'var(--color-primary)' : 'var(--color-surface)', color: '#fff' }}>
                          {selected && <Check size={13} strokeWidth={3} />}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>{item.CONTA_CODIGO} — {toTitleCase(item.CONTA_NOME)}</span>
                          <span className="block text-[11px] mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>{tipoLabel(item.CONTA_TIPO)}</span>
                        </span>
                        <span className="text-sm truncate" style={{ color: 'var(--color-text)' }}>{item.CR_CODIGO} — {toTitleCase(item.CR_NOME)}</span>
                        <span className="text-xs text-right tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>{item.LANCAMENTOS} lançamentos · {item.MESES_COM_MOVIMENTO} meses</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setHistoryModalOpen(false)}
              disabled={historyConfirming}
              className="h-10 px-4 rounded-lg border text-sm font-medium disabled:opacity-50"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            >
              {historySuggestions.length === 0 && !historyLoading ? 'Fechar' : 'Cancelar'}
            </button>
            {historySuggestions.length > 0 && (
              <button
                type="button"
                onClick={confirmHistoryMapping}
                disabled={historyConfirming || selectedHistoryPairs.size === 0}
                className="h-10 px-4 rounded-lg text-sm text-white font-medium disabled:opacity-50"
                style={{ backgroundColor: 'var(--color-primary)' }}
              >
                {historyConfirming ? 'Criando vínculos...' : `Confirmar ${selectedHistoryPairs.size} vínculo${selectedHistoryPairs.size === 1 ? '' : 's'}`}
              </button>
            )}
          </div>
        </div>
      </Modal>

      {/* MODAL — Criar / renomear rateio */}
      <Modal
        isOpen={rateioModalOpen}
        onClose={() => { if (!savingRateio) setRateioModalOpen(false); }}
        title={rateioEditId != null ? 'Renomear rateio' : 'Novo rateio'}
        size="md"
      >
        <div className="space-y-3">
          {rateioEditId == null && (
            <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              Dê um nome ao rateio (ex.: "Rateio por pessoal") e escolha como ele será informado. Depois de criar, preencha os valores de cada setor.
            </p>
          )}
          {rateioEditId == null && (
            <div>
              <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>
                Tipo de rateio
              </label>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { value: 'QUANTIDADE' as const, label: 'Por quantidade', desc: 'Você informa a quantidade de cada setor (ex.: nº de pessoas) e o percentual é calculado automaticamente.' },
                  { value: 'PERCENTUAL' as const, label: 'Por percentual', desc: 'Você digita o percentual de cada setor diretamente (ex.: 40% / 35% / 25%).' },
                ]).map((opt) => {
                  const active = rateioTipo === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setRateioTipo(opt.value)}
                      className="text-left px-3 py-2.5 rounded-lg border transition-colors cursor-pointer"
                      style={{
                        borderColor: active ? 'var(--color-primary)' : 'var(--color-border)',
                        backgroundColor: active ? 'var(--color-primary-bg)' : 'var(--color-surface)',
                        boxShadow: active ? '0 0 0 1px var(--color-primary)' : 'none',
                      }}
                    >
                      <div className="text-[13px] font-semibold flex items-center gap-1.5" style={{ color: active ? 'var(--color-primary)' : 'var(--color-text)' }}>
                        {opt.value === 'PERCENTUAL' ? <Percent size={13} /> : <Users size={13} />}
                        {opt.label}
                      </div>
                      <div className="text-[11px] mt-1 leading-snug" style={{ color: 'var(--color-text-secondary)' }}>{opt.desc}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          {rateioEditId != null && (
            <div className="text-[12px] px-3 py-2 rounded-md" style={{ color: 'var(--color-text-secondary)', backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)' }}>
              Tipo: <strong style={{ color: 'var(--color-text)' }}>{rateioTipo === 'PERCENTUAL' ? 'Por percentual' : 'Por quantidade'}</strong> — o tipo é definido na criação e não pode ser alterado.
            </div>
          )}
          <div>
            <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>
              Nome do rateio
            </label>
            <input
              type="text"
              value={rateioNome}
              onChange={(e) => setRateioNome(e.target.value)}
              placeholder="Ex: Rateio por pessoal"
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter' && rateioNome.trim() && !savingRateio) handleSaveRateio(); }}
              className="w-full px-3 py-2 text-sm rounded-md border focus:outline-none focus:ring-2"
              style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' }}
            />
          </div>
          <div>
            <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>Descrição (opcional)</label>
            <textarea
              value={rateioDesc}
              onChange={(e) => setRateioDesc(e.target.value)}
              placeholder="Qual a lógica de divisão deste rateio?"
              rows={3}
              className="w-full px-3 py-2 text-sm rounded-md border focus:outline-none focus:ring-2 resize-none"
              style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' }}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => { if (!savingRateio) setRateioModalOpen(false); }}
              className="px-4 py-2 text-sm rounded-lg border transition-colors cursor-pointer"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSaveRateio}
              disabled={savingRateio || !rateioNome.trim()}
              className="px-4 py-2 text-sm rounded-lg text-white font-medium transition-opacity cursor-pointer disabled:opacity-50"
              style={{ backgroundColor: 'var(--color-primary)' }}
            >
              {rateioEditId != null ? 'Salvar' : 'Criar rateio'}
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={confirmDeleteRateio != null}
        onClose={() => { if (!deletingRateio) setConfirmDeleteRateio(null); }}
        onConfirm={handleDeleteRateio}
        title="Excluir rateio"
        message={`Excluir o rateio "${confirmDeleteRateio ? toTitleCase(confirmDeleteRateio.NOME) : ''}" e as quantidades por setor cadastradas nele? Essa ação não pode ser desfeita.`}
        confirmLabel="Excluir"
        loading={deletingRateio}
      />

      <ConfirmDialog
        isOpen={confirmClearContaId != null}
        onClose={() => { if (!clearingPersonalizacoes) setConfirmClearContaId(null); }}
        onConfirm={clearPersonalizacoes}
        title="Limpar personalizações por CR"
        message={(() => {
          const n = confirmClearContaId != null ? (excecoesPorConta.get(confirmClearContaId)?.size || 0) : 0;
          return `Remover ${n} personalizaç${n === 1 ? 'ão' : 'ões'} por setor desta conta? Todos os setores voltam a usar a regra geral.`;
        })()}
        confirmLabel="Remover"
        loading={clearingPersonalizacoes}
      />

      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  );
}
