export function colaboradorTemCustoNoMes(mes: number, mesDesligamento?: number | null): boolean {
  return !mesDesligamento || mes < mesDesligamento;
}
