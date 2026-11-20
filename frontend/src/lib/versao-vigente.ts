// Criterio unico de "qual versao orcamentaria esta valendo".
//
// Antes cada tela decidia sozinha: o Dashboard e o DRE liam a marca VERSAO_ATUAL
// (o botao "Tornar atual"), enquanto Orcamento, Preenchimento, Folha e Pessoal
// pegavam simplesmente a primeira versao nao fechada. O resultado era um botao
// que nao tinha efeito nenhum justamente nas telas que mostram dado — e telas em
// branco quando nenhuma versao estava aberta.
//
// A marca passa a mandar em todas as telas. As SFs 103/124/129/136/138 aplicam o
// mesmo criterio no SQL (ver backend/add-versao-atual-vigente.mjs), entao a
// versao marcada como atual chega na lista mesmo estando fechada.

/** Versao que a tela deve abrir por padrao: a marcada como atual; senao a primeira da lista. */
export function escolherVersaoVigente(ciclos: any[]): number | null {
  if (!ciclos || ciclos.length === 0) return null;
  const atual = ciclos.find((c: any) => c.VERSAO_ATUAL === 'true');
  return (atual || ciclos[0]).ID;
}

/**
 * Versao fechada entra somente para consulta — nenhuma edicao. Mesmo tratamento
 * que a tela de Premissas ja aplicava; aqui vira regra do sistema inteiro.
 */
export function versaoEhFechada(ciclos: any[], cicloId: number | null): boolean {
  if (!cicloId) return false;
  return ciclos?.find((c: any) => c.ID === cicloId)?.STATUS === 'FECHADO';
}

/** Rotulo do seletor: deixa explicito quando a versao aberta e so de consulta. */
export function rotuloVersao(ciclo: any): string {
  if (!ciclo) return '';
  return ciclo.STATUS === 'FECHADO' ? `${ciclo.NOME} (Fechada)` : ciclo.NOME;
}
