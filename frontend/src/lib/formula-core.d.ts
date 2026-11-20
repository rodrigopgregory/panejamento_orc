// Tipos de formula-core.js. O core e JS puro para manter a aritmetica das
// formulas fora do componente e testavel isoladamente — ver o cabecalho la.
export declare function avaliarFormula(
  formula: string,
  resolverConta: (codigo: string) => number,
  resolverLinha: (nome: string) => number | undefined
): number;

export declare function formulaValida(formula: string): boolean;

export declare function tokensDaFormula(formula: string): { contas: string[]; linhas: string[] };

export declare function problemasDaFormula(
  formula: string,
  conhecidos?: { contas?: string[]; linhas?: string[] }
): string[];
