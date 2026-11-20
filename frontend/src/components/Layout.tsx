import { useState, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, CalendarRange,
  BarChart3, ClipboardCheck,
  UserCheck, ChevronsLeft, ChevronsRight, ListTree, ChevronDown,
  Users, Database, Package, FileBarChart, Receipt,
  MessageCircle, ScrollText, Sparkles,
  BrainCircuit, Eye, Layers, Wallet, ShieldCheck,
} from 'lucide-react';
import { openChatMitra, closeChatMitra } from 'mitra-interactions-sdk';

interface NavItem {
  divider?: boolean;
  label: string;
  path?: string;
  icon?: any;
  badge?: number;
}

const navItems: NavItem[] = [
  { divider: true, label: 'Visão', icon: Eye },
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/workflow', label: 'Workflow', icon: ClipboardCheck },
  { path: '/dre', label: 'DRE Mensal', icon: BarChart3 },
  { path: '/playground', label: 'Playground', icon: Sparkles },
  { divider: true, label: 'Planejamento', icon: Layers },
  { path: '/versoes', label: 'Versões do Orçamento', icon: CalendarRange },
  { path: '/regras-contabeis', label: 'Mapeamento', icon: Package },
  { path: '/premissas', label: 'Premissas Gerais', icon: Receipt },
  { path: '/folha', label: 'Premissas Folha', icon: Users },
  { path: '/dre-config', label: 'Config DRE', icon: ListTree },
  { divider: true, label: 'Base Financeira', icon: Wallet },
  { path: '/resultado-contabil', label: 'Resultado Contábil', icon: FileBarChart },
  { path: '/dados-integracao', label: 'Cadastros', icon: Database },
  { divider: true, label: 'Governança', icon: ShieldCheck },
  { path: '/gestores', label: 'Gestores', icon: UserCheck },
  { path: '/auditoria', label: 'Auditoria', icon: ScrollText },
  { path: '/governanca-ia', label: 'Governança de IA', icon: BrainCircuit },
];

const COLLAPSED_KEY = 'sidebar-collapsed';
// Seções recolhidas da sidebar, por label ("Visão", "Planejamento", ...).
// Ausente = expandida (estado inicial de todas).
const SECTIONS_KEY = 'sidebar-secoes-recolhidas';

function BadgePill({ count }: { count: number }) {
  const label = count > 99 ? '99+' : String(count);
  return (
    <span
      className="ml-auto inline-flex items-center justify-center rounded-full text-white text-[10px] font-semibold"
      style={{ backgroundColor: 'var(--color-primary)', minWidth: 18, padding: '1px 6px' }}
    >
      {label}
    </span>
  );
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem(COLLAPSED_KEY) === '1'; } catch { return false; }
  });
  // Seções da sidebar que o usuário recolheu (todas iniciam expandidas).
  const [secoesRecolhidas, setSecoesRecolhidas] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem(SECTIONS_KEY) || '{}'); } catch { return {}; }
  });
  function toggleSecao(label: string) {
    setSecoesRecolhidas((prev) => {
      const next = { ...prev, [label]: !prev[label] };
      try { localStorage.setItem(SECTIONS_KEY, JSON.stringify(next)); } catch { /* sem persistencia, segue em memoria */ }
      return next;
    });
  }
  const [chatOpen, setChatOpen] = useState(false);
  // Largura reservada pra empurrar o conteudo do main pra esquerda quando
  // o chat abre. Medida do sidebar real + 32px (margin de 16px de cada
  // lado que o popup arredondado tem). Atualizado pela mesma deteccao
  // que aplica .mitra-chat-detected.
  const [chatPush, setChatPush] = useState(0);

  // Expoe estado do chat no <body> pra que drawers/modais possam
  // recuar pra esquerda do chat via CSS (body[data-chat-open=true]
  // .chat-aware-drawer { right: calc(var(--chat-push)...) }).
  useEffect(() => {
    document.body.setAttribute('data-chat-open', chatOpen ? 'true' : 'false');
    document.body.style.setProperty('--chat-push', `${chatPush}px`);
    return () => {
      document.body.setAttribute('data-chat-open', 'false');
      document.body.style.removeProperty('--chat-push');
    };
  }, [chatOpen, chatPush]);

  // Polling pra detectar quando o chat fecha pelo X interno do sidebar —
  // sem isso o FAB ficaria escondido apos o chat fechar externamente.
  useEffect(() => {
    const id = setInterval(() => {
      const chat = (window as any).__mitraChat;
      if (!chat) return;
      const ext = typeof chat.isOpen === 'boolean'
        ? chat.isOpen
        : typeof chat.open === 'boolean'
          ? chat.open
          : null;
      if (ext === null) return;
      setChatOpen(prev => (prev !== ext ? ext : prev));
    }, 400);
    return () => clearInterval(id);
  }, []);

  // Detecta o sidebar real do chat IA por geometria (position:fixed +
  // ancorado a direita + altura quase total) e marca com a classe
  // .mitra-chat-detected pra que o CSS em index.css aplique o look
  // popup arredondado mesmo quando a plataforma usa id/class genericos
  // que nao batem com os seletores defensivos. Roda enquanto o chat
  // estiver aberto pra cobrir re-render do widget.
  useEffect(() => {
    if (!chatOpen) {
      setChatPush(0);
      return;
    }
    const MARK = 'mitra-chat-detected';
    function findAndMark() {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let maxWidth = 0;
      document.querySelectorAll('body iframe, body div, body aside, body section')
        .forEach((node) => {
          const el = node as HTMLElement;
          if (el.closest('.chat-trigger')) return;
          // Drawers do app (.chat-aware-drawer) tambem sao fixed altura-
          // cheia ancorados a direita — ignorar pra nao ganhar o estilo
          // de popup-chat por engano.
          if (el.classList.contains('chat-aware-drawer')) return;
          if (el.closest('.chat-aware-drawer')) return;
          const cs = getComputedStyle(el);
          if (cs.position !== 'fixed') return;
          if (cs.display === 'none' || cs.visibility === 'hidden') return;
          if (parseFloat(cs.opacity || '1') < 0.1) return;
          const r = el.getBoundingClientRect();
          // Teto de largura: 60% da viewport, mas nunca menor que a largura
          // que o proprio CSS forca no popup (--chat-popup-width + margem).
          // Sem isso, em tela estreita o chat ja alargado seria descartado na
          // proxima varredura e o push dos drawers parava de atualizar.
          const tetoLargura = Math.max(vw * 0.6, 520);
          if (r.width < 280 || r.width > tetoLargura) return;
          if (r.height < vh * 0.6) return;
          if (vw - r.right > 40) return;
          el.classList.add(MARK);
          // Distancia do chat ate a borda direita da viewport. O popup tem
          // margin: 16px no CSS, entao queremos empurrar = r.width + margin
          // a direita do chat (vw - r.right + r.width).
          const push = vw - r.left;
          if (push > maxWidth) maxWidth = push;
        });
      if (maxWidth > 0) {
        setChatPush(prev => (Math.abs(prev - maxWidth) > 1 ? maxWidth : prev));
      }
    }
    findAndMark();
    const id = setInterval(findAndMark, 400);
    return () => {
      clearInterval(id);
      document.querySelectorAll('.' + MARK).forEach((el) => el.classList.remove(MARK));
    };
  }, [chatOpen]);

  function toggleChat() {
    if (chatOpen) {
      closeChatMitra();
      setChatOpen(false);
    } else {
      openChatMitra();
      setChatOpen(true);
    }
  }

  useEffect(() => {
    try { localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0'); } catch {}
  }, [collapsed]);

  const visibleNavItems = navItems;
  const location = useLocation();
  const isPlaygroundStudy = /^\/playground\/\d+\/?$/.test(location.pathname);
  // Caminhos que devem reaproveitar a marcação de outro item da nav
  // (ex: /preenchimento abre um CR/pacote vindo do Workflow → Workflow continua ativo)
  const navAlias: Record<string, string> = { '/preenchimento': '/workflow' };
  const aliasedPath = navAlias[location.pathname] || location.pathname;
  // Group items into sections for proper gap control (sidebar) e
  // pra separar links diretos de dropdowns (topbar do gestor)
  const sections: NavItem[][] = [];
  let current: NavItem[] = [];
  for (const item of visibleNavItems) {
    if ('divider' in item && item.divider) {
      if (current.length > 0) sections.push(current);
      current = [item];
    } else {
      current.push(item);
    }
  }
  if (current.length > 0) sections.push(current);

  // ============ Casca do app — sidebar lateral ============
  const asideWidth = collapsed ? 68 : 240;

  return (
    <div
      className="h-screen"
      style={{
        backgroundColor: 'var(--bg-app)',
        // Grid com minmax(0, 1fr) na coluna do conteudo: isso eh o
        // padrao CSS pra impedir 'blow-out' — a coluna NUNCA cresce com
        // o min-content dos filhos (tabelas wide, SVG fixo, etc.), o
        // que o flex com min-width:0 NAO estava conseguindo segurar.
        display: 'grid',
        gridTemplateColumns: `${asideWidth}px minmax(0, 1fr)`,
      }}
    >
      <aside
        className="sticky top-0 z-50 shrink-0 h-screen flex flex-col relative transition-all duration-200"
        style={{
          width: collapsed ? 68 : 240,
          backgroundColor: 'var(--color-nav)',
          borderRight: '1px solid var(--color-border)',
        }}
      >
        {/* Toggle button */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="absolute z-10 flex items-center justify-center transition-colors"
          style={{
            right: -12, top: 28, width: 24, height: 24, borderRadius: '50%',
            border: '1px solid var(--color-border)',
            backgroundColor: 'var(--color-surface)',
            color: 'var(--color-text-secondary)',
            boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'var(--color-primary-bg)';
            e.currentTarget.style.color = 'var(--color-primary)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'var(--color-surface)';
            e.currentTarget.style.color = 'var(--color-text-secondary)';
          }}
          title={collapsed ? 'Expandir menu' : 'Retrair menu'}
        >
          {collapsed ? <ChevronsRight size={12} /> : <ChevronsLeft size={12} />}
        </button>

        {/* Navigation */}
        <nav className={`flex-1 overflow-y-auto scroll-hidden flex flex-col pt-5 pb-4 ${collapsed ? 'px-2 items-center' : 'px-3'}`} style={{ gap: collapsed ? 4 : 0 }}>
          {sections.map((section, si) => {
            const divider = section[0]?.divider ? section[0] : null;
            const items = divider ? section.slice(1) : section;
            // Só faz sentido recolher quando o cabeçalho está visível (sidebar
            // expandida). No modo ícones os itens aparecem sempre.
            const recolhida = !collapsed && !!divider && !!secoesRecolhidas[divider.label];

            return (
              <div key={si} className="flex flex-col" style={{ gap: collapsed ? 4 : 1 }}>
                {divider && (
                  collapsed ? null : (
                    <button
                      type="button"
                      onClick={() => toggleSecao(divider.label)}
                      aria-expanded={!recolhida}
                      title={recolhida ? `Expandir ${divider.label}` : `Recolher ${divider.label}`}
                      className="w-full flex items-center gap-2 font-medium uppercase cursor-pointer"
                      style={{
                        fontSize: 10,
                        fontWeight: 500,
                        letterSpacing: '0.08em',
                        color: 'var(--color-menu-secao)',
                        paddingTop: si === 0 ? 0 : 22,
                        paddingBottom: 6,
                        paddingLeft: 10,
                        paddingRight: 12,
                        background: 'transparent',
                      }}
                    >
                      {divider.icon && <divider.icon size={13} strokeWidth={1.5} className="shrink-0" style={{ opacity: 0.75 }} />}
                      <span className="flex-1 text-left">{divider.label}</span>
                      <ChevronDown
                        size={12}
                        className="shrink-0 transition-transform duration-200"
                        style={{ transform: recolhida ? 'rotate(-90deg)' : 'none' }}
                      />
                    </button>
                  )
                )}
                {/* Linha-guia continua a esquerda das telas da secao (so no menu expandido). */}
                <div
                  className="flex flex-col"
                  style={!collapsed && !recolhida && items.length > 0
                    ? { gap: 1, marginLeft: 16, borderLeft: '1px solid var(--dash-dre-sub-border)' }
                    : { gap: collapsed ? 4 : 1 }}
                >
                {!recolhida && items.map((item) => {
                  const Icon = item.icon!;
                  // Considera tambem caminhos com alias (ex: /preenchimento -> /workflow)
                  const aliasActive = item.path === aliasedPath;
                  return (
                    <NavLink
                      key={item.path}
                      to={item.path!}
                      end={item.path === '/'}
                      title={collapsed ? item.label : undefined}
                      className={`flex items-center transition-colors duration-150 ${
                        collapsed ? 'justify-center w-10 h-10' : 'pr-3'
                      }`}
                      style={({ isActive }) => ({
                        fontSize: 12,
                        fontWeight: (isActive || aliasActive) ? 500 : 400,
                        // Cantos esquerdos retos: o realce do item ativo encosta na
                        // linha-guia da secao. No modo icones, quadrado 40x40 com raio 8.
                        borderRadius: collapsed ? 8 : '0 8px 8px 0',
                        backgroundColor: (isActive || aliasActive) ? 'var(--color-primary-bg)' : 'transparent',
                        color: (isActive || aliasActive) ? 'var(--color-primary)' : 'var(--color-menu-item)',
                        paddingTop: collapsed ? undefined : 7,
                        paddingBottom: collapsed ? undefined : 7,
                        // Indentacao fixa: as telas ficam recuadas em relacao ao rotulo da secao,
                        // inclusive quando selecionadas (o destaque e so o fundo).
                        paddingLeft: collapsed ? undefined : 11,
                      })}
                      onMouseEnter={(e) => {
                        const active = e.currentTarget.getAttribute('aria-current') === 'page' || aliasActive;
                        if (!active) {
                          e.currentTarget.style.backgroundColor = 'var(--color-hover)';
                          e.currentTarget.style.color = 'var(--color-menu-item-hover)';
                        }
                      }}
                      onMouseLeave={(e) => {
                        const active = e.currentTarget.getAttribute('aria-current') === 'page' || aliasActive;
                        if (!active) {
                          e.currentTarget.style.backgroundColor = 'transparent';
                          e.currentTarget.style.color = 'var(--color-menu-item)';
                        }
                      }}
                    >
                      {collapsed && <Icon size={16} strokeWidth={1.8} />}
                      {!collapsed && <span className="truncate">{item.label}</span>}
                      {!collapsed && item.badge != null && item.badge > 0 && <BadgePill count={item.badge} />}
                    </NavLink>
                  );
                })}
                </div>
              </div>
            );
          })}
        </nav>
      </aside>

      {/* Wrapper block (NAO flex) — em flex-col com 1 filho, o flex-item
          tem comportamento de stretch que pode ser puxado por min-content
          de descendentes (tabela sem wrapper, SVG fixo, pre sem wrap).
          Bloco simples: main vira block normal, width 100% do parent =
          grid track (minmax(0,1fr)). overflow:auto interno cria scroll
          horizontal pra filhos wider. */}
      <div
        className="relative overflow-hidden transition-[margin] duration-200 ease-out"
        style={{ marginRight: chatPush, minWidth: 0, height: '100vh' }}
      >
        <main
          className="p-8 scroll-hidden"
          style={{
            width: '100%',
            height: '100%',
            overflow: 'auto',
            minWidth: 0,
          }}
        >
          {children}
        </main>
      </div>

      <ChatFAB open={chatOpen} onToggle={toggleChat} avoidComposer={isPlaygroundStudy} />
    </div>
  );
}

function ChatFAB({ open, onToggle, avoidComposer }: { open: boolean; onToggle: () => void; avoidComposer?: boolean }) {
  return (
    <button
      onClick={onToggle}
      title="Pergunte ao Mitra"
      aria-label="Pergunte ao Mitra"
      aria-hidden={open}
      tabIndex={open ? -1 : 0}
      className={`chat-trigger${avoidComposer ? ' chat-trigger--playground' : ''}`}
    >
      <MessageCircle size={24} strokeWidth={2.2} />
    </button>
  );
}
