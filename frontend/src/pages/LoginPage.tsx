import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  loginWithGoogleMitra,
  loginWithMicrosoftMitra,
  emailLoginMitra,
  emailSignupMitra,
  emailVerifyCodeMitra,
} from 'mitra-interactions-sdk';
import { MITRA_CONFIG, saveMitraSession } from '../mitra-config';
import { hidratarUsuarioLogado } from '../lib/sessao-plataforma';
import MitraProductLockup from '../components/MitraProductLockup';

// Login: SSO Google/Microsoft via popup do servico de auth (senha digitada no
// dominio confiavel) + e-mail/senha INLINE no proprio card (emailLoginMitra),
// com toggle para criar conta (signup + verificacao de codigo de 6 digitos).

// Design system Mitra: a coluna de entrada usa SO tokens. O painel de marca e'
// a excecao registrada do sistema — degrade escuro fixo nos dois temas.
const PAINEL_MARCA = 'linear-gradient(160deg, #15131c 0%, #1f2128 55%, #2a2e37 100%)';

// Painel de marca lateral — identidade Mitra. Some no mobile (a marca aparece
// compacta acima do formulario).
function BrandPanel() {
  const features = [
    'Ciclos e versões sob controle',
    'Workflow de aprovação por gestor',
    'DRE consolidado em tempo real',
  ];
  return (
    <div
      className="hidden lg:flex lg:w-[46%] max-w-[640px] flex-col justify-between p-12 relative overflow-hidden"
      style={{ background: PAINEL_MARCA, color: '#ffffff' }}
    >
      {/* textura de losangos a 1,6% de branco */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          backgroundImage:
            'linear-gradient(45deg, rgba(255,255,255,0.016) 25%, transparent 25%, transparent 75%, rgba(255,255,255,0.016) 75%), linear-gradient(45deg, rgba(255,255,255,0.016) 25%, transparent 25%, transparent 75%, rgba(255,255,255,0.016) 75%)',
          backgroundSize: '28px 28px',
          backgroundPosition: '0 0, 14px 14px',
        }}
      />
      {/* halo radial violeta -> azul */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          backgroundImage:
            'radial-gradient(620px circle at 12% 8%, rgba(120,57,238,0.22) 0, transparent 52%), radial-gradient(560px circle at 96% 96%, rgba(40,167,248,0.16) 0, transparent 54%)',
        }}
      />

      <div className="relative flex items-center">
        <MitraProductLockup product="FP&A" wordmarkHeight={22} />
      </div>

      <div className="relative">
        <h2 className="font-semibold max-w-md" style={{ fontSize: 32, lineHeight: 1.15, letterSpacing: '-0.01em' }}>
          Planejamento orçamentário, do preenchimento à aprovação
        </h2>
        <p className="mt-4 text-[14px] leading-relaxed max-w-sm" style={{ color: 'rgba(255,255,255,0.72)' }}>
          Centralize ciclos, revisões, aprovações e análises financeiras em um único ambiente.
        </p>
        <ul className="mt-8 space-y-3">
          {features.map((f) => (
            <li key={f} className="flex items-center gap-3 text-[13.5px]" style={{ color: 'rgba(255,255,255,0.86)' }}>
              <span
                className="w-5 h-5 rounded-full flex items-center justify-center shrink-0"
                style={{ backgroundColor: 'rgba(255,255,255,0.12)' }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
              </span>
              {f}
            </li>
          ))}
        </ul>
      </div>

      <p className="relative text-[12px]" style={{ color: 'rgba(255,255,255,0.45)' }}>
        © {new Date().getFullYear()} Mitra
      </p>
    </div>
  );
}

type Provider = 'google' | 'microsoft';
type AuthMode = 'login' | 'signup' | 'verify';

// Se o usuário chegou por um link de estudo compartilhado (/estudo/<token>),
// volta pra ele após o login em vez da landing padrão — o link agora exige
// sessão ativa e o LoginPage é a porta de entrada.
function postLoginPath(fallback: string): string {
  const p = window.location.pathname;
  return p.startsWith('/estudo/') ? p : fallback;
}

export default function LoginPage({ onLogin }: { onLogin: () => void }) {
  const navigate = useNavigate();

  const [loading, setLoading] = useState<Provider | null>(null);
  const [error, setError] = useState('');

  // E-mail inline (login / criar conta / verificar codigo)
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [codigo, setCodigo] = useState('');
  const [emailBusy, setEmailBusy] = useState(false);

  // Apos login Mitra com sucesso, hidrata o espelho local do usuario (INT_USER
  // com fallback no e-mail do token — ver lib/sessao-plataforma) e entra.
  async function finishAuth() {
    await hidratarUsuarioLogado();
    onLogin();
    navigate(postLoginPath('/'), { replace: true });
  }

  // Salva a sessao retornada por qualquer fluxo de auth e hidrata o usuario.
  function applySession(res: { token: string; baseURL: string; integrationURL?: string }) {
    saveMitraSession({ token: res.token, baseURL: res.baseURL, integrationURL: res.integrationURL });
    return finishAuth();
  }

  async function handleLogin(provider: Provider) {
    setError('');
    setLoading(provider);
    try {
      const fn = provider === 'google' ? loginWithGoogleMitra : loginWithMicrosoftMitra;
      const res = await fn({ projectId: MITRA_CONFIG.projectId, authUrl: MITRA_CONFIG.authUrl });
      await applySession(res);
    } catch (err: any) {
      const label = provider === 'google' ? 'Google' : 'Microsoft';
      setError(err?.message || `Falha no login com ${label}.`);
      setLoading(null);
    }
  }

  // E-mail/senha INLINE — sem popup. Login, criar conta e verificacao de codigo.
  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || emailBusy) return;
    setError('');
    setEmailBusy(true);
    try {
      const base = { projectId: MITRA_CONFIG.projectId, authUrl: MITRA_CONFIG.authUrl };
      if (authMode === 'login') {
        const res = await emailLoginMitra({ ...base, email: email.trim(), password: senha });
        await applySession(res);
      } else if (authMode === 'signup') {
        await emailSignupMitra({ ...base, name: nome.trim(), email: email.trim(), password: senha });
        setAuthMode('verify'); // aguarda o codigo enviado por e-mail
        setEmailBusy(false);
      } else {
        const res = await emailVerifyCodeMitra({ ...base, email: email.trim(), code: codigo.trim(), password: senha });
        await applySession(res);
      }
    } catch (err: any) {
      const msg =
        authMode === 'login' ? 'E-mail ou senha inválidos.' :
        authMode === 'signup' ? 'Não foi possível criar a conta.' :
        'Código inválido ou expirado.';
      setError(err?.message || msg);
      setEmailBusy(false);
    }
  }

  const busy = loading !== null || emailBusy;

  return (
    <div
      className="h-screen w-full flex overflow-hidden"
      style={{ backgroundColor: 'var(--bg)', color: 'var(--fg)' }}
    >
      {/* Painel de marca (identidade Mitra) — só em telas grandes */}
      <BrandPanel />

      {/* Coluna de entrada */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-10 overflow-y-auto">
        <div className="w-full animate-riseIn" style={{ maxWidth: 380 }}>
        {/* Marca compacta (quando o painel lateral está oculto) */}
        <div className="lg:hidden flex items-center justify-center mb-8" style={{ color: 'var(--fg)' }}>
          <MitraProductLockup product="FP&A" wordmarkHeight={18} />
        </div>

        {/* Cabeçalho */}
        <div className="mb-8">
          <h1 className="font-semibold" style={{ color: 'var(--fg)', fontSize: 26, letterSpacing: '-0.01em' }}>
            Entrar
          </h1>
          <p className="text-[14px] mt-2" style={{ color: 'var(--fg-muted)' }}>
            Acesse seu ambiente de planejamento
          </p>
        </div>

        {/* SSO empilhado full-width (via popup do servico de auth) */}
        <div className="flex flex-col gap-3">
          <button
            onClick={() => handleLogin('google')}
            disabled={busy}
            className="w-full flex items-center justify-center gap-3 rounded-xl border text-[14px] font-medium transition-[background-color,border-color] duration-150 active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed"
            style={{ height: 48, backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border)', color: 'var(--fg)' }}
            onMouseEnter={(e) => { if (!busy) { e.currentTarget.style.backgroundColor = 'var(--surface-hover)'; e.currentTarget.style.borderColor = 'var(--border-strong)'; } }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-elevated)'; e.currentTarget.style.borderColor = 'var(--border)'; }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            {loading === 'google' ? 'Conectando...' : 'Continuar com Google'}
          </button>

          <button
            onClick={() => handleLogin('microsoft')}
            disabled={busy}
            className="w-full flex items-center justify-center gap-3 rounded-xl border text-[14px] font-medium transition-[background-color,border-color] duration-150 active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed"
            style={{ height: 48, backgroundColor: 'var(--bg-elevated)', borderColor: 'var(--border)', color: 'var(--fg)' }}
            onMouseEnter={(e) => { if (!busy) { e.currentTarget.style.backgroundColor = 'var(--surface-hover)'; e.currentTarget.style.borderColor = 'var(--border-strong)'; } }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-elevated)'; e.currentTarget.style.borderColor = 'var(--border)'; }}
          >
            <svg width="17" height="17" viewBox="0 0 23 23" xmlns="http://www.w3.org/2000/svg">
              <path fill="#f25022" d="M1 1h10v10H1z"/>
              <path fill="#00a4ef" d="M1 12h10v10H1z"/>
              <path fill="#7fba00" d="M12 1h10v10H12z"/>
              <path fill="#ffb900" d="M12 12h10v10H12z"/>
            </svg>
            {loading === 'microsoft' ? 'Conectando...' : 'Continuar com Microsoft'}
          </button>
        </div>

        {/* Divisor "ou com e-mail" */}
        <div className="flex items-center gap-3 my-5">
          <div className="flex-1 h-px" style={{ backgroundColor: 'var(--border)' }} />
          <span className="rotulo-secao">ou com e-mail</span>
          <div className="flex-1 h-px" style={{ backgroundColor: 'var(--border)' }} />
        </div>

        {/* Formulario de e-mail INLINE — sem popup */}
        <form onSubmit={handleEmailSubmit} className="flex flex-col gap-2.5">
          {authMode === 'signup' && (
            <input
              type="text" value={nome} onChange={(e) => setNome(e.target.value)}
              placeholder="Nome completo" autoComplete="name" required disabled={busy}
              className="controle w-full disabled:opacity-60"
            />
          )}

          {authMode !== 'verify' && (
            <>
              <input
                type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="E-mail" autoComplete="email" required disabled={busy}
                className="controle w-full disabled:opacity-60"
              />
              <input
                type="password" value={senha} onChange={(e) => setSenha(e.target.value)}
                placeholder="Senha" autoComplete={authMode === 'signup' ? 'new-password' : 'current-password'} required disabled={busy}
                className="controle w-full disabled:opacity-60"
              />
            </>
          )}

          {authMode === 'verify' && (
            <>
              <p className="text-[12.5px] leading-snug" style={{ color: 'var(--fg-muted)' }}>
                Enviamos um código de 6 dígitos para <strong style={{ color: 'var(--fg)' }}>{email}</strong>.
              </p>
              <input
                type="text" inputMode="numeric" value={codigo}
                onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="Código de 6 dígitos" required disabled={busy}
                className="controle w-full disabled:opacity-60 tracking-[0.3em] text-center"
              />
            </>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full flex items-center justify-center rounded-xl text-[14px] font-medium transition-[background-color] duration-150 active:scale-[0.99] disabled:opacity-60 disabled:cursor-not-allowed mt-0.5 shadow-sm"
            style={{ height: 48, backgroundColor: 'var(--accent)', color: 'var(--accent-fg)' }}
            onMouseEnter={(e) => { if (!busy) e.currentTarget.style.backgroundColor = 'var(--accent-hover)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'var(--accent)'; }}
          >
            {emailBusy ? 'Aguarde...' :
              authMode === 'login' ? 'Entrar' :
              authMode === 'signup' ? 'Criar conta' : 'Confirmar código'}
          </button>
        </form>

        {error && (
          <p
            className="rounded-xl px-3.5 py-2.5 text-[13px] mt-4 animate-fadeIn"
            style={{ backgroundColor: 'var(--danger-soft)', color: 'var(--danger)' }}
          >{error}</p>
        )}

        {/* Toggle login / criar conta */}
        <div className="text-center mt-5 text-[12.5px]" style={{ color: 'var(--fg-muted)' }}>
          {authMode === 'login' ? (
            <>Não tem conta?{' '}
              <button type="button" onClick={() => { setError(''); setAuthMode('signup'); }} className="font-medium hover:underline" style={{ color: 'var(--accent)' }}>Criar conta</button>
            </>
          ) : authMode === 'signup' ? (
            <>Já tem conta?{' '}
              <button type="button" onClick={() => { setError(''); setAuthMode('login'); }} className="font-medium hover:underline" style={{ color: 'var(--accent)' }}>Entrar</button>
            </>
          ) : (
            <button type="button" onClick={() => { setError(''); setCodigo(''); setAuthMode('signup'); }} className="font-medium hover:underline" style={{ color: 'var(--accent)' }}>Voltar</button>
          )}
        </div>
        </div>
      </div>
    </div>
  );
}
