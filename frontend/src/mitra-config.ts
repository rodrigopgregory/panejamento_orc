import { configureSdkMitra } from 'mitra-interactions-sdk';
import { clearUser, getUser, setUser } from './lib/auth';

// Auth Mitra nativa (Google / Microsoft / email com codigo).
//
// Fluxo:
//  1) Boot — initMitra() PRIMEIRO le o fragment da URL (#tokenMitra=...): e
//     assim que a plataforma/pagina de auth entrega a sessao de quem ja esta
//     logado la ao abrir o app. Depois cai no 'mitra-session' do localStorage
//     (token do ultimo login). Sem nenhum dos dois, o app exige login.
//  2) Login — LoginPage chama loginWithGoogleMitra / loginWithMicrosoftMitra
//     / emailLoginMitra do SDK. Eles retornam { token, baseURL } e a gente
//     guarda em localStorage via saveMitraSession().
//  3) Logout — clearMitraSession() limpa o token salvo (junto com clearUser
//     do auth local).

const PROJECT_ID = parseInt(import.meta.env.VITE_MITRA_PROJECT_ID);
const AUTH_URL = import.meta.env.VITE_MITRA_AUTH_URL || '';
const ENV_BASE_URL = import.meta.env.VITE_MITRA_BASE_URL || '';

const SESSION_KEY = 'mitra-session';

export interface MitraSession {
  token: string;
  baseURL: string;
  integrationURL?: string;
}

function decodeJwt(token?: string): { tni?: number; backURL?: string; sub?: string; email?: string } | null {
  if (!token) return null;
  try {
    const raw = token.replace(/^Bearer\s+/i, '');
    const payloadB64 = raw.split('.')[1];
    const padded = payloadB64.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

// E-mail do usuario logado, extraido do token da sessao (claim `sub`, com
// fallback em `email`). Usado como fonte tolerante quando a leitura de
// enriquecimento (SF que le INT_USER) volta vazia — o primeiro acesso de um
// usuario real ainda nao tem linha em INT_USER, e o login nao pode travar por
// causa disso. A autorizacao real continua server-side via :VAR_USER.
export function getSessionEmail(): string | null {
  const session = getMitraSession();
  const payload = decodeJwt(session?.token);
  const email = payload?.sub || payload?.email;
  return email && email.includes('@') ? email : null;
}

// Espelho local do usuario ('planej-user') a partir da PROPRIA sessao. Quem
// entra pela tela de login ganha esse espelho no finishAuth; quem entra pela
// sessao entregue pelo involucro da plataforma (fragment #tokenMitra) ou pelo
// login silencioso nunca passou por la — e sem o espelho o App mandava logar
// de novo, mesmo com token valido em maos. Aqui o espelho nasce do e-mail do
// token (ID 0 e' seguro: a autorizacao real e' server-side via :VAR_USER); o
// enriquecimento com INT_USER acontece depois, em segundo plano.
export function espelharUsuarioDaSessao(): void {
  if (getUser()) return;
  const email = getSessionEmail() || '';
  const nome = email.includes('@') ? email.split('@')[0] : email;
  setUser({ ID: 0, EMAIL: email, NOME: nome });
}

export function getMitraSession(): MitraSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as MitraSession) : null;
  } catch {
    return null;
  }
}

function persistMitraSession(s: MitraSession): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(s));
}

// Toda configuracao de sessao real passa por aqui: alem do token, entrega o
// onTokenRefresh que persiste o token renovado pela SDK. O template original
// fazia isso e a versao custom tinha perdido — sem ele a sessao nunca se
// renova e expira em silencio (a raiz das trocas de identidade anteriores).
function configurarSdkComSessao(s: MitraSession): void {
  configureSdkMitra({
    baseURL: s.baseURL,
    token: s.token,
    integrationURL: s.integrationURL,
    projectId: PROJECT_ID,
    authUrl: AUTH_URL,
    onTokenRefresh: (nova: MitraSession) => persistMitraSession(nova),
  } as Parameters<typeof configureSdkMitra>[0]);
}

export function saveMitraSession(s: MitraSession): void {
  persistMitraSession(s);
  configurarSdkComSessao(s);
}

// Aplica uma sessao na SDK SEM gravar no armazenamento. Serve para PROVAR uma
// sessao candidata (a que o involucro acabou de entregar) antes de adota-la: se
// a prova falhar, nada ficou gravado e o app volta ao estado anterior com
// `reconfigurarSdkDoArmazenado`. Adotar primeiro e descobrir depois deixaria a
// pessoa "logada" numa casca que nao carrega dado nenhum.
export function aplicarSessaoNaSdk(s: MitraSession): void {
  configurarSdkComSessao(s);
}

// Volta a SDK para a sessao guardada (ou para o modo sem token, se nao houver).
export function reconfigurarSdkDoArmazenado(): void {
  const s = getMitraSession();
  if (s?.token && s?.baseURL) {
    configurarSdkComSessao(s);
    return;
  }
  if (ENV_BASE_URL) {
    try {
      configureSdkMitra({ baseURL: ENV_BASE_URL });
    } catch (e) {
      console.error('Mitra SDK reconfig error:', e);
    }
  }
}

export function clearMitraSession(): void {
  localStorage.removeItem(SESSION_KEY);
}

export const MITRA_CONFIG = {
  baseURL: ENV_BASE_URL,
  projectId: PROJECT_ID,
  authUrl: AUTH_URL,
};

// Base URL utilizavel por telas PUBLICAS (usuarios nao logados): o
// VITE_MITRA_BASE_URL do ambiente. Nao ha token nenhum envolvido — as Server
// Functions publicas executam sem autenticacao.
export function getPublicBaseURL(): string {
  return ENV_BASE_URL;
}

// Configura a SDK SEM token para telas publicas (magic-link). As Server
// Functions publicas (marcadas com publicExecution) executam sem autenticacao;
// a autorizacao e derivada do token UUID no proprio SQL da SF, no servidor.
export function configurePublicSdk(): void {
  configureSdkMitra({ baseURL: getPublicBaseURL(), projectId: PROJECT_ID });
}

// Invalido e SO o token que prova estar vencido: `exp` no passado.
//
// A versao anterior tratava "sem `exp`" (ou payload que nao decodifica) como
// invalido — e essa era a porta do vazamento. Um token de login legitimo que
// nao traga `exp` fazia o app DESCARTAR a sessao real e cair no token de
// build: a pessoa seguia logada na tela, mas quem falava com a plataforma era
// a conta criadora, com as credenciais de IA dela. Descartar o que nao se
// consegue datar e trocar uma incerteza por um erro de identidade.
//
// Se o token realmente nao servir, quem diz isso e o servidor (401) — e o app
// manda logar de novo. Isso e recuperavel; assumir outra identidade nao e.
function isJwtValid(token?: string): boolean {
  if (!token) return false;
  const payload = decodeJwt(token) as { exp?: number } | null;
  if (!payload || typeof payload.exp !== 'number') return true;
  return payload.exp > Math.floor(Date.now() / 1000) + 60;
}

// Ha uma sessao de login REAL valida? Tudo que a plataforma responde e' desta
// pessoa — e a credencial de IA "pessoal" e' legitimamente dela. Sem sessao, o
// app nao fala em nome de ninguem: a resposta honesta e' pedir login de novo.
export function sessaoRealAtiva(): boolean {
  const s = getMitraSession();
  return !!(s?.token && s?.baseURL && isJwtValid(s.token));
}

// Hand-off da plataforma / pagina de auth: quando alguem ja logado na
// PLATAFORMA abre o app (ou volta do redirect de login), o token vem no
// fragment da URL — #tokenMitra=...&backURLMitra=... (fragment para nao vazar
// em logs/referrer). O template original lia isso; a versao custom tinha
// APAGADO a leitura, entao o app jogava fora a sessao real que a plataforma
// entregava — e quem "estava logado la" virava, aqui dentro, um anonimo.
function lerSessaoDoFragment(): MitraSession | null {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash?.slice(1) || '';
  if (!hash.includes('tokenMitra')) return null;
  const params = new URLSearchParams(hash);
  const token = params.get('tokenMitra');
  const backURL = params.get('backURLMitra');
  const limparHash = () =>
    window.history.replaceState({}, '', window.location.pathname + window.location.search);
  // Erro devolvido pela pagina de auth — ja foi exibido la; so limpa a URL.
  if (token === 'error') {
    limparHash();
    return null;
  }
  if (!token || !backURL) return null;
  limparHash();
  const integrationURL = params.get('integrationURLMitra');
  return {
    token: token.startsWith('Bearer ') ? token : `Bearer ${token}`,
    baseURL: backURL,
    ...(integrationURL ? { integrationURL } : {}),
  };
}

export function initMitra() {
  // 0. Token entregue pela plataforma no fragment da URL — e a sessao mais
  // fresca que existe (acabou de ser emitida), entao vence o localStorage.
  const entregue = lerSessaoDoFragment();
  if (entregue) {
    try {
      saveMitraSession(entregue);
      espelharUsuarioDaSessao();
      return;
    } catch (e) {
      console.error('Mitra SDK init (hand-off) error:', e);
    }
  }

  // 1. Sessao real do login Mitra — unica identidade que o app aceita.
  const session = getMitraSession();
  if (session?.token && session?.baseURL) {
    if (isJwtValid(session.token)) {
      try {
        configurarSdkComSessao(session);
        espelharUsuarioDaSessao();
        return;
      } catch (e) {
        console.error('Mitra SDK init (session) error:', e);
      }
    } else {
      // Sessao expirada: derruba tambem o usuario local e o App manda para a
      // tela de login. Nao ha token de build para cair — assumir outra
      // identidade nunca foi uma opcao aceitavel.
      console.warn('[mitra-auth] sessao expirada — exigindo login novamente');
      clearMitraSession();
      clearUser();
      try { window.dispatchEvent(new Event('auth:sessao-expirada')); } catch { /* ignore */ }
    }
  }

  // 3. Sem nada — SDK sem auth. Login real precisa rodar.
  if (ENV_BASE_URL) {
    try {
      configureSdkMitra({ baseURL: ENV_BASE_URL });
    } catch (e) {
      console.error('Mitra SDK init (no-token) error:', e);
    }
  }
}
