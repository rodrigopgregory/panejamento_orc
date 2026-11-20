// ──────────────────────────────────────────────────────────────────────
// PainelCredenciaisIA — modal curto para conectar/trocar a credencial de IA.
//
// Antes isso era um card grande renderizado DENTRO da lista de mensagens do
// chat: o conteudo parecia resposta do analista e empurrava a conversa para
// cima. Agora e um modal proprio, por cima da tela — configuracao e assunto
// separado da conversa.
//
// A lista de provedores vem da plataforma (list_providers): target, metodo,
// rotulos e status de conectado sao os de verdade. Chumbar o formulario do
// Claude com paste_code fazia a conexao acontecer sem servir — a impressao
// de "conectei e perdeu".
//
// O modal e curto de proposito: o que vale agora, os provedores, e a regra
// em uma linha. O ajuste da credencial da empresa (so quem administra) fica
// atras de um clique para nao inchar a tela de quem so quer conectar a sua.
// ──────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useState } from 'react';
import { Check, Loader2, Building2, User, AlertCircle, ChevronLeft } from 'lucide-react';
import { manageAgentCredentialMitra } from 'mitra-interactions-sdk';
import Modal from './ui/Modal';
import ConectarCredencialAgente from './ConectarCredencialAgente';
import { lerConnectionIdCompartilhado, gravarConnectionIdCompartilhado, assinaturaModelos } from '../lib/playground';
import { getUser } from '../lib/auth';
import { sessaoRealAtiva } from '../mitra-config';

type Metodo = 'paste_code' | 'device' | 'api_key';
type CredStatus = 'verificando' | 'usuario' | 'empresa' | 'nenhuma';

interface Provider {
  id: string;
  name: string;
  type: string;
  target: string;
  auth: { method: Metodo; keyLabel?: string; keyPlaceholder?: string };
  connected: boolean;
  account?: { email?: string; orgName?: string };
  maskedKey?: string;
}

interface Props {
  onConectado: () => void;
  onClose: () => void;
  status: CredStatus;
}

// Uma frase sobre o que esta valendo AGORA. Sem isso, a pessoa conecta a
// conta sem saber que ja estava funcionando pela credencial da empresa — ou
// espera a da empresa aparecer quando ninguem a configurou.
function resumoStatus(status: CredStatus): { texto: string; tom: 'ok' | 'aviso' } {
  if (status === 'usuario') return { texto: 'Em uso agora: a credencial da sua conta.', tom: 'ok' };
  if (status === 'empresa') return { texto: 'Em uso agora: a credencial compartilhada da empresa. Você não precisa conectar nada.', tom: 'ok' };
  if (status === 'verificando') return { texto: 'Verificando qual credencial está disponível para você…', tom: 'ok' };
  return { texto: 'Nenhuma credencial disponível: conecte a sua conta abaixo, ou peça a quem administra para ativar a da empresa.', tom: 'aviso' };
}

// Assinatura conectavel sem redirect + qualquer API key. O openai_oauth fica
// de fora porque depende de redirect em localhost (a propria SDK documenta).
function conectavel(p: Provider): boolean {
  if (p.auth?.method === 'api_key') return true;
  return p.target === 'claude' || p.target === 'codex';
}

function descricaoConta(p: Provider): string {
  if (p.account?.email) return p.account.email;
  if (p.maskedKey) return p.maskedKey;
  return 'conectado';
}

export default function PainelCredenciaisIA({ onConectado, onClose, status }: Props) {
  const [providers, setProviders] = useState<Provider[] | null>(null);
  const [erro, setErro] = useState('');
  const [alvo, setAlvo] = useState<Provider | null>(null);
  const [removendo, setRemovendo] = useState('');

  // Credencial compartilhada: so quem administra configura, mas TODOS veem o
  // status dela — e o que responde "por que funciona pro meu colega e nao pra mim".
  // `semIdentidade` = nao ha sessao real da plataforma (token valido) para
  // esta pessoa. Sem identidade, credenciais PESSOAIS nao podem ser listadas,
  // conectadas nem removidas daqui — a resposta honesta e' pedir login.
  const semIdentidade = !sessaoRealAtiva();
  // O identificador da connection e CONFIGURACAO DO APP (fica no APP_CONFIG do
  // projeto), nao uma credencial de ninguem — por isso continua editavel por
  // quem administra mesmo sem sessao real. Exigir sessao aqui criava um beco
  // sem saida: sem o identificador o analista bloqueia, e quem poderia
  // preencher estava justamente bloqueado. O que fica proibido sem identidade
  // propria e mexer em credenciais PESSOAIS (abaixo).
  const isAdmin = !!getUser();
  const [connId, setConnId] = useState('');
  const [connIdSalvo, setConnIdSalvo] = useState('');
  const [salvandoConn, setSalvandoConn] = useState(false);
  const [editandoConn, setEditandoConn] = useState(false);

  // Diagnostico: "conectado" (list_providers) e "oferece modelos"
  // (list_models) sao respostas DIFERENTES do servidor, e e a segunda que
  // decide qual modelo o estudo usa. Quando as duas discordam — provedor
  // conectado, zero modelos — o app parece dizer que voce nao tem credencial
  // mesmo tendo. Mostrar as duas para de transformar isso em adivinhacao.
  const [modelos, setModelos] = useState<string>('');
  // Mesmo diagnostico para a credencial da EMPRESA: "ativada" (id gravado) e
  // "responde" (list_models com connectionId) sao coisas diferentes. Um id
  // gravado que nao responde e exatamente o tipo de problema invisivel que
  // fazia o fallback parecer quebrado.
  const [modelosEmpresa, setModelosEmpresa] = useState<string>('');

  const carregar = useCallback(async () => {
    setErro('');
    // Sem identidade propria, TUDO que a plataforma responde aqui vem da conta
    // criadora. Listar os provedores mostraria a assinatura pessoal do dono
    // como se fosse desta pessoa — e o botao "Remover" apagaria a assinatura
    // real de outra gente. Nao consultamos nada: so a compartilhada vale.
    if (semIdentidade) {
      setProviders([]);
      return;
    }
    void manageAgentCredentialMitra<{ providers?: { models?: unknown[] }[] }>({ action: 'list_models' })
      .then((r) => {
        const grupos = r?.providers || [];
        const n = grupos.reduce((s, g) => s + (g?.models?.length || 0), 0);
        setModelos(`${n} modelo(s) em ${grupos.length} grupo(s)`);
      })
      .catch((e: unknown) => setModelos(`indisponível (${String((e as Error)?.message || e)})`));
    try {
      const r = await manageAgentCredentialMitra<{ providers?: Provider[] }>({ action: 'list_providers' });
      const lista = (r?.providers || []).filter(conectavel);
      setProviders(lista);
      // Um unico provedor conectavel e nenhum conectado: abre direto o
      // formulario dele — escolher numa lista de um item so e atrito a toa.
      if (lista.length === 1 && !lista[0].connected) setAlvo(lista[0]);
    } catch (e: unknown) {
      setProviders([]);
      setErro(String((e as Error)?.message || e));
    }
  }, [semIdentidade]);

  useEffect(() => { void carregar(); }, [carregar]);

  // Verificacao que DISCRIMINA. Um connectionId errado nao provoca erro: o
  // servidor o descarta em silencio, atende com a credencial pessoal e devolve
  // uma lista normal. Logo "veio lista, entao a conexao respondeu" e uma
  // verificacao de fachada — a lista vem sempre. A unica prova e comparar as
  // duas respostas: iguais = o id nao foi reconhecido.
  const checarEmpresa = useCallback((id: string) => {
    if (!id) { setModelosEmpresa(''); return; }
    setModelosEmpresa('verificando…');
    void (async () => {
      try {
        const [pessoal, empresa] = await Promise.all([
          manageAgentCredentialMitra<{ providers?: { models?: unknown[] }[] }>({ action: 'list_models' }),
          manageAgentCredentialMitra<{ providers?: { models?: unknown[] }[] }>({ action: 'list_models', connectionId: id } as never),
        ]);
        const grupos = empresa?.providers || [];
        const n = grupos.reduce((s, g) => s + (g?.models?.length || 0), 0);
        const refPessoal = assinaturaModelos((pessoal?.providers || []) as never);
        if (n > 0 && refPessoal && assinaturaModelos(grupos as never) === refPessoal) {
          setModelosEmpresa(`o identificador foi RECUSADO — a plataforma devolveu a mesma lista de modelos da sua credencial pessoal, ou seja, não reconheceu o id. Confira o identificador da connection na aba AI da plataforma.`);
          return;
        }
        setModelosEmpresa(n > 0
          ? `ativada e respondendo com credencial própria (${n} modelo(s))`
          : 'ativada, mas sem modelos visíveis — pode ainda funcionar; se falhar, revise a conexão na plataforma');
      } catch (e: unknown) {
        setModelosEmpresa(`ativada, mas a verificação falhou (${String((e as Error)?.message || e)})`);
      }
    })();
  }, []);

  useEffect(() => {
    void lerConnectionIdCompartilhado().then((v) => { setConnId(v); setConnIdSalvo(v); checarEmpresa(v); });
  }, [checarEmpresa]);

  async function salvarConn() {
    setSalvandoConn(true);
    try {
      await gravarConnectionIdCompartilhado(connId);
      setConnIdSalvo(connId.trim());
      setEditandoConn(false);
      checarEmpresa(connId.trim());
      // Re-resolve a credencial: ligar a compartilhada tem que valer na
      // proxima pergunta, nao so depois de recarregar a pagina.
      onConectado();
    } catch (e: unknown) {
      setErro(String((e as Error)?.message || e));
    }
    setSalvandoConn(false);
  }

  async function remover(p: Provider) {
    setRemovendo(p.target);
    try {
      await manageAgentCredentialMitra({ action: 'remove', target: p.target as never });
      await carregar();
    } catch (e: unknown) {
      setErro(String((e as Error)?.message || e));
    }
    setRemovendo('');
  }

  const resumo = resumoStatus(status);

  return (
    <Modal
      isOpen
      onClose={onClose}
      size="sm"
      title={alvo ? `Conectar ${alvo.name}` : 'Credencial de IA'}
    >
      {alvo ? (
        // Conectar um provedor: o modal vira o formulario dele. Sem moldura
        // propria — o titulo e o X do modal ja sao a moldura.
        <div className="flex flex-col gap-2.5">
          {providers && providers.length > 1 && (
            <button
              onClick={() => setAlvo(null)}
              className="self-start inline-flex items-center gap-1 text-[11.5px] font-medium"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              <ChevronLeft size={13} /> Escolher outro provedor
            </button>
          )}
          <ConectarCredencialAgente
            semMoldura
            target={alvo.target}
            metodo={alvo.auth.method}
            nome={alvo.name}
            keyLabel={alvo.auth.keyLabel}
            keyPlaceholder={alvo.auth.keyPlaceholder}
            onDone={() => { setAlvo(null); void carregar(); onConectado(); }}
            onClose={() => setAlvo(null)}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {/* O que vale AGORA */}
          <p
            className="text-[12.5px] font-medium flex items-start gap-1.5 leading-snug"
            style={{ color: resumo.tom === 'aviso' ? 'var(--semantic-danger, #dc2626)' : 'var(--color-text)' }}
          >
            {resumo.tom === 'aviso'
              ? <AlertCircle size={13} className="mt-0.5 shrink-0" />
              : status === 'empresa'
                ? <Building2 size={13} className="mt-0.5 shrink-0" />
                : <User size={13} className="mt-0.5 shrink-0" />}
            <span>{resumo.texto}</span>
          </p>

          {semIdentidade ? (
            <p className="text-xs leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
              Você está em um login de demonstração, que não é um usuário da plataforma. Como
              ninguém está autenticado, a plataforma responderia com as credenciais de quem
              publicou a aplicação — por isso elas não são exibidas nem podem ser usadas aqui.
              Entre com o seu próprio login para o analista usar a credencial da sua conta (ou
              a compartilhada da empresa, se houver).
            </p>
          ) : providers === null ? (
            <div className="flex items-center gap-2 py-2 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
              <Loader2 size={13} className="animate-spin" /> Verificando as credenciais desta conta…
            </div>
          ) : providers.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
              Nenhum provedor de IA disponível para conexão nesta instalação.
              {erro && <> Detalhe técnico: {erro}</>}
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {providers.map((p) => (
                <div
                  key={p.target}
                  className="flex items-center gap-2 rounded-lg border px-3 py-2"
                  style={{ borderColor: 'var(--color-border)' }}
                >
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium truncate" style={{ color: 'var(--color-text)' }}>{p.name}</p>
                    {p.connected && (
                      <p className="inline-flex items-center gap-1 text-[11px] truncate" style={{ color: 'var(--color-primary)' }}>
                        <Check size={11} strokeWidth={3} className="shrink-0" /> {descricaoConta(p)}
                      </p>
                    )}
                  </div>
                  <div className="ml-auto flex items-center gap-2.5 shrink-0">
                    <button
                      onClick={() => setAlvo(p)}
                      className="text-[11.5px] font-semibold"
                      style={{ color: 'var(--color-primary)' }}
                    >
                      {p.connected ? 'Reconectar' : 'Conectar'}
                    </button>
                    {p.connected && (
                      <button
                        onClick={() => void remover(p)}
                        disabled={removendo === p.target}
                        className="text-[11.5px] font-medium disabled:opacity-50"
                        style={{ color: 'var(--color-text-muted)' }}
                      >
                        {removendo === p.target ? 'Removendo…' : 'Remover'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {erro && <p className="text-xs" style={{ color: 'var(--semantic-danger, #dc2626)' }}>{erro}</p>}
            </div>
          )}

          {/* A regra e a credencial da empresa, em letra miuda. E o que evita
              tanto conectar a conta a toa quanto esperar por uma credencial
              compartilhada que ninguem ativou. */}
          <div className="pt-2.5 border-t flex flex-col gap-1" style={{ borderColor: 'var(--border-light)' }}>
            {!semIdentidade && (
              <p className="text-[11px] leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                Quando a empresa mantém uma credencial compartilhada, o analista usa ela — e você não
                precisa conectar nada. A credencial da sua conta só entra se a compartilhada não
                estiver disponível.
              </p>
            )}
            {modelos && (
              <p className="text-[10.5px]" style={{ color: 'var(--color-text-muted)' }}>
                Sua conta: {modelos}
              </p>
            )}
            {connIdSalvo && modelosEmpresa && (
              <p className="text-[10.5px]" style={{ color: 'var(--color-text-muted)' }}>
                Credencial da empresa: {modelosEmpresa}
              </p>
            )}
            {isAdmin && (
              editandoConn ? (
                <div className="flex items-center gap-2 mt-0.5">
                  <input
                    value={connId}
                    onChange={(e) => setConnId(e.target.value)}
                    placeholder="identificador da conexão (padrão: default)"
                    className="flex-1 min-w-0 rounded-lg border px-2.5 py-1.5 text-xs outline-none focus:ring-2"
                    style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' }}
                  />
                  <button
                    onClick={() => void salvarConn()}
                    disabled={salvandoConn || connId.trim() === connIdSalvo}
                    className="text-[11.5px] font-semibold px-2.5 py-1.5 rounded-lg disabled:opacity-40"
                    style={{ backgroundColor: 'var(--color-primary)', color: '#fff' }}
                  >
                    {salvandoConn ? 'Salvando…' : 'Salvar'}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setEditandoConn(true)}
                  className="self-start inline-flex items-center gap-1 text-[11px] font-semibold"
                  style={{ color: 'var(--color-primary)' }}
                >
                  <Building2 size={11} />
                  {connIdSalvo ? 'Trocar o identificador da conexão' : 'Apontar uma conexão específica (opcional)'}
                </button>
              )
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
