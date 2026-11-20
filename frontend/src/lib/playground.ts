// ──────────────────────────────────────────────────────────────────────
// Playground — contratos das SFs, tipos do chat (segmentos), contexto
// injetado na 1a mensagem da thread e helpers de apresentação.
// ──────────────────────────────────────────────────────────────────────
import { execSF } from '../hooks/useMitraData';
import { manageAgentCredentialMitra } from 'mitra-interactions-sdk';

// IDs reais criados por backend/add-playground.mjs (validados pela suite)
export const SF_PG = {
  consultaLivre: 176,
  schemaResumo: 177,
  criar: 178,
  ultimo: 179,
  listar: 180,
  get: 181,
  excluir: 182,
  setTask: 183,
  compartilhar: 184,
  publico: 185,
  versoes: 186,
  salvarHtml: 187,
  salvarConversa: 188,
  renomear: 189,
  restaurar: 190,
} as const;

// Tipo de agente do analista. NAO existe modelo cravado no codigo: quem
// escolhe e o admin, na tela de Governanca de IA (APP_CONFIG.AGENT_MODEL_ID),
// entre os modelos que a credencial realmente oferece. Sem escolha gravada, o
// modo automatico decide pelo list_models (ver escolherModelo) — cravar um
// modelId que a conta nao tem fazia toda pergunta falhar com "model not
// available", e o app lia isso como "falta credencial".
export const PG_AGENT_TYPE = 'claudecode';

// ── As DUAS realidades de credencial ────────────────────────────────────
// 1. DA EMPRESA (compartilhada) — uma connection do projeto, criada nas
//    configuracoes da plataforma (aba de IA) e apontada aqui pelo
//    identificador guardado em APP_CONFIG.AGENT_CONNECTION_ID. Tem
//    PRIORIDADE: a razao de ela existir e que TODOS consumam a IA pela
//    MESMA credencial, sem ninguem precisar plugar chave propria.
// 2. DO USUARIO — cada pessoa conecta a propria assinatura/chave no painel
//    do chat. E a rede de seguranca: vale quando a compartilhada nao esta
//    disponivel.
//
// NUNCA a credencial de OUTRO usuario — em especial a do dono do sistema.
// Esse vazamento acontece sozinho quando se omite o connectionId: omitir NAO
// significa "modo automatico", significa "use a credencial pessoal de quem
// esta chamando". Como quem configura o sistema costuma ser o dono (que tem
// chave propria), o sistema inteiro passava a depender da assinatura dele.
//
// A escolha e automatica, mas NUNCA silenciosa: a tela diz qual esta valendo.
// Sem isso, "funciona pra um e nao funciona pro outro" parece defeito.
export const SF_AGENTE = {
  lerConfig: 237,    // lerConfigAgenteIA    (SQL) — sem params
  gravarConfig: 238, // gravarConfigAgenteIA (SQL) — { chave, valor, quando }
} as const;

export type OrigemCredencial = 'usuario' | 'empresa';

export interface CredencialEscolhida {
  modelId: string;
  connectionId: string; // '' quando e a do proprio usuario
  origem: OrigemCredencial;
  // Identificador que foi informado mas a plataforma NAO reconheceu (devolveu
  // a mesma lista da credencial pessoal). Existe para a tela poder dizer isso
  // em voz alta — sem ele o sintoma e invisivel.
  idIgnorado?: string;
}

export function rotuloOrigem(origem: OrigemCredencial): string {
  return origem === 'usuario' ? 'sua conta' : 'credencial da empresa';
}

// Estado REAL da credencial, em uma frase. Texto fixo afirmando o que o codigo
// deveria fazer ("a credencial vem da conexao do projeto") e pior que texto
// nenhum: foi o que escondeu, por semanas, o app rodando na credencial pessoal
// enquanto o painel jurava o contrario. Aqui a frase e derivada do que foi
// resolvido, nunca escrita a mao na tela.
export function descreverOrigem(c: Pick<CredencialEscolhida, 'origem' | 'connectionId' | 'idIgnorado'>): string {
  const recusado = c.idIgnorado
    ? ` O identificador "${c.idIgnorado}" foi recusado pela plataforma (devolveu a mesma lista da credencial pessoal).`
    : '';
  return c.origem === 'empresa'
    ? `Origem: conexão do projeto ("${c.connectionId}") — vale para todos os usuários.${recusado}`
    : `Origem: a credencial pessoal de quem está logado, como reserva — a compartilhada da empresa não está disponível.${recusado}`;
}

// Formato minimo do retorno de manageAgentCredentialMitra({action:'list_models'})
interface ModeloLike { modelId: string; name?: string }
interface GrupoModelosLike { id?: string; name?: string; type?: string; models?: ModeloLike[] }

// Escolhe um modelId que a credencial conectada REALMENTE oferece.
//   1. o preferido, se estiver disponivel;
//   2. senao, o primeiro modelo de uma assinatura (mais barato/estavel que
//      API key avulsa no uso interativo);
//   3. senao, o primeiro modelo de qualquer grupo.
// Retorna '' quando nao ha modelo nenhum — que e o unico caso em que faltar
// credencial e mesmo a explicacao.
export function escolherModelo(grupos: GrupoModelosLike[], preferido: string = ''): string {
  const lista = (grupos || []).filter((g) => (g?.models || []).length > 0);
  const todos = lista.flatMap((g) => g.models || []);
  if (todos.length === 0) return '';
  if (preferido && todos.some((m) => m?.modelId === preferido)) return preferido;
  const assinatura = lista.find((g) => g.type === 'subscription');
  return String(assinatura?.models?.[0]?.modelId || todos[0]?.modelId || '');
}

// Assinatura do CONJUNTO de modelos de uma resposta de list_models. E o que
// permite comparar duas respostas: se a lista pedida com connectionId for
// identica a lista pessoal, o identificador nao foi reconhecido.
export function assinaturaModelos(grupos: GrupoModelosLike[] | null): string {
  return (grupos || [])
    .flatMap((g) => g?.models || [])
    .map((m) => String(m?.modelId || ''))
    .filter(Boolean)
    .sort()
    .join('|');
}

// Decide QUAL das duas credenciais roda o estudo. Funcao pura (a suite cobre
// os cenarios): `null` numa lista significa "a consulta falhou", que e
// diferente de lista VAZIA — vazia quer dizer "nao ha credencial ali".
//
// ORDEM: a compartilhada da empresa PRIMEIRO; a do usuario so como reserva.
//
// A armadilha que esta funcao existe para desarmar: o connectionId viaja cru
// ate o servidor e, quando esta errado, a chamada NAO falha — e atendida com a
// credencial PESSOAL e devolve uma resposta normal, indistinguivel de um
// acerto. Por isso "veio lista de modelos" NAO e prova de que a connection
// respondeu (a lista vem sempre). A prova que discrimina e COMPARAR: so
// aceitamos a connection quando o conjunto de modelos difere do pessoal.
//
// Efeito colateral aceito: se a connection tiver exatamente as mesmas
// credenciais da pessoal, tratamos como pessoal. Perde-se o sandbox
// compartilhado, nao o acesso — erra para o lado seguro.
export function decidirCredencial(
  pessoais: GrupoModelosLike[] | null,
  daEmpresa: GrupoModelosLike[] | null,
  connectionId: string,
  preferido: string = '',
): CredencialEscolhida | null {
  const conn = sanitizarConnectionId(connectionId);
  const refPessoal = assinaturaModelos(pessoais);
  let idIgnorado: string | undefined;

  if (conn) {
    const modeloEmpresa = daEmpresa ? escolherModelo(daEmpresa, preferido) : '';
    // `refPessoal` vazio = o usuario nao tem credencial propria; nesse caso
    // nao ha com o que comparar e qualquer lista da connection e dela mesma.
    if (modeloEmpresa && refPessoal && assinaturaModelos(daEmpresa) === refPessoal) {
      idIgnorado = conn;
    } else if (modeloEmpresa) {
      return { modelId: modeloEmpresa, connectionId: conn, origem: 'empresa' };
    }
  }

  const modeloUsuario = pessoais ? escolherModelo(pessoais, preferido) : '';
  if (modeloUsuario) return { modelId: modeloUsuario, connectionId: '', origem: 'usuario', idIgnorado };
  return null;
}

// O identificador entra literal no SQL da SF de escrita (substituicao de
// {{valor}}), entao passa por uma lista branca de caracteres em vez de escape.
export function sanitizarConnectionId(valor: string): string {
  return String(valor || '').trim().replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 120);
}

// ── Deteccao de "falta credencial" ──────────────────────────────────────
// Fonte UNICA usada pelo listener de erro E pelo catch do send(): a mensagem
// da plataforma varia (403 puro, "no active credential", "model not
// available"), e quando o padrao nao casava o painel de conexao simplesmente
// nunca aparecia — o usuario ficava sem saida.
export function pareceErroDeCredencial(texto: string): boolean {
  return /credencial|credential|assinatura|subscription|api\s*key|conect|unauthorized|logad|403|forbidden|not\s+available|no\s+active|sem\s+credencial|expirou|expired|invalid/i
    .test(String(texto || ''));
}

// Marcador usado quando o list_models nao devolveu NENHUM modelo: nao ha
// credencial conectada, e so nesse caso "conecte sua conta" e a instrucao
// certa. Falha COM credencial conectada e outra conversa (ver textoErro).
export const SEM_CREDENCIAL = 'sem_credencial';

export type CausaCredencial = 'sem' | 'falhou';

export function causaCredencial(texto: string): CausaCredencial {
  return String(texto || '').includes(SEM_CREDENCIAL) ? 'sem' : 'falhou';
}

// O texto muda conforme a credencial que estava valendo: mandar o usuario
// "reconectar a sua conta" quando quem falhou foi a credencial da empresa e
// pedir pra ele resolver um problema que nao e dele.
export function tituloErroCredencial(causa: CausaCredencial, origem?: OrigemCredencial): string {
  if (causa === 'sem') return 'Conecte uma credencial de IA para usar o analista';
  return origem === 'empresa'
    ? 'A credencial de IA da empresa não conseguiu responder'
    : 'A credencial de IA da sua conta não conseguiu responder';
}

export function textoErroCredencial(causa: CausaCredencial, origem?: OrigemCredencial): string {
  if (causa === 'sem') {
    return 'Nenhuma credencial de IA está disponível para você. Conecte a sua conta abaixo — leva um minuto e vale para todos os seus estudos. Se a sua empresa mantém uma credencial compartilhada, peça a quem administra o sistema para ativá-la: aí ninguém precisa conectar nada.';
  }
  return origem === 'empresa'
    ? 'Este estudo está usando a credencial compartilhada da empresa, e foi ela que falhou. Os motivos comuns são: a assinatura expirou, o limite de uso foi atingido, ou ela não tem acesso ao modelo. Avise quem administra o sistema — ou conecte a sua própria conta abaixo para não ficar esperando.'
    : 'A credencial da sua conta está conectada, mas a chamada falhou. Os motivos comuns são: a assinatura expirou, o limite de uso foi atingido, ou a conta não tem acesso ao modelo. Reconecte abaixo para renovar a autorização; se o erro persistir, verifique a assinatura direto no provedor.';
}

// ── Acesso SEM identidade propria ───────────────────────────────────────
// Quando nao ha sessao de login real, quem responde pelo app e o token de
// build — da conta CRIADORA do projeto. Nesse estado, o que a plataforma
// chamaria de "credencial pessoal" e a assinatura do dono: usa-la seria gastar
// (e expor) a assinatura de outra pessoa, fora da hierarquia permitida.
// Sobra UMA credencial legitima: a compartilhada do projeto. Sem ela, o
// analista fica indisponivel — e isso e o comportamento correto.
export const TITULO_DEMO_SEM_COMPARTILHADA = 'Entre com o seu login para usar o analista';

export function textoDemoSemCompartilhada(): string {
  return 'Você está em um login de demonstração, que não é um usuário da plataforma. Como ninguém está autenticado, a única credencial de IA que a plataforma ofereceria é a de quem publicou a aplicação — e usar a assinatura de outra pessoa não é aceitável. Entre com o seu próprio login (o mesmo que você usa na plataforma) e o analista funciona normalmente, com a credencial compartilhada da empresa ou com a da sua conta.';
}

// ── Bloqueio de PLATAFORMA (diferente de credencial de IA) ──────────────
// O caso do estudo #21: o modelo RESPONDE (a credencial de IA esta boa), mas
// a task nao consegue chamar as server functions — o token que a sessao usa
// para falar com a plataforma esta invalido/expirado. Nenhuma linha aparece
// em INT_SERVERFUNCTIONEXECUTION durante o turno, e o "sem acesso" que o
// usuario ve e PROSA do proprio modelo — nao existe essa string no app, entao
// nenhuma deteccao de erro disparava e o app ainda marcava a credencial como
// confirmada. Pior: o estudo reusa o TASK_ID para sempre, entao ficava preso
// a uma sessao morta sem nenhuma saida.
//
// A cura e RENOVAR A SESSAO: limpar o TASK_ID e abrir uma task nova (token
// novo, contexto reinjetado). A conversa nao se perde — ela vive na coluna
// CONVERSA, nao na task.
//
// O contexto instrui o agente a emitir este marcador quando as SFs falharem
// por autenticacao — deteccao deterministica; a prosa e so o fallback.
export const MARCADOR_SEM_PLATAFORMA = '[SEM_ACESSO_PLATAFORMA]';

export function pareceBloqueioPlataforma(texto: string): boolean {
  const t = String(texto || '');
  if (t.includes(MARCADOR_SEM_PLATAFORMA)) return true;
  // Fallback de prosa: fala de acesso bloqueado/credencial invalida E cita a
  // plataforma/ferramentas. As duas condicoes juntas — "acesso" sozinho
  // aparece em analise normal ("acesso dos gestores ao pacote").
  const acesso = /(sem\s+acesso|acesso[^.\n]{0,60}(bloquead|revogad|negad)|n[aã]o\s+(tenho|consigo|estou\s+conseguindo)[^.\n]{0,50}acess|credencial[^.\n]{0,60}(inv[aá]lid|expirad))/i;
  const alvo = /(plataforma|mitra|server\s*function|ferramenta|consulta_livre|banco\s+de\s+dados|\btools?\b|\bmcp\b)/i;
  return acesso.test(t) && alvo.test(t);
}

export function tituloErroPlataforma(): string {
  return 'O analista perdeu o acesso aos dados';
}

export function textoErroPlataforma(): string {
  return 'A credencial de IA está funcionando (o analista respondeu), mas a conexão desta sessão com os dados do sistema expirou — por isso ele não consegue consultar o banco nem publicar a tela. Renove a sessão do analista abaixo: a conversa é preservada e a próxima pergunta abre uma conexão nova, com acesso atualizado.';
}

// Desvincula a thread morta do estudo: proximo send abre task nova com o
// contexto completo reinjetado. A conversa (coluna CONVERSA) fica intacta.
export async function pgLimparTask(id: number): Promise<void> {
  await execSF(SF_PG.setTask, { id, taskId: '' });
}

// ── Caracteres de 4 bytes (emoji) — o banco NAO aceita ──────────────────
// As colunas do projeto sao utf8mb3: no maximo 3 bytes por caractere. Emoji
// (e todo code point acima de U+FFFF) ocupa 4 bytes e, com STRICT_TRANS_TABLES
// ligado, o banco RECUSA a escrita inteira. Erro real colhido em 2026-08-03,
// rodando a mesma SF duas vezes seguidas no mesmo estudo:
//   com emoji  -> FAILED  "'\xF0\x9F\x93\x8A 2...' for column 'HTML' at row 1"
//   sem emoji  -> COMPLETED
// Ou seja: bastava UM emoji em qualquer ponto do HTML para a tela nunca ser
// publicada — o estudo terminava so com a conversa, que e exatamente o
// sintoma de "nao consigo gerar dashboard".
//
// O guard DEFINITIVO vive no esc() das SFs de escrita (backend/add-playground-
// emoji-safe.mjs), porque o analista chama playground_salvar_html direto do
// sandbox — esse HTML nunca passa pelo frontend. Aqui espelhamos a mesma regra
// para o que a propria tela grava, para o texto nao mudar sozinho no F5.
//
// Filtrar os code units 0xD800-0xDFFF (os pares surrogate) remove exatamente
// os caracteres de 4 bytes e nada mais: acentuacao portuguesa fica intacta.
export function semCaracteres4Bytes(texto: string): string {
  const t = String(texto ?? '');
  let saida = '';
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    if (c < 0xd800 || c > 0xdfff) saida += t[i];
  }
  return saida;
}

// Se um erro de encoding ainda escapar por outro caminho (ex: o analista
// comparando um emoji dentro de um SELECT, que e o unico lugar onde NAO da
// para filtrar sem alterar o sentido da consulta), o usuario merece a
// explicacao em portugues em vez do erro cru do banco.
export function pareceErroDeEncoding(texto: string): boolean {
  const t = String(texto || '');
  return /illegal mix of collations|incorrect string value|for column '(html|nome|conversa)' at row/i.test(t)
    || /\\x[fF]0\\x9[fF]/.test(t);
}

export function tituloErroEncoding(): string {
  return 'Um caractere não suportado travou a gravação';
}

export function textoErroEncoding(): string {
  return 'O analista usou um emoji (ou símbolo equivalente) e o banco de dados não aceita esse tipo de caractere — por isso a gravação foi recusada. As telas e o nome do estudo já são limpos automaticamente; se a mensagem apareceu, foi dentro de uma consulta. Peça a mesma análise de novo: o analista está instruído a não usar emojis.';
}

// ── Segmentos de tool agrupados ─────────────────────────────────────────
// UM grupo de tools por mensagem do agente. Antes cada chamada virava um
// chip novo numa linha propria: uma analise longa repetia "Consultando
// dados" cinco vezes e empurrava a conversa pra baixo. Agora os chips
// ficam numa faixa unica que envolve, com contador de repeticoes.
// Tipos estruturais frouxos: as telas declaram os proprios Segment/ChatMsg
// (verbatimModuleSyntax impede importar interface entre arquivos), entao aqui
// so descrevemos o formato minimo que estas funcoes tocam.
interface ToolItemLike { label: string; count: number; done: boolean }
interface SegLike { t: string; label?: string; items?: ToolItemLike[] }
interface MsgLike { segments: SegLike[] }

export function registrarTool(msg: MsgLike, label: string): void {
  let grupo = msg.segments.find((s) => s && s.t === 'tools');
  if (!grupo) { grupo = { t: 'tools', items: [] }; msg.segments.push(grupo); }
  const items = grupo.items || (grupo.items = []);
  for (const it of items) it.done = true;
  const ja = items.find((it) => it.label === label);
  if (ja) { ja.count = (ja.count || 1) + 1; ja.done = false; }
  else items.push({ label, count: 1, done: false });
}

export function concluirTools(msgs: MsgLike[]): void {
  for (const m of msgs || []) {
    for (const s of m?.segments || []) {
      if (s?.t === 'tools') { for (const it of s.items || []) it.done = true; }
      else if (s?.t === 'tool') (s as SegLike & { done?: boolean }).done = true;
    }
  }
}

// Conversas persistidas antes do agrupamento trazem um segmento 'tool' por
// chamada — converte na leitura para o formato agrupado.
export function normalizarSegmentos(msgs: MsgLike[]): MsgLike[] {
  return (msgs || []).map((m) => {
    if (!m || !Array.isArray(m.segments)) return m;
    if (!m.segments.some((s) => s && s.t === 'tool')) return m;
    const out: MsgLike = { ...m, segments: [] };
    for (const s of m.segments) {
      if (s && s.t === 'tool') registrarTool(out, s.label || 'Trabalhando');
      else out.segments.push(s);
    }
    concluirTools([out]);
    return out;
  });
}

export interface Estudo {
  ID: number;
  USUARIO?: string;
  NOME: string;
  HTML?: string;
  TASK_ID?: string;
  SHARE_TOKEN?: string;
  CONVERSA?: string;
  CRIADO_EM?: string;
  ATUALIZADO_EM?: string;
  TEM_HTML?: number;
}

// ── Modelo de SEGMENTOS do chat ─────────────────────────────────────────
// Um turno do agente é uma lista ordenada de segmentos: falas (md) e tools
// no ponto exato do raciocínio. Tools guardam só o LABEL (serializável).
export type Segment =
  | { t: 'md'; c: string }
  | { t: 'tool'; label: string; done?: boolean };

export interface ChatMsg {
  role: 'user' | 'agent';
  segments: Segment[];
}

const agoraIso = () => new Date().toISOString().slice(0, 19);

// ── CRUD dos estudos (SFs SQL, ~8ms). Reads pós-escrita levam _cb: o
// servidor tem um cache curto de resultado por SF+input — sem o buster,
// um get logo após salvar_html devolve a tela ANTIGA. ──────────────────
const cb = () => ({ _cb: Date.now() + ':' + Math.random().toString(36).slice(2, 8) });

// ── Credencial compartilhada da empresa (APP_CONFIG.AGENT_CONNECTION_ID) ──
// A connection em si e criada nas configuracoes da PLATAFORMA (aba de IA);
// o que fica aqui e so o identificador dela. Leitura tolerante de proposito:
// se a SF falhar, o Playground segue com a credencial do usuario em vez de
// travar — a compartilhada e uma rede de seguranca, nao um pre-requisito.
// Descoberta automatica: o build-proxy injeta `window.__mitraEnv` no app
// publicado (e onde a SDK acha agentWsUrl/apiBaseURL). Se a plataforma expuser
// ali o identificador da connection do projeto, usamos sem ninguem precisar
// digitar nada — nao existe API para listar connections, entao este e o unico
// canal possivel de descoberta. Se a chave nao existir, devolve '' e a
// hierarquia segue normal (credencial do proprio usuario).
export function connectionIdInjetado(): string {
  try {
    const env = (window as unknown as { __mitraEnv?: Record<string, unknown> }).__mitraEnv;
    if (!env || typeof env !== 'object') return '';
    for (const [chave, valor] of Object.entries(env)) {
      if (/connection/i.test(chave) && typeof valor === 'string' && valor.trim()) {
        return sanitizarConnectionId(valor);
      }
    }
  } catch {
    /* ambiente sem window (testes/node) */
  }
  return '';
}

// Identificador padrao da connection do projeto. Validado em producao: gravar
// "default" no campo fez a plataforma resolver a connection compartilhada da
// aba AI. E seguro vir preenchido de fabrica porque um id que a plataforma NAO
// reconheca e detectado pela comparacao de listas (decidirCredencial) e o app
// cai na credencial pessoal — nunca trava nem vaza credencial de terceiro.
export const CONNECTION_ID_PADRAO = 'default';

export async function lerConnectionIdCompartilhado(): Promise<string> {
  try {
    const rows = (await execSF(SF_AGENTE.lerConfig, cb())) as Array<{ CHAVE?: string; VALOR?: string }>;
    const linha = (rows || []).find((r) => String(r?.CHAVE || '') === 'AGENT_CONNECTION_ID');
    return sanitizarConnectionId(String(linha?.VALOR ?? '')) || connectionIdInjetado() || CONNECTION_ID_PADRAO;
  } catch {
    return connectionIdInjetado() || CONNECTION_ID_PADRAO;
  }
}

// Uma so implementacao da consulta de modelos para as TELAS. Cada copia dessa
// chamada e uma chance de a tela afirmar uma coisa e o chat fazer outra — foi
// assim que o painel jurou por semanas estar na credencial da empresa enquanto
// o analista rodava na pessoal.
export async function listarModelosIA(connectionId?: string): Promise<GrupoModelosLike[] | null> {
  try {
    const arg: Record<string, unknown> = { action: 'list_models' };
    if (connectionId) arg.connectionId = connectionId;
    const r = await manageAgentCredentialMitra<{ providers?: unknown[] }>(arg as any);
    return Array.isArray(r?.providers) ? (r.providers as GrupoModelosLike[]) : null;
  } catch {
    return null;
  }
}

// Qual credencial vale AGORA, pela mesma hierarquia do chat: compartilhada da
// empresa primeiro, pessoal so como reserva. As telas usam isto para avisar
// antes de o usuario esbarrar no analista mudo.
//   temCompartilhada -> a connection do projeto respondeu com credencial propria
//   temPessoal       -> o usuario tem credencial dele conectada
export async function diagnosticarCredencial(): Promise<{
  temCompartilhada: boolean;
  temPessoal: boolean;
  idIgnorado?: string;
}> {
  const [pessoais, connId] = await Promise.all([listarModelosIA(), lerConnectionIdCompartilhado()]);
  const daEmpresa = connId ? await listarModelosIA(connId) : null;
  const escolhida = decidirCredencial(pessoais, daEmpresa, connId);
  return {
    temCompartilhada: escolhida?.origem === 'empresa',
    temPessoal: !!(pessoais && escolherModelo(pessoais)),
    idIgnorado: escolhida?.idIgnorado,
  };
}

// ── Modelo do analista (APP_CONFIG.AGENT_MODEL_ID) ──────────────────────
// Ate aqui o modelo era uma constante do codigo: mudar exigia deploy, e nao
// havia onde ver/escolher qual roda o Playground. Agora e configuracao do
// projeto, na tela de Governanca de IA. Vazio = automatico (o sistema escolhe
// pelo que a credencial oferece — a regra de escolherModelo).
export function sanitizarModelId(valor: string): string {
  return String(valor || '').trim().replace(/[^A-Za-z0-9_.:\/-]/g, '').slice(0, 160);
}

export async function lerModeloPreferido(): Promise<string> {
  try {
    const rows = (await execSF(SF_AGENTE.lerConfig, cb())) as Array<{ CHAVE?: string; VALOR?: string }>;
    const linha = (rows || []).find((r) => String(r?.CHAVE || '') === 'AGENT_MODEL_ID');
    // Sem escolha gravada = automatico (o list_models decide). Nenhum modelo
    // e assumido pelo codigo.
    return sanitizarModelId(String(linha?.VALOR ?? ''));
  } catch {
    return '';
  }
}

export async function gravarModeloPreferido(valor: string): Promise<void> {
  await execSF(SF_AGENTE.gravarConfig, {
    chave: 'AGENT_MODEL_ID',
    valor: sanitizarModelId(valor),
    quando: agoraIso(),
  });
}

export async function gravarConnectionIdCompartilhado(valor: string): Promise<void> {
  await execSF(SF_AGENTE.gravarConfig, {
    chave: 'AGENT_CONNECTION_ID',
    valor: sanitizarConnectionId(valor),
    quando: agoraIso(),
  });
}

export async function pgCriar(usuario: string): Promise<number> {
  const agora = agoraIso();
  await execSF(SF_PG.criar, { usuario, agora });
  const rows = await execSF(SF_PG.ultimo, { usuario, ...cb() });
  const id = rows?.[0]?.ID;
  if (!id) throw new Error('Falha ao criar o estudo');
  return Number(id);
}

export async function pgListar(usuario: string): Promise<Estudo[]> {
  return (await execSF(SF_PG.listar, { usuario, ...cb() })) as Estudo[];
}

export async function pgGet(id: number): Promise<Estudo | null> {
  const rows = await execSF(SF_PG.get, { id, ...cb() });
  return (rows?.[0] as Estudo) || null;
}

export async function pgRenomear(id: number, nome: string): Promise<void> {
  // espelha o guard da SF: o titulo e visivel, entao o que a tela mostra tem
  // de ser exatamente o que ficou gravado (senao o emoji some sozinho no F5)
  await execSF(SF_PG.renomear, { id, nome: semCaracteres4Bytes(nome) });
}

export async function pgExcluir(id: number): Promise<void> {
  await execSF(SF_PG.excluir, { id, agora: agoraIso() });
}

export async function pgSetTask(id: number, taskId: string): Promise<void> {
  await execSF(SF_PG.setTask, { id, taskId });
}

export async function pgSalvarConversa(id: number, msgs: ChatMsg[]): Promise<void> {
  // últimas ~60 msgs — o histórico rico é o que sobrevive ao F5
  const conversa = JSON.stringify(msgs.slice(-60));
  await execSF(SF_PG.salvarConversa, { id, conversa });
}

export async function pgCompartilhar(id: number): Promise<string> {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const token = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  await execSF(SF_PG.compartilhar, { id, token, agora: agoraIso() });
  return token;
}

export async function pgVersoes(id: number): Promise<{ ID: number; CRIADO_EM: string; TAMANHO: number }[]> {
  return (await execSF(SF_PG.versoes, { id, ...cb() })) as any[];
}

export async function pgRestaurar(id: number, versaoId: number): Promise<void> {
  await execSF(SF_PG.restaurar, { id, versaoId });
}

// ── Labels amigáveis das tools do agente ────────────────────────────────
// O evento `tool` traz o nome cru (mcp__mitra-business__executeServerFunction)
// e o input JSON — o serverFunctionId dentro do input decide o label.
const SF_LABEL: Record<number, string> = {
  [SF_PG.consultaLivre]: 'Consultando dados',
  [SF_PG.schemaResumo]: 'Lendo o schema',
  [SF_PG.salvarHtml]: 'Desenhando a tela',
  [SF_PG.renomear]: 'Nomeando o estudo',
  [SF_PG.get]: 'Consultando o estudo',
  [SF_PG.salvarConversa]: 'Salvando a conversa',
};

export function toolLabel(tool: string, input?: string): string {
  const m = String(input || '').match(/"serverFunctionId"\s*:\s*"?(\d+)/);
  if (m) {
    const id = parseInt(m[1]);
    if (SF_LABEL[id]) return SF_LABEL[id];
    return 'Executando função ' + id;
  }
  // desconhecida → label limpo (strip do prefixo mcp__servidor__)
  const clean = String(tool || '').replace(/^mcp__[\w-]+__/, '').replace(/[_-]+/g, ' ').trim();
  return clean ? clean.charAt(0).toUpperCase() + clean.slice(1) : 'Trabalhando';
}

// Detecta o serverFunctionId de um evento tool (para reagir a salvar_html etc.)
export function toolSfId(input?: string): number | null {
  const m = String(input || '').match(/"serverFunctionId"\s*:\s*"?(\d+)/);
  return m ? parseInt(m[1]) : null;
}

// Linha de histórico da plataforma que na verdade é uma tool call crua
export function isRawToolLine(content: string): boolean {
  return /^(mcp__[\w-]+__)?[\w-]+\s*\{"/.test(String(content || '').trim());
}

// ── Markdown leve (falas do agente) ─────────────────────────────────────
// HTML escapado ANTES das transformações; suporta **b**, *i*, `code`,
// listas com "- " e quebras de linha.
export function mdToHtml(src: string): string {
  const esc = String(src ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const lines = esc.split('\n');
  const out: string[] = [];
  let inList = false;
  for (const line of lines) {
    const li = line.match(/^\s*[-*]\s+(.*)$/);
    if (li) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push('<li>' + inline(li[1]) + '</li>');
      continue;
    }
    if (inList) { out.push('</ul>'); inList = false; }
    const h = line.match(/^\s*(#{1,4})\s+(.*)$/);
    if (h) { out.push('<div class="pg-md-h">' + inline(h[2]) + '</div>'); continue; }
    if (line.trim() === '') { out.push('<div class="pg-md-gap"></div>'); continue; }
    out.push('<p>' + inline(line) + '</p>');
  }
  if (inList) out.push('</ul>');
  return out.join('');

  function inline(s: string): string {
    return s
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>');
  }
}

// ── Contexto injetado — a alma da velocidade ────────────────────────────
// Sem isso o agente gasta minutos explorando o projeto. Prepend na 1a
// mensagem da thread; nas seguintes vai só o sufixo curto.

// tabelas-núcleo do domínio: entram no contexto com TODAS as colunas
const CORE_TABLES = [
  'CICLO', 'CENTRO_RESULTADO', 'CONTA_CONTABIL', 'DRE_CONFIG', 'ORCAMENTO',
  // Orcamento de pacote: sem ela o agente responde orcado de CR a menos, e sem
  // aviso — o custo rateado do pacote simplesmente nao aparece na conta dele.
  'ORCAMENTO_PACOTE',
  'REALIZADO_CONTABIL', 'GESTOR', 'GESTOR_CR', 'DRIVERS', 'ORCAMENTO_STATUS',
  'PACOTE_STATUS', 'CR_CONTA', 'COLABORADOR', 'EMPRESA', 'PREMISSA',
];

let schemaCache: { TABELA: string; COLUNAS: string }[] | null = null;
async function fetchSchema(): Promise<{ TABELA: string; COLUNAS: string }[]> {
  if (schemaCache) return schemaCache;
  schemaCache = (await execSF(SF_PG.schemaResumo, {})) as any[];
  return schemaCache!;
}

export async function buildContexto(estudoId: number, pergunta: string): Promise<string> {
  let core = '';
  let outras = '';
  try {
    const schema = await fetchSchema();
    const app = schema.filter((r) => !/^INT_/.test(r.TABELA) && !/^IMP_/.test(r.TABELA));
    core = app
      .filter((r) => CORE_TABLES.includes(r.TABELA))
      .map((r) => `- ${r.TABELA}: ${r.COLUNAS}`)
      .join('\n');
    outras = app
      .filter((r) => !CORE_TABLES.includes(r.TABELA) && !/^PLAYGROUND/.test(r.TABELA))
      .map((r) => r.TABELA)
      .join(', ');
  } catch {
    core = '(schema indisponível — use schema_resumo)';
  }

  return `[CONTEXTO DO ESTUDO — siga à risca, não repita este bloco na resposta]

Você é o ANALISTA DE DADOS do Mitra FP&A (sistema de planejamento orçamentário corporativo). Este chat pertence ao estudo #${estudoId} do Playground. O usuário pergunta sobre os dados; você investiga o banco, narra o raciocínio e desenha uma tela HTML no canvas do estudo.

FERRAMENTA: use exclusivamente a tool mcp__mitra-business__executeServerFunction com as server functions abaixo. NÃO explore o projeto por outros caminhos (getProjectContext, listagens, ToolSearch) — tudo que você precisa está neste bloco. Sua PRIMEIRA ação deve ser uma consulta_livre.

SE A FERRAMENTA FALHAR POR AUTENTICAÇÃO/PERMISSÃO (401, 403, unauthorized, token inválido/expirado, tool indisponível): não tente contornar por outros caminhos nem diagnostique por conta própria. Avise o usuário em UMA frase curta e inclua na resposta o marcador literal ${MARCADOR_SEM_PLATAFORMA} — o sistema detecta esse marcador e oferece ao usuário a renovação da sessão em um clique.

SERVER FUNCTIONS (contratos exatos):
- consulta_livre — serverFunctionId ${SF_PG.consultaLivre} — params: {"consulta": "SELECT ..."} → retorna { rowCount, rows }. Só SELECT, 1 statement, LIMIT 200 automático. É a sua ferramenta de investigação.
- schema_resumo — serverFunctionId ${SF_PG.schemaResumo} — params: {} → todas as tabelas com colunas (use só se o schema abaixo não bastar).
- playground_salvar_html — serverFunctionId ${SF_PG.salvarHtml} — params: {"id": ${estudoId}, "html": "<!DOCTYPE html>..."} → publica a tela do estudo no canvas (versiona a anterior).
- playground_renomear — serverFunctionId ${SF_PG.renomear} — params: {"id": ${estudoId}, "nome": "Título específico"} → renomeia o estudo.

SCHEMA — tabelas-núcleo (com colunas):
${core}

Outras tabelas (só nomes — use schema_resumo se precisar): ${outras}

CONVENÇÕES DO BANCO:
- Datas/timestamps são VARCHAR ISO: 'YYYY-MM-DD' ou 'YYYY-MM-DDTHH:mm:ss'. Compare com string.
- MES é INT 1..12; ANO é INT (ex: 2025). Valores monetários em R$ (DECIMAL).
- Booleans são VARCHAR 'true'/'false' (ex: ATIVO = 'true').
- STATUS de workflow: PENDENTE, SUBMETIDO, APROVADO, REPROVADO.
- ORCAMENTO liga CONTA_CONTABIL (CONTA_ID), CENTRO_RESULTADO (CR_ID) e CICLO (CICLO_ID). REALIZADO_CONTABIL usa ANO + MES + CONTA_ID + CR_ID + EMPRESA_ID.
- ORÇADO DE UM CR NÃO ESTÁ SÓ EM ORCAMENTO. Contas delegadas a um pacote são lançadas pelo gestor do pacote e rateadas entre os setores em ORCAMENTO_PACOTE (uma linha por CR). Somar só ORCAMENTO subestima o resultado do CR. Use sempre as duas fontes, contando o pacote apenas quando submetido:
  SELECT CONTA_ID, MES, VALOR FROM ORCAMENTO WHERE CICLO_ID = :ciclo AND CR_ID = :cr
  UNION ALL
  SELECT op.CONTA_ID, op.MES, op.VALOR FROM ORCAMENTO_PACOTE op WHERE op.CICLO_ID = :ciclo AND op.CR_ID = :cr AND EXISTS (SELECT 1 FROM PACOTE_STATUS ps WHERE ps.CICLO_ID = op.CICLO_ID AND ps.DRIVER_ID = op.DRIVER_ID AND ps.STATUS IN ('SUBMETIDO','APROVADO'))
- O banco armazena no máximo 3 bytes por caractere. Acentuação portuguesa é livre, mas EMOJI e qualquer caractere acima de U+FFFF ocupam 4 bytes e o banco os REJEITA. Nunca escreva um emoji dentro de uma consulta SQL — a comparação falha com erro de collation. Nas escritas (HTML, nome, conversa) eles são descartados antes de gravar, então um emoji nunca chega à tela: só suja o texto.

DESIGN SYSTEM DO PROJETO (OBRIGATÓRIO — a tela DEVE seguir à risca o design system do Mitra FP&A, o MESMO sistema em que este Playground está embutido, para parecer nativa do produto e nunca um dashboard genérico de IA. Use SOMENTE os tokens abaixo; não invente cores, fontes, sombras ou raios próprios):
- TEMA CLARO E FUNDO BRANCO PURO, SEMPRE (regra nº 1): <html>, <body> e o container principal DEVEM usar #FFFFFF. É PROIBIDO usar cinza, off-white, cinza-escuro, preto, navy, gradiente ou dark mode como fundo da página, inclusive ao regenerar um estudo. Cinza aparece apenas em bordas, divisores, cabeçalhos de tabela e estados secundários.
- Fonte: "Geist Sans", "Geist", Inter, system-ui, sans-serif. Fundo da página e superfícies #FFFFFF.
- Texto: #15131c (principal), #5a576a (secundário), #8a8794 (muted). Borda #ececef; divisores internos #f1f0f3.
- Cor de acento (marca Mitra): #4b5563, com fundo suave rgba(75,85,99,.08). Use o acento com parcimônia: só no destaque principal. A cor entra pelos DADOS, não por blocos decorativos.
- Cores semânticas: sucesso #1d9d6c, aviso #c98a16, erro #d4322c, informação #2779d8 — sempre com fundo a 10% da própria cor.
- Paleta de gráficos, nesta ordem: #7839ee, #28a7f8, #1d9d6c, #c98a16, #d4327f, #5577f6, #d4322c, #0d9488.
- Layout: espaçamento externo mínimo de 24px e distância consistente de 20px a 24px entre blocos. Prefira rolagem vertical e áreas respiradas; nunca comprima todo o estudo para caber na primeira dobra.
- Hierarquia obrigatória: título e contexto do estudo → indicadores principais → gráficos → diagnóstico detalhado → tabelas em seções próprias. Não repita a mesma informação em título, subtítulo, KPI e gráfico.
- Título e subtítulo: use título curto e subtítulo discreto com NO MÁXIMO 1 ou 2 linhas. Nunca coloque parágrafos, diagnósticos ou explicações longas no cabeçalho do canvas; se o contexto ultrapassar duas linhas, detalhe-o na resposta do chat do analista.
- Cards: border-radius 20px, borda 1px #ececef, sombra quase invisível (0 1px 2px 0 rgba(20,18,32,.04)) ou nenhuma, padding 16px a 20px. Alinhe as alturas de cards equivalentes e evite excesso de cards. Nunca cartão dentro de cartão.
- Controles (campos, botões, itens de navegação): altura 36px e border-radius 12px. Badges e pílulas: rounded-full, altura 22px, 12px/500, sem borda, fundo na cor semântica a 10%.
- KPIs: label 12px uppercase letter-spacing .05em #8a8794; valor 22px a 28px weight 500 #15131c (NUNCA weight 700 — o sistema não tem negrito), font-variant-numeric: tabular-nums; delta positivo #1d9d6c / negativo #d4322c.
- KPIs: no máximo 4 na primeira linha. Mostre apenas indicadores que sustentem a leitura executiva.
- Tabelas: sempre abaixo dos indicadores e gráficos, em seção própria; header 12px weight 500 #8a8794 em #f4f3f6; células 12px 16px com border-top 1px #f1f0f3; números alinhados à direita, tabular-nums, formato pt-BR.
- Gráficos: SVG INLINE desenhado por você com os VALORES REAIS das consultas (barras, linhas, donut), com altura generosa e títulos, legendas, eixos e rótulos legíveis; eixos discretos #8a8794 e grade #f1f0f3, sem contorno preto em barras ou fatias, sem bibliotecas externas, sem placeholder. Zero emojis; ícones só se desenhados em SVG.
- Tipografia: corpo 14px / line-height 1.45; título de seção 24px weight 500 letter-spacing -.025em; título de card 14px weight 500; metadados 12px (nunca menos, exceto eixos de gráfico a 11px). Apenas os pesos 400, 500 e 600 — negrito (700+) não existe neste sistema.
- Densidade: evite elementos encostados, excesso de cards e muitas informações competindo na primeira dobra. Use vermelho somente em situações realmente críticas.

REGRAS DE ESTILO DE TRABALHO:
1. NARRE TUDO em tempo real, como um analista pensando alto: o que vai investigar, o que cada consulta revelou (com números concretos), hipóteses e viradas. Nunca fique em silêncio entre consultas.
2. INVESTIGUE FUNDO antes de concluir: várias consultas encadeadas (visão geral → decomposição → comparações → causa provável). Não pare na primeira agregação.
3. A TELA É O GRANDE FINAL E É OBRIGATÓRIA: TODA análise TERMINA com uma chamada a playground_salvar_html (UMA ÚNICA vez, ao final) com um HTML self-contained impecável (CSS inline/embutido, SVG inline com os valores reais, títulos, KPIs, gráficos e tabela de suporte). Zero placeholder, zero dado inventado. PROIBIDO encerrar o turno sem ter publicado a tela; PROIBIDO entregar a análise apenas em texto no chat; PROIBIDO colar código HTML no texto do chat — o HTML vai SOMENTE no param "html" da SF. O chat é para a narrativa; o canvas é para o resultado visual.
4. O DASHBOARD SEGUE O DESIGN SYSTEM DO PROJETO: a tela HTML tem de parecer feita pelo próprio Mitra FP&A — fundo #FFFFFF, espaçamento mínimo de 24px, subtítulo discreto limitado a 1-2 linhas, números dos cards em 22px (máximo 24px), densidade moderada, no máximo 4 KPIs na primeira linha, gráficos altos e legíveis e tabelas abaixo em seções próprias. Contexto que não couber no subtítulo deve ficar no chat. Nada de paletas, fontes ou estilos alheios ao produto; a tela deve ser indistinguível das telas nativas do sistema.
5. SEMPRE renomeie o estudo ao final via playground_renomear — título de 3-6 palavras específico da análise (ex: "Queda de vendas do Zé").
6. Feche o chat com uma conclusão de 2-3 frases com o achado principal.
7. ZERO EMOJI, EM QUALQUER LUGAR: nem na narrativa do chat, nem no HTML da tela, nem no nome do estudo, nem em consulta SQL. Emoji não faz parte do design system do produto e o banco não aceita caracteres de 4 bytes. Ícones, só desenhados em SVG inline. Marque status com cor e texto, nunca com símbolo.

PERGUNTA DO USUÁRIO:
${pergunta}`;
}

// Sufixo curto das mensagens seguintes da mesma thread
export function suffixTurno(estudoId: number, pergunta: string): string {
  return `${pergunta}

[Estudo #${estudoId} do Playground — narre o raciocínio em tempo real e investigue com consulta_livre (SF ${SF_PG.consultaLivre}). OBRIGATÓRIO: toda pergunta que envolva análise de dados TERMINA com a tela atualizada via playground_salvar_html (SF ${SF_PG.salvarHtml}, id ${estudoId}) — nunca entregue a análise só em texto nem cole HTML no chat; só pule a tela se a pergunta for puramente conversacional sobre a tela já publicada. A tela DEVE seguir o design system do Mitra FP&A: fundo principal #FFFFFF sem cinza/off-white, margem externa mínima de 24px, gaps de 20-24px, subtítulo discreto com no máximo 1-2 linhas (contexto maior fica no chat), números dos cards em 22px e nunca acima de 24px, densidade moderada, até 4 KPIs na primeira linha, gráficos altos e legíveis e tabelas em seções próprias abaixo. Use violeta como destaque e vermelho só em situações críticas. ZERO emoji em qualquer lugar (chat, HTML, nome do estudo, SQL) — o banco não aceita caracteres de 4 bytes e eles não fazem parte do design system; ícones só em SVG inline. Renomeie com playground_renomear (SF ${SF_PG.renomear}) se o foco mudar. Se as server functions falharem por autenticação/permissão, avise em uma frase e inclua o marcador literal ${MARCADOR_SEM_PLATAFORMA}.]`;
}

// Os timestamps do estudo sao gravados em UTC ("YYYY-MM-DDTHH:mm:ss", sem
// sufixo de fuso) tanto pelo navegador quanto pelas SFs. Sem o 'Z', o
// new Date() interpreta a string como HORA LOCAL — a tela mostrava o horario
// UTC como se fosse o nosso, 3h adiantado no Brasil. Marcar como UTC deixa o
// toLocale* converter para o fuso de quem esta olhando.
function comoUtc(iso: string): Date {
  const s = String(iso).trim().replace(' ', 'T');
  const temFuso = /(?:Z|[+-]\d{2}:?\d{2})$/.test(s);
  return new Date(temFuso ? s : s + 'Z');
}

export function fmtDataHora(iso?: string): string {
  if (!iso) return '';
  const d = comoUtc(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }) + ' ' +
    d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}
