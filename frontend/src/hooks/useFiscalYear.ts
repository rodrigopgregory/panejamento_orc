// Ordem de meses do sistema — fixa em Jan–Dez (ano-calendário).
// A configuração de ano fiscal foi removida; este módulo mantém a mesma API
// consumida pelas telas (monthsShort/monthsFull/fiscalMonthNumbers) para que
// nenhuma delas precise mudar a forma de mapear coluna → mês.
const ALL_MONTHS_SHORT = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const ALL_MONTHS_FULL = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const CALENDAR_MONTH_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

interface FiscalYearValues {
  monthsShort: string[];
  monthsFull: string[];
  fiscalMonthNumbers: number[];
}

const STATIC_VALUES: FiscalYearValues = {
  monthsShort: ALL_MONTHS_SHORT,
  monthsFull: ALL_MONTHS_FULL,
  fiscalMonthNumbers: CALENDAR_MONTH_NUMBERS,
};

export function useFiscalYear(): FiscalYearValues {
  return STATIC_VALUES;
}
