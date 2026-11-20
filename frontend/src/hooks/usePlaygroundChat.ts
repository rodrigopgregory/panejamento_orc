// ──────────────────────────────────────────────────────────────────────
// usePlaygroundChat — sessão com o agente analista de um estudo.
//
// Modelo de SEGMENTOS: cada turno do agente é uma lista ordenada de
// { t:'md', c } | { t:'tool', label, done } — a tool aparece ENTRE as
// falas, no ponto exato do raciocínio. Ao chegar um evento `tool`, o
// buffer de texto pendente é DESCARREGADO antes (senão a ordem mente).
//
// Streaming suave: a plataforma manda chunks grandes; os deltas entram
// num buffer e são drenados ~(2 + len/14) chars a cada 24ms.
// ──────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useRef, useState } from 'react';
import { getAgentTaskMitra, manageAgentCredentialMitra } from 'mitra-interactions-sdk';
import { MITRA_CONFIG, sessaoRealAtiva } from '../mitra-config';
import {
  toolLabel, toolSfId, buildContexto, suffixTurno,
  pgSetTask, pgSalvarConversa, SF_PG,
  pareceErroDeCredencial, causaCredencial, textoErroCredencial,
  pareceBloqueioPlataforma, textoErroPlataforma, pgLimparTask,
  pareceErroDeEncoding, textoErroEncoding,
  decidirCredencial, lerConnectionIdCompartilhado, lerModeloPreferido, sanitizarConnectionId,
  PG_AGENT_TYPE, textoDemoSemCompartilhada,
  registrarTool, concluirTools, normalizarSegmentos,
} from '../lib/playground';

// Modelo a usar nesta sessao: SEMPRE o que a credencial conectada oferece de
// verdade (list_models). Cravar o preferido sem checar era a causa de "conectei
// a conta e continua sem funcionar" — o backend respondia "model not available"
// e o app interpretava como falta de credencial, num laco sem saida.
//
// `null` = a CONSULTA falhou (fora do ambiente publicado, rede). Lista vazia =
// a consulta foi bem e nao ha credencial ali. Sao coisas diferentes: a primeira
// nao pode bloquear o chat, a segunda e a unica que significa "falta conectar".
async function listarModelos(connectionId?: string): Promise<any[] | null> {
  try {
    const arg: any = { action: 'list_models' };
    if (connectionId) arg.connectionId = connectionId;
    const r = await manageAgentCredentialMitra<{ providers?: unknown[] }>(arg);
    return Array.isArray(r?.providers) ? (r.providers as any[]) : null;
  } catch {
    return null;
  }
}

// Prioridade: a COMPARTILHADA da empresa; sem ela, a credencial DO USUARIO.
//
// As duas listas sao SEMPRE buscadas, mesmo quando o usuario tem credencial
// propria. Nao e desperdicio: a lista pessoal e a REFERENCIA que denuncia um
// connectionId invalido. Um id errado nao da erro — o servidor o descarta e
// responde com a credencial pessoal, entao a unica forma de distinguir
// "connection respondeu" de "id ignorado" e comparar as duas respostas.
//
// NUNCA lanca. Quem decide se a credencial serve e a PLATAFORMA, no momento da
// pergunta — nao este palpite. A versao anterior barrava o envio quando o
// list_models vinha vazio, e list_models vazio nao prova ausencia de acesso
// (ele nao enumera, por exemplo, uma conexao de projeto resolvida no servidor).
// Resultado: acesso travado sem recurso, com o chat recusando ate tentar.
// Preferimos tentar e deixar o erro real aparecer a negar por conta propria.
async function resolverCredencial(): Promise<CredencialEscolhida> {
  // Sem sessão de login real, a identidade perante a plataforma é a da conta
  // criadora (token de build). O que ela chamaria de "credencial pessoal" é a
  // assinatura do dono — fora da hierarquia permitida. Nesse estado só a
  // COMPARTILHADA vale; sem ela o analista fica indisponível, em vez de rodar
  // na assinatura de outra pessoa.
  //
  // O teste é sempre a SESSÃO: quem entrou de verdade tem identidade própria e
  // segue o caminho normal (compartilhada → a dela).
  if (!sessaoRealAtiva()) {
    const [connIdBruto, preferidoDemo] = await Promise.all([lerConnectionIdCompartilhado(), lerModeloPreferido()]);
    const connIdDemo = sanitizarConnectionId(connIdBruto);
    if (!connIdDemo) {
      return { modelId: '', connectionId: '', origem: 'empresa', confirmado: false, bloqueada: true };
    }
    // A lista "pessoal" é buscada só como REFERÊNCIA de comparação — sob o
    // token de build ela é a do dono e não pode ser usada. Se a connection devolver exatamente ela, o
    // id não foi reconhecido e a chamada seria atendida pela assinatura do
    // dono: bloqueia em vez de deixar passar disfarçado de compartilhada.
    const [refDoDono, daEmpresaDemo] = await Promise.all([listarModelos(), listarModelos(connIdDemo)]);
    const escolhidaDemo = decidirCredencial(refDoDono, daEmpresaDemo, connIdDemo, preferidoDemo);
    if (!escolhidaDemo || escolhidaDemo.origem !== 'empresa') {
      return { modelId: '', connectionId: '', origem: 'empresa', confirmado: false, bloqueada: true };
    }
    return { ...escolhidaDemo, confirmado: true };
  }

  const [pessoais, connId, preferido] = await Promise.all([
    listarModelos(), lerConnectionIdCompartilhado(), lerModeloPreferido(),
  ]);
  const daEmpresa = connId ? await listarModelos(connId) : null;

  // O modelo preferido vem da configuracao do projeto (Governanca de IA); se a
  // credencial nao oferecer esse modelo, escolherModelo cai no que existe.
  const escolhida = decidirCredencial(pessoais, daEmpresa, connId, preferido);
  if (escolhida) return { ...escolhida, confirmado: true };

  // Nada confirmado (consulta vazia OU indisponivel): tenta assim mesmo, mas
  // SEM modelId. `modelId` e opcional na SDK — omitir faz a plataforma usar o
  // default dela, que por definicao a credencial oferece. Cravar um modelo
  // adivinhado aqui era o jeito mais rapido de derrubar uma credencial que
  // funciona: quem tem Claude, mas nao exatamente ESTE Claude, levava
  // "model not available" em todo turno.
  const conn = sanitizarConnectionId(connId);
  return {
    modelId: '',
    connectionId: conn,
    origem: conn ? 'empresa' : 'usuario',
    confirmado: false,
  };
}

// Tipos locais (verbatimModuleSyntax — não importar interfaces de outros arquivos)
type OrigemCredencial = 'usuario' | 'empresa';
// `confirmado`: a plataforma listou modelos para esta credencial. Falso = nao
// deu pra confirmar, mas a pergunta vai assim mesmo.
type CredencialEscolhida = {
  modelId: string; connectionId: string; origem: OrigemCredencial; confirmado: boolean;
  idIgnorado?: string;
  // Acesso de demonstração sem credencial compartilhada válida: não há
  // credencial legítima, e a pergunta NÃO deve ser enviada (enviar usaria a
  // assinatura da conta criadora).
  bloqueada?: boolean;
};
// 'verificando' e o estado de partida: a tela mostra "verificando" em vez de
// insinuar que falta credencial antes de a resposta chegar.
export type PgCredStatus = 'verificando' | 'usuario' | 'empresa' | 'nenhuma';
type ToolItem = { label: string; count: number; done: boolean };
type Segment =
  | { t: 'md'; c: string }
  | { t: 'tool'; label: string; done?: boolean }          // legado (conversas antigas)
  | { t: 'tools'; items: ToolItem[] }
  | { t: 'erro'; c: string; cred?: 'sem' | 'falhou'; org?: OrigemCredencial; plataforma?: boolean; demo?: boolean };
type ChatMsg = { role: 'user' | 'agent'; segments: Segment[] };

export type PgChatStatus = 'idle' | 'connecting' | 'streaming';

interface Opts {
  estudoId: number;
  taskId?: string | null;         // TASK_ID salvo no estudo (reconexão pós-F5)
  conversaInicial?: string | null; // JSON da conversa rica persistida
  onTaskCreated?: (taskId: string) => void;
  onTelaSalva?: () => void;        // agente chamou playground_salvar_html
  onRenomeado?: () => void;        // agente chamou playground_renomear
  onTurnEnd?: () => void;
}

export function usePlaygroundChat(opts: Opts) {
  const { estudoId } = opts;
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [status, setStatus] = useState<PgChatStatus>('idle');
  const [erro, setErro] = useState<string | null>(null);
  const [precisaCredencial, setPrecisaCredencial] = useState(false);
  // Qual credencial esta valendo — a tela mostra isso SEMPRE, nao so no erro.
  const [credStatus, setCredStatus] = useState<PgCredStatus>('verificando');

  const msgsRef = useRef<ChatMsg[]>([]);
  const sessionRef = useRef<any>(null);
  const offsRef = useRef<Array<() => void>>([]);
  const bufRef = useRef('');
  const drainRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedRef = useRef(false);      // a thread já recebeu a 1a mensagem?
  const taskIdRef = useRef<string | null>(opts.taskId || null);
  const streamingRef = useRef(false);
  // Ha um turno em curso que ainda precisa ser encerrado (gravar + recarregar)?
  const turnoVivoRef = useRef(false);
  const ultimaPersistRef = useRef(0);
  // O turno tocou a plataforma? (algum tool event com serverFunctionId).
  // Turno que termina "com sucesso" mas sem NENHUMA SF executada + prosa de
  // "sem acesso" = a task perdeu o token da plataforma (não é credencial de
  // IA — o modelo respondeu). É o caso do estudo #21.
  const turnoComPlataformaRef = useRef(false);
  const credRef = useRef<CredencialEscolhida | null>(null);
  const cbRef = useRef(opts);
  cbRef.current = opts;

  const commit = useCallback(() => {
    setMsgs(msgsRef.current.map((m) => ({ ...m, segments: [...m.segments] })));
  }, []);

  const persist = useCallback(() => {
    ultimaPersistRef.current = Date.now();
    // Falha aqui nao interrompe o estudo (a conversa vive em memoria ate o
    // F5), mas silencio total foi o que escondeu o bug do emoji por semanas:
    // a conversa simplesmente nao gravava e ninguem via o porque.
    pgSalvarConversa(estudoId, msgsRef.current as any).catch((e) => {
      console.warn('[playground] conversa nao gravada:', e?.message || e);
    });
  }, [estudoId]);

  // Grava a conversa DURANTE o stream, não só no fim. Se a conexão cair no
  // meio de uma análise longa, o que o analista já escreveu tem de sobreviver
  // — perder o turno inteiro é o que fazia parecer que ele nunca respondeu.
  const persistParcial = useCallback(() => {
    if (Date.now() - ultimaPersistRef.current < 5000) return;
    persist();
  }, [persist]);

  // ── buffer de streaming ──
  const lastAgentMsg = () => {
    let m = msgsRef.current[msgsRef.current.length - 1];
    if (!m || m.role !== 'agent') {
      m = { role: 'agent', segments: [] };
      msgsRef.current.push(m);
    }
    return m;
  };

  const appendText = (chars: string) => {
    if (!chars) return;
    const m = lastAgentMsg();
    const last = m.segments[m.segments.length - 1];
    if (last && last.t === 'md') last.c += chars;
    else m.segments.push({ t: 'md', c: chars });
  };

  const flushBuf = () => {
    if (!bufRef.current) return;
    appendText(bufRef.current);
    bufRef.current = '';
  };

  const ensureDrain = () => {
    if (drainRef.current) return;
    drainRef.current = setInterval(() => {
      const buf = bufRef.current;
      if (!buf) {
        if (!streamingRef.current && drainRef.current) {
          clearInterval(drainRef.current);
          drainRef.current = null;
        }
        return;
      }
      // velocidade adaptativa: quanto maior o backlog, mais rápido drena
      const n = Math.max(2, Math.round(2 + buf.length / 14));
      bufRef.current = buf.slice(n);
      appendText(buf.slice(0, n));
      commit();
      persistParcial();
    }, 24);
  };

  const markToolsDone = () => concluirTools(msgsRef.current);

  // ── Encerramento de turno — caminho ÚNICO ───────────────────────────────
  // Um turno pode terminar de mais de um jeito: o evento `turnEnd`, ou um
  // `statusChange` para idle/error sem turnEnd nenhum (WebSocket caiu, sessao
  // encerrada do outro lado, aba dormindo). Antes so o `turnEnd` gravava a
  // conversa e mandava recarregar o canvas — pelo outro caminho o resultado
  // ficava no limbo: tela velha, conversa nao gravada, chat parado. Era
  // exatamente a cara de "travou".
  //
  // Idempotente: quem chegar primeiro encerra, os seguintes nao fazem nada.
  const finalizarTurno = (sucesso: boolean) => {
    if (!turnoVivoRef.current) return;
    turnoVivoRef.current = false;
    flushBuf();
    markToolsDone();
    // Turno "bem-sucedido" que nao executou NENHUMA SF e cuja fala diz que o
    // acesso esta bloqueado: a task perdeu o token da plataforma. Sem esta
    // deteccao o app confirmava a credencial de IA e nao oferecia saida
    // nenhuma — o "sem acesso" era prosa do modelo, invisivel para o codigo.
    const ultima = msgsRef.current[msgsRef.current.length - 1];
    const falaDoTurno = ultima && ultima.role === 'agent'
      ? ultima.segments.filter((s) => s.t === 'md').map((s) => (s as { c: string }).c).join('\n')
      : '';
    const semPlataforma = sucesso && !turnoComPlataformaRef.current && pareceBloqueioPlataforma(falaDoTurno);
    if (semPlataforma && ultima) {
      ultima.segments.push({ t: 'erro', c: textoErroPlataforma(), plataforma: true });
    }
    if (sucesso && !semPlataforma) {
      // O turno respondeu: seja qual for o palpite anterior, a credencial em
      // uso existe e funciona. Corrige o rotulo e tira o aviso da tela.
      const cred = credRef.current;
      if (cred && !cred.confirmado) {
        cred.confirmado = true;
        setCredStatus(cred.origem);
        setPrecisaCredencial(false);
      }
    }
    streamingRef.current = false;
    setStatus('idle');
    commit();
    persist();
    cbRef.current.onTurnEnd?.();
  };

  // Credencial resolvida uma vez por sessao de tela (evita um list_models por
  // mensagem) e zerada quando o usuario (re)conecta uma credencial — sem isso
  // o app continuaria usando a credencial velha depois de conectar a conta.
  const credencialAtual = async (): Promise<CredencialEscolhida> => {
    if (credRef.current) return credRef.current;
    const c = await resolverCredencial();
    credRef.current = c;
    // 'nenhuma' aqui e um AVISO ("não encontrei credencial"), não um veto: o
    // envio segue. Se a pergunta funcionar, o rótulo se corrige sozinho no
    // fim do turno — dizer "conecte uma credencial" para quem acabou de ser
    // atendido é o tipo de mentira que faz o produto parecer quebrado.
    setCredStatus(c.confirmado ? c.origem : 'nenhuma');
    return c;
  };

  // Chamado quando uma credencial e conectada no painel (ou quando o admin
  // aponta a compartilhada): a proxima pergunta re-resolve tudo e reabre a
  // sessao ja com a credencial nova.
  const credencialConectada = useCallback(() => {
    credRef.current = null;
    setCredStatus('verificando');
    setPrecisaCredencial(false);
    setErro(null);
    void credencialAtual().catch(() => { /* status ja virou 'nenhuma' */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mensagem de erro rica: diz se falta credencial ou se a credencial
  // conectada e que nao respondeu — instrucoes diferentes para cada caso.
  // useCallback com deps vazias: so mexe em refs e setState (ambos estaveis),
  // entao attach/send podem lista-la nas deps sem reconstruir a sessao.
  const pushErro = useCallback((texto: string) => {
    const m = lastAgentMsg();
    if (pareceErroDeCredencial(texto)) {
      // Falhou E nunca deu pra confirmar a credencial: "conecte uma" é a
      // instrução certa. Falhou COM credencial confirmada é outra conversa
      // (assinatura expirada, limite, sem acesso ao modelo).
      const causa = credRef.current && !credRef.current.confirmado ? 'sem' : causaCredencial(texto);
      // Origem da credencial que estava valendo: mandar reconectar a conta
      // pessoal quando quem falhou foi a da empresa e jogar no usuario um
      // problema que nao e dele (e que ele nao consegue resolver).
      const org = credRef.current?.origem;
      m.segments.push({ t: 'erro', c: textoErroCredencial(causa, org), cred: causa, org });
      setPrecisaCredencial(true);
    } else if (pareceErroDeEncoding(texto)) {
      // Emoji/caractere de 4 bytes recusado pelo banco. As escritas ja saem
      // filtradas nas SFs; se chegou aqui foi dentro de uma consulta, e o erro
      // cru do banco ("Illegal mix of collations") nao diz nada ao usuario.
      m.segments.push({ t: 'erro', c: textoErroEncoding() });
    } else {
      m.segments.push({ t: 'erro', c: texto });
    }
  }, []);

  // ── listeners da sessão ──
  const attach = useCallback((session: any) => {
    const offs: Array<() => void> = [];
    offs.push(session.on('turnStart', () => {
      streamingRef.current = true;
      turnoVivoRef.current = true;
      setStatus('streaming');
      msgsRef.current.push({ role: 'agent', segments: [] });
      commit();
      ensureDrain();
    }));
    offs.push(session.on('delta', ({ delta, kind }: any) => {
      if (kind !== 'text' || !delta) return;
      streamingRef.current = true;
      bufRef.current += delta;
      ensureDrain();
    }));
    offs.push(session.on('tool', ({ tool, input }: any) => {
      // descarrega o texto pendente ANTES da tool — a ordem dos segmentos
      // precisa refletir o ponto exato do raciocínio
      flushBuf();
      markToolsDone();
      // Um grupo unico por mensagem: o mesmo topico nunca reaparece em outra
      // linha (so incrementa o contador) e a conversa nao cresce a cada
      // chamada — sem isso uma analise longa virava uma coluna de chips.
      registrarTool(lastAgentMsg(), toolLabel(tool, input));
      commit();
      const sfId = toolSfId(input);
      // Qualquer SF chamada = o canal task→plataforma esta vivo neste turno
      if (sfId != null) turnoComPlataformaRef.current = true;
      if (sfId === SF_PG.salvarHtml) cbRef.current.onTelaSalva?.();
      if (sfId === SF_PG.renomear) cbRef.current.onRenomeado?.();
    }));
    offs.push(session.on('turnEnd', () => finalizarTurno(true)));
    offs.push(session.on('cancelled', () => {
      flushBuf();
      markToolsDone();
      lastAgentMsg().segments.push({ t: 'md', c: '*Interrompido pelo usuário.*' });
      finalizarTurno(false);
    }));
    offs.push(session.on('taskCreated', ({ task }: any) => {
      const id = task?.id;
      if (!id) return;
      taskIdRef.current = id;
      pgSetTask(estudoId, id).catch(() => { /* background */ });
      cbRef.current.onTaskCreated?.(id);
    }));
    offs.push(session.on('error', ({ error }: any) => {
      flushBuf();
      markToolsDone();
      const texto = String(error || 'Erro desconhecido');
      pushErro(texto);
      setErro(texto);
      finalizarTurno(false);
    }));
    offs.push(session.on('statusChange', ({ status: st }: any) => {
      if (st === 'streaming') {
        streamingRef.current = true;
        turnoVivoRef.current = true;
        setStatus('streaming');
        ensureDrain();
      } else if (st === 'idle' || st === 'cancelled' || st === 'error') {
        // Sem turnEnd: encerra por aqui. É este o caminho que deixava a tela
        // desatualizada e a conversa sem gravar.
        finalizarTurno(st === 'idle');
        setStatus('idle');
      } else if (st === 'opening' || st === 'uploading') setStatus('connecting');
    }));
    offsRef.current.push(...offs);
  }, [commit, estudoId, persist, pushErro]);

  // ── abrir sessão NO MOUNT quando o estudo já tem TASK_ID ──
  // (não só no primeiro send — senão o F5 mostra chat vazio e a thread
  //  "some". Detecta stream ativa automaticamente.)
  useEffect(() => {
    // 0. descobre a credencial JA na abertura do estudo: o rótulo no cabeçalho
    //    do chat ("sua conta" / "da empresa" / "conectar") precisa estar certo
    //    antes da primeira pergunta — descobrir isso só no erro é o que fazia
    //    parecer defeito.
    void credencialAtual().catch(() => { /* status já virou 'nenhuma' */ });
    // 1. conversa rica persistida (fonte primária pós-F5)
    if (opts.conversaInicial) {
      try {
        const parsed = JSON.parse(opts.conversaInicial);
        if (Array.isArray(parsed) && parsed.length) {
          // conversas antigas guardam um segmento 'tool' por chamada
          msgsRef.current = normalizarSegmentos(parsed) as ChatMsg[];
          // Estudo reaberto JÁ preso a uma task sem acesso: a última fala
          // gravada é o analista dizendo que está bloqueado. Mostra a saída
          // (renovar sessão) na abertura — sem isso o usuário precisaria de
          // mais um turno falho só para descobrir o botão.
          const last = msgsRef.current[msgsRef.current.length - 1];
          if (opts.taskId && last && last.role === 'agent' && !last.segments.some((s) => s.t === 'erro')) {
            const texto = last.segments.filter((s) => s.t === 'md').map((s) => (s as { c: string }).c).join('\n');
            if (pareceBloqueioPlataforma(texto)) {
              last.segments.push({ t: 'erro', c: textoErroPlataforma(), plataforma: true });
            }
          }
          commit();
        }
      } catch { /* conversa corrompida — segue com fallback */ }
    }
    // 2. NÃO reconecta a thread salva automaticamente.
    // Um TASK_ID persistido pertence à sessão/sandbox que o criou. Reabrir esse
    // id com `getAgentTaskMitra({ taskId })` não permite reaplicar connectionId
    // e pode herdar a credencial de outro usuário (ex.: quem criou/configurou o
    // estudo). A conversa rica acima é a fonte de histórico; a próxima pergunta
    // sempre cria uma task nova com a credencial resolvida para o login atual.
    if (opts.taskId) {
      taskIdRef.current = null;
      startedRef.current = false;
      pgLimparTask(estudoId).catch(() => { /* a proteção local já vale */ });
    }
    return () => {
      for (const off of offsRef.current) { try { off(); } catch { /* noop */ } }
      offsRef.current = [];
      if (drainRef.current) { clearInterval(drainRef.current); drainRef.current = null; }
      try { sessionRef.current?.close(); } catch { /* noop */ }
      sessionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estudoId]);

  const send = useCallback(async (texto: string) => {
    const t = texto.trim();
    if (!t) return;
    setErro(null);
    msgsRef.current.push({ role: 'user', segments: [{ t: 'md', c: t }] });
    commit();
    persist();
    try {
      // Resolve a credencial ANTES de tocar na sessao: se nao ha nenhuma, para
      // aqui em vez de criar uma task condenada a falhar em todo turno.
      const cred = await credencialAtual();
      // Demo sem compartilhada valida: parar ANTES de criar a task. Seguir
      // aqui faria a plataforma atender pela credencial da conta criadora —
      // exatamente o que este acesso nao pode alcancar.
      if (cred.bloqueada) {
        lastAgentMsg().segments.push({ t: 'erro', c: textoDemoSemCompartilhada(), demo: true });
        setStatus('idle');
        commit();
        persist();
        return;
      }
      // modelId so vai quando foi CONFIRMADO que a credencial o oferece.
      // Vazio = omitir e deixar a plataforma escolher o default dela.
      const modelId = cred.modelId;
      let session = sessionRef.current;
      if (!session) {
        // Nunca reutilizar TASK_ID persistido: ele pode ter sido criado por
        // outro usuário e carrega a credencial/sandbox antigos. Criar uma task
        // nova é o único ponto em que a SDK aceita connectionId.
        session = getAgentTaskMitra({
          create: true,
          projectId: MITRA_CONFIG.projectId,
          agentType: PG_AGENT_TYPE as any,
          name: `Estudo #${estudoId}`,
          ...(modelId ? { modelId } : {}),
          ...(cred.connectionId ? { connectionId: cred.connectionId } : {}),
        } as any);
        sessionRef.current = session;
        attach(session);
      }
      const first = !startedRef.current;
      startedRef.current = true;
      // A partir daqui ha um turno que PRECISA ser encerrado — mesmo que a
      // plataforma nunca mande turnStart/turnEnd.
      turnoVivoRef.current = true;
      turnoComPlataformaRef.current = false;
      setStatus('connecting');
      const prompt = first ? await buildContexto(estudoId, t) : suffixTurno(estudoId, t);
      // modelId TAMBEM no send: uma task antiga criada com um modelo que a
      // credencial de hoje nao oferece continuaria falhando pra sempre. O
      // override por turno recupera o estudo sem perder o historico. Sem
      // modelo confirmado, nao manda nada — o default da sessao vale mais que
      // um palpite nosso.
      session.send(prompt, modelId ? { modelId } : undefined);
    } catch (e: any) {
      const texto2 = String(e?.message || e);
      // Falha na CRIACAO da sessao (nao so no stream) tambem costuma ser
      // credencial — mesmo tratamento, com a instrucao de qual credencial.
      pushErro(texto2);
      setErro(texto2);
      setStatus('idle');
      commit();
    }
  }, [attach, commit, estudoId, persist, pushErro]);

  const cancel = useCallback(async () => {
    try { await sessionRef.current?.cancel(); } catch { /* noop */ }
  }, []);

  // ── Renovar a sessão do analista ────────────────────────────────────────
  // A cura para a task que perdeu o acesso à plataforma: desvincula a thread
  // morta (TASK_ID = '') e zera a sessão local — a próxima pergunta cria uma
  // task NOVA, com token novo e o contexto completo reinjetado. A conversa
  // não se perde: ela vive na coluna CONVERSA, não na task.
  const renovarSessao = useCallback(async () => {
    for (const off of offsRef.current) { try { off(); } catch { /* noop */ } }
    offsRef.current = [];
    try { sessionRef.current?.close(); } catch { /* noop */ }
    sessionRef.current = null;
    taskIdRef.current = null;
    startedRef.current = false;
    turnoVivoRef.current = false;
    streamingRef.current = false;
    bufRef.current = '';
    setStatus('idle');
    setErro(null);
    try { await pgLimparTask(estudoId); } catch { /* melhor renovar localmente do que travar */ }
    msgsRef.current.push({
      role: 'agent',
      segments: [{ t: 'md', c: '*Sessão renovada. Pode perguntar de novo — a próxima pergunta abre uma conexão nova com os dados.*' }],
    });
    commit();
    persist();
  }, [commit, estudoId, persist]);

  return {
    msgs, status, erro, precisaCredencial, setPrecisaCredencial,
    credStatus, credencialConectada, send, cancel, renovarSessao,
  };
}
