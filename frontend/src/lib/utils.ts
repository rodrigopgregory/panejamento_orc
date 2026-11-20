export function cn(...inputs: (string | undefined | null | false)[]) {
  return inputs.filter(Boolean).join(' ');
}

// Palavras de ligação que ficam em minúsculo no meio do título.
const SMALL_WORDS = new Set([
  'de', 'do', 'da', 'dos', 'das', 'e', 'ou', 'a', 'o', 'as', 'os',
  'para', 'com', 'em', 'no', 'na', 'nos', 'nas', 'por', 'pelo', 'pela',
  'sobre', 'sem', 'sob', 'um', 'uma', 'ao', 'à', 'às', 'aos',
]);

// Siglas que devem ficar em maiúscula (independente do input).
const ACRONYMS = new Set([
  'ICMS', 'ISS', 'PIS', 'COFINS', 'INSS', 'PLR', 'CMV', 'DRE', 'CR', 'CRs',
  'IRPJ', 'CSLL', 'IPI', 'IRRF', 'FGTS', 'IOF', 'INPC', 'IPCA', 'CDI',
  'FP&A', 'B2B', 'B2C', 'SaaS', 'TI', 'RH',
]);

export function toTitleCase(s: string) {
  if (!s) return '';
  // Quebra preservando separadores (espaço, /, -)
  return s.replace(/_/g, ' ').split(/(\s+|[/-])/).map((piece, i, arr) => {
    if (/^[\s/-]+$/.test(piece) || piece === '') return piece;
    const lower = piece.toLowerCase();
    const upper = piece.toUpperCase();
    if (ACRONYMS.has(upper)) return upper;
    // Palavra pequena fica minúscula, exceto se for a primeira palavra real
    const hadWord = arr.slice(0, i).some(p => p !== '' && !/^[\s/-]+$/.test(p));
    if (hadWord && SMALL_WORDS.has(lower)) return lower;
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }).join('');
}

// "tipo" interno (RESULTADO_FINANCEIRO) -> rótulo discreto pra UI ("resultado financeiro")
export function tipoLabel(s: string): string {
  if (!s) return '—';
  return toTitleCase(s);
}

// Mapa de modelos de driver para labels com acentuacao correta (PT-BR).
// Cobre os fixos do sistema; modelos custom caem no fallback toTitleCase.
const DRIVER_LABEL_MAP: Record<string, string> = {
  BASE_ZERO: 'Base Zero',
  BASE_HISTORICO: 'Base Histórica',
  RECEITA: 'Receita',
  PESSOAL: 'Pessoal',
};

export function driverLabel(nome: string): string {
  if (!nome) return '';
  const upper = nome.toUpperCase();
  return DRIVER_LABEL_MAP[upper] || toTitleCase(nome);
}

export function formatDateBR(value?: string | null): string {
  if (!value) return '';
  const datePart = value.slice(0, 10);
  const m = datePart.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return value;
  return `${m[3]}/${m[2]}/${m[1]}`;
}
