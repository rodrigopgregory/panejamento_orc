// ──────────────────────────────────────────────────────────────────────
// Sessao entregue pelo INVOLUCRO (workspace) — o aperto de mao que ele espera.
//
// O app roda dentro de um iframe do workspace, onde a pessoa JA esta logada.
// O involucro NAO empurra a sessao sozinho: ele so' RESPONDE a quem pedir.
// O contrato (lido do proprio bundle do workspace) e' este:
//
//   app  -> involucro : { type: 'mitra-preview-login-request' }
//   involucro -> app  : { type: 'mitra-preview-login-response',
//                         session: { baseURL, token, refreshToken? } }
//
// Ao receber o pedido, o involucro localiza qual dos iframes de produto
// perguntou (comparando com o `contentWindow` de cada um), emite um token de
// acesso daquele app e devolve a sessao apontando para o gateway dele.
//
// Sem esse pedido nada chega: era por isso que o app caia na tela de login
// mesmo com a pessoa logada no workspace. Os outros caminhos que ja existiam
// nao cobrem este cenario — o hand-off por fragment (#tokenMitra) depende de
// uma sessao legada no armazenamento do workspace, e o login silencioso
// pergunta a uma pagina de auth de OUTRA origem, que nao tem o cookie de quem
// entrou no workspace.
//
// Confianca: o pedido nao carrega segredo nenhum (pode ir para qualquer
// origem), mas a RESPOSTA traz um token e o endereco de quem vamos obedecer —
// entao ela so' e' aceita de uma janela que esta' acima de nos na hierarquia,
// de origem da plataforma, e apontando para um gateway da plataforma.
// ──────────────────────────────────────────────────────────────────────

export const PEDIDO_SESSAO = 'mitra-preview-login-request';
export const RESPOSTA_SESSAO = 'mitra-preview-login-response';

export interface SessaoInvolucro {
  token: string;
  baseURL: string;
}

// Origem que pode nos entregar uma sessao: a propria plataforma.
const ORIGEM_CONFIAVEL = /^https:\/\/([a-z0-9-]+\.)*mitralab\.io$/i;
// Endereco que podemos passar a obedecer como backend.
const HOST_API_CONFIAVEL = /(^|\.)(mitralab\.io|mitrasheet\.com)$/i;

// Reenvios: o involucro ja' esta' escutando quando o app carrega, mas o iframe
// pode ainda nao estar no mapa dele (ou a resposta depende de uma chamada de
// rede). Insistir algumas vezes custa nada e cobre a corrida.
const REENVIOS_MS = [0, 250, 1000, 2500];

function janelasAcima(): Window[] {
  const fora: Window[] = [];
  if (typeof window === 'undefined') return fora;
  let atual: Window = window;
  for (let i = 0; i < 5; i++) {
    const pai = atual.parent;
    if (!pai || pai === atual) break;
    fora.push(pai);
    atual = pai;
  }
  return fora;
}

function sessaoValida(dado: unknown): SessaoInvolucro | null {
  if (!dado || typeof dado !== 'object') return null;
  const s = dado as Record<string, unknown>;
  const token = typeof s.token === 'string' ? s.token.trim() : '';
  const baseURL = typeof s.baseURL === 'string' ? s.baseURL.trim() : '';
  if (!token || !baseURL) return null;
  let host = '';
  try {
    const u = new URL(baseURL);
    if (u.protocol !== 'https:') return null;
    host = u.hostname;
  } catch {
    return null;
  }
  if (!HOST_API_CONFIAVEL.test(host)) return null;
  return { token, baseURL };
}

// Pergunta ao involucro se ha' sessao para este app. Resolve com a sessao
// quando ele responde, ou null quando nao estamos embutidos, ninguem responde
// a tempo, ou a resposta nao passa nas verificacoes acima.
export function pedirSessaoAoInvolucro(timeoutMs = 5000): Promise<SessaoInvolucro | null> {
  if (typeof window === 'undefined') return Promise.resolve(null);
  const acima = janelasAcima();
  if (!acima.length) return Promise.resolve(null);

  return new Promise<SessaoInvolucro | null>((resolve) => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    let encerrado = false;

    function encerrar(valor: SessaoInvolucro | null) {
      if (encerrado) return;
      encerrado = true;
      window.removeEventListener('message', aoReceber);
      timers.forEach(clearTimeout);
      resolve(valor);
    }

    function aoReceber(e: MessageEvent) {
      const dado = e.data as { type?: unknown; session?: unknown } | null;
      if (!dado || typeof dado !== 'object' || dado.type !== RESPOSTA_SESSAO) return;
      // Quem responde tem que ser uma janela acima de nos, de origem da
      // plataforma. Uma pagina qualquer que nos embuta nao entra aqui.
      if (!ORIGEM_CONFIAVEL.test(e.origin)) return;
      if (!acima.some((j) => j === e.source)) return;
      const sessao = sessaoValida(dado.session);
      if (!sessao) return;
      encerrar(sessao);
    }

    window.addEventListener('message', aoReceber);

    // O pedido e' vazio de proposito — pode ir para qualquer origem porque nao
    // revela nada. Nao sabemos a origem do involucro para restringir aqui.
    const perguntar = () => {
      if (encerrado) return;
      for (const janela of acima) {
        try { janela.postMessage({ type: PEDIDO_SESSAO }, '*'); } catch { /* janela sumiu */ }
      }
    };
    for (const atraso of REENVIOS_MS) timers.push(setTimeout(perguntar, atraso));
    timers.push(setTimeout(() => encerrar(null), timeoutMs));
  });
}
