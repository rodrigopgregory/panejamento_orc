import { useState, useCallback, useMemo } from 'react';

// ──────────────────────────────────────────────────────────────────────
// Ordenacao de linhas por clique no cabecalho, compartilhada pelas telas.
//
// Ciclo do clique: direcao inicial da coluna -> inversa -> sem ordenacao.
// O terceiro clique devolve a ordem original sem precisar de outro controle.
//
// Duas formas de uso:
//  - dados ja na memoria (Premissas Folha): chame `ordenar(linhas)`;
//  - dados paginados no banco (Resultado Contabil): ignore `ordenar` e mande
//    `ordemCampo`/`ordemDir` para a Server Function, porque ordenar no cliente
//    ordenaria so a pagina visivel.
// ──────────────────────────────────────────────────────────────────────

export type DirecaoOrdem = 'asc' | 'desc';

export interface ColunaOrdenavel {
  key: string;
  dirInicial: DirecaoOrdem;
  // Valor usado na comparacao. Sem ele a coluna so ordena no servidor.
  valor?: (linha: Record<string, unknown>) => unknown;
}

function ehVazio(v: unknown): boolean {
  return v === null || v === undefined || v === '';
}

function comparar(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b);

  const na = Number(a);
  const nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb) && String(a).trim() !== '' && String(b).trim() !== '') {
    return na - nb;
  }
  return String(a).localeCompare(String(b), 'pt-BR', { sensitivity: 'base' });
}

export function useOrdenacaoTabela(colunas: ColunaOrdenavel[]) {
  const [ordem, setOrdem] = useState<{ campo: string; dir: DirecaoOrdem } | null>(null);

  const porKey = useMemo(() => new Map(colunas.map((c) => [c.key, c])), [colunas]);

  const alternarOrdem = useCallback((campo: string) => {
    const coluna = porKey.get(campo);
    // Guarda: so vira ordenacao um campo que existe na tabela.
    if (!coluna) return;
    setOrdem((prev) => {
      if (prev?.campo !== campo) return { campo, dir: coluna.dirInicial };
      if (prev.dir === coluna.dirInicial) return { campo, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
      return null;
    });
  }, [porKey]);

  const limparOrdem = useCallback(() => setOrdem(null), []);

  const ordenar = useCallback(<T,>(linhas: T[]): T[] => {
    if (!ordem) return linhas;
    const coluna = porKey.get(ordem.campo);
    if (!coluna?.valor) return linhas;
    const extrair = coluna.valor;
    const fator = ordem.dir === 'asc' ? 1 : -1;
    // Copia antes de ordenar: a lista vem de um useMemo e ordenar no lugar
    // corromperia o valor memoizado que as outras partes da tela leem.
    return [...linhas].sort((a, b) => {
      const va = extrair(a as Record<string, unknown>);
      const vb = extrair(b as Record<string, unknown>);
      // Vazio/nulo sempre no fim, nas DUAS direcoes — por isso fica fora da
      // multiplicacao pelo fator. Em tabela de cadastro o campo em branco e
      // ausencia de dado, nao o "menor" valor: deixa-lo encabecar a lista
      // decrescente esconderia justamente o que o usuario quer olhar.
      const aVazio = ehVazio(va);
      const bVazio = ehVazio(vb);
      if (aVazio && bVazio) return 0;
      if (aVazio) return 1;
      if (bVazio) return -1;
      return comparar(va, vb) * fator;
    });
  }, [ordem, porKey]);

  return {
    ordem,
    alternarOrdem,
    limparOrdem,
    ordenar,
    // Params para ordenacao no servidor: string vazia = ordem padrao do banco.
    ordemCampo: ordem?.campo ?? '',
    ordemDir: ordem?.dir ?? '',
  };
}
