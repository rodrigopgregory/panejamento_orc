import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { execSF, execSFCached, sqlEscape, SF_IDS } from '../hooks/useMitraData';
import { baixarCsv } from '../lib/csv';
import {
  parteData, fmtHora, fmtDataBr, fmtDataHora, fmtDataExtenso,
  isoLocal, diaUtc, rotuloDia,
} from '../lib/auditoria-datas';
import Select from '../components/ui/Select';
import Input from '../components/ui/Input';
import DatePicker from '../components/ui/DatePicker';
import { useToast } from '../hooks/useToast';
import { ToastContainer } from '../components/ui/Toast';
import {
  Send, CheckCircle, XCircle, RotateCcw, Check, Undo2, Clock,
  Search, ChevronLeft, ChevronRight, ScrollText, Download, X,
  SlidersHorizontal, ArrowRight, MessageSquare, User, Globe, Monitor,
  Loader2, ListTree, HelpCircle, Sparkles,
} from 'lucide-react';

// ──────────────────────────────────────────────────────────────────────
// Auditoria — ferramenta de investigacao da trilha do workflow.
//
// A tela e organizada em tres partes: cabecalho com acoes, barra de filtros e
// lista de eventos com painel de detalhes ao lado. A lista responde "o que
// aconteceu"; o painel responde "por que" — abre o evento inteiro e, junto,
// o fluxo completo do mesmo objeto naquele ciclo, que e como se investiga uma
// reprovacao ou uma reabertura (submeteu, foi reprovado por que, quem reabriu,
// reenviou quando).
//
// Os filtros e os rotulos cobrem exatamente o que o sistema registra hoje:
// submissoes, aprovacoes, reprovacoes, reaberturas e confirmacoes de modelo,
// vindas do aplicativo ou do portal externo. Categorias sem lastro no dado
// (importacoes, alteracoes de valor, chamadas de API) ficariam sempre vazias e
// por isso nao entram na barra de filtros.
// ──────────────────────────────────────────────────────────────────────

interface AuditoriaItem {
  ID: number;
  CICLO_ID: number;
  CICLO_NOME: string;
  TIPO: 'CR' | 'PACOTE';
  EVENTO: string;
  STATUS_DE: string | null;
  STATUS_PARA: string | null;
  COMENTARIO: string | null;
  AUTOR: string | null;
  ORIGEM: string | null;
  CRIADO_EM: string | null;
  CR_ID: number | null;
  DRIVER_ID: number | null;
  ALVO: string;
  TOTAL_FILTRADO?: number;
}

interface FluxoItem {
  ID: number;
  EVENTO: string;
  STATUS_DE: string | null;
  STATUS_PARA: string | null;
  COMENTARIO: string | null;
  AUTOR: string | null;
  ORIGEM: string | null;
  CRIADO_EM: string | null;
}

const EVENTO_META: Record<string, { label: string; curto: string; color: string; icon: typeof Send }> = {
  SUBMETIDO: { label: 'Submetido para aprovação', curto: 'Submissão', color: '#d97706', icon: Send },
  APROVADO: { label: 'Aprovado', curto: 'Aprovação', color: '#059669', icon: CheckCircle },
  REPROVADO: { label: 'Reprovado', curto: 'Reprovação', color: '#b91c1c', icon: XCircle },
  REABERTO: { label: 'Reaberto para avaliação', curto: 'Reabertura', color: '#64748b', icon: RotateCcw },
  MODELO_CONFIRMADO: { label: 'Modelo confirmado', curto: 'Confirmação de modelo', color: '#059669', icon: Check },
  CONFIRMACAO_DESFEITA: { label: 'Confirmação desfeita', curto: 'Confirmação desfeita', color: '#64748b', icon: Undo2 },
};

const EVENTO_FALLBACK = { label: '', curto: '', color: '#64748b', icon: Clock };
function metaDe(evento: string) {
  return EVENTO_META[evento] || { ...EVENTO_FALLBACK, label: evento, curto: evento };
}

const STATUS_LABEL: Record<string, string> = {
  ABERTO: 'Aberto',
  EM_PREENCHIMENTO: 'Em preenchimento',
  PREENCHIDO: 'Preenchido',
  CONFIRMADO: 'Confirmado',
  SUBMETIDO: 'Submetido',
  APROVADO: 'Aprovado',
  REPROVADO: 'Reprovado',
  REABERTO: 'Reaberto',
  PENDENTE: 'Pendente',
};
function statusLabel(s: string | null): string {
  if (!s) return '—';
  return STATUS_LABEL[s] || s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ');
}

const ORIGEM_LABEL: Record<string, string> = { APP: 'Aplicativo', LINK: 'Portal externo' };
function origemLabel(o: string | null): string {
  return (o && ORIGEM_LABEL[o]) || 'Aplicativo';
}

const PAGE_SIZE = 25;
const EXPORT_LIMIT = 5000;


// Quando cada evento entra na trilha. A lista exibida na ajuda e derivada de
// EVENTO_META — a mesma fonte dos rotulos e do filtro —, entao um evento novo
// aparece aqui sozinho e a ajuda nao descola do que a tela realmente registra.
const EVENTO_QUANDO: Record<string, string> = {
  SUBMETIDO: 'O gestor envia o orçamento do setor ou do pacote para aprovação.',
  APROVADO: 'O avaliador aprova o que foi submetido.',
  REPROVADO: 'O avaliador devolve para ajustes — o motivo fica registrado junto.',
  REABERTO: 'Um orçamento já avaliado volta a ficar editável.',
  MODELO_CONFIRMADO: 'O gestor confirma o modelo de projeção de uma conta.',
  CONFIRMACAO_DESFEITA: 'A confirmação de um modelo é desfeita.',
};

// Ajuda da tela, no mesmo padrão do botão da tela de Mapeamento: gatilho "Ajuda"
// com popover ancorado à direita, fechando por clique fora ou Escape.
function AuditoriaHelp() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

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
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border transition-all duration-200"
        style={{
          borderColor: open ? 'var(--color-primary)' : 'var(--color-border)',
          backgroundColor: open ? 'var(--color-primary-bg)' : 'var(--color-surface)',
          color: open ? 'var(--color-primary)' : 'var(--color-text-secondary)',
        }}
      >
        <HelpCircle size={14} /> Ajuda
      </button>
      {open && (
        <div
          className="absolute right-0 top-full mt-2 z-40 w-[380px] max-w-[85vw] rounded-xl p-4 animate-scaleIn text-left"
          style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', boxShadow: '0 14px 34px -12px rgba(15, 23, 42, 0.24)' }}
        >
          <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
            <span className="w-7 h-7 rounded-full inline-flex items-center justify-center" style={{ backgroundColor: 'var(--color-primary-bg)', color: 'var(--color-primary)' }}>
              <HelpCircle size={14} />
            </span>
            O que a auditoria registra
          </div>
          <p className="mt-2 text-[12px] leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
            Cada linha guarda quem fez, de onde fez e quando — pelo aplicativo ou pelo portal
            externo do gestor. Estes são os eventos hoje registrados:
          </p>
          <ul className="mt-3 space-y-2.5">
            {Object.entries(EVENTO_META).map(([codigo, meta]) => {
              const Icone = meta.icon;
              return (
                <li key={codigo} className="flex gap-2.5">
                  <span className="rounded-full p-1 shrink-0 mt-0.5 h-fit" style={{ backgroundColor: meta.color + '1f' }}>
                    <Icone size={12} style={{ color: meta.color }} />
                  </span>
                  <div className="min-w-0">
                    <div className="text-[12px] font-medium" style={{ color: 'var(--color-text)' }}>{meta.label}</div>
                    <div className="text-[11px] leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                      {EVENTO_QUANDO[codigo] || 'Registrado automaticamente pelo fluxo de aprovação.'}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="mt-3 pt-3 flex gap-2.5" style={{ borderTop: '1px solid var(--border-light)' }}>
            <Sparkles size={13} className="shrink-0 mt-0.5" style={{ color: 'var(--color-primary)' }} />
            <p className="text-[11px] leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
              Precisa acompanhar algo que não está nesta lista? Peça à{' '}
              <strong style={{ color: 'var(--color-text)' }}>IA de desenvolvimento</strong> para
              incluir o evento na trilha — ela cria o registro e ele passa a aparecer aqui, com
              filtro e exportação, como os demais.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

const PERIODO_OPTIONS = [
  { value: '', label: 'Todo o período' },
  { value: '7', label: 'Últimos 7 dias' },
  { value: '30', label: 'Últimos 30 dias' },
  { value: '90', label: 'Últimos 90 dias' },
  { value: 'custom', label: 'Personalizado' },
];

const EVENTO_OPTIONS = [
  { value: '', label: 'Todos os eventos' },
  { value: 'SUBMETIDO', label: 'Submissões' },
  { value: 'APROVADO', label: 'Aprovações' },
  { value: 'REPROVADO', label: 'Reprovações' },
  { value: 'REABERTO', label: 'Reaberturas' },
  { value: 'MODELO_CONFIRMADO', label: 'Confirmações de modelo' },
  { value: 'CONFIRMACAO_DESFEITA', label: 'Confirmações desfeitas' },
];

const ORIGEM_OPTIONS = [
  { value: '', label: 'Todas as origens' },
  { value: 'APP', label: 'Aplicativo' },
  { value: 'LINK', label: 'Portal externo' },
];

const TIPO_OPTIONS = [
  { value: '', label: 'CRs e pacotes' },
  { value: 'CR', label: 'Somente CRs' },
  { value: 'PACOTE', label: 'Somente pacotes' },
];

// ── Chip de filtro ativo ─────────────────────────────────────────────
function FiltroChip({ rotulo, valor, onRemove }: { rotulo: string; valor: string; onRemove: () => void }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-lg text-xs"
      style={{ backgroundColor: 'var(--color-primary-bg)', color: 'var(--color-primary)', border: '1px solid var(--color-primary-bg)' }}
    >
      <span style={{ opacity: 0.75 }}>{rotulo}:</span>
      <span className="font-medium truncate" style={{ maxWidth: 180 }}>{valor}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remover filtro ${rotulo}`}
        className="rounded p-0.5 transition-colors"
        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(0,0,0,0.06)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ''; }}
      >
        <X size={12} />
      </button>
    </span>
  );
}

// ── Painel de detalhes ───────────────────────────────────────────────
function PainelDetalhes({
  item, fluxo, fluxoLoading, onFechar, onSelecionarFluxo,
}: {
  item: AuditoriaItem;
  fluxo: FluxoItem[];
  fluxoLoading: boolean;
  onFechar: () => void;
  onSelecionarFluxo: (f: FluxoItem) => void;
}) {
  const meta = metaDe(item.EVENTO);
  const Icon = meta.icon;
  const mudouStatus = !!(item.STATUS_DE || item.STATUS_PARA);
  // Confirmacao de modelo guarda o nome do modelo no comentario, nao um motivo.
  const comentarioEhMotivo = item.EVENTO !== 'MODELO_CONFIRMADO' && item.EVENTO !== 'CONFIRMACAO_DESFEITA';

  return (
    <div className="flex flex-col h-full">
      {/* Cabecalho do painel */}
      <div
        className="flex items-start gap-3 px-4 py-3.5 shrink-0"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <span className="rounded-full p-2 shrink-0 mt-0.5" style={{ backgroundColor: meta.color + '1f' }}>
          <Icon size={15} style={{ color: meta.color }} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-snug" style={{ color: meta.color }}>{meta.label}</p>
          <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--color-text-secondary)' }}>{item.ALVO}</p>
        </div>
        <button
          type="button"
          onClick={onFechar}
          aria-label="Fechar detalhes"
          className="rounded-lg p-1.5 transition-colors shrink-0"
          style={{ color: 'var(--color-text-muted)' }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ''; }}
        >
          <X size={15} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto scroll-hidden px-4 py-4" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {/* Identificacao */}
        <section>
          <h3 className="text-[10px] font-semibold uppercase tracking-wider mb-2.5" style={{ color: 'var(--color-text-muted)' }}>
            Registro
          </h3>
          <dl style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <LinhaDetalhe rotulo="Objeto" valor={item.ALVO} />
            <LinhaDetalhe rotulo="Natureza" valor={item.TIPO === 'CR' ? 'Centro de resultado' : 'Pacote'} />
            <LinhaDetalhe rotulo="Ciclo" valor={item.CICLO_NOME} />
            <LinhaDetalhe
              rotulo="Data e hora"
              valor={`${fmtDataExtenso(item.CRIADO_EM)}, ${fmtHora(item.CRIADO_EM)}`}
            />
            <LinhaDetalhe rotulo="Responsável" valor={item.AUTOR || 'Não identificado'} icone={User} />
            <LinhaDetalhe
              rotulo="Origem"
              valor={origemLabel(item.ORIGEM)}
              icone={item.ORIGEM === 'LINK' ? Globe : Monitor}
            />
            <LinhaDetalhe rotulo="Identificador" valor={`#${item.ID}`} />
          </dl>
        </section>

        {/* Transicao de status */}
        {mudouStatus && (
          <section>
            <h3 className="text-[10px] font-semibold uppercase tracking-wider mb-2.5" style={{ color: 'var(--color-text-muted)' }}>
              Alteração de situação
            </h3>
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className="text-xs px-2.5 py-1 rounded-lg"
                style={{ backgroundColor: 'var(--bg-hover)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}
              >
                {statusLabel(item.STATUS_DE)}
              </span>
              <ArrowRight size={14} style={{ color: 'var(--color-text-muted)' }} />
              <span
                className="text-xs px-2.5 py-1 rounded-lg font-medium"
                style={{ backgroundColor: meta.color + '1a', color: meta.color, border: `1px solid ${meta.color}33` }}
              >
                {statusLabel(item.STATUS_PARA)}
              </span>
            </div>
          </section>
        )}

        {/* Motivo / comentario */}
        {item.COMENTARIO && comentarioEhMotivo && (
          <section>
            <h3 className="text-[10px] font-semibold uppercase tracking-wider mb-2.5" style={{ color: 'var(--color-text-muted)' }}>
              {item.EVENTO === 'REPROVADO' ? 'Motivo da reprovação' : 'Comentário'}
            </h3>
            <p
              className="text-xs leading-relaxed px-3 py-2.5 rounded-lg whitespace-pre-wrap"
              style={{ backgroundColor: 'var(--bg-hover)', color: 'var(--color-text-secondary)' }}
            >
              {item.COMENTARIO}
            </p>
          </section>
        )}
        {item.COMENTARIO && !comentarioEhMotivo && (
          <section>
            <h3 className="text-[10px] font-semibold uppercase tracking-wider mb-2.5" style={{ color: 'var(--color-text-muted)' }}>
              Modelo
            </h3>
            <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{item.COMENTARIO}</p>
          </section>
        )}

        {/* Fluxo relacionado */}
        <section>
          <h3 className="text-[10px] font-semibold uppercase tracking-wider mb-2.5 flex items-center gap-1.5" style={{ color: 'var(--color-text-muted)' }}>
            <ListTree size={12} /> Fluxo relacionado
          </h3>
          {fluxoLoading ? (
            <p className="text-xs flex items-center gap-1.5" style={{ color: 'var(--color-text-muted)' }}>
              <Loader2 size={12} className="animate-spin" /> Carregando o fluxo...
            </p>
          ) : fluxo.length <= 1 ? (
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              Este é o único evento registrado para {item.ALVO} neste ciclo.
            </p>
          ) : (
            <>
              <p className="text-xs mb-2.5" style={{ color: 'var(--color-text-muted)' }}>
                {fluxo.length} eventos de {item.ALVO} em {item.CICLO_NOME}, do mais antigo ao mais recente.
              </p>
              <ol style={{ display: 'flex', flexDirection: 'column' }}>
                {fluxo.map((f, i) => {
                  const fm = metaDe(f.EVENTO);
                  const FIcon = fm.icon;
                  const atual = f.ID === item.ID;
                  return (
                    <li key={f.ID} className="flex gap-2.5">
                      <div className="flex flex-col items-center shrink-0">
                        <span className="rounded-full p-1" style={{ backgroundColor: fm.color + (atual ? '2e' : '14') }}>
                          <FIcon size={11} style={{ color: fm.color, opacity: atual ? 1 : 0.75 }} />
                        </span>
                        {i < fluxo.length - 1 && (
                          <span className="w-px flex-1 my-0.5" style={{ backgroundColor: 'var(--color-border)' }} />
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => onSelecionarFluxo(f)}
                        className="text-left min-w-0 flex-1 pb-3 rounded transition-colors px-1.5 -mx-1.5"
                        style={{ backgroundColor: atual ? 'var(--bg-hover)' : undefined }}
                        onMouseEnter={(e) => { if (!atual) e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; }}
                        onMouseLeave={(e) => { if (!atual) e.currentTarget.style.backgroundColor = ''; }}
                      >
                        <p className="text-xs font-medium truncate" style={{ color: atual ? 'var(--color-text)' : 'var(--color-text-secondary)' }}>
                          {fm.curto}
                        </p>
                        <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-muted)' }}>
                          {f.AUTOR ? `${f.AUTOR} · ` : ''}{fmtDataHora(f.CRIADO_EM)}
                        </p>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function LinhaDetalhe({ rotulo, valor, icone: Icone }: { rotulo: string; valor: string; icone?: typeof User }) {
  return (
    <div className="flex items-baseline gap-3">
      <dt className="text-xs shrink-0" style={{ color: 'var(--color-text-muted)', width: 92 }}>{rotulo}</dt>
      <dd className="text-xs flex items-center gap-1.5 min-w-0" style={{ color: 'var(--color-text)' }}>
        {Icone && <Icone size={12} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />}
        <span className="break-words">{valor}</span>
      </dd>
    </div>
  );
}

// ── Pagina ───────────────────────────────────────────────────────────
export default function AuditoriaPage() {
  const { toasts, addToast, removeToast } = useToast();

  const [items, setItems] = useState<AuditoriaItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [exportando, setExportando] = useState(false);

  const [ciclos, setCiclos] = useState<{ ID: number; NOME: string }[]>([]);
  const [autores, setAutores] = useState<string[]>([]);

  // Filtros
  const [busca, setBusca] = useState('');
  const [buscaDebounced, setBuscaDebounced] = useState('');
  const [periodo, setPeriodo] = useState('');
  const [dataDe, setDataDe] = useState('');
  const [dataAte, setDataAte] = useState('');
  const [cicloId, setCicloId] = useState('0');
  const [evento, setEvento] = useState('');
  const [origem, setOrigem] = useState('');
  const [autor, setAutor] = useState('');
  const [tipo, setTipo] = useState('');
  const [maisFiltros, setMaisFiltros] = useState(false);

  const [page, setPage] = useState(0);
  const [selecionado, setSelecionado] = useState<AuditoriaItem | null>(null);
  const [fluxo, setFluxo] = useState<FluxoItem[]>([]);
  const [fluxoLoading, setFluxoLoading] = useState(false);

  const versionRef = useRef(0);
  const fluxoVersionRef = useRef(0);

  // Desktop ganha painel fixo na coluna da direita; abaixo de 1024px ele vira
  // gaveta sobreposta, porque uma coluna de 380px espremeria a lista.
  const [larguraOk, setLarguraOk] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 1024);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const on = () => setLarguraOk(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  useEffect(() => {
    execSFCached(SF_IDS.baseCiclos, {})
      .then((rows) => setCiclos(rows as { ID: number; NOME: string }[]))
      .catch((e) => console.error('auditoria ciclos:', e));
    execSFCached(SF_IDS.auditoriaAutores, {})
      .then((rows) => setAutores((rows as { AUTOR: string }[]).map((r) => r.AUTOR).filter(Boolean)))
      .catch((e) => console.error('auditoria autores:', e));
  }, []);

  // Debounce da busca pra nao consultar a cada tecla
  useEffect(() => {
    const t = setTimeout(() => { setBuscaDebounced(busca.trim()); setPage(0); }, 350);
    return () => clearTimeout(t);
  }, [busca]);

  // Presets resolvem para o mesmo par de datas que o modo personalizado usa,
  // entao a query nao precisa saber qual dos dois o usuario escolheu.
  const recorte = useMemo(() => {
    let de = '';
    let ate = '';
    if (periodo === 'custom') {
      de = dataDe; ate = dataAte;
    } else if (periodo === '7' || periodo === '30' || periodo === '90') {
      const inicio = new Date();
      inicio.setDate(inicio.getDate() - Number(periodo));
      de = isoLocal(inicio); ate = isoLocal(new Date());
    }
    // O SQL recorta SUBSTRING(CRIADO_EM, 1, 10), que e a data em UTC, enquanto o
    // usuario escolhe dias no fuso dele. Mandar o dia local cru descartava os
    // eventos do fim da noite (que ja estao no dia UTC seguinte); converter cada
    // limite para o dia UTC correspondente fecha esse buraco.
    return { de: diaUtc(de, false), ate: diaUtc(ate, true) };
  }, [periodo, dataDe, dataAte]);

  const filtrosQuery = useMemo(() => ({
    cicloId: Number(cicloId) || 0,
    evento,
    tipo,
    origem,
    autor: sqlEscape(autor),
    dataDe: recorte.de,
    dataAte: recorte.ate,
    busca: sqlEscape(buscaDebounced),
  }), [cicloId, evento, tipo, origem, autor, recorte.de, recorte.ate, buscaDebounced]);

  useEffect(() => {
    const version = ++versionRef.current;
    setLoading(true);
    execSF(SF_IDS.auditoriaGeral, { ...filtrosQuery, limit: PAGE_SIZE, offset: page * PAGE_SIZE })
      .then((rows) => {
        if (versionRef.current !== version) return;
        const lista = rows as AuditoriaItem[];
        setItems(lista);
        setTotal(Number(lista[0]?.TOTAL_FILTRADO ?? 0));
      })
      .catch((e) => {
        console.error('auditoria geral:', e);
        if (versionRef.current === version) { setItems([]); setTotal(0); }
      })
      .finally(() => { if (versionRef.current === version) setLoading(false); });
  }, [filtrosQuery, page]);

  // Fluxo do objeto selecionado. A chave e o objeto (ciclo + CR/pacote), nao o
  // evento — trocar de evento dentro do mesmo fluxo nao refaz a consulta.
  const chaveFluxo = selecionado
    ? `${selecionado.CICLO_ID}|${selecionado.TIPO}|${selecionado.CR_ID ?? 0}|${selecionado.DRIVER_ID ?? 0}`
    : '';

  useEffect(() => {
    if (!chaveFluxo) { setFluxo([]); return; }
    const [cid, t, cr, drv] = chaveFluxo.split('|');
    const version = ++fluxoVersionRef.current;
    setFluxoLoading(true);
    execSF(SF_IDS.auditoriaFluxo, { cicloId: Number(cid), tipo: t, crId: Number(cr), driverId: Number(drv) })
      .then((rows) => { if (fluxoVersionRef.current === version) setFluxo(rows as FluxoItem[]); })
      .catch((e) => { console.error('auditoria fluxo:', e); if (fluxoVersionRef.current === version) setFluxo([]); })
      .finally(() => { if (fluxoVersionRef.current === version) setFluxoLoading(false); });
  }, [chaveFluxo]);

  // Esc fecha o painel — atalho esperado de qualquer gaveta.
  useEffect(() => {
    if (!selecionado) return;
    const on = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelecionado(null); };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [selecionado]);

  const cicloOptions = useMemo(() => [
    { value: '0', label: 'Todos os ciclos' },
    ...ciclos.map((c) => ({ value: String(c.ID), label: c.NOME })),
  ], [ciclos]);

  const autorOptions = useMemo(() => [
    { value: '', label: 'Todos os responsáveis' },
    ...autores.map((a) => ({ value: a, label: a })),
  ], [autores]);

  const limparTudo = useCallback(() => {
    setBusca(''); setPeriodo(''); setDataDe(''); setDataAte('');
    setCicloId('0'); setEvento(''); setOrigem(''); setAutor(''); setTipo('');
    setPage(0);
  }, []);

  const trocarFiltro = useCallback((fn: () => void) => { fn(); setPage(0); }, []);

  // Chips do que esta filtrando agora, cada um removivel individualmente.
  const chips = useMemo(() => {
    const out: { rotulo: string; valor: string; remover: () => void }[] = [];
    if (buscaDebounced) out.push({ rotulo: 'Busca', valor: buscaDebounced, remover: () => setBusca('') });
    if (periodo) {
      const valor = periodo === 'custom'
        ? [dataDe && fmtDataBr(dataDe), dataAte && fmtDataBr(dataAte)]
            .filter(Boolean).join(' a ') || 'Personalizado'
        : PERIODO_OPTIONS.find((p) => p.value === periodo)?.label || periodo;
      out.push({ rotulo: 'Período', valor, remover: () => trocarFiltro(() => { setPeriodo(''); setDataDe(''); setDataAte(''); }) });
    }
    if (cicloId !== '0') {
      out.push({
        rotulo: 'Ciclo',
        valor: ciclos.find((c) => String(c.ID) === cicloId)?.NOME || cicloId,
        remover: () => trocarFiltro(() => setCicloId('0')),
      });
    }
    if (evento) {
      out.push({
        rotulo: 'Evento',
        valor: EVENTO_OPTIONS.find((e) => e.value === evento)?.label || evento,
        remover: () => trocarFiltro(() => setEvento('')),
      });
    }
    if (origem) out.push({ rotulo: 'Origem', valor: origemLabel(origem), remover: () => trocarFiltro(() => setOrigem('')) });
    if (autor) out.push({ rotulo: 'Responsável', valor: autor, remover: () => trocarFiltro(() => setAutor('')) });
    if (tipo) {
      out.push({
        rotulo: 'Objeto',
        valor: TIPO_OPTIONS.find((t) => t.value === tipo)?.label || tipo,
        remover: () => trocarFiltro(() => setTipo('')),
      });
    }
    return out;
  }, [buscaDebounced, periodo, dataDe, dataAte, cicloId, ciclos, evento, origem, autor, tipo, trocarFiltro]);

  const filtrosAvancadosAtivos = !!origem || !!autor || !!tipo;
  const temFiltro = chips.length > 0;

  // Blocos por dia: o cabecalho de data aparece uma vez, nao em cada linha.
  const grupos = useMemo(() => {
    const out: { dia: string; eventos: AuditoriaItem[] }[] = [];
    for (const it of items) {
      const dia = parteData(it.CRIADO_EM);
      const ultimo = out[out.length - 1];
      if (ultimo && ultimo.dia === dia) ultimo.eventos.push(it);
      else out.push({ dia, eventos: [it] });
    }
    return out;
  }, [items]);

  async function exportarCsv() {
    setExportando(true);
    try {
      const rows = await execSF(SF_IDS.auditoriaGeral, { ...filtrosQuery, limit: EXPORT_LIMIT, offset: 0 }) as AuditoriaItem[];
      const linhas: unknown[][] = [[
        'ID', 'Data e hora', 'Ciclo', 'Objeto', 'Natureza', 'Evento',
        'Situação anterior', 'Nova situação', 'Responsável', 'Origem', 'Comentário',
      ]];
      for (const r of rows) {
        linhas.push([
          r.ID,
          fmtDataHora(r.CRIADO_EM),
          r.CICLO_NOME,
          r.ALVO,
          r.TIPO === 'CR' ? 'Centro de resultado' : 'Pacote',
          metaDe(r.EVENTO).label,
          statusLabel(r.STATUS_DE),
          statusLabel(r.STATUS_PARA),
          r.AUTOR || '',
          origemLabel(r.ORIGEM),
          r.COMENTARIO || '',
        ]);
      }
      baixarCsv(`auditoria-${isoLocal(new Date())}.csv`, linhas);
      // O teto do export e alto, mas se o filtro estourar e melhor dizer do que
      // entregar um arquivo silenciosamente cortado.
      if (rows.length >= EXPORT_LIMIT) {
        addToast('error', `Exportados apenas os ${EXPORT_LIMIT} eventos mais recentes do filtro. Estreite o período para exportar o restante.`);
      } else {
        addToast('success', `${rows.length} ${rows.length === 1 ? 'evento exportado' : 'eventos exportados'}.`);
      }
    } catch (e) {
      console.error('auditoria export:', e);
      addToast('error', 'Não foi possível exportar os eventos. Tente novamente.');
    } finally {
      setExportando(false);
    }
  }

  const inicio = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const fim = Math.min(total, page * PAGE_SIZE + items.length);
  const temProxima = (page + 1) * PAGE_SIZE < total;

  const painel = selecionado && (
    <PainelDetalhes
      item={selecionado}
      fluxo={fluxo}
      fluxoLoading={fluxoLoading}
      onFechar={() => setSelecionado(null)}
      onSelecionarFluxo={(f) => setSelecionado((atual) => (atual ? {
        ...atual,
        ID: f.ID,
        EVENTO: f.EVENTO,
        STATUS_DE: f.STATUS_DE,
        STATUS_PARA: f.STATUS_PARA,
        COMENTARIO: f.COMENTARIO,
        AUTOR: f.AUTOR,
        ORIGEM: f.ORIGEM,
        CRIADO_EM: f.CRIADO_EM,
      } : atual))}
    />
  );

  return (
    <div className="animate-fadeIn" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ── Cabeçalho e ações ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="font-semibold" style={{ color: 'var(--color-text)', fontSize: '20px' }}>Auditoria</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>
            Histórico de eventos, decisões e alterações do planejamento orçamentário.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <div className="flex items-center gap-2">
          <AuditoriaHelp />
          <button
            type="button"
            onClick={exportarCsv}
            disabled={exportando || loading || total === 0}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text-secondary)', borderColor: 'var(--color-border)' }}
            onMouseEnter={(e) => { if (!e.currentTarget.disabled) e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-surface)'; }}
          >
            {exportando ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            Exportar CSV
          </button>
          </div>
          <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
            {loading ? 'Carregando...' : total === 0 ? 'Nenhum evento' : `${total.toLocaleString('pt-BR')} ${total === 1 ? 'evento' : 'eventos'}`}
          </span>
        </div>
      </div>

      {/* ── Filtros ── */}
      <div
        className="rounded-xl px-4 py-3.5"
        style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}
      >
        <div className="flex gap-2.5 flex-wrap items-center">
          <div className="relative" style={{ flex: '1 1 260px', minWidth: 220, maxWidth: 380 }}>
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 z-10" style={{ color: 'var(--color-text-muted)' }} />
            <Input
              value={busca}
              onChange={setBusca}
              placeholder="Buscar por CR, pacote, responsável ou comentário"
              className="pl-9"
              aria-label="Buscar eventos"
            />
          </div>
          <div style={{ width: 170 }}>
            <Select
              options={PERIODO_OPTIONS}
              value={periodo}
              onChange={(v) => trocarFiltro(() => {
                setPeriodo(v);
                if (v !== 'custom') { setDataDe(''); setDataAte(''); }
                else setMaisFiltros(true);
              })}
              searchThreshold={99}
            />
          </div>
          <div style={{ width: 210 }}>
            <Select options={cicloOptions} value={cicloId} onChange={(v) => trocarFiltro(() => setCicloId(v))} />
          </div>
          <div style={{ width: 210 }}>
            <Select options={EVENTO_OPTIONS} value={evento} onChange={(v) => trocarFiltro(() => setEvento(v))} />
          </div>
          <button
            type="button"
            onClick={() => setMaisFiltros((v) => !v)}
            aria-expanded={maisFiltros}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg border transition-all duration-200"
            style={{
              backgroundColor: maisFiltros ? 'var(--bg-hover)' : 'var(--color-surface)',
              color: 'var(--color-text-secondary)',
              borderColor: 'var(--color-border)',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = maisFiltros ? 'var(--bg-hover)' : 'var(--color-surface)'; }}
          >
            <SlidersHorizontal size={14} />
            Mais filtros
            {filtrosAvancadosAtivos && (
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: 'var(--color-primary)' }} />
            )}
          </button>
        </div>

        {maisFiltros && (
          <div
            className="flex gap-2.5 flex-wrap items-center mt-3 pt-3 animate-fadeIn"
            style={{ borderTop: '1px solid var(--color-border)' }}
          >
            <div style={{ width: 190 }}>
              <Select options={ORIGEM_OPTIONS} value={origem} onChange={(v) => trocarFiltro(() => setOrigem(v))} searchThreshold={99} />
            </div>
            <div style={{ width: 210 }}>
              <Select options={autorOptions} value={autor} onChange={(v) => trocarFiltro(() => setAutor(v))} />
            </div>
            <div style={{ width: 180 }}>
              <Select options={TIPO_OPTIONS} value={tipo} onChange={(v) => trocarFiltro(() => setTipo(v))} searchThreshold={99} />
            </div>
            {periodo === 'custom' && (
              <>
                <div style={{ width: 170 }}>
                  <DatePicker value={dataDe} onChange={(v) => trocarFiltro(() => setDataDe(v))} placeholder="Data inicial" />
                </div>
                <div style={{ width: 170 }}>
                  <DatePicker value={dataAte} onChange={(v) => trocarFiltro(() => setDataAte(v))} placeholder="Data final" />
                </div>
              </>
            )}
          </div>
        )}

        {temFiltro && (
          <div className="flex gap-2 flex-wrap items-center mt-3">
            {chips.map((c) => (
              <FiltroChip key={c.rotulo} rotulo={c.rotulo} valor={c.valor} onRemove={c.remover} />
            ))}
            <button
              type="button"
              className="text-xs underline ml-1"
              style={{ color: 'var(--color-text-secondary)', textUnderlineOffset: 3 }}
              onClick={limparTudo}
            >
              Limpar tudo
            </button>
          </div>
        )}
      </div>

      {/* ── Lista + painel ── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: larguraOk && selecionado ? 'minmax(0, 1fr) 380px' : 'minmax(0, 1fr)',
          gap: 16,
          alignItems: 'start',
        }}
      >
        <div
          className="rounded-xl"
          style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}
        >
          {loading ? (
            <p className="text-sm py-12 text-center" style={{ color: 'var(--color-text-secondary)' }}>Carregando eventos...</p>
          ) : items.length === 0 ? (
            <div className="text-center py-14 px-6">
              <ScrollText size={30} className="mx-auto mb-2.5" style={{ color: 'var(--color-text-muted)' }} />
              <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                {temFiltro
                  ? 'Nenhum evento encontrado com os filtros aplicados.'
                  : 'Nenhum evento registrado ainda. Submissões, aprovações e reprovações aparecem aqui.'}
              </p>
              {temFiltro && (
                <button
                  type="button"
                  className="text-xs underline mt-2"
                  style={{ color: 'var(--color-primary)', textUnderlineOffset: 3 }}
                  onClick={limparTudo}
                >
                  Limpar os filtros
                </button>
              )}
            </div>
          ) : (
            <div>
              {grupos.map((g, gi) => (
                <div key={g.dia}>
                  {/* Sem overflow:hidden no card — ele mataria o sticky. O canto
                      arredondado do topo vem do proprio primeiro cabecalho. */}
                  <div
                    className="sticky top-0 z-10 px-4 py-2"
                    style={{
                      backgroundColor: 'var(--color-surface)',
                      borderBottom: '1px solid var(--color-border)',
                      borderTopLeftRadius: gi === 0 ? 12 : 0,
                      borderTopRightRadius: gi === 0 ? 12 : 0,
                    }}
                  >
                    <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
                      {rotuloDia(g.dia)}
                    </span>
                  </div>
                  {g.eventos.map((it) => {
                    const meta = metaDe(it.EVENTO);
                    const Icon = meta.icon;
                    const ativo = selecionado?.ID === it.ID;
                    const ehModelo = it.EVENTO === 'MODELO_CONFIRMADO' || it.EVENTO === 'CONFIRMACAO_DESFEITA';
                    return (
                      <button
                        key={it.ID}
                        type="button"
                        onClick={() => setSelecionado((atual) => (atual?.ID === it.ID ? null : it))}
                        aria-pressed={ativo}
                        className="w-full text-left flex gap-3 px-4 py-3 transition-colors"
                        style={{
                          borderBottom: '1px solid var(--border-light)',
                          // A selecao e marcada so pela barra lateral: pintar a
                          // linha inteira competia com a cor dos proprios
                          // eventos e sujava a leitura da lista.
                          borderLeft: `3px solid ${ativo ? 'var(--color-primary)' : 'transparent'}`,
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ''; }}
                      >
                        <span className="rounded-full p-1.5 shrink-0 h-fit mt-0.5" style={{ backgroundColor: meta.color + '1f' }}>
                          <Icon size={14} style={{ color: meta.color }} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline gap-2 flex-wrap">
                            <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{it.ALVO}</span>
                            <span className="text-sm" style={{ color: meta.color }}>{meta.label}</span>
                            {!ehModelo && it.STATUS_DE && it.STATUS_PARA && (
                              <span className="text-[11px] inline-flex items-center gap-1" style={{ color: 'var(--color-text-muted)' }}>
                                {statusLabel(it.STATUS_DE)} <ArrowRight size={10} /> {statusLabel(it.STATUS_PARA)}
                              </span>
                            )}
                          </div>
                          <p className="text-xs mt-1 flex items-center gap-1.5 flex-wrap" style={{ color: 'var(--color-text-secondary)' }}>
                            {it.AUTOR && <span>{it.AUTOR}</span>}
                            <span style={{ color: 'var(--color-text-muted)' }}>·</span>
                            <span>{fmtHora(it.CRIADO_EM)}</span>
                            <span style={{ color: 'var(--color-text-muted)' }}>·</span>
                            <span className="inline-flex items-center gap-1" style={{ color: 'var(--color-text-muted)' }}>
                              {it.ORIGEM === 'LINK' ? <Globe size={11} /> : <Monitor size={11} />}
                              {origemLabel(it.ORIGEM)}
                            </span>
                            <span style={{ color: 'var(--color-text-muted)' }}>·</span>
                            <span style={{ color: 'var(--color-text-muted)' }}>{it.CICLO_NOME}</span>
                          </p>
                          {it.COMENTARIO && (
                            <p
                              className="text-xs mt-1.5 flex items-start gap-1.5"
                              style={{ color: 'var(--color-text-secondary)' }}
                            >
                              {!ehModelo && <MessageSquare size={11} className="shrink-0 mt-0.5" style={{ color: 'var(--color-text-muted)' }} />}
                              <span className="truncate">{it.COMENTARIO}</span>
                            </p>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}

          {/* ── Paginação ── */}
          {!loading && total > 0 && (
            <div className="flex items-center justify-between gap-3 px-4 py-3 flex-wrap">
              <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                Mostrando {inicio.toLocaleString('pt-BR')}–{fim.toLocaleString('pt-BR')} de {total.toLocaleString('pt-BR')}
              </span>
              {(page > 0 || temProxima) && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={page === 0}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    className="flex items-center gap-1 text-sm px-2.5 py-1 rounded-lg transition-colors disabled:opacity-40"
                    style={{ color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}
                  >
                    <ChevronLeft size={14} /> Anterior
                  </button>
                  <button
                    type="button"
                    disabled={!temProxima}
                    onClick={() => setPage((p) => p + 1)}
                    className="flex items-center gap-1 text-sm px-2.5 py-1 rounded-lg transition-colors disabled:opacity-40"
                    style={{ color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}
                  >
                    Próxima <ChevronRight size={14} />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Painel lateral — coluna fixa no desktop */}
        {larguraOk && selecionado && (
          <aside
            className="rounded-xl animate-fadeIn sticky"
            style={{
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              boxShadow: 'var(--shadow-card)',
              top: 0,
              maxHeight: 'calc(100vh - 128px)',
              overflow: 'hidden',
            }}
          >
            {painel}
          </aside>
        )}
      </div>

      {/* Painel lateral — gaveta sobreposta abaixo de 1024px */}
      {!larguraOk && selecionado && (
        <>
          <div
            className="fixed inset-0 z-40 animate-fadeIn"
            style={{ backgroundColor: 'var(--overlay)' }}
            onClick={() => setSelecionado(null)}
          />
          <aside
            className="fixed top-0 bottom-0 right-0 z-50 chat-aware-drawer animate-slideIn"
            style={{
              width: 'min(420px, 100vw)',
              backgroundColor: 'var(--color-surface)',
              borderLeft: '1px solid var(--color-border)',
            }}
          >
            {painel}
          </aside>
        </>
      )}

      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  );
}
