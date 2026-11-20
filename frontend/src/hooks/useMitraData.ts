import { useState, useEffect, useCallback } from 'react';
import { executeServerFunctionMitra, executePublicServerFunctionMitra, listRecordsMitra, createRecordMitra, patchRecordMitra, deleteRecordMitra, createRecordsBatchMitra } from 'mitra-interactions-sdk';
import { MITRA_CONFIG } from '../mitra-config';

const pid = MITRA_CONFIG.projectId;
const SF_QUERY = 76;       // executarConsultaSegura — SELECT-only (substitui a SF 18)
const SF_QUERY_BATCH = 79; // executarConsultasSeguras — lote de SELECTs em 1 invocacao E2B

// SFs dedicadas tipo SQL (~8ms no banco, sem sandbox E2B) — telas quentes (DRE,
// kanban, dashboard) usam SEMPRE estas, em paralelo, nunca a SF 76/79 (JS, ~500ms).
export const SF_IDS = {
  baseCiclos: 80,
  baseDreConfig: 81,
  baseContas: 82,
  baseCrs: 83,
  baseEmpresas: 84,
  baseGestorCrs: 85,          // { gestorId }
  dreOrcadoPorConta: 86,      // { cicloId, crIds, contaIds }        (CSV vazio = sem filtro)
  dreRealizadoPorConta: 87,   // { ano, crIds, contaIds, empresaId }
  dreOrcadoPorCr: 88,         // { cicloId, contaIds, crIds }
  dreRealizadoPorCr: 89,      // { ano, contaIds, crIds }
  dreOrcadoPorEmpresa: 90,    // { cicloId, contaIds, crIds }
  dreRealizadoPorEmpresa: 91, // { ano, contaIds, crIds }
  kanbanGestores: 92,
  kanbanStatusCrs: 93,        // { cicloId }
  kanbanStatusPacotes: 94,    // { cicloId }
  kanbanModelosPorCiclo: 95,  // { cicloId }
  kanbanPacoteTotais: 96,     // { cicloId }
  dashStatusAgg: 97,          // { cicloId }
  // Telas quentes em 1 ida so (blocos JSON via JSON_ARRAYAGG) — driver/OrcamentoContent:
  hotOrcBase: 124,            // sem params — mount do OrcamentoContent (9 blocos)
  hotOrcDetalheCr: 125,       // { crId, cicloId, ano, anoPrev, gestorId (0=sem), controlCicloId (0=sem) }
  hotOrcDetalhePkg: 126,      // { pkgId, cicloId, ano, anoPrev, controlCicloId (0=sem) }
  hotResumoCr: 127,           // { crId, cicloId, ano, anoPrev }
  hotResumoCrMes: 128,        // { crId, cicloId, ano, anoPrev, mes }
  // Telas de cadastro/consulta em 1 ida so (blocos JSON):
  hotFolhaBase: 129,          // { cicloId } (0 = ciclo aberto default)
  hotGestoresBase: 130,       // sem params
  hotRegrasBase: 131,         // sem params
  hotModelagemBase: 132,      // sem params
  hotFormulasModeloBase: 133, // { driverId }
  hotColabRefs: 134,          // sem params
  hotBeneficiosBase: 135,     // { cicloId } (0 = VERSAO_ATUAL ou mais recente)
  hotPessoalBase: 136,        // { cicloId } (0 = ciclo aberto default)
  hotResultadoBase: 137,      // sem params
  hotOrcamentoStatus: 138,    // { crId, gestorId } (0 = sem status/modelos)
  // Fluxo de aprovacao com validacao no servidor + auditoria (add-workflow-auditoria.mjs):
  avaliarWorkflow: 171,       // JS: { tipo, acao, statusId | cicloId+crId/driverId+gestorId, comentario, autor, appUrl, notificar }
  registrarEventoWorkflow: 172, // SQL INSERT: { cicloId, tipo, crId, driverId, gestorId, evento, statusDe, statusPara, comentario, autor, origem, agora }
  auditoriaWorkflow: 173,     // SQL: { cicloId, tipo (CR|PACOTE), refId }
  auditoriaGeral: 174,        // SQL: { cicloId (0=todos), evento, tipo (CR|PACOTE), origem (APP|LINK), autor, dataDe, dataAte, busca, limit, offset } — '' = sem filtro. Devolve TOTAL_FILTRADO. Tela /auditoria
  auditoriaFluxo: 232,        // SQL: { cicloId, tipo (CR|PACOTE), crId (0 se pacote), driverId (0 se CR) } — trilha cronologica do objeto, painel de detalhes da /auditoria
  auditoriaAutores: 233,      // SQL: sem params — responsaveis distintos da trilha, popula o filtro Responsavel da /auditoria
  excluirModelo: 175,         // JS: { driverId, op (check|excluir|inativar) } — exclui modelo se sem orcamento; senao so inativa. Nativo protegido.
  // Publicacao + historico do desenho do modelo (add-modelo-versao.mjs):
  publicarModeloVersao: 194,  // SQL INSERT: { driverId, agora } — grava snapshot atual como nova versao (autor = :VAR_USER)
  listarModeloVersoes: 195,   // SQL: { driverId } — lista versoes publicadas (sem snapshot)
  getModeloVersao: 196,       // SQL: { versaoId } — snapshot completo de uma versao
  statusPublicacaoModelos: 225, // SQL: sem params — por driver: LINHAS atuais + SNAPSHOT publicado (detecta alteracoes nao publicadas na lista)
  // Upsert de valor de linha custom (add-formula-upsert-e-ordem.mjs) — evita 403 do CRUD REST no preenchimento interno:
  upsertFormulaValor: 197,    // SQL upsert: { formulaId, cicloId, crId, mes, valor }
  // Upsert de valor de linha de MODELO DE PACOTE (add-pacote-modelo.mjs) — inclui a dimensao do pacote:
  upsertFormulaValorPkg: 200, // SQL upsert: { formulaId, cicloId, pacoteId, crId (0 = valor unico do pacote), mes, valor }
  // Ordem dos modelos (drivers):
  driversOrdem: 198,          // SQL: sem params — [{ ID, ORDEM }]
  setDriverOrdem: 199,        // SQL: { driverId, ordem }
  mapearHistoricoPrevia: 223, // sem params — sugestões do ano anterior ainda sem vínculo ativo
  mapearHistoricoConfirmar: 224, // { ano, paresCsv } — confirma somente os pares selecionados
  // Premissa histórica do gestor (add-hist-premissa-upsert.mjs) — INSERT ... ON DUPLICATE KEY
  // UPDATE sobre a UNIQUE (CICLO_ID, CR_ID, CONTA_ID). Substituiu o SELECT-então-decide que
  // duplicava a linha quando dois saves caíam quase juntos:
  upsertHistPremissa: 230,    // SQL upsert: { cicloId, crId, contaId, percentual, modo, justificativa, agora }
  // Premissas gerais LIVRES — nome proprio, sem conta contabil (add-premissas-gerais.mjs).
  // Sao consumidas pelas linhas de modelo do tipo PREMISSA, que amarram por NOME
  // (e nao por ID, porque a premissa e clonada a cada versao com IDs novos):
  hotPremissasGeraisPorCiclo: 240, // SQL: { cicloId } — { LINHAS, VALORES }
  upsertPremissaValor: 241,        // SQL upsert sobre (LINHA_ID, MES): { linhaId, mes, valor }
  excluirPremissaGeral: 242,       // SQL: { linhaId } — apaga a premissa e seus valores mensais
  // Rateio de pacote manda no vínculo conta × setor: setor com quantidade > 0 num
  // rateio aplicado a uma linha de modelo de pacote passa a ter a conta mapeada.
  // Sem isso, o setor era descartado da divisão e os percentuais renormalizavam
  // entre os demais — o setor recebia zero e não via o pacote em tela nenhuma.
  // Idempotente (ON DUPLICATE KEY) e sem params: roda inteira, não só sobre o que
  // foi tocado. Chamar depois de mexer na quantidade de um rateio ou no rateio de
  // uma linha de modelo (add-rateio-mapeamento-automatico):
  sincronizarCrContaRateio: 243,   // SQL: sem params
  // Cards do workflow x mapeamento de gestores (add-sincronizar-cards-ciclo.mjs).
  // Reconcilia ORCAMENTO_STATUS e PACOTE_STATUS de TODOS os ciclos nao fechados:
  // apaga o card ainda pendente cujo vinculo sumiu e cria o que falta. Cards
  // SUBMETIDO/APROVADO/REPROVADO nao sao tocados. Chamar via sincronizarCardsCiclo().
  sincronizarCardsCiclo: 246,      // SQL: { agora }
} as const;

// Cache TTL simples para leituras de tabelas estaticas (CICLO, DRE_CONFIG, contas...).
// Navegar entre telas dentro do TTL nao refaz a chamada — sensacao de instantaneo.
const sfCache = new Map<string, { at: number; rows: any[] }>();

export async function execSFCached(serverFunctionId: number, input: Record<string, any> = {}, ttlMs = 60_000): Promise<any[]> {
  const key = serverFunctionId + ':' + JSON.stringify(input);
  const hit = sfCache.get(key);
  if (ttlMs > 0 && hit && Date.now() - hit.at < ttlMs) return hit.rows;
  const rows = await execSF(serverFunctionId, input);
  sfCache.set(key, { at: Date.now(), rows });
  return rows;
}

export function invalidateSFCache() { sfCache.clear(); }

function extractRows(res: any): any[] {
  // Execucao autenticada devolve { result: { output } }; a publica devolve { output } no topo
  let output = res?.result?.output ?? res?.output;
  if (typeof output === 'string') {
    try { output = JSON.parse(output); } catch { /* keep */ }
  }
  if (output && typeof output === 'object' && Array.isArray(output.rows)) {
    return output.rows;
  }
  if (Array.isArray(output)) return output;
  return [];
}

export function useQuery<T = any>(sql: string, deps: any[] = []) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      const res = await executeServerFunctionMitra({ projectId: pid, serverFunctionId: SF_QUERY, input: { sql } });
      setData(extractRows(res) as T[]);
    } catch (e) { console.error('Query error:', e); }
    setLoading(false);
  }, [sql]);

  useEffect(() => { refetch(); }, [refetch, ...deps]);
  return { data, loading, refetch };
}

// Executa VARIAS consultas SELECT em UMA unica chamada (1 sandbox E2B em vez de N).
// Retorna um array na mesma ordem dos SQLs — cada item e o array de rows daquela query.
export async function querySQLMany(sqls: string[]): Promise<any[][]> {
  const res = await executeServerFunctionMitra({ projectId: pid, serverFunctionId: SF_QUERY_BATCH, input: { sqls } });
  let output: any = (res as any)?.result?.output;
  if (typeof output === 'string') { try { output = JSON.parse(output); } catch { /* keep */ } }
  const results = output?.results;
  return Array.isArray(results) ? results : [];
}

// Versao em lote do useQuery: roda um array de SELECTs numa unica chamada e
// devolve os resultados na mesma ordem (data[i] = rows do sqls[i]).
export function useQueries(sqls: string[]) {
  const [data, setData] = useState<any[][]>([]);
  const [loading, setLoading] = useState(true);
  const key = JSON.stringify(sqls);

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      setData(await querySQLMany(sqls));
    } catch (e) { console.error('Batch query error:', e); }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => { refetch(); }, [refetch]);
  return { data, loading, refetch };
}

// Hook para SF SQL DEDICADA (execSF, ~200ms, SEM sandbox) — use em telas quentes no lugar
// de useQuery (que roteia pela SF 76/79 JS, ~550ms de sandbox por chamada). cache=true usa
// execSFCached (TTL) para tabelas estaticas; deixe false para listas que mudam (refetch fresco).
export function useSF<T = any>(sfId: number, input: Record<string, any> = {}, cache = false, ttlMs = 60_000) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const key = sfId + ':' + JSON.stringify(input);

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      setData((cache ? await execSFCached(sfId, input, ttlMs) : await execSF(sfId, input)) as T[]);
    } catch (e) { console.error('useSF error:', e); }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => { refetch(); }, [refetch]);
  return { data, loading, refetch };
}

export function useList<T = any>(tableName: string, page = 0, size = 200) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listRecordsMitra({ projectId: pid, tableName, page, size });
      setData((res as any).content || []);
      setTotal((res as any).totalElements || 0);
    } catch (e) { console.error('List error:', e); }
    setLoading(false);
  }, [tableName, page, size]);

  useEffect(() => { refetch(); }, [refetch]);
  return { data, loading, total, refetch };
}

export async function createRecord(tableName: string, data: any) {
  return createRecordMitra({ projectId: pid, tableName, data });
}

export async function updateRecord(tableName: string, id: number, data: any) {
  return patchRecordMitra({ projectId: pid, tableName, id, data });
}

export async function removeRecord(tableName: string, id: number) {
  return deleteRecordMitra({ projectId: pid, tableName, id });
}

// ── Modo publico (link do gestor, /preenchimento-publico) ──────────────────
// Quando ativo, as SFs quentes do driver (hotOrcBase/DetalheCr/DetalhePkg) sao
// roteadas para os espelhos PUBLICOS token-escopados (142/143/145) e as escritas
// do OrcamentoContent vao pela SF publicOrcWrite (147). Isso permite renderizar o
// MESMO OrcamentoContent da visao kanban sem login, com autorizacao derivada do
// token no servidor (backend/add-public-orc-driver.mjs).
const PUBLIC_ORC_SF = { base: 142, cr: 143, pkg: 145, write: 147 } as const;
let publicOrcToken: string | null = null;
export function enablePublicOrcMode(token: string) { publicOrcToken = token; }
export function getPublicOrcToken(): string | null { return publicOrcToken; }

async function execPublicSF(serverFunctionId: number, input: Record<string, any>): Promise<any[]> {
  const res: any = await executePublicServerFunctionMitra({ projectId: pid, serverFunctionId, input });
  const status = res?.result?.executionStatus ?? res?.status;
  if (status === 'FAILED') throw new Error(res?.result?.error || res?.error || 'Falha na operacao');
  return extractRows(res);
}

// Escrita publica do driver — op roteia dentro da SF 147 (orcCells, formulaCells,
// histPremissa, aumentoUpsert/Delete, contratCreate/Delete, desligamentoUpsert/Delete,
// pessoalRecalc, confirmDriver).
export async function publicOrcWrite(op: string, payload: Record<string, any>): Promise<any> {
  const res: any = await executePublicServerFunctionMitra({
    projectId: pid, serverFunctionId: PUBLIC_ORC_SF.write,
    input: { token: publicOrcToken, op, ...payload },
  });
  const status = res?.result?.executionStatus ?? res?.status;
  if (status === 'FAILED') throw new Error(res?.result?.error || res?.error || 'Falha na operacao');
  let output = res?.result?.output ?? res?.output;
  if (typeof output === 'string') { try { output = JSON.parse(output); } catch { /* keep */ } }
  if (output && output.ok === false) throw new Error(output.error || 'Falha na operacao');
  return output;
}

// Fila com debounce para as celulas digitadas nos grids publicos: agrupa uma rajada
// de edicao (digitar, drag-fill) em UMA chamada a SF 147 (sandbox ~1s) em vez de uma
// chamada por celula. O estado local do grid ja foi atualizado pelo componente —
// o flush e so a persistencia em background.
const orcCellQueue = new Map<string, { contaId: number; mes: number; valor: number; qtd: number; vu: number }>();
const formulaCellQueue = new Map<string, { formulaId: number; mes: number; valor: number }>();
let queueCrId: number | null = null;
// Modo pacote no link publico: celulas de conta (ORCAMENTO_PACOTE, CR a CR) e
// valores de linha do modelo (DRIVER_FORMULA_VALOR com PACOTE_ID) tem filas
// proprias — mesmas semanticas de debounce, ops pkgCells/pkgLineCells na SF 147.
const pkgCellQueue = new Map<string, { contaId: number; mes: number; valor: number; crId: number }>();
const pkgLineCellQueue = new Map<string, { formulaId: number; mes: number; valor: number; crId: number }>();
let queuePkgId: number | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushChain: Promise<void> = Promise.resolve();

function scheduleQueueFlush() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => { void flushPublicOrcQueue(); }, 600);
}

export function queuePublicOrcCell(crId: number, cell: { contaId: number; mes: number; valor: number; qtd: number; vu: number }) {
  if (queueCrId !== null && queueCrId !== crId) void flushPublicOrcQueue();
  queueCrId = crId;
  orcCellQueue.set(`${cell.contaId}_${cell.mes}`, cell);
  scheduleQueueFlush();
}

export function queuePublicFormulaCell(crId: number, cell: { formulaId: number; mes: number; valor: number }) {
  if (queueCrId !== null && queueCrId !== crId) void flushPublicOrcQueue();
  queueCrId = crId;
  formulaCellQueue.set(`${cell.formulaId}_${cell.mes}`, cell);
  scheduleQueueFlush();
}

export function queuePublicPkgCell(pacoteId: number, cell: { contaId: number; mes: number; valor: number; crId: number }) {
  if (queuePkgId !== null && queuePkgId !== pacoteId) void flushPublicOrcQueue();
  queuePkgId = pacoteId;
  pkgCellQueue.set(`${cell.contaId}_${cell.mes}_${cell.crId}`, cell);
  scheduleQueueFlush();
}

export function queuePublicPkgLineCell(pacoteId: number, cell: { formulaId: number; mes: number; valor: number; crId: number }) {
  if (queuePkgId !== null && queuePkgId !== pacoteId) void flushPublicOrcQueue();
  queuePkgId = pacoteId;
  pkgLineCellQueue.set(`${cell.formulaId}_${cell.mes}_${cell.crId}`, cell);
  scheduleQueueFlush();
}

// Persiste tudo que esta pendente na fila. Aguardar este retorno garante que o
// banco reflete o grid (ex: antes de Submeter CR ou de um recalculo de folha).
export function flushPublicOrcQueue(): Promise<void> {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  const crId = queueCrId;
  const cells = Array.from(orcCellQueue.values());
  const fcells = Array.from(formulaCellQueue.values());
  orcCellQueue.clear();
  formulaCellQueue.clear();
  const pacoteId = queuePkgId;
  const pcells = Array.from(pkgCellQueue.values());
  const plcells = Array.from(pkgLineCellQueue.values());
  pkgCellQueue.clear();
  pkgLineCellQueue.clear();
  const temCr = crId != null && (cells.length > 0 || fcells.length > 0);
  const temPkg = pacoteId != null && (pcells.length > 0 || plcells.length > 0);
  if (!temCr && !temPkg) return flushChain;
  flushChain = flushChain.then(async () => {
    if (temCr && cells.length) await publicOrcWrite('orcCells', { crId, cells });
    if (temCr && fcells.length) await publicOrcWrite('formulaCells', { crId, cells: fcells });
    if (temPkg && pcells.length) await publicOrcWrite('pkgCells', { pacoteId, cells: pcells });
    if (temPkg && plcells.length) await publicOrcWrite('pkgLineCells', { pacoteId, cells: plcells });
  }).catch(e => { console.error('Erro ao salvar celulas (publico):', e); });
  return flushChain;
}

// Executa SF dedicada (SQL parametrizada) e retorna as rows.
// Lanca erro quando a execucao falha (ex: DELETE bloqueado por FK) para a tela poder avisar o usuario.
// Em modo publico, as SFs quentes do driver sao roteadas para os espelhos token-escopados.
export async function execSF(serverFunctionId: number, input: Record<string, any> = {}): Promise<any[]> {
  if (publicOrcToken) {
    const map: Record<number, number> = {
      [SF_IDS.hotOrcBase]: PUBLIC_ORC_SF.base,
      [SF_IDS.hotOrcDetalheCr]: PUBLIC_ORC_SF.cr,
      [SF_IDS.hotOrcDetalhePkg]: PUBLIC_ORC_SF.pkg,
    };
    const pubId = map[serverFunctionId];
    if (pubId) return execPublicSF(pubId, { ...input, token: publicOrcToken });
  }
  const res = await executeServerFunctionMitra({ projectId: pid, serverFunctionId, input });
  const r: any = (res as any)?.result;
  if (r?.executionStatus === 'FAILED') throw new Error(r?.error || 'Falha na operacao');
  return extractRows(res);
}

// Campo JSON vindo de uma SF SQL (JSON_ARRAYAGG/JSON_OBJECT): pode chegar como string
// ou ja parseado. Sempre devolve um array.
export function jsonField(v: any): any[] {
  if (v == null) return [];
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return []; } }
  return Array.isArray(v) ? v : [];
}

// Escapa valores de texto que entram em params de SF SQL ({{param}} e substituicao textual)
export function sqlEscape(value: string): string {
  return String(value ?? '').replace(/\\/g, '').replace(/'/g, "''");
}

export async function querySQL(sql: string) {
  const res = await executeServerFunctionMitra({ projectId: pid, serverFunctionId: SF_QUERY, input: { sql } });
  return extractRows(res);
}

// Reconcilia os cards do workflow dos ciclos abertos com o mapeamento atual de
// gestores. Chamar depois de qualquer mudanca em GESTOR_CR / GESTOR_PACOTE
// (vincular, transferir, desvincular) e ao desativar/reativar um gestor.
// Idempotente: rodar sem mudanca de mapeamento nao altera nada.
export async function sincronizarCardsCiclo(): Promise<void> {
  await execSF(SF_IDS.sincronizarCardsCiclo, { agora: new Date().toISOString().slice(0, 19) });
}

export async function batchCreate(tableName: string, records: any[]) {
  return createRecordsBatchMitra({ projectId: pid, tableName, records });
}

export const MONTHS = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(value);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

// ──────────────────────────────────────────────────────────────────────
// Fluxo de aprovacao — transicao de status validada no SERVIDOR (SF 171).
// Retorna o objeto { ok, error?, de?, para? } da SF. Mapeia os erros de
// negocio para mensagens exibiveis via avaliarErroMsg().
// ──────────────────────────────────────────────────────────────────────
export interface AvaliarWorkflowInput {
  tipo: 'CR' | 'PACOTE';
  acao: 'APROVADO' | 'REPROVADO' | 'SUBMETIDO';
  statusId?: number;
  cicloId?: number;
  crId?: number;
  driverId?: number;
  gestorId?: number;
  comentario?: string;
  autor?: string;
}

export async function avaliarWorkflow(inp: AvaliarWorkflowInput): Promise<any> {
  const res = await executeServerFunctionMitra({
    projectId: pid,
    serverFunctionId: SF_IDS.avaliarWorkflow,
    input: { ...inp, comentario: inp.comentario ?? '', autor: inp.autor ?? '', appUrl: window.location.origin },
  });
  const r: any = (res as any)?.result;
  if (r?.executionStatus === 'FAILED') throw new Error(r?.error || 'Falha na operacao');
  let out: any = r?.output;
  if (typeof out === 'string') { try { out = JSON.parse(out); } catch { /* keep */ } }
  return out ?? { ok: false, error: 'sem_resposta' };
}

export function avaliarErroMsg(out: any): string {
  const map: Record<string, string> = {
    comentario_obrigatorio: 'Informe o motivo da reprovação.',
    transicao_invalida: 'Transição de status não permitida' + (out?.de ? ` (status atual: ${out.de})` : '') + '.',
    sem_transicao: 'O item já está neste status.',
    ciclo_fechado: 'A versão está fechada — nenhuma alteração é permitida.',
    conflito_concorrente: 'O status mudou em outra sessão. Recarregue a página.',
    status_nao_encontrado: 'Registro de status não encontrado.',
    params_invalidos: 'Parâmetros inválidos.',
    rateio_pendente: 'Não é possível submeter: o modelo tem linha(s) de conta sem rateio aplicado (e não granulares por CR). Acione o administrador do orçamento para configurar o rateio.',
  };
  return map[out?.error] || 'Erro ao atualizar status.';
}

// Exclusao/inativacao de modelo (SF 175). op: 'check' | 'excluir' | 'inativar'.
// Retorna o objeto { ok, error?, temOrcamento, orcamento, contas, formulas, excecoes, nome, excluido?, inativado? }.
export async function gerenciarModelo(driverId: number, op: 'check' | 'excluir' | 'inativar'): Promise<any> {
  const res = await executeServerFunctionMitra({ projectId: pid, serverFunctionId: SF_IDS.excluirModelo, input: { driverId, op } });
  const r: any = (res as any)?.result;
  if (r?.executionStatus === 'FAILED') throw new Error(r?.error || 'Falha na operacao');
  let out: any = r?.output;
  if (typeof out === 'string') { try { out = JSON.parse(out); } catch { /* keep */ } }
  return out ?? { ok: false, error: 'sem_resposta' };
}

// Auditoria de eventos que nao passam pela SF 171 (confirmar/desfazer modelo no
// app interno). Fire-and-forget: falha de auditoria nunca quebra a acao do usuario.
export function registrarEventoWorkflow(inp: {
  tipo: 'CR' | 'PACOTE'; cicloId: number; crId?: number; driverId?: number; gestorId?: number;
  evento: string; statusDe?: string; statusPara?: string; comentario?: string; autor?: string;
}): void {
  execSF(SF_IDS.registrarEventoWorkflow, {
    cicloId: inp.cicloId, tipo: inp.tipo, crId: inp.crId ?? 0, driverId: inp.driverId ?? 0,
    gestorId: inp.gestorId ?? 0, evento: inp.evento, statusDe: inp.statusDe ?? '', statusPara: inp.statusPara ?? '',
    comentario: sqlEscape(inp.comentario ?? '').slice(0, 500), autor: sqlEscape(inp.autor ?? '').slice(0, 200),
    origem: 'APP', agora: new Date().toISOString().slice(0, 19),
  }).catch((e) => console.error('auditoria workflow:', e));
}
