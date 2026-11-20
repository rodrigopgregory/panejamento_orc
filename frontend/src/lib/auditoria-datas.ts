// Datas da trilha de auditoria.
//
// WORKFLOW_AUDITORIA.CRIADO_EM e VARCHAR(19) no formato 'YYYY-MM-DDTHH:mm:ss'.
// Quem carimba o valor sao as Server Functions, sempre com
// `new Date().toISOString().slice(0, 19)` — ou seja, o horario gravado esta em
// UTC, nao no fuso de quem operou o sistema.
//
// A tela exibia esse valor recortando a string, o que mostrava o horario de
// Greenwich como se fosse local: uma aprovacao feita as 14h no Brasil aparecia
// como 17h. Aqui cada instante e reidratado como UTC (sufixo 'Z') e lido pelos
// getters locais do Date, entao a auditoria mostra o relogio de quem esta
// olhando — correto em qualquer fuso, sem constante de -3h no codigo.
//
// A distincao que organiza este modulo: um INSTANTE gravado (CRIADO_EM) precisa
// de conversao; um DIA de calendario escolhido no filtro nao, porque ja nasce no
// fuso do usuario.

export const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

export const DIAS_SEMANA = [
  'domingo', 'segunda-feira', 'terça-feira', 'quarta-feira',
  'quinta-feira', 'sexta-feira', 'sábado',
];

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Reidrata o instante UTC gravado como Date, para leitura no fuso local. */
export function paraLocal(iso: string | null): Date | null {
  if (!iso) return null;
  const d = new Date(`${iso}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 'YYYY-MM-DD' de um Date, pelos getters locais. */
export function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * Dia local do evento. Tambem e a chave dos blocos da lista, por isso precisa
 * nascer da mesma base que `rotuloDia` usa para decidir "Hoje"/"Ontem" — senao
 * os eventos do fim da noite caem sob o cabecalho do dia seguinte.
 */
export function parteData(iso: string | null): string {
  const d = paraLocal(iso);
  return d ? isoLocal(d) : '';
}

/** Hora local 'HH:mm' do instante gravado. */
export function fmtHora(iso: string | null): string {
  const d = paraLocal(iso);
  return d ? `${pad2(d.getHours())}:${pad2(d.getMinutes())}` : '';
}

/**
 * Dia de calendario 'YYYY-MM-DD' para 'dd/mm/aaaa'. Nao passa por `paraLocal`:
 * o que entra aqui e uma data solta (a do filtro), nao um instante gravado.
 */
export function fmtDataBr(dataISO: string): string {
  if (!dataISO) return '';
  const [y, m, dia] = dataISO.split('-');
  return `${dia}/${m}/${y}`;
}

/** Instante gravado para 'dd/mm/aaaa HH:mm' no fuso local. */
export function fmtDataHora(iso: string | null): string {
  const d = parteData(iso);
  if (!d) return '';
  return `${fmtDataBr(d)} ${fmtHora(iso)}`.trim();
}

/** Instante gravado para '5 de agosto de 2026' no fuso local. */
export function fmtDataExtenso(iso: string | null): string {
  const d = parteData(iso);
  if (!d) return '';
  const [y, m, dia] = d.split('-');
  return `${Number(dia)} de ${MESES[Number(m) - 1]} de ${y}`;
}

/**
 * Traduz um dia escolhido no fuso do usuario para o dia UTC equivalente, que e a
 * base do recorte no SQL (`SUBSTRING(CRIADO_EM, 1, 10)`). Mandar o dia local cru
 * descartava os eventos do fim da noite, ja contabilizados no dia UTC seguinte.
 * `fimDoDia` ancora no ultimo segundo, para o limite superior nao cortar a noite.
 */
export function diaUtc(dataLocal: string, fimDoDia: boolean): string {
  if (!dataLocal) return '';
  const [y, m, d] = dataLocal.split('-').map(Number);
  if (!y || !m || !d) return '';
  const inst = fimDoDia ? new Date(y, m - 1, d, 23, 59, 59) : new Date(y, m - 1, d, 0, 0, 0);
  return inst.toISOString().slice(0, 10);
}

/**
 * Cabecalho de cada bloco da lista. "Hoje"/"Ontem" ancoram o leitor sem ele
 * precisar converter a data mentalmente. `dataISO` ja vem local (`parteData`).
 */
export function rotuloDia(dataISO: string, agora: Date = new Date()): string {
  if (!dataISO) return 'Sem data registrada';
  const ontem = new Date(agora);
  ontem.setDate(ontem.getDate() - 1);
  if (dataISO === isoLocal(agora)) return 'Hoje';
  if (dataISO === isoLocal(ontem)) return 'Ontem';
  const [y, m, d] = dataISO.split('-').map(Number);
  const semana = DIAS_SEMANA[new Date(y, m - 1, d).getDay()];
  return `${semana}, ${d} de ${MESES[m - 1]} de ${y}`;
}
