// ──────────────────────────────────────────────────────────────────────
// Configuracao das tabelas da tela Premissas Folha: como cada coluna e
// ordenada e qual o template de CSV de cada aba.
//
// Fica fora da pagina porque as definicoes precisam de identidade estavel —
// os hooks de ordenacao memoizam por referencia, e recriar os arrays a cada
// render invalidaria a memoizacao e refaria a ordenacao sem necessidade.
// ──────────────────────────────────────────────────────────────────────

const MESES = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

type Linha = Record<string, unknown>;

const texto = (campo: string) => (linha: Linha) => String(linha?.[campo] ?? '');
const numero = (campo: string) => (linha: Linha) => Number(linha?.[campo] ?? 0);
const booleano = (campo: string) => (linha: Linha) => linha?.[campo] === 'true';

export const COLUNAS_COLABORADORES = [
  { key: 'nome', dirInicial: 'asc' as const, valor: texto('NOME') },
  { key: 'cargo', dirInicial: 'asc' as const, valor: texto('CARGO') },
  { key: 'cr', dirInicial: 'asc' as const, valor: texto('CR_CODIGO') },
  { key: 'empresa', dirInicial: 'asc' as const, valor: texto('EMPRESA_NOME') },
  { key: 'contrato', dirInicial: 'asc' as const, valor: texto('TIPO_CONTRATO') },
  { key: 'salario', dirInicial: 'desc' as const, valor: numero('SALARIO') },
];

export const COLUNAS_CARGOS = [
  { key: 'nome', dirInicial: 'asc' as const, valor: texto('NOME') },
  { key: 'salario', dirInicial: 'desc' as const, valor: numero('SALARIO_MEDIO') },
  { key: 'ativo', dirInicial: 'desc' as const, valor: booleano('ATIVO') },
];

export const COLUNAS_BENEFICIOS = [
  { key: 'nome', dirInicial: 'asc' as const, valor: texto('NOME') },
  { key: 'tipo', dirInicial: 'asc' as const, valor: texto('TIPO') },
  { key: 'valor', dirInicial: 'desc' as const, valor: numero('VALOR') },
  { key: 'percentual', dirInicial: 'desc' as const, valor: numero('PERCENTUAL') },
  { key: 'clt', dirInicial: 'desc' as const, valor: booleano('APLICA_CLT') },
  { key: 'pj', dirInicial: 'desc' as const, valor: booleano('APLICA_PJ') },
];

export const COLUNAS_ENCARGOS = [
  { key: 'nome', dirInicial: 'asc' as const, valor: texto('NOME') },
  { key: 'percentual', dirInicial: 'desc' as const, valor: numero('PERCENTUAL') },
  { key: 'clt', dirInicial: 'desc' as const, valor: booleano('APLICA_CLT') },
  { key: 'pj', dirInicial: 'desc' as const, valor: booleano('APLICA_PJ') },
];

export const COLUNAS_DISSIDIO = [
  { key: 'empresa', dirInicial: 'asc' as const, valor: texto('EMPRESA_NOME') },
  { key: 'percentual', dirInicial: 'desc' as const, valor: numero('PERCENTUAL') },
  { key: 'mes', dirInicial: 'asc' as const, valor: numero('MES_APLICACAO') },
];

export const COLUNAS_TURNOVER = [
  { key: 'empresa', dirInicial: 'asc' as const, valor: texto('EMPRESA_NOME') },
  { key: 'percentual', dirInicial: 'desc' as const, valor: numero('PERCENTUAL') },
];

export const MESES_LABELS = MESES;

// ── Templates de CSV para importacao em lote ─────────────────────────
// As colunas usam os mesmos rotulos que a tela mostra, e os valores de
// referencia (centro de resultado, empresa, cargo) vao por nome/codigo em vez
// de ID interno — quem preenche a planilha enxerga nome, nao ID de banco.
export const TEMPLATES_FOLHA = {
  colaboradores: {
    arquivo: 'template-colaboradores.csv',
    colunas: ['Nome', 'Cargo', 'Centro de Resultado', 'Empresa', 'Tipo de Contrato', 'Data de Admissao', 'Salario', 'Ativo'],
    exemplos: [
      ['Maria Souza', 'Analista Financeiro', 'CR001', 'Innovare Tecnologia Ltda', 'CLT', '2026-02-01', '7500,00', 'Sim'],
      ['Joao Lima', 'Consultor', 'CR002', 'Grupo Innovare S.A.', 'PJ', '2026-03-15', '12000,00', 'Sim'],
    ],
  },
  cargos: {
    arquivo: 'template-cargos.csv',
    colunas: ['Cargo', 'Salario Medio', 'Ativo'],
    exemplos: [
      ['Analista Financeiro', '7500,00', 'Sim'],
      ['Consultor', '12000,00', 'Sim'],
    ],
  },
  beneficios: {
    arquivo: 'template-beneficios.csv',
    colunas: ['Nome', 'Tipo', 'Valor', 'Percentual', 'Aplica CLT', 'Aplica PJ'],
    exemplos: [
      ['Vale Refeicao', 'FIXO', '800,00', '0', 'Sim', 'Nao'],
      ['Plano de Saude', 'PERCENTUAL', '0', '4,5', 'Sim', 'Sim'],
    ],
  },
  encargos: {
    arquivo: 'template-encargos.csv',
    colunas: ['Nome', 'Percentual', 'Aplica CLT', 'Aplica PJ'],
    exemplos: [
      ['INSS Patronal', '20', 'Sim', 'Nao'],
      ['FGTS', '8', 'Sim', 'Nao'],
    ],
  },
  dissidio: {
    arquivo: 'template-dissidio.csv',
    colunas: ['Empresa', 'Percentual', 'Mes de Aplicacao'],
    exemplos: [
      ['Innovare Tecnologia Ltda', '5,5', 'Maio'],
      ['Grupo Innovare S.A.', '4', 'Janeiro'],
    ],
  },
  turnover: {
    arquivo: 'template-turnover.csv',
    colunas: ['Empresa', 'Turnover Anual'],
    exemplos: [
      ['Innovare Tecnologia Ltda', '12'],
      ['Grupo Innovare S.A.', '8,5'],
    ],
  },
} as const;
