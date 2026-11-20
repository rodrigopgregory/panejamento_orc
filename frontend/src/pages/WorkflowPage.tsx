import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { execSF, execSFCached, SF_IDS, avaliarWorkflow, avaliarErroMsg } from '../hooks/useMitraData';
import WorkflowHistorico from '../components/WorkflowHistorico';
import RejectionReasonsModal from '../components/RejectionReasonsModal';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';
import { ToastContainer } from '../components/ui/Toast';
import { useToast } from '../hooks/useToast';
import { Check, Search, Clock } from 'lucide-react';
import { toTitleCase } from '../lib/utils';
import { getUser } from '../lib/auth';
import { escolherVersaoVigente, versaoEhFechada, rotuloVersao } from '../lib/versao-vigente';
import { Skeleton, SkeletonCards } from '../components/ui/Skeleton';


const STATUS_COLOR: Record<string, string> = {
  PENDENTE: '#f59e0b',
  CONFIRMADO: '#75c95f',
  SUBMETIDO: '#94a3b8',
  APROVADO: '#10b981',
  REPROVADO: '#ef4444',
};

const STATUS_LABEL: Record<string, string> = {
  PENDENTE: 'Pendente',
  CONFIRMADO: 'Confirmado',
  SUBMETIDO: 'Submetido',
  APROVADO: 'Aprovado',
  REPROVADO: 'Reprovado',
};

// Avatar do gestor: iniciais + cor estavel derivada do nome
const AVATAR_COLORS = ['#6366f1', '#0891b2', '#7c3aed', '#db2777', '#ea580c', '#0d9488', '#4f46e5', '#c026d3', '#2563eb', '#16a34a'];
function gestorInitials(name: string): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
function gestorColor(name: string): string {
  let h = 0;
  for (let i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export default function WorkflowPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Base via SFs SQL dedicadas com cache TTL (sem sandbox JS) — em paralelo
  const [ciclos, setCiclos] = useState<any[]>([]);
  // Marca o fim da 1a onda mesmo em falha — sem isso, base vazia/erro deixaria o
  // gate de loading ligado para sempre (o loadStatus nunca dispara).
  const [ciclosCarregados, setCiclosCarregados] = useState(false);
  useEffect(() => {
    execSFCached(SF_IDS.baseCiclos)
      // A versao marcada como atual entra mesmo fechada — o kanban dela vira
      // consulta (as transicoes ficam bloqueadas em changeStatus/changePacoteStatus).
      .then(rows => setCiclos(rows.filter((c: any) => c.STATUS !== 'FECHADO' || c.VERSAO_ATUAL === 'true')))
      .catch(console.error)
      .finally(() => setCiclosCarregados(true));
  }, []);
  const [selectedCiclo, setSelectedCiclo] = useState<number | null>(null);
  const [kanbanSearch, setKanbanSearch] = useState('');
  // gestor selecionado: URL param ?gestor=N > null (ve todos)
  const urlGestorParam = (() => {
    const raw = searchParams.get('gestor');
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  })();
  const [selectedGestor] = useState<number | null>(urlGestorParam);
  const [statusCards, setStatusCards] = useState<any[]>([]);
  const [pacoteCards, setPacoteCards] = useState<any[]>([]);
  const [crProgress, setCrProgress] = useState<Record<number, { filled: number; total: number }>>({});
  // pacoteProgress: total = modelos distintos das contas do pacote (modelo efetivo NORMAL);
  // filled = modelos com pelo menos 1 linha de ORCAMENTO_PACOTE preenchida no ciclo.
  const [pacoteProgress, setPacoteProgress] = useState<Record<number, { filled: number; total: number }>>({});
  // Comeca TRUE: antes disso a tela renderizava "Nenhum CR ou pacote para a versao
  // selecionada" (gestor) e as 4 colunas com "Nenhum item" (admin) enquanto a rede
  // ainda respondia — negando a existencia de trabalho que existe.
  const [loading, setLoading] = useState(true);
  // Skeleton so na montagem: os refetches disparados por mudanca de status sao
  // otimistas e devem manter o quadro visivel, sem piscar.
  const [primeiraCargaFeita, setPrimeiraCargaFeita] = useState(false);
  const showSkeleton = loading && !primeiraCargaFeita;
  const [commentModal, setCommentModal] = useState<{ open: boolean; card: any | null; isPacote?: boolean }>({ open: false, card: null });
  const [historico, setHistorico] = useState<{ tipo: 'CR' | 'PACOTE'; refId: number; titulo: string } | null>(null);
  const [rejectionTarget, setRejectionTarget] = useState<{ tipo: 'CR' | 'PACOTE'; refId: number; title: string } | null>(null);
  const [comment, setComment] = useState('');
  const { toasts, addToast, removeToast } = useToast();

  useEffect(() => {
    if (ciclos.length > 0 && !selectedCiclo) setSelectedCiclo(escolherVersaoVigente(ciclos));
  }, [ciclos]);

  // Versao fechada abre aqui so para consultar o kanban: aprovar, reprovar ou
  // submeter reabriria um ciclo encerrado e ainda dispararia e-mail.
  const cicloFechado = versaoEhFechada(ciclos, selectedCiclo);

  useEffect(() => {
    if (selectedCiclo) { loadStatus(); return; }
    // Nenhuma versao para carregar (base vazia ou falhou): libera o gate para o
    // estado real aparecer em vez de skeleton eterno.
    if (ciclosCarregados && ciclos.length === 0) { setLoading(false); setPrimeiraCargaFeita(true); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCiclo, ciclosCarregados, ciclos.length]);

  const loadStatus = async () => {
    if (!selectedCiclo) return;
    setLoading(true);
    try {
      // 4 SFs SQL dedicadas em UMA rodada paralela — todas dependem so do cicloId
      // (os modelos por CR e os totais de pacote derivam os IDs no proprio SQL,
      // entao nao precisamos esperar os cards chegarem pra dispara-las).
      const [data, pkgData, modelCounts, totalRows] = await Promise.all([
        execSF(SF_IDS.kanbanStatusCrs, { cicloId: selectedCiclo }),
        execSF(SF_IDS.kanbanStatusPacotes, { cicloId: selectedCiclo }),
        execSF(SF_IDS.kanbanModelosPorCiclo, { cicloId: selectedCiclo }).catch(() => [] as any[]),
        execSF(SF_IDS.kanbanPacoteTotais, { cicloId: selectedCiclo }).catch(() => [] as any[]),
      ]);
      setStatusCards(data);
      setPacoteCards(pkgData);

      const progress: Record<number, { filled: number; total: number }> = {};
      for (const card of data) {
        const crId = Number(card.CR_ID);
        const mc = modelCounts.find((r: any) => Number(r.CR_ID) === crId);
        const totalModels = mc?.TOTAL || 0;
        const confirmed = card.DRIVERS_CONFIRMADOS ? card.DRIVERS_CONFIRMADOS.split(',').filter(Boolean).length : 0;
        progress[crId] = { total: totalModels, filled: Math.min(confirmed, totalModels) };
      }
      setCrProgress(progress);

      // Progress dos pacotes: total = modelos NORMAL distintos das contas-em-pacote;
      // filled vem do DRIVERS_CONFIRMADOS do PACOTE_STATUS (modelos explicitamente
      // confirmados via botao "Confirmar X"). Lancar valor sozinho nao incrementa
      // a barra — so quando o user confirmar.
      const pkgProg: Record<number, { filled: number; total: number }> = {};
      const pkgIds = Array.from(new Set(pkgData.map((c: any) => Number(c.DRIVER_ID))));
      if (pkgIds.length > 0) {
        const totalMap = new Map(totalRows.map((r: any) => [Number(r.PACOTE_ID), Number(r.TOTAL) || 0]));
        const filledMap = new Map<number, number>();
        for (const card of pkgData) {
          const pid = Number(card.DRIVER_ID);
          const csv = card.DRIVERS_CONFIRMADOS || '';
          const count = csv.split(',').filter(Boolean).length;
          filledMap.set(pid, count);
        }
        for (const id of pkgIds) {
          const total = totalMap.get(id) || 0;
          pkgProg[id] = { total, filled: Math.min(filledMap.get(id) || 0, total) };
        }
      }
      setPacoteProgress(pkgProg);
    } catch (e) { console.error(e); }
    // Fora do try: falha de rede nao pode deixar a tela presa no skeleton.
    setLoading(false);
    setPrimeiraCargaFeita(true);
  };

  // Transicoes de status passam pela SF 171 (avaliarWorkflowStatus): o servidor
  // valida a maquina de estados, exige o motivo na reprovacao, grava auditoria
  // e dispara os e-mails — o patch direto do navegador nao validava nada.
  // OTIMISTA: o card muda de coluna NA HORA (a SF de transicao + e-mail levam
  // segundos); recusa/erro => loadStatus() ressincroniza com o servidor.
  const changeStatus = async (cardId: number, newStatus: string, comentario?: string) => {
    if (cicloFechado) return;
    setStatusCards((cards) => cards.map((card) => card.ID === cardId ? {
      ...card,
      STATUS: newStatus,
      COMENTARIO: newStatus === 'REPROVADO' ? (comentario || '') : newStatus === 'PENDENTE' ? '' : card.COMENTARIO,
    } : card));
    addToast('success', `Status alterado para ${STATUS_LABEL[newStatus] || newStatus}`);
    try {
      const out = await avaliarWorkflow({ tipo: 'CR', statusId: cardId, acao: newStatus as any, comentario, autor: getUser()?.NOME || '' });
      if (!out?.ok) { addToast('error', avaliarErroMsg(out)); loadStatus(); return; }
      setTimeout(() => { void loadStatus(); }, 250);
    } catch (e) {
      console.error(e);
      addToast('error', 'Erro ao alterar status');
      loadStatus();
    }
  };

  const changePacoteStatus = async (cardId: number, newStatus: string, comentario?: string) => {
    if (cicloFechado) return;
    setPacoteCards((cards) => cards.map((card) => card.ID === cardId ? {
      ...card,
      STATUS: newStatus,
      COMENTARIO: newStatus === 'REPROVADO' ? (comentario || '') : newStatus === 'PENDENTE' ? '' : card.COMENTARIO,
    } : card));
    addToast('success', `Status do pacote alterado para ${STATUS_LABEL[newStatus] || newStatus}`);
    try {
      const out = await avaliarWorkflow({ tipo: 'PACOTE', statusId: cardId, acao: newStatus as any, comentario, autor: getUser()?.NOME || '' });
      if (!out?.ok) { addToast('error', avaliarErroMsg(out)); loadStatus(); return; }
      setTimeout(() => { void loadStatus(); }, 250);
    } catch (e) {
      console.error(e);
      addToast('error', 'Erro ao alterar status do pacote');
      loadStatus();
    }
  };

  const columns = ['PENDENTE', 'SUBMETIDO', 'APROVADO', 'REPROVADO'];

  const getAllCardsForStatus = (status: string) => {
    const matchStatus = (s: string) => status === 'PENDENTE' ? (s === 'PENDENTE' || s === 'CONFIRMADO') : s === status;
    const term = kanbanSearch.trim().toLowerCase();
    const matchSearch = (c: any) => {
      if (!term) return true;
      const fields = [c.GESTOR_NOME, c.CR_CODIGO, c.CR_NOME, c.DRIVER_NOME].filter(Boolean).join(' ').toLowerCase();
      return fields.includes(term);
    };
    // Recorte opcional por gestor vindo da URL (?gestor=N) — sem ele, ve todos.
    const matchGestor = (c: any) => selectedGestor === null || c.GESTOR_ID === selectedGestor;
    const crCards = statusCards.filter((c: any) => matchStatus(c.STATUS) && matchGestor(c) && matchSearch(c)).map(c => ({ ...c, _type: 'cr' as const }));
    const pkgCards = pacoteCards.filter((c: any) => matchStatus(c.STATUS) && matchGestor(c) && matchSearch(c)).map(c => ({ ...c, _type: 'pacote' as const }));
    const all = [...crCards, ...pkgCards];
    if (status === 'PENDENTE') {
      all.sort((a, b) => {
        const aLabel = (a._type === 'cr' ? a.CR_NOME : a.DRIVER_NOME || '').toString().toLowerCase();
        const bLabel = (b._type === 'cr' ? b.CR_NOME : b.DRIVER_NOME || '').toString().toLowerCase();
        const aPin = aLabel.includes('comercial') ? 0 : 1;
        const bPin = bLabel.includes('comercial') ? 0 : 1;
        return aPin - bPin;
      });
    }
    return all;
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="font-medium tracking-tight leading-tight" style={{ color: 'var(--color-text)', fontSize: 24 }}>
            Workflow de Aprovação
          </h1>
          <p className="mt-1" style={{ fontSize: 13.5, color: 'var(--color-text-secondary)' }}>
            Gerencie o fluxo de submissão e aprovação dos orçamentos
          </p>
        </div>
        <div className="flex items-center gap-3">
          {(() => {
            const currentYear = new Date().getFullYear();
            const selected = ciclos.find((c: any) => c.ID === selectedCiclo);
            const isPastYear = selected && Number(selected.ANO) < currentYear;
            return (
              <>
                <div
                  className="flex items-center gap-2 px-3 py-2 rounded-lg shrink-0"
                  style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)' }}
                >
                  <span className="text-xs font-medium whitespace-nowrap" style={{ color: 'var(--color-text-secondary)' }}>Versão</span>
                  <span className="text-sm font-semibold whitespace-nowrap" style={{ color: 'var(--color-text)' }}>
                    {selected ? `${rotuloVersao(selected)} (${selected.ANO})` : '—'}
                  </span>
                </div>
                {isPastYear && (
                  <div
                    className="hidden md:flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium rounded-lg whitespace-nowrap"
                    style={{
                      backgroundColor: 'rgba(245, 158, 11, 0.12)',
                      color: '#b45309',
                      border: '1px solid rgba(245, 158, 11, 0.35)'
                    }}
                  >
                    <Clock size={12} /> {selected.ANO} (anterior)
                  </div>
                )}
              </>
            );
          })()}
        </div>
      </div>


      {/* ==================== Kanban de aprovação ==================== */}
      {(
        <>
          {/* Search bar (above kanban) */}
          <div className="flex items-center justify-start">
            <div className="relative w-full sm:w-80">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--color-text-muted)' }} />
              <input
                type="text"
                value={kanbanSearch}
                onChange={(e) => setKanbanSearch(e.target.value)}
                placeholder="Buscar por gestor ou CR..."
                className="rounded-lg pl-9 pr-3 py-2 text-sm transition-all duration-200 w-full border focus:outline-none focus:ring-2 focus:border-transparent"
                style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)', '--tw-ring-color': 'var(--color-primary-light)' } as any}
              />
            </div>
          </div>
          {/* Kanban grid */}
          <div className="grid gap-5 min-h-[60vh]" style={{ gridTemplateColumns: 'repeat(4, minmax(230px, 1fr))' }}>
            {columns.map((status) => {
              const allCards = getAllCardsForStatus(status);
              const statusColor = STATUS_COLOR[status];
              return (
                <div key={status} className="flex flex-col">
                  {/* Column header — Linear: ponto + label + contagem em pill */}
                  <div className="flex items-center gap-2 mb-3 px-0.5">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: statusColor }} />
                    <span className="font-semibold tracking-tight uppercase" style={{ color: 'var(--color-text-secondary)', fontSize: '11px', letterSpacing: '0.05em' }}>{STATUS_LABEL[status]}</span>
                    {/* Durante a carga a contagem seria "0" — afirmacao falsa. Vira barra. */}
                    {showSkeleton ? (
                      <Skeleton className="ml-auto h-[18px]" style={{ width: 22, borderRadius: 6 }} />
                    ) : (
                      <span className="ml-auto text-[11px] font-semibold px-1.5 py-0.5 rounded-md tabular-nums" style={{ color: 'var(--color-text-secondary)', backgroundColor: 'var(--bg-hover)' }}>{allCards.length}</span>
                    )}
                  </div>

                  {/* Cards */}
                  <div className="space-y-2.5 flex-1">
                    {showSkeleton && <SkeletonCards count={3} height={110} className="space-y-2.5" />}
                    {!showSkeleton && allCards.map((card: any) => {
                      const isPacote = card._type === 'pacote';

                      if (isPacote) {
                        const gNome = card.GESTOR_NOME || '';
                        return (
                          <div
                            key={`pkg-${card.ID}`}
                            className="pg-card group relative rounded-xl p-4 cursor-pointer flex flex-col"
                            style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}
                            onClick={() => navigate(`/preenchimento?gestor=${card.GESTOR_ID}&pkg=${card.DRIVER_ID}&from=kanban&mode=admin`)}
                          >
                            {/* Histórico — só o ícone, canto superior direito, feedback no hover */}
                            <button
                              onClick={(e) => { e.stopPropagation(); setHistorico({ tipo: 'PACOTE', refId: Number(card.DRIVER_ID), titulo: `Histórico — ${toTitleCase(card.DRIVER_NOME || 'Pacote')}` }); }}
                              title="Ver histórico"
                              className="absolute top-2.5 right-2.5 p-1 rounded-md transition-colors"
                              style={{ color: 'var(--color-text-muted)', backgroundColor: 'transparent' }}
                              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-primary)'; e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; }}
                              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-muted)'; e.currentTarget.style.backgroundColor = 'transparent'; }}
                            >
                              <Clock size={14} />
                            </button>

                            {/* Pacote nome em destaque (igual ao CR) */}
                            <div className="flex items-center gap-2 flex-wrap pr-7">
                              <p className="text-[13.5px] font-semibold leading-snug" style={{ color: 'var(--color-text)' }}>{toTitleCase(card.DRIVER_NOME || '')}</p>
                              <span className="inline-flex items-center text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0" style={{ backgroundColor: 'var(--bg-muted)', color: 'var(--color-text-secondary)', letterSpacing: '0.06em' }}>
                                Pacote
                              </span>
                            </div>

                            {/* Gestor — avatar com iniciais */}
                            <div className="flex items-center gap-2 mt-3">
                              <span className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0" style={{ backgroundColor: `color-mix(in srgb, ${gestorColor(gNome)} 14%, transparent)`, color: gestorColor(gNome) }}>{gestorInitials(gNome)}</span>
                              <span className="text-[12px] font-medium truncate" style={{ color: 'var(--color-text-secondary)' }}>{gNome}</span>
                            </div>

                            {/* Progress de modelos (mesma estrutura do CR) */}
                            {(() => {
                              const pp = pacoteProgress[Number(card.DRIVER_ID)] || { filled: 0, total: 0 };
                              const pkgPct = pp.total > 0 ? Math.round((pp.filled / pp.total) * 100) : 0;
                              const progressColor = pkgPct === 0 ? 'var(--color-border)' : pkgPct === 100 ? '#10b981' : pkgPct >= 50 ? '#75c95f' : '#f59e0b';
                              return (
                                <div className="mt-3">
                                  <div className="flex items-center justify-between mb-1.5">
                                    <span className="text-[10px] font-medium" style={{ color: 'var(--color-text-muted)' }}>{pp.filled}/{pp.total} modelos preenchidos</span>
                                    <span className="text-[10px] font-semibold tabular-nums" style={{ color: progressColor === 'var(--color-border)' ? 'var(--color-text-muted)' : progressColor }}>{pkgPct}%</span>
                                  </div>
                                  <div className="w-full rounded-full h-1.5" style={{ backgroundColor: 'var(--bg-hover)' }}>
                                    <div className="h-1.5 rounded-full transition-all duration-500" style={{ width: `${pkgPct}%`, backgroundColor: progressColor }} />
                                  </div>
                                </div>
                              );
                            })()}

                            {/* REPROVADO nao tem "Reabrir": o item ja voltou ao gestor para
                                corrigir e resubmeter — o botao (que resetava para PENDENTE)
                                era redundante e confundia. */}
                            {status === 'APROVADO' && (
                              <div className="flex gap-1.5 mt-3 pt-2.5" style={{ borderTop: '1px solid var(--color-border)' }} onClick={(e) => e.stopPropagation()}>
                                {status === 'APROVADO' && (
                                  <span className="flex flex-1 items-center justify-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg border" style={{ color: '#10b981', borderColor: 'var(--color-border)', backgroundColor: 'transparent' }}>
                                    <Check size={13} /> Finalizado
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      }

                      // ── CR card ──
                      const p = crProgress[card.CR_ID] || { filled: 0, total: 0 };
                      const pct = p.total > 0 ? Math.round((p.filled / p.total) * 100) : 0;
                      const progressColor = pct === 0 ? 'var(--color-border)' : pct === 100 ? '#10b981' : pct >= 50 ? '#75c95f' : '#f59e0b';
                      const gNome = card.GESTOR_NOME || '';
                      return (
                        <div
                          key={`cr-${card.ID}`}
                          className="pg-card group relative rounded-xl p-4 cursor-pointer flex flex-col"
                          style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}
                          onClick={() => navigate(`/orcamento?gestor=${card.GESTOR_ID}&cr=${card.CR_ID}&from=kanban&mode=admin`)}
                        >
                          {/* Histórico — só o ícone, canto superior direito, feedback no hover */}
                          <button
                            onClick={(e) => { e.stopPropagation(); setHistorico({ tipo: 'CR', refId: Number(card.CR_ID), titulo: `Histórico — ${card.CR_NOME}` }); }}
                            title="Ver histórico"
                            className="absolute top-2.5 right-2.5 p-1 rounded-md transition-colors"
                            style={{ color: 'var(--color-text-muted)', backgroundColor: 'transparent' }}
                            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-primary)'; e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-text-muted)'; e.currentTarget.style.backgroundColor = 'transparent'; }}
                          >
                            <Clock size={14} />
                          </button>

                          {/* CR nome em destaque */}
                          <p className="text-[13.5px] font-semibold leading-snug pr-7" style={{ color: 'var(--color-text)' }}>{card.CR_NOME}</p>

                          {/* Gestor — avatar com iniciais */}
                          <div className="flex items-center gap-2 mt-3">
                            <span className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0" style={{ backgroundColor: `color-mix(in srgb, ${gestorColor(gNome)} 14%, transparent)`, color: gestorColor(gNome) }}>{gestorInitials(gNome)}</span>
                            <span className="text-[12px] font-medium truncate" style={{ color: 'var(--color-text-secondary)' }}>{gNome}</span>
                          </div>

                          {/* Progress bar */}
                          <div className="mt-3">
                            <div className="flex items-center justify-between mb-1.5">
                              <span className="text-[10px] font-medium" style={{ color: 'var(--color-text-muted)' }}>{p.filled}/{p.total} modelos preenchidos</span>
                              <span className="text-[10px] font-semibold tabular-nums" style={{ color: progressColor === 'var(--color-border)' ? 'var(--color-text-muted)' : progressColor }}>{pct}%</span>
                            </div>
                            <div className="w-full rounded-full h-1.5" style={{ backgroundColor: 'var(--bg-hover)' }}>
                              <div className="h-1.5 rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: progressColor }} />
                            </div>
                          </div>

                          {/* REPROVADO nao tem "Reabrir": o CR ja voltou ao gestor para
                              corrigir e resubmeter — o botao (que resetava para PENDENTE)
                              era redundante e confundia. */}
                          {status === 'APROVADO' && (
                            <div className="flex gap-1.5 mt-3 pt-2.5" style={{ borderTop: '1px solid var(--color-border)' }} onClick={(e) => e.stopPropagation()}>
                              <span className="flex flex-1 items-center justify-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg border" style={{ color: '#10b981', borderColor: 'var(--color-border)', backgroundColor: 'transparent' }}>
                                <Check size={13} /> Finalizado
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {!showSkeleton && allCards.length === 0 && (
                      <div className="flex flex-col items-center justify-center py-10 px-3 rounded-lg border border-dashed text-[11px]" style={{ color: 'var(--color-text-muted)', borderColor: 'var(--color-border)' }}>
                        Nenhum item
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Reprovacao modal */}
      <Modal isOpen={commentModal.open} onClose={() => setCommentModal({ open: false, card: null })} title={commentModal.isPacote ? 'Reprovar Pacote' : 'Reprovar Orçamento'}>
        <div className="space-y-4">
          <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            Informe o motivo da reprovação para {commentModal.card?.GESTOR_NOME} - {commentModal.isPacote ? toTitleCase(commentModal.card?.DRIVER_NOME || '') : commentModal.card?.CR_CODIGO}
          </p>
          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--color-text-secondary)' }}>Comentário</label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Motivo da reprovação..."
              rows={5}
              className="w-full rounded-lg px-3 py-2 text-sm transition-all duration-200 border focus:outline-none focus:ring-2 focus:border-transparent"
              style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)', resize: 'vertical', minHeight: '100px', '--tw-ring-color': 'var(--color-primary-light)' } as any}
            />
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="secondary" onClick={() => setCommentModal({ open: false, card: null })}>Cancelar</Button>
            <Button variant="danger" onClick={async () => {
              if (!comment.trim()) { addToast('error', 'Informe o motivo da reprovação.'); return; }
              if (commentModal.card) {
                if (commentModal.isPacote) {
                  await changePacoteStatus(commentModal.card.ID, 'REPROVADO', comment);
                } else {
                  await changeStatus(commentModal.card.ID, 'REPROVADO', comment);
                }
                setCommentModal({ open: false, card: null });
              }
            }}>Confirmar Reprovação</Button>
          </div>
        </div>
      </Modal>

      {/* Historico de auditoria do card (CR ou pacote) */}
      <WorkflowHistorico
        isOpen={historico !== null}
        onClose={() => setHistorico(null)}
        tipo={historico?.tipo || 'CR'}
        refId={historico?.refId ?? null}
        cicloId={selectedCiclo}
        titulo={historico?.titulo}
      />
      <RejectionReasonsModal
        isOpen={rejectionTarget !== null}
        onClose={() => setRejectionTarget(null)}
        title={rejectionTarget?.title || 'Motivos da reprovação'}
        load={async () => rejectionTarget && selectedCiclo ? (await execSF(SF_IDS.auditoriaWorkflow, { cicloId: selectedCiclo, tipo: rejectionTarget.tipo, refId: rejectionTarget.refId })).filter((item: any) => item.EVENTO === 'REPROVADO') : []}
      />

      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  );
}
