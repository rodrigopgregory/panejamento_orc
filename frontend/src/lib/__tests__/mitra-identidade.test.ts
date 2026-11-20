// QUEM o app diz ser para a plataforma.
//
// O token do .env (VITE_MITRA_TOKEN) e um JWT da conta CRIADORA do projeto.
// Enquanto ele servia de fallback geral, qualquer situacao sem sessao valida
// — inclusive a sessao EXPIRADA de um login real — fazia o app continuar
// funcionando sob a identidade do criador. Nada quebrava: a pessoa seguia
// navegando, e a plataforma respondia tudo (dados, e as credenciais de IA
// conectadas) como se fosse o dono. Foi assim que a assinatura pessoal dele
// apareceu como "conectada" para outro usuario logado.
//
// A regra que este arquivo protege, agora sem excecao: o token do .env NUNCA
// e identidade. Nao ha mais personas de demonstracao para dar corpo a ele.
// Sem sessao de login real valida, o app fica sem token e manda logar de novo.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const configureSdkMitra = vi.fn();
vi.mock('mitra-interactions-sdk', () => ({
  configureSdkMitra: (...a: any[]) => configureSdkMitra(...a),
  closeChatMitra: vi.fn(),
}));

// JWT falso: so o payload importa (decodeJwt le a parte do meio).
function jwt(payload: Record<string, unknown>): string {
  const b64 = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_');
  return `x.${b64}.y`;
}

const DAQUI_A_ANOS = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365;
const ONTEM = Math.floor(Date.now() / 1000) - 60 * 60 * 24;

const TOKEN_DO_CRIADOR = jwt({
  sub: 'dona@empresa.com', tni: 52483, accessType: 'CREATOR',
  backURL: 'https://plataforma.exemplo', exp: DAQUI_A_ANOS,
});

function logarComo(email: string) {
  localStorage.setItem('planej-user', JSON.stringify({ ID: 1, EMAIL: email, NOME: 'x' }));
}

function comSessao(exp: number) {
  localStorage.setItem('mitra-session', JSON.stringify({
    token: jwt({ sub: 'pessoa@empresa.com', exp }),
    baseURL: 'https://plataforma.exemplo',
  }));
}

// Token de login legitimo que simplesmente nao traz `exp`.
function comSessaoSemExp() {
  localStorage.setItem('mitra-session', JSON.stringify({
    token: jwt({ sub: 'pessoa@empresa.com' }),
    baseURL: 'https://plataforma.exemplo',
  }));
}

// Import dinamico: mitra-config le import.meta.env no topo do modulo.
async function initMitra() {
  vi.resetModules();
  vi.stubEnv('VITE_MITRA_TOKEN', TOKEN_DO_CRIADOR);
  vi.stubEnv('VITE_MITRA_PROJECT_ID', '52483');
  vi.stubEnv('VITE_MITRA_BASE_URL', 'https://plataforma.exemplo');
  const mod = await import('../../mitra-config');
  mod.initMitra();
}

function tokenEnviado(): string | undefined {
  const ultima = configureSdkMitra.mock.calls.at(-1)?.[0];
  return ultima?.token;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  window.history.replaceState({}, '', '/');
});

const TOKEN_ENTREGUE = jwt({ sub: 'saraharantes@exemplo.com', exp: DAQUI_A_ANOS });

// A plataforma entrega a sessao de quem ja esta logado LA pelo fragment da
// URL ao abrir o app: #tokenMitra=...&backURLMitra=...
function comHandOffNaUrl(token: string = TOKEN_ENTREGUE) {
  window.location.hash = `#tokenMitra=${token}&backURLMitra=${encodeURIComponent('https://plataforma.exemplo')}`;
}

describe('identidade usada pela SDK', () => {
  it('login real com sessao valida: usa o token DELE', async () => {
    logarComo('pessoa@empresa.com');
    comSessao(DAQUI_A_ANOS);

    await initMitra();

    expect(tokenEnviado()).toBeTruthy();
    expect(tokenEnviado()).not.toBe(TOKEN_DO_CRIADOR);
  });

  // O caminho do vazamento: a sessao vence em silencio e o app seguia como o dono.
  it('login real com sessao EXPIRADA: nao cai no token do criador e exige novo login', async () => {
    logarComo('pessoa@empresa.com');
    comSessao(ONTEM);

    await initMitra();

    expect(tokenEnviado()).toBeUndefined();
    // usuario local derrubado => o App manda para a tela de login
    expect(localStorage.getItem('planej-user')).toBeNull();
  });

  // Um token que nao se consegue DATAR nao e um token invalido. Descartar a
  // sessao aqui era o que empurrava a pessoa para o token de build — logada na
  // tela, atendida como a conta criadora. Se o token nao servir mesmo, quem
  // diz e o servidor; isso e recuperavel, trocar de identidade nao e.
  it('sessao real SEM claim exp: mantida, nunca trocada pelo token do criador', async () => {
    logarComo('pessoa@empresa.com');
    comSessaoSemExp();

    await initMitra();

    expect(tokenEnviado()).toBeTruthy();
    expect(tokenEnviado()).not.toBe(TOKEN_DO_CRIADOR);
    expect(localStorage.getItem('mitra-session')).toBeTruthy();
  });

  it('login real sem sessao nenhuma: SDK fica sem token', async () => {
    logarComo('pessoa@empresa.com');

    await initMitra();

    expect(tokenEnviado()).toBeUndefined();
  });

  it('boot sem ninguem logado: SDK fica sem token', async () => {
    await initMitra();

    expect(tokenEnviado()).toBeUndefined();
  });

  // Nao ha mais persona nenhuma para justificar o token de build: com
  // VITE_MITRA_TOKEN presente no ambiente e ninguem logado, a SDK fica MUDA.
  it('token do .env presente e sem sessao: a SDK nao o usa como identidade', async () => {
    await initMitra();

    expect(tokenEnviado()).toBeUndefined();
    expect(tokenEnviado()).not.toBe(TOKEN_DO_CRIADOR);
  });

  // Logada na PLATAFORMA: o token chega pelo fragment da URL ao abrir o app. A
  // versao custom do auth tinha apagado essa leitura — o app jogava fora a
  // sessao real entregue e tratava a pessoa como anonima.
  it('token entregue pela plataforma no fragment: vira sessao real do app', async () => {
    comHandOffNaUrl();

    await initMitra();

    expect(tokenEnviado()).toBe(`Bearer ${TOKEN_ENTREGUE}`);
    expect(tokenEnviado()).not.toBe(TOKEN_DO_CRIADOR);
    // persistida: sobrevive a navegacao e ao F5
    expect(localStorage.getItem('mitra-session')).toContain(TOKEN_ENTREGUE);
    // fragment limpo: o token nao fica exposto na barra de endereco
    expect(window.location.hash).toBe('');
  });

  // O involucro da plataforma entrega o token, mas ninguem passou pela tela de
  // login — e o App exigia o espelho local ('planej-user') que so o login
  // criava. Resultado: token valido em maos e tela de login na frente. O
  // espelho agora nasce da propria sessao, com o e-mail do token.
  it('hand-off da plataforma sem login previo: espelho local nasce do token (app entra direto)', async () => {
    comHandOffNaUrl();

    await initMitra();

    const espelho = JSON.parse(localStorage.getItem('planej-user') || 'null');
    expect(espelho).toMatchObject({ EMAIL: 'saraharantes@exemplo.com', NOME: 'saraharantes' });
  });

  it('sessao valida no localStorage sem espelho local: espelho nasce do token', async () => {
    comSessao(DAQUI_A_ANOS);

    await initMitra();

    expect(tokenEnviado()).toBeTruthy();
    const espelho = JSON.parse(localStorage.getItem('planej-user') || 'null');
    expect(espelho).toMatchObject({ EMAIL: 'pessoa@empresa.com' });
  });

  it('hand-off da plataforma com usuario local antigo: identidade e a da sessao entregue', async () => {
    logarComo('pessoa@empresa.com');
    comHandOffNaUrl();

    await initMitra();

    expect(tokenEnviado()).toBe(`Bearer ${TOKEN_ENTREGUE}`);
    expect(tokenEnviado()).not.toBe(TOKEN_DO_CRIADOR);
  });

  it('hand-off vence sessao antiga do localStorage: o token recem-emitido e o mais fresco', async () => {
    comSessao(DAQUI_A_ANOS);
    comHandOffNaUrl();

    await initMitra();

    expect(tokenEnviado()).toBe(`Bearer ${TOKEN_ENTREGUE}`);
  });

  it('tokenMitra=error no fragment: nao cria sessao e limpa a URL', async () => {
    window.location.hash = '#tokenMitra=error';

    await initMitra();

    expect(tokenEnviado()).toBeUndefined();
    expect(localStorage.getItem('mitra-session')).toBeNull();
    expect(window.location.hash).toBe('');
  });
});
