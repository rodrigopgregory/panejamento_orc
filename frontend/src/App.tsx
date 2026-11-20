import { useState, useEffect, lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Layout from './components/Layout';
import ErrorBoundary from './components/ErrorBoundary';
import { SkeletonPage } from './components/ui/Skeleton';
import Dashboard from './pages/Dashboard';
import LoginPage from './pages/LoginPage';
import { sessaoRealAtiva } from './mitra-config';
import { recuperarSessaoDaPlataforma, enriquecerUsuarioSeNecessario } from './lib/sessao-plataforma';
import MitraProductLockup from './components/MitraProductLockup';

// Caminho critico (Layout, Dashboard, LoginPage) fica eager — carrega junto do
// bundle inicial e a primeira tela aparece na hora. As demais paginas sao
// carregadas sob demanda (code-splitting): telas pesadas (planilhas com
// Handsontable/HyperFormula, graficos com Recharts) so baixam quando o usuario
// entra nelas, deixando o primeiro carregamento muito mais leve.
const VersoesPage = lazy(() => import('./pages/VersoesPage'));
const OrcamentoPage = lazy(() => import('./pages/OrcamentoPage'));
const WorkflowPage = lazy(() => import('./pages/WorkflowPage'));
const DREPage = lazy(() => import('./pages/DREPage'));
const DadosIntegracaoPage = lazy(() => import('./pages/DadosIntegracaoPage'));
const GestoresPage = lazy(() => import('./pages/GestoresPage'));
const FolhaPage = lazy(() => import('./pages/FolhaPage'));
const PremissasPage = lazy(() => import('./pages/PremissasPage'));
const DREConfigPage = lazy(() => import('./pages/DREConfigPage'));
const RegraContabilPage = lazy(() => import('./pages/RegraContabilPage'));
const ModelagemPage = lazy(() => import('./pages/ModelagemPage'));
const FormulasModeloPage = lazy(() => import('./pages/FormulasModeloPage'));
const PreenchimentoPage = lazy(() => import('./pages/PreenchimentoPage'));
const PreenchimentoPublicoPage = lazy(() => import('./pages/PreenchimentoPublicoPage'));
const ChangelogPage = lazy(() => import('./pages/ChangelogPage'));
const ResultadoContabilPage = lazy(() => import('./pages/ResultadoContabilPage'));
const ApresentacaoPage = lazy(() => import('./pages/ApresentacaoPage'));
const AuditoriaPage = lazy(() => import('./pages/AuditoriaPage'));
const PlaygroundPage = lazy(() => import('./pages/PlaygroundPage'));
const PlaygroundEstudoPage = lazy(() => import('./pages/PlaygroundEstudoPage'));
const PlaygroundPublicoPage = lazy(() => import('./pages/PlaygroundPublicoPage'));
const GovernancaIAPage = lazy(() => import('./pages/GovernancaIAPage'));

// Telas fora do Layout (changelog, apresentacao, links publicos) tambem passam
// pelo boundary — chunk desatualizado quebra igual nelas.
function RotaIsolada({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary>
      <Suspense fallback={<RouteFallback padded />}>{children}</Suspense>
    </ErrorBoundary>
  );
}

// Fallback enquanto o chunk da rota lazy baixa. Tem a forma de pagina (titulo,
// filtros, tabela) em vez de um indicador redondo: como toda rota fora do
// Dashboard e lazy, era este fallback — nao o skeleton da tela — que aparecia
// primeiro em Premissas, Folha e nas demais. Com o mesmo shimmer e o mesmo
// layout do resto do app, a transicao chunk -> tela deixa de ter dois estagios
// visuais diferentes.
// `padded` e para as rotas isoladas, que ficam fora do Layout e portanto nao
// herdam o padding do container de conteudo.
function RouteFallback({ padded = false }: { padded?: boolean }) {
  return padded ? <div className="p-6"><SkeletonPage /></div> : <SkeletonPage />;
}

function AppRoutes() {
  const location = useLocation();
  const isChangelog = location.pathname === '/changelog';
  const isApresentacao = location.pathname === '/apresentacao';

  if (isChangelog) {
    return <RotaIsolada><ChangelogPage /></RotaIsolada>;
  }

  if (isApresentacao) {
    return <RotaIsolada><ApresentacaoPage /></RotaIsolada>;
  }

  return (
    <Layout>
      {/* key na rota: sem isso, uma tela que falhou deixaria o boundary preso no
          estado de erro e as proximas navegacoes continuariam mostrando a
          mensagem. Trocar de tela monta um boundary novo. */}
      <ErrorBoundary key={location.pathname}>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/versoes" element={<VersoesPage />} />
          <Route path="/orcamento" element={<OrcamentoPage />} />
          <Route path="/preenchimento" element={<PreenchimentoPage />} />
          <Route path="/workflow" element={<WorkflowPage />} />
          <Route path="/dre" element={<DREPage />} />
          <Route path="/dados-integracao" element={<DadosIntegracaoPage />} />
          <Route path="/gestores" element={<GestoresPage />} />
          <Route path="/folha" element={<FolhaPage />} />
          <Route path="/premissas" element={<PremissasPage />} />
          <Route path="/dre-config" element={<DREConfigPage />} />
          <Route path="/regras-contabeis" element={<RegraContabilPage />} />
          <Route path="/modelagem" element={<ModelagemPage />} />
          <Route path="/modelos/:driverId/formulas" element={<FormulasModeloPage />} />
          <Route path="/resultado-contabil" element={<ResultadoContabilPage />} />
          <Route path="/auditoria" element={<AuditoriaPage />} />
          <Route path="/playground" element={<PlaygroundPage />} />
          <Route path="/playground/:id" element={<PlaygroundEstudoPage />} />
          <Route path="/governanca-ia" element={<GovernancaIAPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      </ErrorBoundary>
    </Layout>
  );
}

// Enquanto o app tenta herdar a sessao de quem ja esta logado na plataforma
// (iframe silencioso na pagina de auth), a tela nao pode ser a de login — a
// pessoa ja se autenticou la fora, e pedir de novo e' exatamente o que este
// estado evita. Casca neutra: so a marca e uma linha de status.
function VerificandoSessao() {
  return (
    <div
      className="h-screen w-full flex flex-col items-center justify-center gap-4"
      style={{ backgroundColor: 'var(--bg)', color: 'var(--fg)' }}
      role="status"
      aria-live="polite"
    >
      <MitraProductLockup product="FP&A" wordmarkHeight={18} />
      <p className="text-[12.5px] animate-pulse" style={{ color: 'var(--fg-muted)' }}>
        Verificando sua sessão…
      </p>
    </div>
  );
}

// Teto de espera pela resposta do auth silencioso. A pagina de auth responde
// em bem menos que isso (logado: token; nao logado: erro) — o teto so entra se
// ela nao responder (rede, origem bloqueada). Passado o teto o app mostra a
// tela de login; uma resposta positiva tardia ainda entra sozinha.
const TETO_VERIFICACAO_MS = 8000;

type EstadoSessao = 'verificando' | 'logado' | 'anonimo';

function App() {
  // Logado = sessao REAL da plataforma (token valido). O espelho local do
  // usuario ('planej-user') nasce da propria sessao no initMitra — nao e' mais
  // pre-requisito: exigir o espelho fazia quem chegava pela sessao entregue
  // pelo involucro (#tokenMitra) cair na tela de login com token valido em maos.
  //
  // Sem sessao no boot, o app NAO vai direto para o login: primeiro tenta
  // herdar a sessao de quem esta logado na plataforma (login silencioso).
  const [estado, setEstado] = useState<EstadoSessao>(() => (sessaoRealAtiva() ? 'logado' : 'verificando'));
  const configured = estado === 'logado';

  // Sessao expirada (detectada no initMitra) dispara 'auth:sessao-expirada':
  // volta a verificar — se a pessoa segue logada na plataforma, o token novo
  // chega sem tela de login; senao, cai no login, sem reload e sem flicker.
  useEffect(() => {
    function onExpirada() { setEstado('verificando'); }
    window.addEventListener('auth:sessao-expirada', onExpirada);
    return () => window.removeEventListener('auth:sessao-expirada', onExpirada);
  }, []);

  useEffect(() => {
    if (estado !== 'verificando') return;
    let ativo = true;
    const tentativa = recuperarSessaoDaPlataforma();
    const teto = new Promise<false>((r) => setTimeout(() => r(false), TETO_VERIFICACAO_MS));
    Promise.race([tentativa, teto]).then((ok) => { if (ativo) setEstado(ok ? 'logado' : 'anonimo'); });
    // Resposta positiva depois do teto ainda vale: a pessoa esta logada la.
    tentativa.then((ok) => { if (ativo && ok) setEstado('logado'); });
    return () => { ativo = false; };
  }, [estado]);

  // Espelho nascido so do token (sem ID) ganha os dados de INT_USER em
  // segundo plano — nao bloqueia nada.
  useEffect(() => {
    if (configured) enriquecerUsuarioSeNecessario();
  }, [configured]);

  // Rota PUBLICA (magic-link) — renderiza antes do guard de login, para
  // usuarios NAO logados preencherem via token UUID. Nao usa o Layout nem a nav.
  if (window.location.pathname === '/preenchimento-publico') {
    return <RotaIsolada><PreenchimentoPublicoPage /></RotaIsolada>;
  }

  // Estudo compartilhado do Playground (/estudo/<token>) — EXIGE login.
  // Logado: renderiza a visualizacao (sem Layout nem nav). Anonimo: cai no
  // LoginPage abaixo com a URL preservada — apos o login o estudo abre.
  if (window.location.pathname.startsWith('/estudo/') && configured) {
    return <RotaIsolada><PlaygroundPublicoPage /></RotaIsolada>;
  }

  if (!configured) {
    return (
      <Routes>
        <Route path="/changelog" element={<RotaIsolada><ChangelogPage /></RotaIsolada>} />
        <Route path="/apresentacao" element={<RotaIsolada><ApresentacaoPage /></RotaIsolada>} />
        {/* Qualquer URL nao logada renderiza o LoginPage direto (sem redirect
            pra /login). Isso preserva a URL alvo durante o login — quando o
            navigate do LoginPage roda enquanto configured ainda eh false, a
            URL alvo fica preservada ate o configured virar true e o AppRoutes
            assumir. Enquanto a sessao da plataforma esta sendo verificada, a
            mesma URL fica esperando atras da casca neutra. */}
        <Route
          path="*"
          element={estado === 'verificando'
            ? <VerificandoSessao />
            : <LoginPage onLogin={() => setEstado('logado')} />}
        />
      </Routes>
    );
  }

  return <AppRoutes />;
}

export default App;
