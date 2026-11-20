// ──────────────────────────────────────────────────────────────────────
// Governança de IA — um único assunto: a CREDENCIAL DE IA (quem pensa),
// qual conta paga/roda o MODELO das análises. Prioridade automática:
// compartilhada da empresa (connection do projeto, aba AI da plataforma) →
// credencial do próprio usuário, só como reserva. Gerenciada no painel de
// credenciais (o mesmo do Playground).
//
// Disposição da tela (de cima para baixo, do resultado para o ajuste):
//   1. "Situação atual" — o que está VALENDO agora (credencial, modelo,
//      conexão), sem prosa: é o painel de leitura.
//   2. "Credenciais" — as duas fontes (empresa / sua conta), cada uma com o
//      seu estado e a sua ação ao lado. O identificador da conexão
//      compartilhada mora aqui, na linha da empresa: era um cartão inteiro
//      só para um campo de texto e repetia o que já estava dito acima.
//   3. "Modelo do analista" — o único ajuste que não é credencial.
//   Cada informação aparece UMA vez; o "como funciona" fica recolhido.
//
// O antigo "token permanente da plataforma" (contingência do canal de dados)
// foi removido: a sessão entregue pela plataforma na URL + a renovação
// automática tornaram a contingência desnecessária, e manter uma chave
// permanente legível no projeto era risco sem função.
//
// Tela restrita a admin.
// ──────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import {
  BrainCircuit, KeyRound, Building2, User, Loader2, ShieldAlert, Cpu, Check, RefreshCw, Plug, Info,
} from 'lucide-react';
import Button from '../components/ui/Button';
import Select from '../components/ui/Select';
import Input from '../components/ui/Input';
import Badge from '../components/ui/Badge';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../components/ui/Card';
import { ToastContainer } from '../components/ui/Toast';
import PainelCredenciaisIA from '../components/PainelCredenciaisIA';
import { useToast } from '../hooks/useToast';
import { getUser } from '../lib/auth';
import { sessaoRealAtiva } from '../mitra-config';
import {
  lerConnectionIdCompartilhado, decidirCredencial, descreverOrigem, listarModelosIA,
  lerModeloPreferido, gravarModeloPreferido, PG_AGENT_TYPE,
  gravarConnectionIdCompartilhado, sanitizarConnectionId, CONNECTION_ID_PADRAO,
  connectionIdInjetado, assinaturaModelos,
} from '../lib/playground';

type CredStatus = 'verificando' | 'usuario' | 'empresa' | 'nenhuma';

// Um "fato" do painel de situação: rótulo pequeno em cima, valor embaixo.
function Fato({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      <span className="text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--fg-subtle)' }}>{rotulo}</span>
      <div className="text-[13px] font-medium min-w-0 break-words" style={{ color: 'var(--color-text)' }}>{children}</div>
    </div>
  );
}

export default function GovernancaIAPage() {
  const user = getUser();
  const { toasts, addToast, removeToast } = useToast();

  // ── Credencial de IA ──
  const [credStatus, setCredStatus] = useState<CredStatus>('verificando');
  const [resumoUsuario, setResumoUsuario] = useState('verificando…');
  const [resumoEmpresa, setResumoEmpresa] = useState('verificando…');
  const [empresaRecusada, setEmpresaRecusada] = useState(false);
  // Frase derivada do que foi REALMENTE resolvido (nunca escrita a mao) —
  // e o que torna a hierarquia auditavel em vez de uma promessa da UI.
  const [origemReal, setOrigemReal] = useState('');
  const [painelAberto, setPainelAberto] = useState(false);

  // ── Modelo do analista ──
  // Opcoes vem das credenciais conectadas — oferecer um modelo que nenhuma
  // credencial tem e o jeito mais rapido de derrubar o Playground.
  const [modelosDisponiveis, setModelosDisponiveis] = useState<Array<{ value: string; label: string }>>([]);
  const [modeloPreferido, setModeloPreferido] = useState('');
  const [modeloEmUso, setModeloEmUso] = useState('');
  const [salvandoModelo, setSalvandoModelo] = useState(false);

  // ── Identificador da connection compartilhada ──
  const [connIdAtual, setConnIdAtual] = useState('');
  const [connIdCampo, setConnIdCampo] = useState('');
  const [salvandoConn, setSalvandoConn] = useState(false);
  // A plataforma nao expoe uma API que liste as connections do projeto. O que
  // da para oferecer num dropdown sao os identificadores que o app CONHECE
  // (o gravado, o injetado pela plataforma no ambiente publicado e o padrao
  // de fabrica) — cada um testado de verdade contra a plataforma, com o mesmo
  // criterio do chat: aceito so quando responde com credencial propria.
  const [conexoesConhecidas, setConexoesConhecidas] = useState<Array<{ id: string; status: string; aceita: boolean }>>([]);
  const [connOutro, setConnOutro] = useState(false);

  const carregarCredencial = useCallback(async () => {
    setCredStatus('verificando');
    setOrigemReal('');
    const [pessoais, connId, preferido] = await Promise.all([
      listarModelosIA(), lerConnectionIdCompartilhado(), lerModeloPreferido(),
    ]);
    const nUsuario = (pessoais || []).reduce((s, g) => s + (g?.models?.length || 0), 0);
    setResumoUsuario(pessoais === null
      ? 'não foi possível verificar (fora do ambiente publicado?)'
      : nUsuario > 0 ? `conectada — ${nUsuario} modelo(s) disponíveis` : 'nenhuma credencial conectada');

    // Candidatos conhecidos, cada um consultado uma vez; o gravado (connId)
    // reaproveita a mesma resposta que alimenta a decisao abaixo.
    const candidatos = Array.from(new Set(
      [connId, connectionIdInjetado(), CONNECTION_ID_PADRAO].map(sanitizarConnectionId).filter(Boolean),
    ));
    const respostas = await Promise.all(candidatos.map((id) => listarModelosIA(id)));
    const daEmpresa = connId ? (respostas[candidatos.indexOf(connId)] ?? null) : null;
    const refPessoal = assinaturaModelos(pessoais);
    setConexoesConhecidas(candidatos.map((id, i) => {
      const grupos = respostas[i];
      const n = (grupos || []).reduce((s, g) => s + (g?.models?.length || 0), 0);
      if (grupos === null) return { id, status: 'não foi possível verificar', aceita: false };
      if (n > 0 && refPessoal && assinaturaModelos(grupos) === refPessoal) return { id, status: 'recusada pela plataforma', aceita: false };
      if (n > 0) return { id, status: `aceita — ${n} modelo(s)`, aceita: true };
      return { id, status: 'sem modelos visíveis', aceita: false };
    }));
    // A MESMA decisão que o chat toma — inclusive a comparação que denuncia um
    // identificador recusado. Reimplementar a regra aqui era como o painel
    // acabava afirmando uma coisa enquanto o chat fazia outra.
    // Mesmo preferido que o chat usa — sem isso a tela diria um modelo e o
    // analista rodaria outro.
    const escolhida = decidirCredencial(pessoais, daEmpresa, connId, preferido);

    setEmpresaRecusada(Boolean(escolhida?.idIgnorado));
    if (!connId) {
      setResumoEmpresa('não ativada — informe o identificador da conexão ao lado');
    } else if (escolhida?.idIgnorado) {
      setResumoEmpresa(`identificador "${escolhida.idIgnorado}" recusado pela plataforma — ela devolveu a mesma lista de modelos da credencial pessoal. Confira o identificador na aba AI da plataforma.`);
    } else {
      const nEmpresa = (daEmpresa || []).reduce((s, g) => s + (g?.models?.length || 0), 0);
      setResumoEmpresa(nEmpresa > 0
        ? `ativada e respondendo com credencial própria — ${nEmpresa} modelo(s)`
        : 'ativada, mas sem modelos visíveis — pode ainda funcionar; se falhar, revise a connection na plataforma');
    }

    setCredStatus(escolhida ? escolhida.origem : 'nenhuma');
    if (escolhida) setOrigemReal(descreverOrigem(escolhida));

    // Seletor lista TODOS os modelos que aparecem em qualquer uma das
    // credenciais (empresa e pessoal), nao so os da vigente: restringir a uma
    // delas era o que fazia a tela mostrar um punhado de opcoes.
    const opcoes: Array<{ value: string; label: string }> = [];
    const coletar = (grupos: any[] | null, origem: string) => {
      (grupos || []).forEach((g: any) => {
        (g?.models || []).forEach((m: any) => {
          const id = String(m?.modelId || '');
          if (!id || opcoes.some(o => o.value === id)) return;
          const grupo = g?.name || (g?.type === 'subscription' ? 'Assinatura' : g?.type) || '';
          const detalhe = [grupo, origem].filter(Boolean).join(' · ');
          opcoes.push({ value: id, label: detalhe ? `${m?.name || id} · ${detalhe}` : String(m?.name || id) });
        });
      });
    };
    coletar(daEmpresa, 'empresa');
    coletar(pessoais, 'sua conta');
    opcoes.sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
    setModelosDisponiveis(opcoes);
    setModeloEmUso(escolhida?.modelId || '');
    setModeloPreferido(preferido);
    setConnIdAtual(connId);
    setConnIdCampo(connId);
  }, []);

  const salvarModelo = useCallback(async (valor: string) => {
    setSalvandoModelo(true);
    try {
      await gravarModeloPreferido(valor);
      setModeloPreferido(valor);
      addToast('success', valor ? 'Modelo do analista atualizado' : 'Modelo automático — o sistema escolhe pelo que a credencial oferece');
      await carregarCredencial();
    } catch {
      addToast('error', 'Não foi possível salvar o modelo');
    }
    setSalvandoModelo(false);
  }, [addToast, carregarCredencial]);

  const salvarConnId = useCallback(async (valor: string) => {
    setSalvandoConn(true);
    try {
      await gravarConnectionIdCompartilhado(valor);
      addToast('success', 'Identificador salvo — reverificando a conexão');
      setConnOutro(false);
      await carregarCredencial();
    } catch {
      addToast('error', 'Não foi possível salvar o identificador');
    }
    setSalvandoConn(false);
  }, [addToast, carregarCredencial]);

  // Dropdown: escolher um identificador conhecido ja grava (como o modelo);
  // "Outro…" abre o campo livre, que grava pelo botao Salvar.
  const CONN_OUTRO = '__outro__';
  const escolherConexao = useCallback((valor: string) => {
    if (valor === CONN_OUTRO) { setConnOutro(true); setConnIdCampo(''); return; }
    setConnOutro(false);
    setConnIdCampo(valor);
    if (valor !== connIdAtual) void salvarConnId(valor);
  }, [connIdAtual, salvarConnId]);

  useEffect(() => { void carregarCredencial(); }, [carregarCredencial]);

  // Sem sessao real (app rodando no token de build), esta tela mostraria a
  // assinatura pessoal da conta criadora e gravaria a connection em nome
  // dela. Governanca exige identidade propria.
  if (!user || !sessaoRealAtiva()) return <Navigate to="/" replace />;

  const verificando = credStatus === 'verificando';

  const credInfo: Record<CredStatus, { badge: React.ReactNode; texto: string }> = {
    verificando: { badge: <Badge variant="neutral">Verificando…</Badge>, texto: 'Consultando qual credencial está valendo.' },
    empresa: { badge: <Badge variant="success" dot>Compartilhada da empresa</Badge>, texto: 'O custo das análises não cai na conta pessoal de ninguém.' },
    usuario: { badge: <Badge variant="warning" dot>Sua credencial pessoal</Badge>, texto: 'Em reserva — a compartilhada da empresa não está disponível.' },
    nenhuma: { badge: <Badge variant="danger" dot>Nenhuma</Badge>, texto: 'O analista não responde até conectar uma credencial.' },
  };

  const linhaStatus = (ok: boolean, texto: string) => (
    <p className="text-xs leading-relaxed flex items-start gap-1.5" style={{ color: ok ? 'var(--color-text-secondary)' : 'var(--danger)' }}>
      {ok ? <Check size={13} className="mt-0.5 shrink-0" style={{ color: 'var(--success)' }} /> : <ShieldAlert size={13} className="mt-0.5 shrink-0" />}
      <span>{texto}</span>
    </p>
  );

  return (
    <div className="p-6 w-full animate-fadeIn flex flex-col gap-5">
      {/* ── Cabeçalho ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: 'var(--text-heading)' }}>
            <BrainCircuit size={20} style={{ color: 'var(--color-primary)' }} /> Governança de IA
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>
            Qual credencial e qual modelo sustentam o analista do Playground, para todos os estudos e usuários.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => { void carregarCredencial(); }} disabled={verificando}>
          <RefreshCw size={13} className={`mr-1 inline ${verificando ? 'animate-spin' : ''}`} /> Reverificar
        </Button>
      </div>

      {/* ── 1. Situação atual: o que está valendo, sem prosa ── */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Situação atual</CardTitle>
            <CardDescription>O que o analista está usando neste momento.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-6 sm:grid-cols-3">
          <Fato rotulo="Credencial em uso">
            <div className="flex flex-col gap-1.5 items-start">
              {credInfo[credStatus].badge}
              <span className="text-xs font-normal" style={{ color: 'var(--color-text-secondary)' }}>
                {origemReal || credInfo[credStatus].texto}
              </span>
            </div>
          </Fato>
          <Fato rotulo="Modelo em uso">
            <span className="flex items-center gap-1.5">
              {verificando || salvandoModelo ? <Loader2 size={13} className="animate-spin shrink-0" /> : <Cpu size={13} className="shrink-0" style={{ color: 'var(--color-primary)' }} />}
              <span className="break-all">{modeloEmUso || 'padrão da plataforma'}</span>
            </span>
            <span className="block text-xs font-normal mt-1" style={{ color: 'var(--color-text-secondary)' }}>
              {modeloPreferido ? 'escolhido abaixo' : 'modo automático'} · agente {PG_AGENT_TYPE}
            </span>
          </Fato>
          <Fato rotulo="Conexão compartilhada">
            <span className="flex items-center gap-1.5">
              <Plug size={13} className="shrink-0" style={{ color: connIdAtual && !empresaRecusada ? 'var(--color-primary)' : 'var(--fg-subtle)' }} />
              <span className="break-all">{connIdAtual ? <code>{connIdAtual}</code> : 'não ativada'}</span>
            </span>
            <span className="block text-xs font-normal mt-1" style={{ color: empresaRecusada ? 'var(--danger)' : 'var(--color-text-secondary)' }}>
              {empresaRecusada ? 'identificador recusado pela plataforma' : connIdAtual ? 'identificador aceito' : 'cada usuário roda na própria credencial'}
            </span>
          </Fato>
        </CardContent>
      </Card>

      <div className="grid gap-5 md:grid-cols-5">
        {/* ── 2. Credenciais: as duas fontes, cada uma com seu estado e sua ação ── */}
        <Card className="md:col-span-3">
          <CardHeader>
            <div>
              <CardTitle>Credenciais — quem roda o modelo</CardTitle>
              <CardDescription>A compartilhada da empresa tem prioridade; a sua conta entra só como reserva.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            {/* Empresa */}
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center gap-2">
                <Building2 size={15} style={{ color: 'var(--color-primary)' }} />
                <span className="text-[13px] font-semibold" style={{ color: 'var(--color-text)' }}>Compartilhada da empresa</span>
                {credStatus === 'empresa' && <Badge variant="success">em uso</Badge>}
              </div>
              {linhaStatus(!empresaRecusada && credStatus !== 'nenhuma', resumoEmpresa)}
              <div className="grid gap-2 sm:grid-cols-2 items-end">
                <Select
                  label="Identificador da conexão"
                  value={connOutro ? CONN_OUTRO : connIdAtual}
                  onChange={escolherConexao}
                  disabled={salvandoConn || verificando}
                  placeholder="nenhuma — cada usuário na própria credencial"
                  options={[
                    ...conexoesConhecidas.map((c) => ({
                      value: c.id,
                      label: `${c.id} · ${c.status}${c.id === CONNECTION_ID_PADRAO ? ' · padrão' : ''}`,
                    })),
                    { value: CONN_OUTRO, label: 'Outro identificador…' },
                  ]}
                />
                {connOutro && (
                  <div className="flex items-end gap-2">
                    <div className="flex-1 min-w-0">
                      <Input
                        label="Novo identificador"
                        value={connIdCampo}
                        onChange={(v) => setConnIdCampo(sanitizarConnectionId(v))}
                        placeholder={CONNECTION_ID_PADRAO}
                        autoFocus
                      />
                    </div>
                    <Button size="sm" onClick={() => { void salvarConnId(connIdCampo); }} disabled={salvandoConn || !connIdCampo || connIdCampo === connIdAtual}>
                      {salvandoConn ? <Loader2 size={13} className="mr-1 inline animate-spin" /> : <Check size={13} className="mr-1 inline" />} Salvar
                    </Button>
                  </div>
                )}
              </div>
              <p className="text-[11.5px] leading-snug" style={{ color: 'var(--fg-subtle)' }}>
                A lista traz os identificadores que o sistema conhece, cada um testado contra a plataforma agora — ela não expõe a relação de conexões do projeto. A conexão em si é criada nas configurações do projeto, aba AI.
              </p>
            </div>

            <div style={{ borderTop: '1px solid var(--border-subtle)' }} />

            {/* Sua conta */}
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center gap-2">
                <User size={15} style={{ color: 'var(--color-primary)' }} />
                <span className="text-[13px] font-semibold" style={{ color: 'var(--color-text)' }}>Sua conta</span>
                {credStatus === 'usuario' && <Badge variant="warning">em uso (reserva)</Badge>}
              </div>
              {linhaStatus(!resumoUsuario.startsWith('nenhuma') && !resumoUsuario.startsWith('não'), resumoUsuario)}
              <div>
                <Button variant="secondary" size="sm" onClick={() => setPainelAberto(true)}>
                  <KeyRound size={13} className="mr-1 inline" /> Gerenciar credenciais
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── 3. Modelo do analista: o único ajuste que não é credencial ── */}
        <Card className="md:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>Modelo do analista</CardTitle>
              <CardDescription>Vale para todos os estudos do Playground.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Select
              label="Modelo"
              value={modeloPreferido}
              onChange={(v) => { void salvarModelo(v); }}
              disabled={salvandoModelo}
              options={[
                { value: '', label: 'Automático — o sistema escolhe' },
                ...modelosDisponiveis,
                // Um modelo configurado que a credencial atual nao lista continua
                // visivel: some-lo faria o seletor mentir sobre o que esta gravado.
                ...(modeloPreferido && !modelosDisponiveis.some(o => o.value === modeloPreferido)
                  ? [{ value: modeloPreferido, label: `${modeloPreferido} (não listado pela credencial atual)` }]
                  : []),
              ]}
            />
            <p className="text-[11.5px] leading-snug" style={{ color: 'var(--fg-subtle)' }}>
              {modelosDisponiveis.length
                ? `${modelosDisponiveis.length} modelo(s) oferecidos pelas credenciais conectadas.`
                : 'Nenhum modelo listado pelas credenciais conectadas.'}
              {' '}Se o escolhido deixar de existir na credencial que rodar, o sistema cai em outro dela em vez de falhar.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ── Como funciona: recolhido, para não competir com os dados ── */}
      <details className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
        <summary className="cursor-pointer flex items-center gap-1.5 select-none" style={{ color: 'var(--fg-muted)' }}>
          <Info size={13} /> Como a credencial é escolhida
        </summary>
        <div className="mt-2 pl-5 flex flex-col gap-1.5 leading-relaxed">
          <p>1. Com a conexão compartilhada ativa, o analista roda nela — para qualquer usuário, sem ninguém conectar conta própria.</p>
          <p>2. Sem ela (ou com identificador recusado), entra a credencial pessoal de quem está usando, como reserva.</p>
          <p>3. Um identificador errado não gera erro na plataforma: ela responde com a credencial pessoal de quem perguntou. Por isso o sistema compara as listas de modelos e sinaliza a recusa acima.</p>
          <p>O acesso aos dados usa sempre a sessão de quem está logado — nenhuma chave permanente fica guardada no projeto.</p>
        </div>
      </details>

      {painelAberto && (
        <PainelCredenciaisIA
          status={credStatus}
          onConectado={() => { void carregarCredencial(); addToast('success', 'Credencial atualizada'); }}
          onClose={() => setPainelAberto(false)}
        />
      )}

      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  );
}
