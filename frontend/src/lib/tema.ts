// Tema e' decisao do workspace/plataforma — o app apenas OBEDECE.
// Nao existe toggle local: nada aqui escreve preferencia de tema.
//
// NAO da' para depender de UMA chave de localStorage: o app roda dentro de um
// iframe de preview que pode estar em ORIGEM DIFERENTE da plataforma (ai o
// localStorage nem e' o mesmo) e o nome da chave da casca nao e' contrato
// publico. Entao a deteccao e' em camadas, da pista mais explicita para a mais
// indireta, e a primeira que responder vence.
//
// A escuta e' de MODULO, ligada no boot pelo main.tsx — nao de componente.
// Assim vale para o app inteiro, inclusive as telas publicas (sem login), que
// nao passam pela casca do Layout.

type Tema = 'light' | 'dark';

const CHAVES_TEMA = /(theme|tema|appearance|color[-_]?scheme|modo?)/i;
const VALOR_TEMA = /^"?(dark|light)"?$/i;
// Chave da era do toggle local. So' e' limpa para nao sobreviver como
// preferencia fantasma disputando com o tema do workspace.
const CHAVE_LEGADA = 'budget-corp-theme';

const consultaEscuro = () => window.matchMedia('(prefers-color-scheme: dark)');

function normalizar(v: unknown): Tema | null {
  if (typeof v !== 'string') return null;
  const m = v.trim().replace(/^"|"$/g, '').toLowerCase();
  if (m === 'dark' || m === 'light') return m;
  return null;
}

// --- Camada 1: hand-off explicito na URL (?theme=dark, #themeMitra=dark) ----
function lerTemaDaUrl(): Tema | null {
  if (typeof window === 'undefined') return null;
  const fontes = [window.location.search.slice(1), window.location.hash.slice(1)];
  for (const fonte of fontes) {
    if (!fonte) continue;
    const params = new URLSearchParams(fonte);
    for (const [chave, valor] of params) {
      if (!CHAVES_TEMA.test(chave)) continue;
      const t = normalizar(valor);
      if (t) return t;
    }
  }
  return null;
}

// Capturado na AVALIACAO DO MODULO, nao na primeira chamada: o initMitra()
// limpa o fragment da URL (#tokenMitra=...) assim que consome a sessao. Se o
// tema viajar junto nesse fragment, ler depois seria ler o que ja foi apagado.
const temaDaUrl: Tema | null = lerTemaDaUrl();

// --- Camada 2: tema anunciado pela plataforma via postMessage --------------
let temaAnunciado: Tema | null = null;

// Nao ha contrato publico de formato, entao a leitura e' agnostica: procura
// qualquer chave com cara de tema e valor dark/light, ate' 3 niveis de
// aninhamento, e aceita tambem a mensagem que e' so' a string 'dark'/'light'.
function temaDeMensagem(dado: unknown, profundidade = 0, jaIdentificada = false): Tema | null {
  const direto = normalizar(dado);
  if (direto) return direto;
  if (!dado || typeof dado !== 'object' || profundidade > 3) return null;
  const obj = dado as Record<string, unknown>;

  // 1. Chave com cara de tema: { theme: 'dark' }, { colorScheme: 'dark' }...
  for (const [chave, valor] of Object.entries(obj)) {
    if (CHAVES_TEMA.test(chave)) {
      const t = normalizar(valor);
      if (t) return t;
    }
  }

  // 2. A mensagem se identifica como sendo de tema pelo proprio conteudo
  // ({ type: 'mitra:theme', value: 'dark' }) — ai qualquer dark/light dela
  // vale, venha na chave que vier.
  const eDeTema = jaIdentificada
    || Object.values(obj).some((v) => typeof v === 'string' && CHAVES_TEMA.test(v));
  if (eDeTema) {
    for (const valor of Object.values(obj)) {
      const t = normalizar(valor);
      if (t) return t;
    }
  }

  // 3. Desce em objetos aninhados (payload, data, detail...).
  for (const valor of Object.values(obj)) {
    if (valor && typeof valor === 'object') {
      const t = temaDeMensagem(valor, profundidade + 1, eDeTema);
      if (t) return t;
    }
  }
  return null;
}

// --- Camada 3: a casca da plataforma, quando e' mesma origem ---------------
// Esta e' a pista mais confiavel que existe: nao e' palpite de chave, e' o
// estado RENDERIZADO da plataforma. Cross-origin, o acesso lanca e cai fora.
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

function documentosAcessiveis(): Document[] {
  const docs: Document[] = [];
  for (const janela of janelasAcima()) {
    try {
      const doc = janela.document;
      // Acesso cross-origin lanca antes daqui; o teste confirma que e' util.
      if (doc?.documentElement) docs.push(doc);
    } catch { /* origem diferente: essa casca e' invisivel para nos */ }
  }
  return docs;
}

function temaDeclaradoNoDocumento(doc: Document): Tema | null {
  const raiz = doc.documentElement;
  const corpo = doc.body;
  for (const el of [raiz, corpo].filter(Boolean) as HTMLElement[]) {
    for (const attr of el.getAttributeNames()) {
      if (attr !== 'class' && CHAVES_TEMA.test(attr)) {
        const t = normalizar(el.getAttribute(attr));
        if (t) return t;
      }
    }
    const classes = el.className && typeof el.className === 'string' ? el.className : '';
    if (/(^|[\s-])(dark|theme-dark)($|[\s-])/.test(classes)) return 'dark';
    if (/(^|[\s-])(light|theme-light)($|[\s-])/.test(classes)) return 'light';
  }
  return normalizar(doc.defaultView?.getComputedStyle(raiz).colorScheme);
}

// Fundo escuro = tema escuro. Independe de nome de classe/atributo/chave, so'
// olha o pixel que a plataforma esta' de fato pintando.
function temaPorLuminancia(doc: Document): Tema | null {
  const alvos = [doc.body, doc.documentElement].filter(Boolean) as HTMLElement[];
  for (const alvo of alvos) {
    const cor = doc.defaultView?.getComputedStyle(alvo).backgroundColor || '';
    const m = cor.match(/rgba?\(([^)]+)\)/i);
    if (!m) continue;
    const partes = m[1].split(',').map((p) => parseFloat(p));
    const [r, g, b] = partes;
    const alfa = partes.length > 3 ? partes[3] : 1;
    if (!alfa || [r, g, b].some((n) => Number.isNaN(n))) continue; // transparente: tenta o proximo
    const luz = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    return luz < 0.5 ? 'dark' : 'light';
  }
  return null;
}

// --- Camada 4: localStorage (o proprio, e o da casca se for mesma origem) --
function temaDoArmazenamento(store: Storage | undefined): Tema | null {
  if (!store) return null;
  try {
    for (let i = 0; i < store.length; i++) {
      const chave = store.key(i);
      if (!chave || !CHAVES_TEMA.test(chave)) continue;
      const valor = store.getItem(chave);
      if (valor && VALOR_TEMA.test(valor.trim())) return normalizar(valor);
    }
  } catch { /* sem persistencia acessivel */ }
  return null;
}

function resolverTema(): { tema: Tema; camada: string } {
  if (temaDaUrl) return { tema: temaDaUrl, camada: 'url' };
  if (temaAnunciado) return { tema: temaAnunciado, camada: 'postMessage' };

  // Duas passadas de proposito. A luminancia do fundo e' um bom ultimo
  // recurso, mas um container intermediario claro em volta do preview
  // responderia "light" com a plataforma escura — entao ela so' entra depois
  // de TODOS os sinais explicitos, e comecando pela casca mais externa (a
  // plataforma de verdade, nao o quadro do preview).
  const docs = documentosAcessiveis();

  for (const doc of docs) {
    const t = temaDeclaradoNoDocumento(doc);
    if (t) return { tema: t, camada: 'casca:declarado' };
  }

  for (const doc of docs) {
    const t = temaDoArmazenamento(doc.defaultView?.localStorage);
    if (t) return { tema: t, camada: 'casca:localStorage' };
  }

  const doProprio = temaDoArmazenamento(
    (() => { try { return window.localStorage; } catch { return undefined; } })(),
  );
  if (doProprio) return { tema: doProprio, camada: 'localStorage' };

  for (const doc of [...docs].reverse()) {
    const t = temaPorLuminancia(doc);
    if (t) return { tema: t, camada: 'casca:luminancia' };
  }

  return { tema: consultaEscuro().matches ? 'dark' : 'light', camada: 'sistema' };
}

function aplicar(t: Tema) {
  const raiz = document.documentElement;
  // data-theme e' a fonte do design system; a classe .dark acompanha para o
  // variante `dark:` do Tailwind e para as regras legadas do index.css.
  raiz.dataset.theme = t;
  raiz.classList.toggle('dark', t === 'dark');
  raiz.style.colorScheme = t;
}

// Diagnostico exposto em window.__tema: sem acesso ao preview rodando, e' a
// unica forma de saber POR QUE um tema foi escolhido (e o que a plataforma
// esta', ou nao esta', mandando).
const mensagensVistas: unknown[] = [];

// Aplica o tema atual e passa a seguir a plataforma enquanto o app viver.
export function sincronizarTemaDaPlataforma() {
  try { localStorage.removeItem(CHAVE_LEGADA); } catch { /* sem persistencia */ }

  let ultima = resolverTema();
  const revalidar = () => {
    ultima = resolverTema();
    aplicar(ultima.tema);
    publicarDiagnostico();
  };

  function publicarDiagnostico() {
    try {
      (window as unknown as Record<string, unknown>).__tema = {
        tema: ultima.tema,
        camada: ultima.camada,
        emIframe: window.parent !== window,
        cascasAcessiveis: documentosAcessiveis().length,
        temaDaUrl,
        temaAnunciado,
        mensagens: mensagensVistas,
      };
    } catch { /* ignore */ }
  }

  aplicar(ultima.tema);
  publicarDiagnostico();

  // Plataforma trocou o tema em outra aba/frame da mesma origem.
  window.addEventListener('storage', revalidar);
  // Sem tema definido em lugar nenhum, vale o SO — e ele pode mudar.
  consultaEscuro().addEventListener('change', revalidar);
  // Mudanca no MESMO documento nao dispara `storage`; revalida ao voltar.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) revalidar(); });

  // A casca acessivel mudou de tema (classe/atributo no <html> ou <body>).
  for (const doc of documentosAcessiveis()) {
    try {
      const observador = new MutationObserver(revalidar);
      const opcoes: MutationObserverInit = { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] };
      observador.observe(doc.documentElement, opcoes);
      if (doc.body) observador.observe(doc.body, opcoes);
    } catch { /* casca sumiu ou virou cross-origin */ }
  }

  // Unico canal que funciona cross-origin: a plataforma anunciar o tema.
  window.addEventListener('message', (e: MessageEvent) => {
    if (mensagensVistas.length < 30) mensagensVistas.push({ origem: e.origin, dado: e.data });
    const t = temaDeMensagem(e.data);
    if (!t || t === temaAnunciado) return;
    temaAnunciado = t;
    revalidar();
  });
  // Pede o tema a quem embutiu o app. Se a plataforma nao implementa, o
  // pedido simplesmente cai no vazio — nao ha dado sensivel na mensagem.
  for (const janela of janelasAcima()) {
    for (const tipo of ['mitra-theme-request', 'mitra:theme:request', 'theme-request']) {
      try { janela.postMessage({ type: tipo, source: 'mitra-app' }, '*'); } catch { /* ignore */ }
    }
  }
}
