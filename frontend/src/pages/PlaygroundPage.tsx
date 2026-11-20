// ──────────────────────────────────────────────────────────────────────
// PlaygroundPage — lista de estudos do usuário: criar, abrir, renomear,
// excluir. Cada estudo é um par canvas HTML + chat com o agente analista.
// ──────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, Sparkles, Pencil, Trash2, Share2, MessageCircle, Check, X, LayoutDashboard,
  ShieldAlert, BrainCircuit,
} from 'lucide-react';
import Button from '../components/ui/Button';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import { ToastContainer } from '../components/ui/Toast';
import { useToast } from '../hooks/useToast';
import { getUser } from '../lib/auth';
import { pgCriar, pgListar, pgRenomear, pgExcluir, fmtDataHora, diagnosticarCredencial } from '../lib/playground';

interface Estudo {
  ID: number; NOME: string; SHARE_TOKEN?: string; TASK_ID?: string;
  CRIADO_EM?: string; ATUALIZADO_EM?: string; TEM_HTML?: number;
}

export default function PlaygroundPage() {
  const navigate = useNavigate();
  const { toasts, addToast, removeToast } = useToast();
  const usuario = getUser()?.EMAIL || '';

  const [estudos, setEstudos] = useState<Estudo[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [criando, setCriando] = useState(false);
  const [renomeandoId, setRenomeandoId] = useState<number | null>(null);
  const [nomeDraft, setNomeDraft] = useState('');
  const [salvandoNome, setSalvandoNome] = useState(false);
  const [excluirId, setExcluirId] = useState<number | null>(null);
  const [excluindo, setExcluindo] = useState(false);
  // null enquanto verifica — o aviso so aparece com resposta na mao, senao
  // pisca um alarme falso a cada abertura da tela.
  const [credencial, setCredencial] = useState<{ temCompartilhada: boolean; temPessoal: boolean } | null>(null);
  const ehAdmin = !!getUser();

  const carregar = useCallback(async () => {
    if (!usuario) { setCarregando(false); return; }
    try {
      setEstudos(await pgListar(usuario) as Estudo[]);
    } catch {
      addToast('error', 'Não consegui carregar seus estudos');
    } finally {
      setCarregando(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuario]);

  useEffect(() => { void carregar(); }, [carregar]);

  // Sem credencial compartilhada o estudo nasce e o analista fica mudo — o
  // usuario so descobria depois de criar, escrever a pergunta e esperar. O
  // aviso vem ANTES, aqui na lista, dizendo onde se resolve.
  useEffect(() => {
    let vivo = true;
    void diagnosticarCredencial()
      .then((d) => { if (vivo) setCredencial(d); })
      .catch(() => { /* diagnostico e cortesia: falhou, nao atrapalha a lista */ });
    return () => { vivo = false; };
  }, []);

  async function novoEstudo() {
    if (!usuario) return;
    setCriando(true);
    try {
      const id = await pgCriar(usuario);
      navigate(`/playground/${id}`);
    } catch {
      addToast('error', 'Não consegui criar o estudo');
      setCriando(false);
    }
  }

  async function salvarNome(id: number) {
    const nome = nomeDraft.trim();
    if (!nome) { setRenomeandoId(null); return; }
    setSalvandoNome(true);
    try {
      await pgRenomear(id, nome);
      setEstudos((prev) => prev.map((e) => (e.ID === id ? { ...e, NOME: nome } : e)));
      setRenomeandoId(null);
    } catch {
      addToast('error', 'Não consegui renomear o estudo');
    } finally {
      setSalvandoNome(false);
    }
  }

  async function confirmarExclusao() {
    if (excluirId == null) return;
    setExcluindo(true);
    try {
      await pgExcluir(excluirId);
      setEstudos((prev) => prev.filter((e) => e.ID !== excluirId));
      addToast('success', 'Estudo excluído');
    } catch {
      addToast('error', 'Não consegui excluir o estudo');
    } finally {
      setExcluindo(false);
      setExcluirId(null);
    }
  }

  return (
    <div className="p-6 animate-fadeIn">
      {/* header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: 'var(--color-primary-bg)' }}>
          <Sparkles size={18} style={{ color: 'var(--color-primary)' }} />
        </div>
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-heading)' }}>Playground</h1>
          <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
            Estudos de dados com o agente analista — pergunte, acompanhe a investigação e receba a análise desenhada no canvas
          </p>
        </div>
        <div className="ml-auto">
          <Button onClick={() => void novoEstudo()} disabled={criando}>
            <Plus size={14} className="mr-1 inline" />
            {criando ? 'Criando…' : 'Novo estudo'}
          </Button>
        </div>
      </div>

      {/* Credencial de IA: quem paga o modelo que responde no estudo. Sem a
          compartilhada da empresa, ou o usuario roda na credencial dele (e
          precisa saber disso) ou nao roda em nada. Aviso antes de criar. */}
      {credencial && !credencial.temCompartilhada && (
        <div
          className="mb-5 rounded-xl border p-4 flex items-start gap-3 animate-fadeIn"
          style={{
            borderColor: credencial.temPessoal ? 'var(--color-border)' : 'var(--color-alerta-border)',
            backgroundColor: credencial.temPessoal ? 'var(--color-surface)' : 'var(--color-alerta-bg)',
          }}
        >
          <ShieldAlert
            size={16}
            className="mt-0.5 shrink-0"
            style={{ color: credencial.temPessoal ? 'var(--color-text-muted)' : 'var(--color-alerta-icon)' }}
          />
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold" style={{ color: 'var(--color-text)' }}>
              {credencial.temPessoal
                ? 'Seus estudos vão rodar na credencial da sua conta'
                : 'O analista ainda não tem uma credencial de IA para responder'}
            </p>
            <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
              {credencial.temPessoal
                ? 'A credencial compartilhada da empresa não está ativa, então o custo das análises vai para a sua conta pessoal.'
                : 'Sem credencial, o estudo até é criado, mas o analista não responde. Vale a pena resolver antes de começar.'}
              {' '}
              {ehAdmin
                ? 'Ative a credencial compartilhada em Governança de IA — daí vale para todo mundo, sem ninguém precisar conectar a própria conta.'
                : 'Peça a quem administra o sistema para ativar a credencial compartilhada da empresa, na tela de Governança de IA.'}
            </p>
            {ehAdmin && (
              <div className="mt-3">
                <Button variant="secondary" size="sm" onClick={() => navigate('/governanca-ia')}>
                  <BrainCircuit size={13} className="mr-1 inline" /> Ir para Governança de IA
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* skeleton */}
      {carregando && (
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
          {[0, 1, 2].map((i) => <div key={i} className="pg-skeleton" style={{ height: 148 }} />)}
        </div>
      )}

      {/* estado vazio */}
      {!carregando && estudos.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 animate-fadeIn">
          <div className="pg-empty-art mb-5">
            <div className="pg-empty-bar" style={{ height: 40, animationDelay: '0ms' }} />
            <div className="pg-empty-bar" style={{ height: 64, animationDelay: '120ms' }} />
            <div className="pg-empty-bar" style={{ height: 30, animationDelay: '240ms' }} />
            <div className="pg-empty-bar" style={{ height: 52, animationDelay: '360ms' }} />
          </div>
          <p className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>Nenhum estudo ainda</p>
          <p className="text-sm mt-1 mb-5 max-w-md text-center" style={{ color: 'var(--color-text-secondary)' }}>
            Crie um estudo e pergunte qualquer coisa sobre os dados do orçamento — o analista investiga o banco,
            narra o raciocínio e desenha uma análise visual pra você.
          </p>
          <Button onClick={() => void novoEstudo()} disabled={criando}>
            <Plus size={14} className="mr-1 inline" /> Criar meu primeiro estudo
          </Button>
        </div>
      )}

      {/* cards */}
      {!carregando && estudos.length > 0 && (
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
          {estudos.map((e) => (
            <div
              key={e.ID}
              className="pg-card group rounded-xl border p-5 cursor-pointer"
              style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)', boxShadow: 'var(--shadow-card)' }}
              onClick={() => { if (renomeandoId !== e.ID) navigate(`/playground/${e.ID}`); }}
            >
              <div className="flex items-start gap-2">
                {renomeandoId === e.ID ? (
                  <div className="flex items-center gap-1 flex-1" onClick={(ev) => ev.stopPropagation()}>
                    <input
                      autoFocus
                      value={nomeDraft}
                      onChange={(ev) => setNomeDraft(ev.target.value)}
                      onKeyDown={(ev) => { if (ev.key === 'Enter') void salvarNome(e.ID); if (ev.key === 'Escape') setRenomeandoId(null); }}
                      className="flex-1 rounded-lg border px-2 py-1 text-sm font-semibold outline-none focus:ring-2"
                      style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                    />
                    <button onClick={() => void salvarNome(e.ID)} disabled={salvandoNome} className="p-1 rounded hover:opacity-80" style={{ color: 'var(--color-primary)' }}>
                      {salvandoNome ? <span className="pg-spinner" /> : <Check size={14} />}
                    </button>
                    <button onClick={() => setRenomeandoId(null)} className="p-1 rounded hover:opacity-80" style={{ color: 'var(--color-text-muted)' }}><X size={14} /></button>
                  </div>
                ) : (
                  <h3 className="flex-1 text-sm font-semibold leading-snug" style={{ color: 'var(--color-text)' }}>{e.NOME}</h3>
                )}
                {renomeandoId !== e.ID && (
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(ev) => ev.stopPropagation()}>
                    <button
                      title="Renomear"
                      onClick={() => { setRenomeandoId(e.ID); setNomeDraft(e.NOME); }}
                      className="p-1.5 rounded-lg hover:opacity-70"
                      style={{ color: 'var(--color-text-muted)' }}
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      title="Excluir"
                      onClick={() => setExcluirId(e.ID)}
                      className="p-1.5 rounded-lg hover:opacity-70 text-red-400"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 mt-4">
                {Number(e.TEM_HTML) === 1 && (
                  <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: 'var(--color-primary-bg)', color: 'var(--color-primary)' }}>
                    <LayoutDashboard size={10} /> Com análise
                  </span>
                )}
                {!!e.SHARE_TOKEN && (
                  <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: '#ecfeff', color: '#0891b2' }}>
                    <Share2 size={10} /> Compartilhado
                  </span>
                )}
                {!!e.TASK_ID && Number(e.TEM_HTML) !== 1 && (
                  <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ backgroundColor: 'var(--color-primary-bg)', color: 'var(--color-primary)' }}>
                    <MessageCircle size={10} /> Em conversa
                  </span>
                )}
              </div>

              <p className="text-[11px] mt-3" style={{ color: 'var(--color-text-muted)' }}>
                Atualizado {fmtDataHora(e.ATUALIZADO_EM)}
              </p>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        isOpen={excluirId != null}
        onClose={() => setExcluirId(null)}
        onConfirm={() => void confirmarExclusao()}
        title="Excluir estudo"
        message="O estudo, a conversa e a análise do canvas vão sair da sua lista. Tem certeza?"
        loading={excluindo}
      />
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  );
}
