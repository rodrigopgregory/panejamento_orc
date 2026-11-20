// Tipos de linha de um modelo.
//
// Ate aqui existiam dois: INPUT (o gestor digita mes a mes) e FORMULA (o sistema
// calcula). Entrou um terceiro, PREMISSA, que busca um valor cadastrado em
// Premissas Gerais — mesmo numero para todos os CRs, digitado uma vez pelo
// controller.
//
// O vinculo e por NOME, nao por ID. DRIVER_FORMULA nao tem CICLO_ID (o desenho
// do modelo atravessa versoes), enquanto PREMISSA_LINHA e clonada a cada versao
// com IDs novos. Amarrar por ID faria a linha apontar para a premissa da versao
// anterior no instante em que uma versao nova fosse criada — e sem erro nenhum,
// porque o ID antigo continua existindo.
//
// Consequencia aceita: renomear a premissa desliga as linhas que a citavam. A
// tela avisa ao renomear; nao bloqueia, porque enquanto ninguem usa a premissa
// renomear tem de ser livre.

export type TipoLinhaModelo = 'INPUT' | 'FORMULA' | 'PREMISSA';

const TIPOS: TipoLinhaModelo[] = ['INPUT', 'FORMULA', 'PREMISSA'];

export const ROTULO_TIPO: Record<TipoLinhaModelo, string> = {
  INPUT: 'Input',
  FORMULA: 'Fórmula',
  PREMISSA: 'Premissa',
};

export const ROTULOS_TIPO = TIPOS.map((t) => ROTULO_TIPO[t]);

/**
 * Tipo efetivo da linha. Linhas antigas nasceram sem TIPO e valem INPUT —
 * o mesmo default que o resto do código sempre assumiu (`TIPO || 'INPUT'`).
 */
export function tipoLinha(linha: any): TipoLinhaModelo {
  const bruto = String(linha?.TIPO || '').toUpperCase();
  return (TIPOS as string[]).includes(bruto) ? (bruto as TipoLinhaModelo) : 'INPUT';
}

/** Converte o rótulo exibido na grade de volta para o valor gravado. */
export function tipoDoRotulo(rotulo: any): TipoLinhaModelo {
  const texto = String(rotulo || '').trim();
  const achado = TIPOS.find((t) => ROTULO_TIPO[t] === texto);
  return achado || 'INPUT';
}

/**
 * Chave do mapa de premissas. Nome normalizado (sem espaços nas pontas, caixa
 * única) para que "Inflação " e "inflação" resolvam igual — o nome é digitado à
 * mão em duas telas diferentes.
 */
export function chavePremissa(nome: any, mes: number): string {
  return `${String(nome ?? '').trim().toLocaleLowerCase('pt-BR')}_${mes}`;
}

/**
 * Monta o mapa `nome_mes -> valor` a partir do bloco PREMISSAS das SFs de
 * detalhe (uma linha por premissa/mês; premissa sem valor vem com MES nulo).
 */
export function mapaPremissas(bloco: any[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of bloco || []) {
    if (p?.MES == null) continue;
    m.set(chavePremissa(p.NOME, Number(p.MES)), Number(p.VALOR) || 0);
  }
  return m;
}

/** Valor da premissa no mês, ou 0 quando ela não existe nesta versão. */
export function valorPremissa(mapa: Map<string, number> | null | undefined, nome: any, mes: number): number {
  if (!mapa) return 0;
  return mapa.get(chavePremissa(nome, mes)) ?? 0;
}
