// ──────────────────────────────────────────────────────────────────────
// Identidade do usuario logado no app.
//
// NAO existe mais perfil/persona nesta aplicacao: quem entra e' sempre um
// usuario REAL da plataforma, autenticado pelo login padrao (SSO ou
// e-mail/senha). O que fica guardado aqui em 'planej-user' e' so o espelho
// local dessa sessao (id + e-mail + nome) para a interface exibir quem esta
// logado. A autorizacao de verdade e' server-side, via :VAR_USER nas Server
// Functions — nunca este objeto.
// ──────────────────────────────────────────────────────────────────────

const KEY = 'planej-user';

export interface AuthUser {
  ID: number;
  EMAIL: string;
  NOME: string;
}

export function getUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const u = JSON.parse(raw) as Partial<AuthUser>;
    // Sessoes antigas podiam trazer PERFIL/AREA/AVATAR de persona. Elas nao
    // existem mais: so o que e' identidade real atravessa.
    if (!u || typeof u.EMAIL !== 'string') return null;
    return { ID: Number(u.ID) || 0, EMAIL: u.EMAIL, NOME: String(u.NOME || '') };
  } catch {
    return null;
  }
}

export function setUser(u: AuthUser): void {
  localStorage.setItem(KEY, JSON.stringify({ ID: u.ID, EMAIL: u.EMAIL, NOME: u.NOME }));
}

export function clearUser(): void {
  localStorage.removeItem(KEY);
}
