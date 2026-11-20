// ──────────────────────────────────────────────────────────────────────
// Sessao herdada da PLATAFORMA (involucro) — entrar sem pedir login.
//
// O app roda dentro do involucro da plataforma, onde a pessoa JA esta logada.
// Ha tres caminhos para essa sessao chegar aqui sem tela de login:
//
//  1) Hand-off pelo fragment da URL (#tokenMitra=...&backURLMitra=...): a
//     plataforma entrega o token ao abrir o app. Quem le e' o initMitra
//     (mitra-config), no boot, antes do React montar.
//
//  2) Aperto de mao com o involucro: o app PEDE a sessao a quem o embutiu
//     ('mitra-preview-login-request') e recebe de volta um token deste app.
//     E' o caminho que o workspace usa hoje — e ele so' responde a quem pede.
//
//  3) Login silencioso: quando nao veio fragment nem ha sessao guardada (ou a
//     guardada venceu), a SDK abre um iframe invisivel na pagina de auth da
//     plataforma, que responde com um token novo usando o COOKIE de sessao de
//     quem esta logado la. Sem cookie (ninguem logado), ela responde erro e o
//     app cai na tela de login normal. E' o mesmo mecanismo que a SDK usa para
//     renovar token vencido no meio do uso — so que aqui e' chamado no boot.
//
// Este modulo cuida dos caminhos 2 e 3 e do espelho local do usuario em todos.
// ──────────────────────────────────────────────────────────────────────
import { executeServerFunctionMitra, refreshTokenSilently } from 'mitra-interactions-sdk';
import {
  MITRA_CONFIG,
  saveMitraSession,
  getSessionEmail,
  sessaoRealAtiva,
  espelharUsuarioDaSessao,
  aplicarSessaoNaSdk,
  reconfigurarSdkDoArmazenado,
} from '../mitra-config';
import { pedirSessaoAoInvolucro } from './sessao-involucro';
import { getUser, setUser, type AuthUser } from './auth';

// SF SQL: SELECT ID, DESCR AS EMAIL FROM INT_USER WHERE ID = :VAR_USER
export const SF_GET_MITRA_USER = 40;

function extractRows(res: any): any[] {
  let output = res?.result?.output;
  if (typeof output === 'string') {
    try { output = JSON.parse(output); } catch { /* keep */ }
  }
  if (output && typeof output === 'object' && Array.isArray(output.rows)) return output.rows;
  if (Array.isArray(output)) return output;
  return [];
}

// Hidrata o espelho local ('planej-user') da sessao ATIVA. Tenta enriquecer com
// ID/EMAIL de INT_USER (SF que le pelo :VAR_USER), mas a leitura e' TOLERANTE:
// se vier vazia ou falhar, fica o e-mail do proprio token (claim `sub`). O
// primeiro acesso de um usuario real ainda nao tem linha em INT_USER — e a
// entrada NUNCA pode travar por uma consulta de enriquecimento vazia. A
// autorizacao real e' server-side via :VAR_USER, entao ID=0 e' seguro.
// So falha se nem a SF nem o token trouxerem e-mail (token invalido).
export async function hidratarUsuarioLogado(): Promise<AuthUser> {
  let id = 0;
  let email = '';
  try {
    const res = await executeServerFunctionMitra({
      projectId: MITRA_CONFIG.projectId,
      serverFunctionId: SF_GET_MITRA_USER,
      input: {},
    });
    const rows = extractRows(res);
    if (rows.length) {
      const row = rows[0] as Record<string, any>;
      email = String(row.EMAIL || '');
      id = Number(row.ID) || 0;
    }
  } catch {
    /* segue para o fallback do token — nao aborta a entrada */
  }
  if (!email) email = getSessionEmail() || '';
  if (!email) throw new Error('Não foi possível ler o usuário após o login.');

  const nome = email.includes('@') ? email.split('@')[0] : email;
  const user: AuthUser = { ID: id, EMAIL: email, NOME: nome };
  setUser(user);
  return user;
}

// Espelho nascido so do token (ID 0, via espelharUsuarioDaSessao) ganha o ID e
// o e-mail de INT_USER em segundo plano. Falha e' silenciosa: o espelho do
// token ja basta para a interface.
export function enriquecerUsuarioSeNecessario(): void {
  const u = getUser();
  if (!u || u.ID > 0) return;
  hidratarUsuarioLogado().catch(() => { /* fica o espelho do token */ });
}

// Prova a sessao candidata antes de adota-la: com ela aplicada na SDK, executa
// a leitura do usuario logado. Qualquer erro de transporte/autorizacao aqui
// significa que esse token nao fala pelo projeto — e entrar assim daria uma
// tela logada sem dado nenhum, pior do que pedir login. Linhas vazias NAO sao
// erro: primeiro acesso de um usuario real ainda nao tem linha em INT_USER.
async function provarSessao(): Promise<boolean> {
  try {
    await executeServerFunctionMitra({
      projectId: MITRA_CONFIG.projectId,
      serverFunctionId: SF_GET_MITRA_USER,
      input: {},
    });
    return true;
  } catch {
    return false;
  }
}

// Pede a sessao ao involucro, prova e adota. Retorna false sem deixar rastro
// quando nao ha involucro, ninguem responde, ou a sessao nao passa na prova.
async function adotarSessaoDoInvolucro(): Promise<boolean> {
  const entregue = await pedirSessaoAoInvolucro();
  if (!entregue) return false;

  const sessao = {
    token: entregue.token.startsWith('Bearer ') ? entregue.token : `Bearer ${entregue.token}`,
    baseURL: entregue.baseURL,
  };
  aplicarSessaoNaSdk(sessao);
  if (!(await provarSessao())) {
    reconfigurarSdkDoArmazenado();
    return false;
  }

  saveMitraSession(sessao);
  espelharUsuarioDaSessao();
  try { await hidratarUsuarioLogado(); } catch { /* espelho do token ja basta */ }
  return true;
}

let emAndamento: Promise<boolean> | null = null;

// Tenta herdar a sessao de quem esta logado na plataforma, sem interacao.
// Resolve true quando conseguiu (sessao gravada + SDK configurada + espelho do
// usuario hidratado) e false quando nao ha ninguem logado la, o ambiente nao
// permite (sem authUrl, cookie bloqueado) ou o auth nao respondeu a tempo.
// Uma unica tentativa por vez: chamadas concorrentes (StrictMode monta duas
// vezes) compartilham a mesma promise.
export function recuperarSessaoDaPlataforma(): Promise<boolean> {
  if (emAndamento) return emAndamento;
  emAndamento = (async () => {
    try {
      if (sessaoRealAtiva()) {
        espelharUsuarioDaSessao();
        return true;
      }
      if (typeof window === 'undefined') return false;

      // Caminho do involucro (workspace): pedir e adotar, se a sessao provar
      // que fala pelo projeto. Vem antes do login silencioso porque e' o unico
      // que enxerga quem esta' logado no workspace.
      if (await adotarSessaoDoInvolucro()) return true;

      if (!MITRA_CONFIG.authUrl || !Number.isFinite(MITRA_CONFIG.projectId)) return false;

      const res = await refreshTokenSilently(MITRA_CONFIG.authUrl, MITRA_CONFIG.projectId);
      if (!res?.token || !res?.baseURL) return false;
      saveMitraSession({
        token: res.token.startsWith('Bearer ') ? res.token : `Bearer ${res.token}`,
        baseURL: res.baseURL,
        ...(res.integrationURL ? { integrationURL: res.integrationURL } : {}),
      });
      espelharUsuarioDaSessao();
      try { await hidratarUsuarioLogado(); } catch { /* espelho do token ja basta */ }
      return true;
    } catch {
      return false;
    } finally {
      emAndamento = null;
    }
  })();
  return emAndamento;
}
