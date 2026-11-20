// ──────────────────────────────────────────────────────────────────────
// ConectarCredencialAgente — painel de conexao de uma credencial de IA.
//
// Extraido do Playground para ser usado nos DOIS lugares: dentro do chat
// (quando o analista falha por falta de credencial) e na tela de Governanca
// de IA (onde o admin conecta as credenciais com calma). Duplicar esse fluxo
// era o caminho curto para as duas telas divergirem.
//
// Cobre os tres metodos que a plataforma expoe, todos vindos do
// `auth.method` de list_providers:
//   paste_code  — abre a autorizacao do provedor e o usuario cola o codigo
//   device      — mostra codigo + URL; a SDK faz o polling sozinha
//   api_key     — o usuario cola a chave; validar antes de salvar e opcional
// ──────────────────────────────────────────────────────────────────────
import { useState } from 'react';
import { KeyRound, X, ExternalLink, Copy, Check } from 'lucide-react';
import { manageAgentCredentialMitra } from 'mitra-interactions-sdk';
import Button from './ui/Button';

type Metodo = 'paste_code' | 'device' | 'api_key';

interface Props {
  /** target da credencial ('claude', 'codex', 'openai', ...) */
  target: string;
  /** como conectar — vem de list_providers em auth.method */
  metodo: Metodo;
  /** nome visivel do provedor (ex: "Claude") */
  nome: string;
  /** rotulo/placeholder do campo de chave (auth.keyLabel / keyPlaceholder) */
  keyLabel?: string;
  keyPlaceholder?: string;
  onDone: () => void;
  onClose: () => void;
  /** dentro de um modal, o titulo e o X ja sao a moldura — nao repetir card */
  semMoldura?: boolean;
}

const campoClasse = 'flex-1 rounded-lg border px-3 py-1.5 text-sm outline-none focus:ring-2';
const campoEstilo = {
  borderColor: 'var(--color-border)',
  backgroundColor: 'var(--color-surface)',
  color: 'var(--color-text)',
};

export default function ConectarCredencialAgente({
  target, metodo, nome, keyLabel, keyPlaceholder, onDone, onClose, semMoldura = false,
}: Props) {
  const [fase, setFase] = useState<'inicio' | 'codigo' | 'conectando'>('inicio');
  const [authUrl, setAuthUrl] = useState('');
  const [state, setState] = useState('');
  const [code, setCode] = useState('');
  const [erro, setErro] = useState('');
  // device flow (codex): o codigo aparece na tela e o usuario digita no site
  const [userCode, setUserCode] = useState('');
  const [pollId, setPollId] = useState('');
  const [copiado, setCopiado] = useState(false);
  // api key
  const [chave, setChave] = useState('');
  const [validando, setValidando] = useState(false);
  const [validado, setValidado] = useState(false);

  async function iniciar() {
    setErro('');
    try {
      const r: any = await manageAgentCredentialMitra({ action: 'auth', target: target as any });
      if (metodo === 'device') {
        setUserCode(r?.userCode || '');
        setAuthUrl(r?.verificationUrl || '');
        setPollId(r?.pollId || '');
        setFase('codigo');
        // O connect do device flow bloqueia enquanto a SDK faz o polling —
        // dispara junto com a exibicao do codigo, senao o usuario autoriza no
        // site e nada acontece deste lado.
        if (r?.pollId) void conectarDevice(r.pollId);
        return;
      }
      setAuthUrl(r?.authUrl || '');
      setState(r?.state || '');
      if (r?.authUrl) window.open(r.authUrl, '_blank', 'noopener');
      setFase('codigo');
    } catch (e: any) {
      setErro(String(e?.message || e));
    }
  }

  async function conectarDevice(id: string) {
    try {
      await manageAgentCredentialMitra({ action: 'connect', target: target as any, pollId: id });
      onDone();
    } catch (e: any) {
      setErro(String(e?.message || e));
    }
  }

  async function conectar() {
    setErro('');
    setFase('conectando');
    try {
      await manageAgentCredentialMitra({ action: 'connect', target: target as any, code: code.trim(), state });
      onDone();
    } catch (e: any) {
      setErro(String(e?.message || e));
      setFase('codigo');
    }
  }

  async function validarChave() {
    setErro('');
    setValidando(true);
    setValidado(false);
    try {
      await manageAgentCredentialMitra({ action: 'validate', target: target as any, key: chave.trim() });
      setValidado(true);
    } catch (e: any) {
      setErro(String(e?.message || e));
    }
    setValidando(false);
  }

  async function salvarChave() {
    setErro('');
    setValidando(true);
    try {
      await manageAgentCredentialMitra({ action: 'save', target: target as any, key: chave.trim() });
      onDone();
    } catch (e: any) {
      setErro(String(e?.message || e));
    }
    setValidando(false);
  }

  async function copiarCodigo() {
    try {
      await navigator.clipboard.writeText(userCode);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1800);
    } catch { /* sem permissao no iframe — o codigo esta visivel na tela */ }
  }

  return (
    <div
      className={semMoldura ? 'animate-fadeIn' : 'rounded-xl border p-4 animate-fadeIn'}
      style={semMoldura ? undefined : { borderColor: 'var(--color-border)', backgroundColor: 'var(--color-primary-bg)' }}
    >
      {!semMoldura && (
        <div className="flex items-center gap-2 mb-2">
          <KeyRound size={15} style={{ color: 'var(--color-primary)' }} />
          <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
            Conectar {nome}
          </span>
          <button onClick={onClose} className="ml-auto p-1 rounded hover:opacity-70" aria-label="Fechar">
            <X size={14} style={{ color: 'var(--color-text-muted)' }} />
          </button>
        </div>
      )}

      {metodo === 'api_key' ? (
        <>
          <p className="text-xs mb-3" style={{ color: 'var(--color-text-secondary)' }}>
            {keyLabel || 'Cole a chave de acesso'} de {nome}. A chave fica guardada no servidor — nunca no navegador.
          </p>
          <div className="flex gap-2">
            <input
              value={chave}
              onChange={(e) => { setChave(e.target.value); setValidado(false); }}
              placeholder={keyPlaceholder || 'Cole a chave aqui'}
              className={campoClasse}
              style={campoEstilo}
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void validarChave()}
              disabled={!chave.trim() || validando}
            >
              {validando ? 'Verificando…' : 'Testar'}
            </Button>
            <Button size="sm" onClick={() => void salvarChave()} disabled={!chave.trim() || validando}>
              Salvar
            </Button>
          </div>
          {validado && (
            <p className="text-xs mt-2 flex items-center gap-1" style={{ color: 'var(--color-primary)' }}>
              <Check size={12} /> Chave válida.
            </p>
          )}
        </>
      ) : metodo === 'device' ? (
        <>
          <p className="text-xs mb-3" style={{ color: 'var(--color-text-secondary)' }}>
            Abra a página de autorização de {nome} e informe o código abaixo. A conexão se completa sozinha
            assim que você autorizar.
          </p>
          {fase === 'inicio' ? (
            <Button size="sm" onClick={() => void iniciar()}>Gerar código de autorização</Button>
          ) : (
            <div className="flex flex-col gap-2">
              {userCode && (
                <div className="flex items-center gap-2">
                  <code
                    className="px-2.5 py-1.5 rounded-lg text-sm font-semibold tracking-widest"
                    style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
                  >
                    {userCode}
                  </code>
                  <Button size="sm" variant="secondary" onClick={() => void copiarCodigo()}>
                    {copiado ? <Check size={12} /> : <Copy size={12} />}
                    {copiado ? 'Copiado' : 'Copiar'}
                  </Button>
                </div>
              )}
              {authUrl && (
                <a
                  href={authUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs underline"
                  style={{ color: 'var(--color-primary)' }}
                >
                  Abrir página de autorização
                </a>
              )}
              {pollId && !erro && (
                <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                  Aguardando a autorização…
                </p>
              )}
            </div>
          )}
        </>
      ) : (
        <>
          <p className="text-xs mb-3" style={{ color: 'var(--color-text-secondary)' }}>
            Autorize no site de {nome} e cole o código aqui.
          </p>
          {fase === 'inicio' ? (
            <Button size="sm" onClick={() => void iniciar()}>
              Abrir autorização <ExternalLink size={12} className="ml-1 inline" />
            </Button>
          ) : (
            <div className="flex flex-col gap-2">
              {authUrl && (
                <a
                  href={authUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs underline"
                  style={{ color: 'var(--color-primary)' }}
                >
                  Reabrir página de autorização
                </a>
              )}
              <div className="flex gap-2">
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="Cole o código aqui"
                  className={campoClasse}
                  style={campoEstilo}
                />
                <Button size="sm" onClick={() => void conectar()} disabled={!code.trim() || fase === 'conectando'}>
                  {fase === 'conectando' ? 'Conectando…' : 'Conectar'}
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {erro && <p className="text-xs mt-2 text-red-500">{erro}</p>}
    </div>
  );
}
