import { useState, useEffect, useCallback, useRef } from 'react';
import { executePublicServerFunctionMitra } from 'mitra-interactions-sdk';
import { MITRA_CONFIG, configurePublicSdk } from '../mitra-config';
import { toTitleCase } from '../lib/utils';
import { enablePublicOrcMode, flushPublicOrcQueue, execSFCached, SF_IDS, publicOrcWrite } from '../hooks/useMitraData';
import OrcamentoContent from '../components/OrcamentoContent';
import PublicDreGestor from '../components/PublicDreGestor';
import RejectionReasonsModal from '../components/RejectionReasonsModal';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import {
  Loader2, ShieldAlert, Send, MessageSquare, FileSpreadsheet,
  Package, Eye, ArrowLeft, Info, Check, LayoutDashboard, BarChart3, Wallet,
} from 'lucide-react';

// Tela PUBLICA de preenchimento (usuarios NAO logados, acessada via magic-link).
// A home replica a visao gestor do /workflow (cards de CRs e Pacotes). Abrir um
// CR ou um pacote renderiza o MESMO componente OrcamentoContent da visao kanban
// interna — mesmo container, mesmas abas por driver, mesmo Handsontable, mesmos
// graficos (Resumo/DRE), mesmo fluxo de confirmacao por modelo.
//
// Dados e escritas passam SOMENTE por SFs publicas escopadas pelo token UUID da
// URL (142/143/145/147 + 139/70): a autorizacao (qual gestor / quais CRs) e
// derivada do token no servidor; o cliente nunca informa um GESTOR_ID que nao
// pertenca ao token. O roteamento acontece em useMitraData (enablePublicOrcMode).

const SF = {
  home: 139,      // publicHome: ctx + CRs + pacotes com progresso (1 ida)
  submeter: 70,   // publicSubmeterCR
};

const pid = MITRA_CONFIG.projectId;

const STATUS_COLOR: Record<string, string> = {
  PENDENTE: '#f59e0b',
  CONFIRMADO: '#75c95f',
  SUBMETIDO: '#94a3b8',
  APROVADO: '#10b981',
  REPROVADO: '#ef4444',
};
// Mesma config de badge da tela interna de preenchimento (PreenchimentoPage)
const STATUS_CONFIG: Record<string, { label: string; variant: 'neutral' | 'info' | 'success' | 'danger' | 'warning' }> = {
  PENDENTE: { label: 'Pendente', variant: 'warning' },
  CONFIRMADO: { label: 'Confirmado', variant: 'info' },
  SUBMETIDO: { label: 'Submetido', variant: 'warning' },
  APROVADO: { label: 'Aprovado', variant: 'success' },
  REPROVADO: { label: 'Reprovado', variant: 'danger' },
};

// Sanitiza o token para caracteres de UUID (defesa adicional no cliente; o
// servidor tambem sanitiza).
function sanitizeToken(raw: string): string {
  return (raw || '').replace(/[^0-9a-fA-F-]/g, '').slice(0, 36);
}

function rowsOf(res: any): any[] {
  let out = res?.result?.output ?? res?.output;
  if (typeof out === 'string') { try { out = JSON.parse(out); } catch { /* keep */ } }
  if (out && Array.isArray(out.rows)) return out.rows;
  if (Array.isArray(out)) return out;
  return [];
}

// Blocos JSON das SFs "1 ida" podem vir como string
function jblock(v: any): any[] {
  if (typeof v === 'string') { try { return JSON.parse(v) || []; } catch { return []; } }
  return Array.isArray(v) ? v : [];
}

async function callPublic(serverFunctionId: number, input: Record<string, any>): Promise<any> {
  const res = await executePublicServerFunctionMitra({ projectId: pid, serverFunctionId, input });
  const status = (res as any)?.result?.executionStatus ?? (res as any)?.status;
  const error = (res as any)?.result?.error ?? (res as any)?.error;
  if (status === 'FAILED') throw new Error(error || 'Falha');
  return res;
}

interface Ctx { CICLO_ID: number; GESTOR_ID: number; GESTOR_NOME: string; CICLO_NOME: string; CICLO_ANO: number; }
interface CRCard { CR_ID: number; CODIGO: string; NOME: string; STATUS: string; COMENTARIO: string | null; FILLED: number; TOTAL: number; }
interface PacoteCard { STATUS_ID: number; DRIVER_ID: number; NOME: string; DESCRICAO: string | null; STATUS: string; COMENTARIO: string | null; FILLED: number; TOTAL: number; }

type View = { kind: 'home' } | { kind: 'cr'; crId: number } | { kind: 'pacote'; pacote: PacoteCard };

const cardShadow = '0 1px 2px 0 rgba(0, 0, 0, 0.05)';

export default function PreenchimentoPublicoPage() {
  const token = useRef<string>(sanitizeToken(new URLSearchParams(window.location.search).get('token') || ''));
  const [phase, setPhase] = useState<'loading' | 'invalid' | 'ready'>('loading');
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [crs, setCrs] = useState<CRCard[]>([]);
  const [pacotes, setPacotes] = useState<PacoteCard[]>([]);
  const [view, setView] = useState<View>({ kind: 'home' });
  const [section, setSection] = useState<'workflow' | 'dre'>('workflow');
  const [rejectionTarget, setRejectionTarget] = useState<{ tipo: 'CR' | 'PACOTE'; refId: number; title: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Recusa do servidor ao submeter o pacote (ex: rateio pendente) — mensagem
  // exibida no detalhe do pacote; limpa ao navegar ou tentar de novo.
  const [submitPacoteError, setSubmitPacoteError] = useState<string | null>(null);

  // Home (contexto + cards de CRs + cards de pacotes) em UMA ida ao servidor.
  // Reusada no boot e ao voltar de um pacote (sincroniza status/progresso do card).
  const loadHome = useCallback(async (): Promise<boolean> => {
    const agora = new Date().toISOString().slice(0, 19);
    const row = rowsOf(await callPublic(SF.home, { token: token.current, agora }))[0] || {};
    const ctxRows = jblock(row.CTX);
    if (ctxRows.length === 0) return false;
    setCtx(ctxRows[0]);
    setCrs(jblock(row.CRS).sort((a: CRCard, b: CRCard) => String(a.CODIGO).localeCompare(String(b.CODIGO))));
    setPacotes(jblock(row.PACOTES).sort((a: PacoteCard, b: PacoteCard) => String(a.NOME).localeCompare(String(b.NOME))));
    return true;
  }, []);

  // Boot: valida token e carrega a home.
  useEffect(() => {
    (async () => {
      if (!token.current) { setPhase('invalid'); return; }
      try {
        configurePublicSdk();
        if (!(await loadHome())) { setPhase('invalid'); return; }
        // Ativa o modo publico ANTES de qualquer render do OrcamentoContent:
        // execSF passa a rotear as SFs quentes pros espelhos token-escopados.
        enablePublicOrcMode(token.current);
        // Pre-aquece o mount do driver (mesma tatica da tela interna)
        execSFCached(SF_IDS.hotOrcBase, {}, 60_000).catch(() => { /* aquecimento */ });
        setPhase('ready');
      } catch {
        setPhase('invalid');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openCR = useCallback((cr: CRCard) => { setSection('workflow'); setView({ kind: 'cr', crId: cr.CR_ID }); }, []);
  const openPacote = useCallback((pacote: PacoteCard) => { setSection('workflow'); setSubmitPacoteError(null); setView({ kind: 'pacote', pacote }); }, []);
  const backHome = useCallback(() => {
    const wasPacote = view.kind === 'pacote';
    setSubmitPacoteError(null);
    void flushPublicOrcQueue().then(() => {
      // Confirmacoes/edicoes do pacote acontecem dentro do OrcamentoContent sem
      // callback pra ca — recarrega a home pra refletir status/progresso no card.
      if (wasPacote) loadHome().catch(() => { /* mantem cards atuais */ });
    });
    setView({ kind: 'home' });
  }, [view.kind, loadHome]);

  // Sincroniza status/progresso dos cards quando o OrcamentoContent confirma
  // modelos ou muda o status (mesma semantica do kanban interno)
  const handleStatusChange = useCallback((crId: number, status: string, driversConfirmados?: string) => {
    setCrs(prev => prev.map(c => {
      if (Number(c.CR_ID) !== crId) return c;
      const filled = driversConfirmados !== undefined
        ? Math.min(driversConfirmados ? driversConfirmados.split(',').filter(Boolean).length : 0, Number(c.TOTAL) || 0)
        : c.FILLED;
      return { ...c, STATUS: status, FILLED: filled };
    }));
  }, []);

  const submitCR = useCallback(async (cr: CRCard) => {
    setSubmitting(true);
    try {
      await flushPublicOrcQueue(); // garante que o banco reflete o grid antes de submeter
      // appUrl alimenta o link "Abrir Workflow" do e-mail enviado aos aprovadores
      const res = await callPublic(SF.submeter, { token: token.current, crId: cr.CR_ID, appUrl: window.location.origin });
      let out: any = (res as any)?.result?.output ?? (res as any)?.output;
      if (typeof out === 'string') { try { out = JSON.parse(out); } catch { /* keep */ } }
      // A SF agora retorna erro explicito quando a transicao nao e permitida
      // (ex: CR ja APROVADO, ciclo fechado) — nao marcar SUBMETIDO na UI nesses casos.
      if (out && out.ok === false) {
        console.warn('Submissao recusada pelo servidor:', out.error);
        return;
      }
      setCrs(prev => prev.map(c => (c.CR_ID === cr.CR_ID ? { ...c, STATUS: 'SUBMETIDO' } : c)));
    } catch (e) {
      console.error('Erro ao submeter CR:', e);
    } finally {
      setSubmitting(false);
    }
  }, []);

  // Submissao do pacote pelo gestor: op token-escopada da SF publica de escrita
  // (valida a transicao no servidor, grava auditoria e notifica aprovadores).
  // Recusa do servidor (ex: rateio_pendente) vira mensagem visivel pro gestor.
  const submitPacote = useCallback(async (pacote: PacoteCard) => {
    setSubmitting(true);
    setSubmitPacoteError(null);
    try {
      await flushPublicOrcQueue(); // garante que o banco reflete o grid antes de submeter
      await publicOrcWrite('submeterPacote', { pacoteId: pacote.DRIVER_ID, appUrl: window.location.origin });
      setPacotes(prev => prev.map(p => (p.STATUS_ID === pacote.STATUS_ID ? { ...p, STATUS: 'SUBMETIDO' } : p)));
      setView(v => (v.kind === 'pacote' ? { kind: 'pacote', pacote: { ...v.pacote, STATUS: 'SUBMETIDO' } } : v));
    } catch (e: any) {
      console.error('Erro ao submeter pacote:', e);
      const key = String(e?.message || '');
      setSubmitPacoteError(
        key === 'rateio_pendente'
          ? 'Não foi possível submeter: o modelo tem linha(s) de conta sem rateio aplicado. Veja os avisos de rateio no topo do preenchimento e acione o administrador do orçamento para configurar o rateio.'
          : key === 'ciclo_fechado'
            ? 'A versão está fechada — nenhuma alteração é permitida.'
            : key === 'status_nao_permite'
              ? 'O status atual do pacote não permite submeter.'
              : 'Erro ao submeter o pacote. Tente novamente.'
      );
    } finally {
      setSubmitting(false);
    }
  }, []);

  if (phase === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center p-5" style={{ background: 'var(--bg-app)' }}>
        <div className="flex flex-col items-center gap-3" style={{ color: 'var(--color-text-secondary)' }}>
          <Loader2 size={28} className="animate-spin" style={{ color: 'var(--color-primary)' }} />
          <span>Validando seu link...</span>
        </div>
      </div>
    );
  }

  if (phase === 'invalid') {
    return (
      <div className="min-h-screen flex items-center justify-center p-5" style={{ background: 'var(--bg-app)' }}>
        <div className="rounded-xl text-center p-10 max-w-md" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: cardShadow }}>
          <ShieldAlert size={40} className="mx-auto mb-4" style={{ color: '#dc2626' }} />
          <h1 className="text-xl font-bold m-0" style={{ color: 'var(--color-text)' }}>Link inválido ou expirado</h1>
          <p className="text-sm mt-2.5 leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
            Este link de preenchimento não é mais válido. Solicite um novo link ao responsável pelo ciclo orçamentário.
          </p>
        </div>
      </div>
    );
  }

  const currentCR = view.kind === 'cr' ? crs.find(c => Number(c.CR_ID) === view.crId) : undefined;
  const crStatus = currentCR?.STATUS || 'PENDENTE';

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-app)' }}>
      {/* Barra do gestor no link: navegação limitada ao escopo autorizado pelo token. */}
      <header className="flex items-center gap-8 px-8" style={{ height: 64, background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center justify-center rounded-lg shrink-0" style={{ width: 38, height: 38, background: 'var(--color-primary-bg)', color: 'var(--color-primary)' }}>
            <Wallet size={19} />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Planejamento Orçamentário</div>
            <div className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>{ctx?.CICLO_NOME} · {ctx?.CICLO_ANO}</div>
          </div>
        </div>
        <nav className="flex items-center gap-1.5 flex-1">
          <button onClick={() => { setSection('workflow'); backHome(); }} className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-[13px] font-medium transition-colors" style={{ color: section === 'workflow' ? 'var(--color-primary)' : 'var(--color-nav-text)', backgroundColor: section === 'workflow' ? 'var(--color-primary-bg)' : 'transparent' }}><LayoutDashboard size={16} /> Workflow</button>
          <button onClick={() => { setSection('dre'); setView({ kind: 'home' }); }} className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-[13px] font-medium transition-colors" style={{ color: section === 'dre' ? 'var(--color-primary)' : 'var(--color-nav-text)', backgroundColor: section === 'dre' ? 'var(--color-primary-bg)' : 'transparent' }}><BarChart3 size={16} /> DRE Consolidado</button>
        </nav>
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="text-right leading-tight">
            <div className="text-[13px] font-semibold" style={{ color: 'var(--color-text)' }}>{ctx?.GESTOR_NOME}</div>
            <div className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>Gestor responsável</div>
          </div>
          <div className="flex items-center justify-center rounded-full text-[12px] font-semibold shrink-0" style={{ width: 36, height: 36, background: 'var(--color-primary-bg)', color: 'var(--color-primary)' }}>
            {(ctx?.GESTOR_NOME || '').split(' ').filter(Boolean).slice(0, 2).map((s) => s[0]).join('').toUpperCase() || '?'}
          </div>
        </div>
      </header>

      {/* ==================== HOME — réplica da visão gestor do workflow ==================== */}
       {section === 'workflow' && view.kind === 'home' && (
        <div className="max-w-6xl mx-auto px-8 pt-8 pb-6 space-y-7 animate-fadeIn">
          <div>
            <h1 className="font-bold" style={{ color: 'var(--color-text)', fontSize: '24px' }}>
              Olá, {(ctx?.GESTOR_NOME || '').split(' ').filter(Boolean)[0] || 'gestor'}!
            </h1>
            <p className="text-sm mt-1.5" style={{ color: 'var(--color-text-secondary)' }}>
              Preencha e submeta o orçamento dos seus centros de resultado{ctx?.CICLO_NOME ? <> na versão <strong style={{ color: 'var(--color-text)' }}>{ctx.CICLO_NOME}</strong></> : ''}.
            </p>
          </div>

          {crs.length > 0 && (
            <div>
              <div className="mb-3">
                <h3 className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>CRs</h3>
              </div>
              <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 400px))' }}>
                {crs.map((card) => {
                  const total = Number(card.TOTAL) || 0;
                  const filled = Math.min(Number(card.FILLED) || 0, total);
                  const pct = total > 0 ? Math.round((filled / total) * 100) : 0;
                  const stColor = STATUS_COLOR[card.STATUS] || '#94a3b8';
                  const stLabel = STATUS_CONFIG[card.STATUS]?.label || card.STATUS;
                  const progressColor = pct === 0 ? 'var(--color-border)' : pct === 100 ? '#10b981' : pct >= 50 ? '#75c95f' : '#f59e0b';
                  return (
                    <div
                      key={card.CR_ID}
                      className="pg-card pg-card-neutral relative rounded-xl p-5 cursor-pointer flex flex-col"
                      style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}
                      onClick={() => openCR(card)}
                    >
                      {/* Status discreto no topo — ponto + label, estilo Linear */}
                      <div className="flex items-center gap-1.5 mb-2">
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: stColor }} />
                        {card.STATUS === 'REPROVADO'
                          ? <button onClick={(event) => { event.stopPropagation(); setRejectionTarget({ tipo: 'CR', refId: card.CR_ID, title: `Motivos da reprovação — ${card.CODIGO}` }); }} className="inline-flex items-center gap-1 cursor-pointer text-[10px] font-semibold uppercase" style={{ color: stColor, letterSpacing: '0.06em' }}>{stLabel}<MessageSquare size={11} /> Ver motivos</button>
                          : <span className="text-[10px] font-semibold uppercase" style={{ color: stColor, letterSpacing: '0.06em' }}>{stLabel}</span>}
                      </div>

                      <p className="font-semibold leading-snug" style={{ color: 'var(--color-text)', fontSize: 14 }}>{card.CODIGO} - {card.NOME}</p>

                      <div className="mt-4">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[11px] font-medium" style={{ color: 'var(--color-text-muted)' }}>{filled}/{total} modelos preenchidos</span>
                          <span className="text-xs font-semibold tabular-nums" style={{ color: progressColor === 'var(--color-border)' ? 'var(--color-text-muted)' : progressColor }}>{pct}%</span>
                        </div>
                        <div className="w-full rounded-full h-1.5" style={{ backgroundColor: 'var(--bg-hover)' }}>
                          <div className="h-1.5 rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: progressColor }} />
                        </div>
                      </div>

                      {/* Rodapé com ação — separado por linha */}
                      <div className="flex items-center justify-between mt-4 pt-3" style={{ borderTop: '1px solid var(--color-border)' }}>
                        <span className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>{card.CODIGO}</span>
                        {card.STATUS === 'APROVADO' || card.STATUS === 'SUBMETIDO' ? (
                          <span className="text-xs font-semibold flex items-center gap-1.5" style={{ color: 'var(--color-text-secondary)' }}>
                            <Eye size={13} /> Visualizar
                          </span>
                        ) : card.STATUS === 'REPROVADO' ? (
                          <span className="text-xs font-semibold flex items-center gap-1.5" style={{ color: '#ef4444' }}>
                            <FileSpreadsheet size={13} /> Revisar
                          </span>
                        ) : (
                          <span className="text-xs font-semibold flex items-center gap-1.5" style={{ color: 'var(--color-primary, #8b5cf6)' }}>
                            <FileSpreadsheet size={13} /> Preencher
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {pacotes.length > 0 && (
            <div>
              <div className="mb-3">
                <h3 className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>Pacotes</h3>
              </div>
              <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 400px))' }}>
                {pacotes.map((card) => {
                  const total = Number(card.TOTAL) || 0;
                  const filled = Math.min(Number(card.FILLED) || 0, total);
                  const pct = total > 0 ? Math.round((filled / total) * 100) : 0;
                  const stColor = STATUS_COLOR[card.STATUS] || '#94a3b8';
                  const stLabel = STATUS_CONFIG[card.STATUS]?.label || card.STATUS;
                  const progressColor = pct === 0 ? 'var(--color-border)' : pct === 100 ? '#10b981' : pct >= 50 ? '#75c95f' : '#f59e0b';
                  return (
                    <div
                      key={`pkg-${card.STATUS_ID}`}
                      className="pg-card pg-card-neutral relative rounded-xl p-5 cursor-pointer flex flex-col"
                      style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}
                      onClick={() => openPacote(card)}
                    >
                      {/* Status discreto no topo — ponto + label, estilo Linear */}
                      <div className="flex items-center gap-1.5 mb-2">
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: stColor }} />
                        {card.STATUS === 'REPROVADO'
                          ? <button onClick={(event) => { event.stopPropagation(); setRejectionTarget({ tipo: 'PACOTE', refId: card.DRIVER_ID, title: `Motivos da reprovação — ${toTitleCase(card.NOME || '')}` }); }} className="inline-flex items-center gap-1 cursor-pointer text-[10px] font-semibold uppercase" style={{ color: stColor, letterSpacing: '0.06em' }}>{stLabel}<MessageSquare size={11} /> Ver motivos</button>
                          : <span className="text-[10px] font-semibold uppercase" style={{ color: stColor, letterSpacing: '0.06em' }}>{stLabel}</span>}
                      </div>

                      <p className="font-semibold leading-snug" style={{ color: 'var(--color-text)', fontSize: 14 }}>{toTitleCase(card.NOME || '')}</p>

                      <div className="mt-4">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[11px] font-medium" style={{ color: 'var(--color-text-muted)' }}>{filled}/{total} modelos preenchidos</span>
                          <span className="text-xs font-semibold tabular-nums" style={{ color: progressColor === 'var(--color-border)' ? 'var(--color-text-muted)' : progressColor }}>{pct}%</span>
                        </div>
                        <div className="w-full rounded-full h-1.5" style={{ backgroundColor: 'var(--bg-hover)' }}>
                          <div className="h-1.5 rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: progressColor }} />
                        </div>
                      </div>

                      {/* Rodapé com ação — separado por linha */}
                      <div className="flex items-center justify-between mt-4 pt-3" style={{ borderTop: '1px solid var(--color-border)' }}>
                        <span className="text-[10px] font-semibold uppercase" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.06em' }}>Pacote</span>
                        {card.STATUS === 'APROVADO' || card.STATUS === 'SUBMETIDO' ? (
                          <span className="text-xs font-semibold flex items-center gap-1.5" style={{ color: 'var(--color-text-secondary)' }}>
                            <Eye size={13} /> Visualizar
                          </span>
                        ) : card.STATUS === 'REPROVADO' ? (
                          <span className="text-xs font-semibold flex items-center gap-1.5" style={{ color: '#ef4444' }}>
                            <Package size={13} /> Revisar
                          </span>
                        ) : (
                          <span className="text-xs font-semibold flex items-center gap-1.5" style={{ color: 'var(--color-primary, #8b5cf6)' }}>
                            <Package size={13} /> Preencher
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {crs.length === 0 && pacotes.length === 0 && (
            <div className="rounded-xl text-center py-12" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: cardShadow }}>
              <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>Nenhum CR ou pacote atribuído a você nesta versão</p>
            </div>
          )}
        </div>
       )}

       {section === 'dre' && <PublicDreGestor token={token.current} />}

       {/* ============ DETALHE DE UM CR — mesmo header + OrcamentoContent do kanban ============ */}
       {section === 'workflow' && view.kind === 'cr' && currentCR && (
        <>
          {/* Sem borda inferior: a divisoria entre o nome e as abas/grade deixava
              o topo com linhas em excesso — o fundo surface ja separa as areas. */}
          <header className="h-14 flex items-center justify-between px-6" style={{ backgroundColor: 'var(--color-surface)' }}>
            <div className="flex items-center gap-3">
              <button onClick={backHome}
                className="p-1.5 rounded-lg transition-colors cursor-pointer" style={{ color: 'var(--color-text-secondary)' }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ''; }}>
                <ArrowLeft size={18} />
              </button>
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm" style={{ color: 'var(--color-text)' }}>{currentCR.CODIGO} - {currentCR.NOME}</span>
                <span className="text-[11px] font-medium px-2.5 py-0.5 rounded-full" style={{ backgroundColor: 'var(--sidebar-item-active-bg)', color: 'var(--color-primary)' }}>Preenchimento</span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {(() => {
                const stConfig = STATUS_CONFIG[crStatus] || STATUS_CONFIG.PENDENTE;
                const total = Number(currentCR.TOTAL) || 0;
                const filled = Math.min(Number(currentCR.FILLED) || 0, total);
                const allFilled = total > 0 && filled >= total;
                return (
                  <>
                    <Badge variant={stConfig.variant}>{stConfig.label}</Badge>
                    {/* O motivo da reprovacao precisa ser LEGIVEL aqui dentro: e nesta
                        tela que o gestor ajusta o CR. O balao antes era so um tooltip
                        (title) — invisivel no toque e truncado. Agora abre o mesmo
                        historico de reprovacoes dos cards da home. */}
                    {(crStatus === 'REPROVADO' || currentCR.COMENTARIO) && (
                      <button
                        onClick={() => setRejectionTarget({ tipo: 'CR', refId: Number(currentCR.CR_ID), title: `Motivos da reprovação — ${currentCR.CODIGO}` })}
                        className="inline-flex items-center gap-1 text-xs font-medium cursor-pointer border-0 bg-transparent p-0"
                        style={{ color: 'var(--semantic-danger, #dc2626)' }}
                        title="Ver motivos da reprovação">
                        <MessageSquare size={14} /> Ver motivos
                      </button>
                    )}
                    {(crStatus === 'PENDENTE' || crStatus === 'CONFIRMADO' || crStatus === 'REPROVADO') && (
                      <Button variant="primary" size="sm" onClick={() => submitCR(currentCR)} disabled={!allFilled || submitting}>
                        {submitting ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Submeter CR
                      </Button>
                    )}
                    {crStatus === 'SUBMETIDO' && (
                      <span className="text-xs font-medium" style={{ color: 'var(--semantic-warning, #d97706)' }}>Aguardando aprovação</span>
                    )}
                    {crStatus === 'APROVADO' && (
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
            <OrcamentoContent
              gestorId={ctx?.GESTOR_ID ?? null}
              selectedCR={view.crId}
              forcedCicloId={ctx?.CICLO_ID ?? null}
              readOnly={crStatus === 'APROVADO'}
              onStatusChange={handleStatusChange}
            />
          </div>
        </>
      )}

      {/* ============ DETALHE DE UM PACOTE — mesmo OrcamentoContent do kanban ============ */}
      {/* O gestor do pacote PREENCHE pelo link (grid do modelo com formulas e linhas
          personalizadas) e submete para aprovacao — mesma maquina de status dos CRs.
          Somente SUBMETIDO/APROVADO travam a edicao. */}
      {section === 'workflow' && view.kind === 'pacote' && (() => {
        const pkgStatus = view.pacote.STATUS || 'PENDENTE';
        const pkgReadOnly = pkgStatus === 'APROVADO' || pkgStatus === 'SUBMETIDO';
        return (
        <>
          {/* Sem borda inferior: a divisoria entre o nome e as abas/grade deixava
              o topo com linhas em excesso — o fundo surface ja separa as areas. */}
          <header className="h-14 flex items-center justify-between px-6" style={{ backgroundColor: 'var(--color-surface)' }}>
            <div className="flex items-center gap-3">
              <button onClick={backHome}
                className="p-1.5 rounded-lg transition-colors cursor-pointer" style={{ color: 'var(--color-text-secondary)' }}
                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ''; }}>
                <ArrowLeft size={18} />
              </button>
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm" style={{ color: 'var(--color-text)' }}>{toTitleCase(view.pacote.NOME || '')}</span>
                <span className="text-[11px] font-medium px-2.5 py-0.5 rounded-full" style={{ backgroundColor: 'var(--sidebar-item-active-bg)', color: 'var(--color-primary)' }}>Pacote</span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {(() => {
                const stConfig = STATUS_CONFIG[pkgStatus] || STATUS_CONFIG.PENDENTE;
                return (
                  <>
                    <Badge variant={stConfig.variant}>{stConfig.label}</Badge>
                    {/* Mesmo motivo do detalhe do CR: o balao abre o historico de
                        reprovacoes em vez de esconder o texto num tooltip. */}
                    {(pkgStatus === 'REPROVADO' || view.pacote.COMENTARIO) && (
                      <button
                        onClick={() => setRejectionTarget({ tipo: 'PACOTE', refId: Number(view.pacote.DRIVER_ID), title: `Motivos da reprovação — ${toTitleCase(view.pacote.NOME || '')}` })}
                        className="inline-flex items-center gap-1 text-xs font-medium cursor-pointer border-0 bg-transparent p-0"
                        style={{ color: 'var(--semantic-danger, #dc2626)' }}
                        title="Ver motivos da reprovação">
                        <MessageSquare size={14} /> Ver motivos
                      </button>
                    )}
                    {(pkgStatus === 'PENDENTE' || pkgStatus === 'CONFIRMADO' || pkgStatus === 'REPROVADO') && (
                      <Button variant="primary" size="sm" onClick={() => submitPacote(view.pacote)} disabled={submitting}>
                        {submitting ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Submeter Pacote
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
          </header>

          <div className="px-6 py-6 space-y-4">
            {pkgReadOnly && (
              <div className="flex items-start gap-2.5 rounded-xl px-4 py-3 text-[13px]" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)', color: 'var(--color-text-secondary)' }}>
                <Info size={15} className="mt-0.5 shrink-0" style={{ color: pkgStatus === 'SUBMETIDO' ? '#d97706' : '#10b981' }} />
                <span>{pkgStatus === 'SUBMETIDO' ? 'Pacote submetido — aguardando aprovação. A edição fica travada até a avaliação.' : 'Pacote aprovado — visão somente leitura.'}</span>
              </div>
            )}
            {submitPacoteError && (
              <div className="flex items-start gap-2.5 rounded-xl px-4 py-3 text-[13px]" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)', color: 'var(--color-text-secondary)' }}>
                <ShieldAlert size={15} className="mt-0.5 shrink-0" style={{ color: '#dc2626' }} />
                <span>{submitPacoteError}</span>
              </div>
            )}
            <OrcamentoContent
              gestorId={ctx?.GESTOR_ID ?? null}
              selectedCR={null}
              selectedPackage={{ ID: view.pacote.DRIVER_ID, NOME: view.pacote.NOME, GESTOR_ID: ctx?.GESTOR_ID ?? null }}
              forcedCicloId={ctx?.CICLO_ID ?? null}
              readOnly={pkgReadOnly}
            />
          </div>
        </>
        );
      })()}
      <RejectionReasonsModal
        isOpen={rejectionTarget !== null}
        onClose={() => setRejectionTarget(null)}
        title={rejectionTarget?.title || 'Motivos da reprovação'}
        load={async () => rejectionTarget ? rowsOf(await callPublic(193, { token: token.current, tipo: rejectionTarget.tipo, refId: rejectionTarget.refId, agora: new Date().toISOString().slice(0, 19) })) : []}
      />
    </div>
  );
}
