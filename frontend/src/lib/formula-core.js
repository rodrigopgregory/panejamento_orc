// Nucleo do avaliador de formulas dos modelos.
//
// Este arquivo e JavaScript puro de proposito: a aritmetica e a sanitizacao
// ficam num lugar so, fora do componente, onde podem ser testadas sem montar
// tela nenhuma.
//
// O QUE O AVALIADOR FAZ DE RUIM, E POR QUE CONTINUA ASSIM
//
// A ultima etapa de avaliarFormula apaga tudo que nao for digito ou operador e
// roda o resto. Isso significa que:
//   - token que nao resolve vira 0 em silencio;
//   - nome solto ("{3.1.01} * INFLACAO") vira "12000 * " e devolve 0 sem erro;
//   - "%" e o modulo do JavaScript, nao porcento;
//   - "," nao e separador decimal ("1,05" avalia como 5, pelo operador virgula).
//
// Mudar o avaliador para recusar esses casos quebraria formulas ja gravadas no
// meio de um ciclo de orcamento, sem aviso. A escolha foi outra: o calculo
// continua tolerante, e quem AVISA e problemasDaFormula, chamado na tela onde a
// formula e escrita. O erro passa a ser visivel na hora de digitar, que e onde
// da para corrigir, em vez de virar um zero silencioso no DRE.

/**
 * Avalia a formula para UM mes.
 *
 * @param {string} formula        ex: "{3.1.01} * [L2] / 100"
 * @param {(codigo: string) => number} resolverConta  valor de {codigo contabil}
 * @param {(nome: string) => number|undefined} resolverLinha valor de [linha]
 * @returns {number} 0 quando a formula e vazia, invalida ou estoura
 */
export function avaliarFormula(formula, resolverConta, resolverLinha) {
  try {
    let expr = formula;

    const refConta = /\{([^}]+)\}/g;
    let m;
    while ((m = refConta.exec(formula)) !== null) {
      expr = expr.replace(m[0], String(resolverConta(m[1]) ?? 0));
    }

    const refLinha = /\[([^\]]+)\]/g;
    let c;
    while ((c = refLinha.exec(formula)) !== null) {
      expr = expr.replace(c[0], String(resolverLinha(c[1]) ?? 0));
    }

    const sanitized = expr.replace(/[^0-9+\-*/().,%\s]/g, '');
    if (!sanitized.trim()) return 0;
    // eslint-disable-next-line no-new-func
    return new Function(`return (${sanitized})`)() || 0;
  } catch {
    return 0;
  }
}

/**
 * Uma formula so vale se compila. Formula incompleta ("2222 *") NAO pode
 * transformar a conta em "conta calculada" e some-la do lancamento — nesse caso
 * ela volta a ser input.
 *
 * @param {string} formula
 * @returns {boolean}
 */
export function formulaValida(formula) {
  if (!formula || !formula.trim()) return false;
  try {
    const expr = formula.replace(/\{[^}]+\}/g, '1').replace(/\[[^\]]+\]/g, '1');
    const sanitized = expr.replace(/[^0-9+\-*/().,%\s]/g, '');
    if (!sanitized.trim()) return false;
    // eslint-disable-next-line no-new-func
    new Function(`return (${sanitized})`)();
    return true;
  } catch {
    return false;
  }
}

/**
 * Tokens citados pela formula, separados por tipo. Usado pela auditoria para
 * explicar de onde veio cada numero (e para achar referencia orfa).
 *
 * @param {string} formula
 * @returns {{ contas: string[], linhas: string[] }}
 */
export function tokensDaFormula(formula) {
  const contas = [];
  const linhas = [];
  const f = String(formula || '');
  let m;
  const rc = /\{([^}]+)\}/g;
  while ((m = rc.exec(f)) !== null) contas.push(m[1]);
  const rl = /\[([^\]]+)\]/g;
  while ((m = rl.exec(f)) !== null) linhas.push(m[1]);
  return { contas, linhas };
}

const normalizar = (s) => String(s ?? '').trim().toLocaleLowerCase('pt-BR');

/**
 * Problemas de uma formula, em portugues, para mostrar a quem a escreve.
 *
 * Existe porque o avaliador e tolerante demais: ele devolve 0 para praticamente
 * qualquer coisa errada, e um zero no orcamento nao se distingue de um zero
 * legitimo. Aqui a intencao e o contrario — apontar cedo.
 *
 * As listas de referencias conhecidas sao opcionais: quando vazias, a checagem
 * de referencia orfa e pulada (a tela pode nao saber o universo).
 *
 * @param {string} formula
 * @param {{ contas?: string[], linhas?: string[] }} [conhecidos]
 * @returns {string[]} lista de problemas; vazia = formula sa
 */
export function problemasDaFormula(formula, conhecidos = {}) {
  const texto = String(formula || '').trim();
  if (!texto) return ['A fórmula está vazia — a linha vai valer zero no orçamento.'];

  const problemas = [];
  const usados = tokensDaFormula(texto);

  const contasConhecidas = new Set((conhecidos.contas || []).map(normalizar));
  if (contasConhecidas.size > 0) {
    for (const c of usados.contas) {
      if (!contasConhecidas.has(normalizar(c))) problemas.push(`A conta {${c}} não existe no plano de contas.`);
    }
  }
  const linhasConhecidas = new Set((conhecidos.linhas || []).map(normalizar));
  if (linhasConhecidas.size > 0) {
    for (const l of usados.linhas) {
      if (!linhasConhecidas.has(normalizar(l))) problemas.push(`A linha [${l}] não existe neste modelo.`);
    }
  }

  // Daqui para baixo a analise e sobre o que SOBRA depois dos tokens: e essa
  // sobra que a sanitizacao do avaliador vai comer em silencio.
  const sobra = texto.replace(/\{[^}]*\}/g, '1').replace(/\[[^\]]*\]/g, '1');

  if (/[A-Za-zÀ-ÿ_]/.test(sobra)) {
    problemas.push('Há um nome solto na fórmula. Referência a conta usa {chaves} e a outra linha usa [colchetes]; qualquer outro texto é descartado e o resultado sai errado.');
  }
  if (sobra.includes('%')) {
    problemas.push('O símbolo % aqui é resto de divisão, não porcentagem. Para 5%, escreva "/ 100" ou "* 0.05".');
  }
  if (/\d\s*,\s*\d/.test(sobra)) {
    problemas.push('Use ponto como separador decimal: 1.05, não 1,05. Com vírgula a fórmula devolve outro número.');
  }
  if (!formulaValida(texto)) {
    problemas.push('A expressão está incompleta ou inválida — confira parênteses e operadores.');
  }
  return problemas;
}
