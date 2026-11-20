// Entrar sem pedir login quando a pessoa JA esta logada na plataforma
// (involucro). Sem sessao no app, a SDK pergunta a pagina de auth da
// plataforma, por iframe invisivel, se ha alguem logado la — e herda o token.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const pedirSessaoAoInvolucro = vi.fn();
vi.mock('../sessao-involucro', () => ({
  pedirSessaoAoInvolucro: (...a: any[]) => pedirSessaoAoInvolucro(...a),
  PEDIDO_SESSAO: 'mitra-preview-login-request',
  RESPOSTA_SESSAO: 'mitra-preview-login-response',
}));

const configureSdkMitra = vi.fn();
const refreshTokenSilently = vi.fn();
const executeServerFunctionMitra = vi.fn();
vi.mock('mitra-interactions-sdk', () => ({
  configureSdkMitra: (...a: any[]) => configureSdkMitra(...a),
  refreshTokenSilently: (...a: any[]) => refreshTokenSilently(...a),
  executeServerFunctionMitra: (...a: any[]) => executeServerFunctionMitra(...a),
  closeChatMitra: vi.fn(),
}));

function jwt(payload: Record<string, unknown>): string {
  const b64 = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_');
  return `x.${b64}.y`;
}
const DAQUI_A_ANOS = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 365;
const TOKEN_DA_PLATAFORMA = jwt({ sub: 'sarah@empresa.com', exp: DAQUI_A_ANOS });

async function carregar() {
  vi.resetModules();
  vi.stubEnv('VITE_MITRA_PROJECT_ID', '59648');
  vi.stubEnv('VITE_MITRA_BASE_URL', 'https://plataforma.exemplo');
  vi.stubEnv('VITE_MITRA_AUTH_URL', 'https://auth.exemplo/sdk-auth/');
  return import('../sessao-plataforma');
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  executeServerFunctionMitra.mockRejectedValue(new Error('sem INT_USER no teste'));
  // Por padrao o involucro nao responde — cada teste que exercita esse caminho
  // diz o que ele devolve.
  pedirSessaoAoInvolucro.mockResolvedValue(null);
});

describe('recuperarSessaoDaPlataforma', () => {
  it('logada na plataforma: herda o token, grava a sessao e hidrata o usuario — sem tela de login', async () => {
    refreshTokenSilently.mockResolvedValue({ token: TOKEN_DA_PLATAFORMA, baseURL: 'https://plataforma.exemplo' });
    const mod = await carregar();

    const ok = await mod.recuperarSessaoDaPlataforma();

    expect(ok).toBe(true);
    expect(refreshTokenSilently).toHaveBeenCalledWith('https://auth.exemplo/sdk-auth/', 59648);
    // sessao real gravada e SDK configurada com o token herdado
    expect(localStorage.getItem('mitra-session')).toContain(TOKEN_DA_PLATAFORMA);
    expect(configureSdkMitra.mock.calls.at(-1)?.[0]?.token).toBe(`Bearer ${TOKEN_DA_PLATAFORMA}`);
    // espelho local de quem entrou
    const espelho = JSON.parse(localStorage.getItem('planej-user') || 'null');
    expect(espelho).toMatchObject({ EMAIL: 'sarah@empresa.com', NOME: 'sarah' });
  });

  it('ninguem logado na plataforma: nao cria sessao e o app cai no login', async () => {
    refreshTokenSilently.mockRejectedValue(new Error('Erro no refresh do token'));
    const mod = await carregar();

    const ok = await mod.recuperarSessaoDaPlataforma();

    expect(ok).toBe(false);
    expect(localStorage.getItem('mitra-session')).toBeNull();
    expect(localStorage.getItem('planej-user')).toBeNull();
  });

  it('sem authUrl no ambiente: nem tenta o iframe', async () => {
    vi.resetModules();
    vi.stubEnv('VITE_MITRA_PROJECT_ID', '59648');
    vi.stubEnv('VITE_MITRA_BASE_URL', 'https://plataforma.exemplo');
    vi.stubEnv('VITE_MITRA_AUTH_URL', '');
    const mod = await import('../sessao-plataforma');

    expect(await mod.recuperarSessaoDaPlataforma()).toBe(false);
    expect(refreshTokenSilently).not.toHaveBeenCalled();
  });

  it('sessao valida ja gravada: responde true sem ir ao auth', async () => {
    localStorage.setItem('mitra-session', JSON.stringify({ token: TOKEN_DA_PLATAFORMA, baseURL: 'https://plataforma.exemplo' }));
    const mod = await carregar();

    expect(await mod.recuperarSessaoDaPlataforma()).toBe(true);
    expect(refreshTokenSilently).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem('planej-user') || 'null')).toMatchObject({ EMAIL: 'sarah@empresa.com' });
  });

  it('chamadas concorrentes (StrictMode) compartilham uma unica tentativa', async () => {
    let resolver!: (v: any) => void;
    refreshTokenSilently.mockReturnValue(new Promise((r) => { resolver = r; }));
    const mod = await carregar();

    const a = mod.recuperarSessaoDaPlataforma();
    const b = mod.recuperarSessaoDaPlataforma();
    resolver({ token: TOKEN_DA_PLATAFORMA, baseURL: 'https://plataforma.exemplo' });

    expect(await Promise.all([a, b])).toEqual([true, true]);
    expect(refreshTokenSilently).toHaveBeenCalledTimes(1);
  });
});

describe('hidratarUsuarioLogado', () => {
  it('INT_USER responde: usa ID e e-mail de la', async () => {
    localStorage.setItem('mitra-session', JSON.stringify({ token: TOKEN_DA_PLATAFORMA, baseURL: 'https://plataforma.exemplo' }));
    executeServerFunctionMitra.mockResolvedValue({ result: { output: { rows: [{ ID: 77, EMAIL: 'sarah@empresa.com' }] } } });
    const mod = await carregar();

    const u = await mod.hidratarUsuarioLogado();

    expect(u).toEqual({ ID: 77, EMAIL: 'sarah@empresa.com', NOME: 'sarah' });
    expect(executeServerFunctionMitra.mock.calls[0][0]).toMatchObject({ serverFunctionId: 40, input: {} });
  });

  it('INT_USER vazio (primeiro acesso): fica o e-mail do token, ID 0', async () => {
    localStorage.setItem('mitra-session', JSON.stringify({ token: TOKEN_DA_PLATAFORMA, baseURL: 'https://plataforma.exemplo' }));
    executeServerFunctionMitra.mockResolvedValue({ result: { output: { rows: [] } } });
    const mod = await carregar();

    expect(await mod.hidratarUsuarioLogado()).toEqual({ ID: 0, EMAIL: 'sarah@empresa.com', NOME: 'sarah' });
  });

  it('enriquecerUsuarioSeNecessario: so age quando o espelho nao tem ID', async () => {
    localStorage.setItem('mitra-session', JSON.stringify({ token: TOKEN_DA_PLATAFORMA, baseURL: 'https://plataforma.exemplo' }));
    localStorage.setItem('planej-user', JSON.stringify({ ID: 5, EMAIL: 'sarah@empresa.com', NOME: 'sarah' }));
    const mod = await carregar();

    mod.enriquecerUsuarioSeNecessario();
    expect(executeServerFunctionMitra).not.toHaveBeenCalled();

    localStorage.setItem('planej-user', JSON.stringify({ ID: 0, EMAIL: 'sarah@empresa.com', NOME: 'sarah' }));
    mod.enriquecerUsuarioSeNecessario();
    expect(executeServerFunctionMitra).toHaveBeenCalledTimes(1);
  });
});


// O caminho que faltava: dentro do workspace, o app PEDE a sessao e o involucro
// responde. Sem esse pedido a pessoa via a tela de login mesmo ja logada la.
describe('sessao entregue pelo involucro (workspace)', () => {
  const DO_INVOLUCRO = { token: TOKEN_DA_PLATAFORMA, baseURL: 'https://beta.mitralab.io/legacy' };

  it('adota a sessao do involucro e nem chega a tentar o login silencioso', async () => {
    pedirSessaoAoInvolucro.mockResolvedValue(DO_INVOLUCRO);
    executeServerFunctionMitra.mockResolvedValue({ result: { output: { rows: [] } } });
    const mod = await carregar();

    expect(await mod.recuperarSessaoDaPlataforma()).toBe(true);
    expect(refreshTokenSilently).not.toHaveBeenCalled();
    const gravada = JSON.parse(localStorage.getItem('mitra-session') || 'null');
    expect(gravada).toMatchObject({ token: `Bearer ${TOKEN_DA_PLATAFORMA}`, baseURL: DO_INVOLUCRO.baseURL });
    expect(JSON.parse(localStorage.getItem('planej-user') || 'null')).toMatchObject({ EMAIL: 'sarah@empresa.com' });
  });

  it('sessao que nao fala pelo projeto e recusada: nada fica gravado e o app segue tentando', async () => {
    pedirSessaoAoInvolucro.mockResolvedValue(DO_INVOLUCRO);
    // A prova falha (token nao autoriza este projeto).
    executeServerFunctionMitra.mockRejectedValue(new Error('401'));
    refreshTokenSilently.mockRejectedValue(new Error('ninguem logado'));
    const mod = await carregar();

    expect(await mod.recuperarSessaoDaPlataforma()).toBe(false);
    expect(localStorage.getItem('mitra-session')).toBeNull();
    // e ainda assim tentou o caminho seguinte
    expect(refreshTokenSilently).toHaveBeenCalled();
  });

  it('involucro sem resposta: cai no login silencioso, como antes', async () => {
    pedirSessaoAoInvolucro.mockResolvedValue(null);
    refreshTokenSilently.mockResolvedValue({ token: TOKEN_DA_PLATAFORMA, baseURL: 'https://plataforma.exemplo' });
    const mod = await carregar();

    expect(await mod.recuperarSessaoDaPlataforma()).toBe(true);
    expect(refreshTokenSilently).toHaveBeenCalled();
  });
});
