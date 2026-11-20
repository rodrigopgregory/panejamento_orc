import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';

// ──────────────────────────────────────────────────────────────────────
// Rede de seguranca das rotas.
//
// Sem isto, qualquer erro de render derruba a arvore inteira do React e o
// usuario fica olhando uma tela BRANCA, sem mensagem e sem saida.
//
// O caso mais comum nem e bug de codigo: as rotas sao lazy, e cada build
// renomeia os chunks (FolhaPage-<hash>.js). Se o navegador estiver com o
// index.html antigo em cache, clicar num item do menu tenta baixar um chunk
// que nao existe mais e o import falha. Como isso se resolve sozinho com um
// reload, a gente recarrega UMA vez automaticamente — e so mostra a mensagem
// se o erro persistir depois do reload (ai e bug de verdade).
// ──────────────────────────────────────────────────────────────────────

const CHAVE_RELOAD = 'mitra:recarregou-por-chunk';

// Cada navegador tem sua propria redacao para "falhou ao baixar o modulo".
function ehFalhaDeChunk(erro: Error): boolean {
  const texto = `${erro?.name ?? ''} ${erro?.message ?? ''}`.toLowerCase();
  return texto.includes('dynamically imported module')
    || texto.includes('importing a module script failed')
    || texto.includes('failed to fetch dynamically imported module')
    || texto.includes('error loading dynamically imported module')
    || texto.includes('chunkloaderror');
}

interface Props { children: ReactNode }
interface State { erro: Error | null }

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { erro: null };

  static getDerivedStateFromError(erro: Error): State {
    return { erro };
  }

  componentDidCatch(erro: Error, info: ErrorInfo) {
    console.error('Erro na rota:', erro, info.componentStack);

    if (ehFalhaDeChunk(erro) && !sessionStorage.getItem(CHAVE_RELOAD)) {
      // A marca vive na sessao da aba: evita o loop de recarregar sem parar
      // quando o chunk realmente sumiu do servidor.
      sessionStorage.setItem(CHAVE_RELOAD, '1');
      window.location.reload();
    }
  }

  recarregar = () => {
    sessionStorage.removeItem(CHAVE_RELOAD);
    window.location.reload();
  };

  render() {
    const { erro } = this.state;
    if (!erro) return this.props.children;

    const deChunk = ehFalhaDeChunk(erro);
    return (
      <div className="flex items-center justify-center" style={{ minHeight: '50vh' }}>
        <div
          className="rounded-xl border px-6 py-6 max-w-md text-center"
          style={{
            backgroundColor: 'var(--color-surface)',
            borderColor: 'var(--color-border)',
            boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
          }}
        >
          <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>
            {deChunk ? 'Esta tela foi atualizada' : 'Nao foi possivel abrir esta tela'}
          </h2>
          <p className="text-sm mt-2" style={{ color: 'var(--color-text-secondary)' }}>
            {deChunk
              ? 'Uma versao nova do sistema foi publicada enquanto voce navegava. Recarregue para continuar.'
              : 'Ocorreu um erro ao montar a tela. Recarregar costuma resolver; se persistir, avise o suporte.'}
          </p>
          <button
            onClick={this.recarregar}
            className="inline-flex items-center gap-2 mt-4 px-4 py-2 rounded-lg text-sm font-medium transition-all"
            style={{ backgroundColor: 'var(--color-primary)', color: '#fff' }}
          >
            <RefreshCw size={15} /> Recarregar
          </button>
          {!deChunk && (
            <p className="text-xs mt-3 break-words" style={{ color: 'var(--color-text-muted)' }}>
              {erro.message}
            </p>
          )}
        </div>
      </div>
    );
  }
}
