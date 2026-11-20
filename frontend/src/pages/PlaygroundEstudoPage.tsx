// ──────────────────────────────────────────────────────────────────────
// PlaygroundEstudoPage — um estudo: CANVAS HTML (análise visual) + CHAT
// com o agente analista, lado a lado em painel redimensionável.
//
// A página externa só carrega o estudo; o EstudoView interno monta o chat
// já com TASK_ID/CONVERSA em mãos — abrir a sessão NO MOUNT é o que faz o
// F5 reconectar a thread em vez de mostrar chat vazio.
// ──────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import {
  ArrowLeft, Share2, Pencil, Check, X, Send, Square,
  Sparkles, Copy, KeyRound, ChevronLeft, ChevronRight, AlertTriangle,
  Building2, User, Loader2, RefreshCcw,
} from 'lucide-react';
import Button from '../components/ui/Button';
import Modal from '../components/ui/Modal';
import PainelCredenciaisIA from '../components/PainelCredenciaisIA';
import { ToastContainer } from '../components/ui/Toast';
import Tooltip from '../components/ui/Tooltip';
import { useToast } from '../hooks/useToast';
import { usePlaygroundChat } from '../hooks/usePlaygroundChat';
import {
  pgGet, pgRenomear, pgCompartilhar,
  mdToHtml, fmtDataHora, tituloErroCredencial, tituloErroPlataforma,
  TITULO_DEMO_SEM_COMPARTILHADA,
} from '../lib/playground';

// Tipos locais (verbatimModuleSyntax — não importar interfaces de outros arquivos)
type OrigemCredencial = 'usuario' | 'empresa';
type CredStatus = 'verificando' | 'usuario' | 'empresa' | 'nenhuma';
type ToolItem = { label: string; count: number; done: boolean };
type Segment =
  | { t: 'md'; c: string }
  | { t: 'tool'; label: string; done?: boolean }          // legado (conversas antigas)
  | { t: 'tools'; items: ToolItem[] }
  | { t: 'erro'; c: string; cred?: 'sem' | 'falhou'; org?: OrigemCredencial; plataforma?: boolean; demo?: boolean };
type ChatMsg = { role: 'user' | 'agent'; segments: Segment[] };
interface Estudo {
  ID: number; NOME: string; HTML?: string; TASK_ID?: string;
  SHARE_TOKEN?: string; CONVERSA?: string; ATUALIZADO_EM?: string;
}

// Perguntas de partida — o chat vazio nao ajuda ninguem a comecar, e digitar
// a primeira pergunta do zero e justamente o momento de maior atrito.
const SUGESTOES = [
  'Compare orçado x realizado por centro de resultado',
  'Quais contas mais cresceram em relação ao ano anterior?',
  'Mostre a evolução mensal das despesas com pessoal',
];

// Indicador de trabalho: três pontinhos + uma palavra de status que gira.
// Substitui os chips de ferramenta ("Bash 6", "ToolSearch 4") — aquilo era o
// diário interno do agente vazando na tela: poluía e não dizia nada útil.
// O que o usuário precisa saber é UMA coisa: "ainda estou aqui, trabalhando".
const STATUS_TRABALHO = ['Analisando', 'Consultando os dados', 'Executando', 'Cruzando os números', 'Montando a análise'];

function WorkingIndicator() {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setIdx((v) => (v + 1) % STATUS_TRABALHO.length), 3000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="flex items-center gap-2 px-1 py-1 animate-fadeIn">
      <span className="pg-think-dot" style={{ animationDelay: '0ms' }} />
      <span className="pg-think-dot" style={{ animationDelay: '150ms' }} />
      <span className="pg-think-dot" style={{ animationDelay: '300ms' }} />
      <span key={idx} className="text-xs animate-fadeIn" style={{ color: 'var(--color-text-muted)' }}>
        {STATUS_TRABALHO[idx]}…
      </span>
    </div>
  );
}

// Rotulo SEMPRE visivel de qual credencial esta rodando o estudo. Antes isso
// so aparecia quando dava erro — e um icone de chave de 13px a 60% de opacidade
// era a unica porta de entrada. Quem usava a credencial da empresa nao tinha
// como saber disso, e quem nao tinha nenhuma so descobria ao ver a resposta
// falhar, o que parece defeito do sistema.
const CRED_INFO: Record<CredStatus, { texto: string; dica: string }> = {
  verificando: { texto: 'Verificando…', dica: 'Descobrindo qual credencial de IA está disponível para você' },
  usuario: { texto: 'Sua credencial', dica: 'O analista está usando a credencial da sua conta. Clique para trocar ou remover.' },
  empresa: { texto: 'Credencial da empresa', dica: 'O analista está usando a credencial compartilhada da empresa — ela tem prioridade sobre credenciais pessoais. Clique para ver os detalhes.' },
  nenhuma: { texto: 'Credencial de IA', dica: 'Não consegui confirmar qual credencial está disponível — pergunte normalmente; se o analista não responder, clique para conectar a sua conta' },
};

// Nunca em vermelho: não conseguir CONFIRMAR a credencial não é falha — a
// plataforma pode atender o usuário por um caminho que o app não enxerga.
// Pintar de alerta quem está prestes a ser atendido é alarme falso.
function CredChip({ status, onClick }: { status: CredStatus; onClick: () => void }) {
  const info = CRED_INFO[status];
  return (
    <Tooltip content={info.dica} side="bottom">
      <button
        onClick={onClick}
        className="ml-auto inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] font-medium transition-colors"
        style={{
          borderColor: 'var(--color-border)',
          color: 'var(--color-text-secondary)',
          backgroundColor: 'var(--color-surface)',
        }}
        aria-label={info.dica}
      >
        {status === 'verificando' && <Loader2 size={11} className="animate-spin" />}
        {status === 'usuario' && <User size={11} />}
        {status === 'empresa' && <Building2 size={11} />}
        {status === 'nenhuma' && <KeyRound size={11} />}
        <span>{info.texto}</span>
      </button>
    </Tooltip>
  );
}

function SegmentView({ seg, onConectar, onRenovar }: { seg: Segment; onConectar: () => void; onRenovar: () => void }) {
  // Ferramentas NÃO aparecem no chat (nem ao vivo, nem no histórico). Elas
  // continuam registradas nos segmentos — a lógica de fim de turno e a
  // persistência dependem delas — mas a tela mostra só a conversa. Quem diz
  // "estou trabalhando" é o WorkingIndicator, não uma coluna de chips.
  if (seg.t === 'tools' || seg.t === 'tool') return null;
  if (seg.t === 'erro') {
    return (
      <div className="pg-erro-card animate-fadeIn">
        <div className="flex items-start gap-2">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" style={{ color: 'var(--semantic-danger, #dc2626)' }} />
          <div className="min-w-0">
            <p className="text-[13px] font-semibold" style={{ color: 'var(--color-text)' }}>
              {seg.demo ? TITULO_DEMO_SEM_COMPARTILHADA
                : seg.plataforma ? tituloErroPlataforma()
                : seg.cred ? tituloErroCredencial(seg.cred, seg.org)
                : 'A busca não foi concluída'}
            </p>
            <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>{seg.c}</p>
            {/* Sem identidade propria o botao NAO oferece "conectar a sua
                conta" (as credenciais pessoais dali sao de quem publicou a
                aplicacao) — leva ao painel, onde fica o identificador da
                conexao compartilhada, que e a unica saida deste estado. */}
            {seg.demo ? (
              <div className="flex flex-wrap items-center gap-3 mt-2.5">
                <button onClick={onConectar} className="pg-erro-acao">
                  <KeyRound size={12} /> Abrir credenciais de IA
                </button>
              </div>
            ) : seg.plataforma ? (
              <div className="flex flex-wrap items-center gap-3 mt-2.5">
                <button onClick={onRenovar} className="pg-erro-acao">
                  <RefreshCcw size={12} /> Renovar a sessão do analista
                </button>
              </div>
            ) : seg.cred && (
              <div className="flex flex-wrap items-center gap-3 mt-2.5">
                <button onClick={onConectar} className="pg-erro-acao">
                  <KeyRound size={12} /> {seg.cred === 'sem' ? 'Conectar credencial' : seg.org === 'empresa' ? 'Conectar a minha conta' : 'Rever credenciais'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }
  return <div className="pg-md" dangerouslySetInnerHTML={{ __html: mdToHtml(seg.c) }} />;
}

// ── View interna — monta o chat já com o estudo carregado ───────────────
function EstudoView({ inicial }: { inicial: Estudo }) {
  const estudoId = inicial.ID;
  const { toasts, addToast, removeToast } = useToast();

  const [nome, setNome] = useState(inicial.NOME);
  const [shareToken, setShareToken] = useState(inicial.SHARE_TOKEN || '');
  const [atualizadoEm, setAtualizadoEm] = useState(inicial.ATUALIZADO_EM || '');
  const [html, setHtml] = useState(inicial.HTML || '');
  const [htmlKey, setHtmlKey] = useState(1);
  const [canvasVivo, setCanvasVivo] = useState<'vazio' | 'trabalhando' | 'atualizado'>(inicial.HTML ? 'atualizado' : 'vazio');

  const [editandoNome, setEditandoNome] = useState(false);
  const [nomeDraft, setNomeDraft] = useState('');
  const [salvandoNome, setSalvandoNome] = useState(false);

  const [shareOpen, setShareOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState('');
  const [shareCopied, setShareCopied] = useState(false);

  const [input, setInput] = useState('');
  const [chatAberto, setChatAberto] = useState(true);
  const [chatWidth, setChatWidth] = useState(400);
  const [redimensionando, setRedimensionando] = useState(false);
  const splitRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const htmlRef = useRef(html);
  htmlRef.current = html;

  // recarrega nome + HTML do banco (pós salvar_html / renomear do agente)
  const reloadCanvas = useCallback(async () => {
    try {
      const e = await pgGet(estudoId);
      if (!e) return;
      setNome(e.NOME);
      setShareToken(e.SHARE_TOKEN || '');
      setAtualizadoEm(e.ATUALIZADO_EM || '');
      if (e.HTML && e.HTML !== htmlRef.current) {
        setHtml(e.HTML);
        setHtmlKey((k) => k + 1);
        setCanvasVivo('atualizado');
      }
    } catch { /* leitura em background */ }
  }, [estudoId]);

  // Fim de turno recarrega em RAJADA, não uma vez só. O evento de fim pode
  // chegar ANTES de o HTML terminar de gravar no banco (a SF de salvar roda em
  // paralelo ao encerramento) — uma única releitura imediata pegava a versão
  // velha e parava por aí: a análise pronta só aparecia saindo e voltando.
  // `reloadCanvas` só troca a tela quando o HTML mudou, então as releituras
  // extras custam leituras baratas e nenhum piscar.
  const posTurnoTimers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const recarregarPosTurno = useCallback(() => {
    posTurnoTimers.current.forEach(clearTimeout);
    posTurnoTimers.current = [0, 1500, 4000, 8000].map((ms) =>
      setTimeout(() => { void reloadCanvas(); }, ms));
  }, [reloadCanvas]);

  const chat = usePlaygroundChat({
    estudoId,
    taskId: inicial.TASK_ID || null,
    conversaInicial: inicial.CONVERSA || null,
    onTelaSalva: () => {
      setCanvasVivo('trabalhando');
      // o evento tool dispara no INÍCIO da chamada — o HTML chega ao banco ~2,5s depois
      if (reloadTimer.current) clearTimeout(reloadTimer.current);
      reloadTimer.current = setTimeout(() => { void reloadCanvas(); }, 2500);
    },
    onRenomeado: () => {
      if (reloadTimer.current) clearTimeout(reloadTimer.current);
      reloadTimer.current = setTimeout(() => { void reloadCanvas(); }, 2500);
    },
    onTurnEnd: recarregarPosTurno,
  });

  useEffect(() => () => {
    if (reloadTimer.current) clearTimeout(reloadTimer.current);
    posTurnoTimers.current.forEach(clearTimeout);
  }, []);

  // Rede de segurança do canvas: enquanto o analista trabalha, relê o estudo a
  // cada 5s em vez de depender só dos eventos da sessão. Se o evento de fim de
  // turno não chegar (conexão caída, aba dormindo), a tela pronta aparece
  // assim mesmo — em vez de ficar a versão velha na frente do usuário.
  // `reloadCanvas` só troca o HTML quando ele mudou de verdade, então o custo
  // é uma leitura barata e nenhum piscar de tela.
  useEffect(() => {
    if (chat.status === 'idle') return;
    const t = setInterval(() => { void reloadCanvas(); }, 5000);
    return () => clearInterval(t);
  }, [chat.status, reloadCanvas]);

  useEffect(() => {
    if (!redimensionando) return;
    const previousCursor = document.body.style.cursor;
    const previousSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    function onPointerMove(event: PointerEvent) {
      const rect = splitRef.current?.getBoundingClientRect();
      if (!rect) return;
      const maxWidth = Math.max(280, Math.min(640, rect.width - 360));
      const minWidth = Math.min(320, maxWidth);
      setChatWidth(Math.min(maxWidth, Math.max(minWidth, rect.right - event.clientX)));
    }

    function stopResize() { setRedimensionando(false); }
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', stopResize, { once: true });
    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousSelect;
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', stopResize);
    };
  }, [redimensionando]);

  // autoscroll do chat
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.msgs, chat.status]);

  async function salvarNome() {
    const n = nomeDraft.trim();
    if (!n) { setEditandoNome(false); return; }
    setSalvandoNome(true);
    try {
      await pgRenomear(estudoId, n);
      setNome(n);
      setEditandoNome(false);
    } catch {
      addToast('error', 'Não consegui renomear o estudo');
    } finally {
      setSalvandoNome(false);
    }
  }

  // Copia com fallback: navigator.clipboard é bloqueado quando o app roda
  // dentro de iframe (preview do portal) — cai no execCommand('copy').
  async function copiarTexto(txt: string): Promise<boolean> {
    try { await navigator.clipboard.writeText(txt); return true; } catch { /* sem permissão no iframe */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = txt;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch { return false; }
  }

  async function compartilhar() {
    // 1. garante o token (persistido no estudo) — falha aqui é falha real
    let token = shareToken;
    if (!token) {
      try {
        token = await pgCompartilhar(estudoId);
        setShareToken(token);
      } catch {
        addToast('error', 'Não consegui gerar o link de compartilhamento');
        return;
      }
    }
    // 2. SEMPRE mostra o link no modal — a cópia automática é bônus, não
    // condição (clipboard pode estar bloqueado e o usuário precisa do link)
    const url = `${window.location.origin}/estudo/${token}`;
    setShareUrl(url);
    setShareCopied(await copiarTexto(url));
    setShareOpen(true);
  }

  async function copiarLinkDoModal() {
    const ok = await copiarTexto(shareUrl);
    setShareCopied(ok);
    if (!ok) addToast('error', 'Cópia bloqueada pelo navegador — selecione o link e use Ctrl+C');
  }

  function enviarTexto(texto: string) {
    const t = texto.trim();
    if (!t || chat.status !== 'idle') return;
    setInput('');
    void chat.send(t);
  }

  function enviar() { enviarTexto(input); }

  // Enquanto o analista trabalha, o indicador fica SEMPRE visível — é ele
  // (e só ele) que diz "a execução continua", do primeiro ao último segundo.
  const trabalhando = chat.status !== 'idle';

  const statusPill = useMemo(() => {
    if (chat.status !== 'idle') return { txt: 'Analista trabalhando…', vivo: true };
    if (canvasVivo === 'atualizado') return { txt: 'Atualizado ' + fmtDataHora(atualizadoEm), vivo: false };
    return { txt: 'Aguardando a primeira análise', vivo: false };
  }, [chat.status, canvasVivo, atualizadoEm]);

  return (
    <div className="flex flex-col animate-fadeIn" style={{ height: 'calc(100vh - 32px)', padding: '16px 20px 12px' }}>
      {/* header */}
      <div className="flex items-center gap-3 mb-3">
        <Link to="/playground" className="p-1.5 rounded-lg border hover:opacity-80 transition-opacity" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
          <ArrowLeft size={16} style={{ color: 'var(--color-text-secondary)' }} />
        </Link>
        {editandoNome ? (
          <div className="flex items-center gap-1.5">
            <input
              autoFocus
              value={nomeDraft}
              onChange={(e) => setNomeDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void salvarNome(); if (e.key === 'Escape') setEditandoNome(false); }}
              className="rounded-lg border px-3 py-1 text-base font-semibold outline-none focus:ring-2"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)', backgroundColor: 'var(--color-surface)', minWidth: 280 }}
            />
            <button onClick={() => void salvarNome()} disabled={salvandoNome} className="p-1.5 rounded-lg hover:opacity-80" style={{ color: 'var(--color-primary)' }}>
              {salvandoNome ? <span className="pg-spinner" /> : <Check size={16} />}
            </button>
            <button onClick={() => setEditandoNome(false)} className="p-1.5 rounded-lg hover:opacity-80" style={{ color: 'var(--color-text-muted)' }}><X size={16} /></button>
          </div>
        ) : (
          <button
            className="group flex items-center gap-2 text-left"
            onClick={() => { setNomeDraft(nome); setEditandoNome(true); }}
            title="Renomear estudo"
          >
            <h1 className="text-lg font-bold" style={{ color: 'var(--text-heading)' }}>{nome}</h1>
            <Pencil size={13} className="opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: 'var(--color-text-muted)' }} />
          </button>
        )}
        <div className="ml-auto flex items-center gap-3">
          {/* Status do canvas vive aqui: a barra cinza que ficava em cima do
              canvas so servia de moldura e roubava altura da analise. */}
          <span className="flex items-center gap-1.5 text-[11px]" style={{ color: statusPill.vivo ? 'var(--color-primary)' : 'var(--color-text-muted)' }}>
            {statusPill.vivo && <span className="pg-spinner" />}
            {statusPill.txt}
          </span>
          <Button variant="secondary" size="sm" onClick={() => void compartilhar()}>
            <Share2 size={13} className="mr-1 inline" /> Compartilhar
          </Button>
        </div>
      </div>

      {/* canvas + painel lateral redimensionável */}
      <div ref={splitRef} className="relative flex flex-1 min-h-0 min-w-0">
        {/* ── CANVAS ── */}
        <div className="flex flex-1 min-w-0 flex-col rounded-xl border overflow-hidden" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)', boxShadow: 'var(--shadow-card)' }}>
          <div className="flex-1 min-h-0 relative" style={{ backgroundColor: '#fff' }}>
            {html ? (
              <iframe
                key={htmlKey}
                sandbox=""
                srcDoc={html}
                title="Análise do estudo"
                className="w-full h-full animate-fadeIn"
                style={{ border: 'none' }}
              />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
                <div className="pg-empty-art">
                  <div className="pg-empty-bar" style={{ height: 46, animationDelay: '0ms' }} />
                  <div className="pg-empty-bar" style={{ height: 72, animationDelay: '120ms' }} />
                  <div className="pg-empty-bar" style={{ height: 34, animationDelay: '240ms' }} />
                  <div className="pg-empty-bar" style={{ height: 58, animationDelay: '360ms' }} />
                </div>
                <div className="text-center">
                  <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>O canvas ainda está em branco</p>
                  <p className="text-xs mt-1 max-w-xs" style={{ color: 'var(--color-text-secondary)' }}>
                    Pergunte algo sobre os dados no chat ao lado — o analista investiga e desenha a análise aqui.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>

        {!chatAberto && (
          <div className="absolute right-0 top-1/2 z-20 -translate-y-1/2 translate-x-1/2 animate-fadeIn">
            <Tooltip content="Reabrir o chat" side="left">
              <button
                onClick={() => setChatAberto(true)}
                className="pg-split-toggle"
                aria-label="Reabrir o chat"
              >
                <ChevronLeft size={15} strokeWidth={2.2} />
              </button>
            </Tooltip>
          </div>
        )}

        {/* ── CHAT ── */}
        {chatAberto && (
          <>
            <div
              className="pg-split-divider relative shrink-0 cursor-col-resize touch-none"
              style={{ width: 16 }}
              role="separator"
              aria-label="Redimensionar chat"
              aria-orientation="vertical"
              onPointerDown={() => setRedimensionando(true)}
            >
              <span className="pg-split-line" />
              <div className="absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2">
                <Tooltip content="Recolher o chat" side="left">
                  <button
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => setChatAberto(false)}
                    className="pg-split-toggle"
                    aria-label="Recolher o chat"
                  >
                    <ChevronRight size={15} strokeWidth={2.2} />
                  </button>
                </Tooltip>
              </div>
            </div>
            <div
              className="flex flex-col rounded-xl border overflow-hidden min-h-0 shrink-0 animate-fadeIn"
              style={{ width: chatWidth, maxWidth: '60%', borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)', boxShadow: 'var(--shadow-card)' }}
            >
              <div className="flex items-center gap-2 px-4 py-2.5 border-b" style={{ borderColor: 'var(--border-light)', backgroundColor: 'var(--color-surface)' }}>
                <Sparkles size={14} style={{ color: 'var(--color-primary)' }} />
                <span className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>Analista</span>
                {/* Diz qual credencial esta valendo E e a porta de entrada do
                    painel — a deteccao automatica de erro pode nao disparar
                    (a mensagem da plataforma varia), entao o caminho manual
                    precisa estar visivel, nao escondido num icone. */}
                <CredChip status={chat.credStatus} onClick={() => chat.setPrecisaCredencial(true)} />
              </div>

              <div ref={scrollRef} className="pg-chat-messages flex-1 min-h-0 overflow-y-auto px-3.5 py-3 flex flex-col gap-3">
                {/* Aviso, não bloqueio: não conseguimos CONFIRMAR uma credencial,
                    mas a plataforma pode ter acesso que o app não enumera. Então
                    o texto convida a perguntar — quem decide é a resposta real. */}
                {chat.msgs.length === 0 && chat.credStatus === 'nenhuma' && (
                  <div className="rounded-xl border p-3 animate-fadeIn" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-primary-bg)' }}>
                    <p className="text-[13px] font-semibold flex items-center gap-1.5" style={{ color: 'var(--color-text)' }}>
                      <KeyRound size={13} style={{ color: 'var(--color-primary)' }} /> Não encontrei uma credencial de IA conectada
                    </p>
                    <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                      Pode ser só o app não enxergar a credencial — pergunte normalmente. Se o analista
                      não responder, conecte a sua conta aqui, ou peça a quem administra para ativar a
                      credencial compartilhada da empresa.
                    </p>
                    <button onClick={() => chat.setPrecisaCredencial(true)} className="pg-erro-acao mt-2">
                      <KeyRound size={12} /> Conectar credencial
                    </button>
                  </div>
                )}
                {chat.msgs.length === 0 && (
                  <div className="mt-6 px-2 animate-fadeIn">
                    <p className="text-sm font-semibold mb-1" style={{ color: 'var(--color-text)' }}>Pergunte sobre os dados</p>
                    <p className="text-xs leading-relaxed mb-3" style={{ color: 'var(--color-text-secondary)' }}>
                      Eu investigo o banco, narro o raciocínio e desenho a análise no canvas.
                      Comece por uma destas ou escreva a sua pergunta.
                    </p>
                    <div className="flex flex-col gap-1.5">
                      {SUGESTOES.map((s) => (
                        <button key={s} onClick={() => enviarTexto(s)} className="pg-sugestao">
                          <Sparkles size={12} className="shrink-0" style={{ color: 'var(--color-primary)' }} />
                          <span>{s}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {chat.msgs.map((m: ChatMsg, i: number) => (
                  m.role === 'user' ? (
                    <div key={i} className="self-end max-w-[85%] rounded-2xl rounded-br-md px-3.5 py-2 text-sm animate-fadeIn"
                      style={{ backgroundColor: 'var(--color-primary)', color: '#fff' }}>
                      {m.segments.map((s, j) => s.t === 'md' ? <span key={j} style={{ whiteSpace: 'pre-wrap' }}>{s.c}</span> : null)}
                    </div>
                  ) : (
                    <div key={i} className="self-start max-w-full w-full flex flex-col gap-1.5">
                      {m.segments.map((s, j) => (
                        <SegmentView
                          key={j}
                          seg={s}
                          onConectar={() => chat.setPrecisaCredencial(true)}
                          onRenovar={() => { void chat.renovarSessao(); addToast('success', 'Sessão renovada — pergunte de novo'); }}
                        />
                      ))}
                    </div>
                  )
                ))}
                {trabalhando && <WorkingIndicator />}
              </div>

              {/* composer */}
              <div className="pg-chat-composer shrink-0 border-t px-3 py-2.5" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
                <div className="flex items-end gap-2">
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); }
                    }}
                    rows={Math.min(4, Math.max(1, input.split('\n').length))}
                    placeholder={chat.status === 'idle' ? 'Pergunte algo sobre os dados…' : 'O analista está trabalhando…'}
                    className="pg-composer-input flex-1 resize-none rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 transition-all"
                    style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' }}
                  />
                  {chat.status === 'idle' ? (
                    <button
                      onClick={enviar}
                      disabled={!input.trim()}
                      className="pg-composer-btn rounded-lg transition-all duration-200 disabled:opacity-40"
                      style={{ backgroundColor: 'var(--color-primary)', color: '#fff' }}
                      title="Enviar (Enter)"
                    >
                      <Send size={15} />
                    </button>
                  ) : (
                    <button
                      onClick={() => void chat.cancel()}
                      className="pg-composer-btn rounded-lg border transition-all duration-200"
                      style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}
                      title="Interromper"
                    >
                      <Square size={15} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* modal de compartilhamento — sempre exibe o link (clipboard pode
          estar bloqueado no iframe do portal, então a URL fica visível) */}
      <Modal isOpen={shareOpen} onClose={() => setShareOpen(false)} title="Compartilhar estudo" size="sm">
        <p className="text-sm mb-3" style={{ color: 'var(--color-text-secondary)' }}>
          Envie o link abaixo — ele abre a versão atual do canvas, somente leitura.
          Visível apenas para quem tem login nesta base.
        </p>
        <div className="flex items-center gap-2">
          <input
            readOnly
            value={shareUrl}
            onFocus={(e) => e.currentTarget.select()}
            onClick={(e) => e.currentTarget.select()}
            className="flex-1 rounded-lg border px-3 py-2 text-xs font-mono"
            style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--bg-muted)', color: 'var(--color-text)' }}
          />
          <Button variant="secondary" size="sm" onClick={() => void copiarLinkDoModal()}>
            {shareCopied ? <><Check size={13} className="mr-1 inline" /> Copiado</> : <><Copy size={13} className="mr-1 inline" /> Copiar</>}
          </Button>
        </div>
      </Modal>

      {/* Credencial é configuração, não conversa: sai da lista de mensagens
          (onde parecia resposta do analista) e vira modal próprio por cima. */}
      {chat.precisaCredencial && (
        <PainelCredenciaisIA
          status={chat.credStatus}
          onConectado={() => { chat.credencialConectada(); addToast('success', 'Credencial conectada — pergunte de novo'); }}
          onClose={() => chat.setPrecisaCredencial(false)}
        />
      )}

      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  );
}

// ── Página externa — carrega o estudo e monta a view ────────────────────
export default function PlaygroundEstudoPage() {
  const { id } = useParams();
  const estudoId = Number(id);
  const navigate = useNavigate();
  const [estudo, setEstudo] = useState<Estudo | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    let vivo = true;
    setCarregando(true);
    setEstudo(null);
    (async () => {
      try {
        const e = await pgGet(estudoId);
        if (!vivo) return;
        if (!e) { navigate('/playground'); return; }
        setEstudo(e as Estudo);
      } finally {
        if (vivo) setCarregando(false);
      }
    })();
    return () => { vivo = false; };
  }, [estudoId, navigate]);

  if (carregando || !estudo) {
    return (
      <div className="p-6">
        <div className="pg-skeleton h-8 mb-4" style={{ width: 260 }} />
        <div className="pg-skeleton" style={{ height: 'calc(100vh - 160px)' }} />
      </div>
    );
  }

  return <EstudoView key={estudo.ID} inicial={estudo} />;
}
