import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { HotTable } from '@handsontable/react-wrapper';
import { registerAllModules } from 'handsontable/registry';
import Handsontable from 'handsontable';
import { TextEditor } from 'handsontable/editors';
import { textRenderer } from 'handsontable/renderers';
import { useSF, jsonField, SF_IDS, execSF, querySQL, createRecord, updateRecord, removeRecord, invalidateSFCache } from '../hooks/useMitraData';
import { ToastContainer } from './ui/Toast';
import ModeloHistoricoModal from './ModeloHistoricoModal';
import { useToast } from '../hooks/useToast';
import { toTitleCase } from '../lib/utils';
import { tipoLinha, tipoDoRotulo, ROTULO_TIPO, ROTULOS_TIPO } from '../lib/linha-modelo';
import { problemasDaFormula } from '../lib/formula-core';
import { ArrowLeft, Plus, Info, HelpCircle, X, UploadCloud, History, Check, AlertCircle } from 'lucide-react';

registerAllModules();

// Editor da coluna Formula. O TextEditor padrao so carrega o valor da celula no
// textarea quando esta em "full edit mode" (Enter/F2/duplo clique); em qualquer
// outra abertura — inclusive o type-to-edit, que chama openEditor('') — o
// textarea comeca VAZIO e, ao fechar, salva vazio por cima da formula existente.
// Aqui TODA abertura entra em full edit mode com a formula atual carregada; o
// caractere digitado e inserido pelo navegador no fim (o focus() do editor ja
// colapsa o caret no final). Nenhum caminho de edicao descarta o valor anterior.
class FormulaCellEditor extends TextEditor {
  beginEditing(newInitialValue?: any, event?: any) {
    this.enableFullEditMode();
    const original = this.originalValue == null ? '' : String(this.originalValue);
    const typed = typeof newInitialValue === 'string' ? newInitialValue : '';
    super.beginEditing(original + typed, event);
  }
}

// Indices das colunas do grid. GRAN e RATEIO so aparecem em modelos de pacote
// (ESCOPO='PACOTE') — ficam no fim para nao deslocar os indices das colunas
// comuns. A ULTIMA coluna e sempre a lixeira (excluir linha) — renderer puro,
// sem dados; o botao direito segue funcionando como atalho alternativo.
const COL = { NOME: 0, TIPO: 1, FORMULA: 2, CONTA: 3, ESCONDER: 4, NEGRITO: 5, FORMATO: 6, GRAN: 7, RATEIO: 8 } as const;
const CHECKBOX_COLS: number[] = [COL.ESCONDER, COL.NEGRITO];

// Cabecalhos com icone (coluna estreita e legivel) — texto no title (tooltip)
const HEADER_ESCONDER = '<span class="ht-col-icon" title="Esconder na visualização"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"/><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"/><line x1="2" x2="22" y1="2" y2="22"/></svg></span>';
const HEADER_NEGRITO = '<span class="ht-col-icon" title="Exibir em negrito" style="font-weight:800;font-size:14px">B</span>';

// Alca de arrasto no cabecalho de cada linha (manualRowMove arrasta pelo row header)
const ROW_GRIP = '<span class="ht-row-grip" title="Arraste para reordenar"><svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor"><circle cx="3" cy="3" r="1.4"/><circle cx="7" cy="3" r="1.4"/><circle cx="3" cy="8" r="1.4"/><circle cx="7" cy="8" r="1.4"/><circle cx="3" cy="13" r="1.4"/><circle cx="7" cy="13" r="1.4"/></svg></span>';

// Modelo de PACOTE tem caminho de calculo proprio (granularidade por CR e
// rateio) que ainda nao resolve linha de premissa. Oferecer a opcao la faria a
// linha valer zero em silencio, entao ela so aparece em modelo de CR.
const TIPO_OPTS_CR = ROTULOS_TIPO;
const TIPO_OPTS_PACOTE = [ROTULO_TIPO.INPUT, ROTULO_TIPO.FORMULA];
const SEM_PREMISSA = '— selecione —';
const FORMATO_OPTS = ['Sem prefixo', 'Monetário', 'Unidades', 'Percentual', 'Texto'];
const FORMATO_DEFAULT = 'Sem prefixo';
const SEM_CONTA = '— sem conta —';
// Modelos de pacote: granularidade da linha ('Por CR' = sanfona de inputs por CR)
// e rateio aplicado (valor único dividido entre os CRs conforme o rateio)
const GRAN_OPTS = ['—', 'Por CR'];
const GRAN_DEFAULT = '—';
const SEM_RATEIO = '— sem rateio —';

const FORMATO_DB_TO_LABEL: Record<string, string> = {
  SEM_PREFIXO: 'Sem prefixo', MONETARIO: 'Monetário', UNIDADES: 'Unidades', PERCENTUAL: 'Percentual', TEXTO: 'Texto',
};
const FORMATO_LABEL_TO_DB: Record<string, string> = {
  'Sem prefixo': 'SEM_PREFIXO', 'Monetário': 'MONETARIO', 'Unidades': 'UNIDADES', 'Percentual': 'PERCENTUAL', 'Texto': 'TEXTO',
};

// Placeholders didaticos da coluna Formula — sempre com um exemplo concreto.
// Decimal com PONTO: com virgula ("1,05") o motor le o operador virgula do
// JavaScript e a formula devolve 5. O exemplo anterior ensinava esse erro.
const PLACEHOLDER_FORMULA = 'Ex.: {3.1.01} * 1.05   ou   [L2] * [L3]';
const PLACEHOLDER_INPUT = 'Ex.: {3.1.01} * 1.05   (digite para virar fórmula)';

const PADRAO_NAMES = new Set(['BASE_ZERO', 'BASE_HISTORICO', 'PESSOAL']);
function isAutoravel(d: any): boolean {
  if (!d) return false;
  if (d.TIPO_DRIVER === 'PACOTE') return false;
  if (d.ORIGEM === 'NATIVO' || d.ORIGEM === 'IA') return false;
  if (!d.ORIGEM && PADRAO_NAMES.has(d.NOME)) return false;
  return true;
}

function toBool(v: any): boolean {
  return v === true || v === 'true' || v === 1 || v === '1';
}

// Assinatura canonica das linhas para detectar "alteracoes nao publicadas".
// Compara o que importa para o calculo (codigo, tipo, formula, conta, flags,
// formato) na ordem de exibicao — deliberadamente ignora o NOME (que tem
// representacao diferente entre banco e grid) e o valor numerico de ORDEM.
export function canonOrdered(rows: any[]): string {
  return JSON.stringify(rows.map((r) => [
    String(r.CODIGO || ''),
    tipoLinha(r),
    tipoLinha(r) === 'FORMULA' ? String(r.FORMULA || '') : '',
    // A premissa citada faz parte do desenho do modelo: trocar de premissa e
    // uma alteracao a publicar, igual a trocar a formula. Snapshots antigos nao
    // tem o campo e normalizam para '', mantendo a assinatura estavel.
    tipoLinha(r) === 'PREMISSA' ? String(r.PREMISSA_NOME || '') : '',
    r.CONTA_ID == null || r.CONTA_ID === '' ? null : Number(r.CONTA_ID),
    toBool(r.ESCONDER) ? 1 : 0,
    toBool(r.NEGRITO) ? 1 : 0,
    String(r.FORMATO || 'SEM_PREFIXO'),
    // Campos de modelo de pacote — vazios em modelos de CR (snapshots antigos
    // sem os campos normalizam para o mesmo valor, mantendo a assinatura estável)
    String(r.GRANULARIDADE || ''),
    r.RATEIO_ID == null || r.RATEIO_ID === '' ? null : Number(r.RATEIO_ID),
  ]));
}
export function canonFromSnapshot(arr: any[]): string {
  const ordered = [...arr].sort((a, b) =>
    (Number(a.ORDEM) - Number(b.ORDEM)) || String(a.CODIGO || '').localeCompare(String(b.CODIGO || '')));
  return canonOrdered(ordered);
}

function formatVersaoData(iso: string): string {
  if (!iso) return '';
  const d = String(iso).replace('T', ' ');
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(d);
  return m ? `${m[3]}/${m[2]} às ${m[4]}:${m[5]}` : d;
}
type ModeloVersao = { ID: number; NUMERO: number; CRIADO_EM: string; AUTOR?: string | null; QTD_LINHAS?: number };

type GridRow = (string | boolean)[];
type FormulaSuggestionState = {
  kind: 'conta' | 'linha';
  queryStart: number;
  caret: number;
  items: any[];
  selectedIndex: number;
  top: number;
  left: number;
  width: number;
};

/**
 * Editor de fórmulas de um modelo personalizado (Handsontable + auto-save).
 * - standalone: renderiza cabeçalho próprio (voltar + título) e ocupa a tela toda (rota /modelos/:id/formulas)
 * - embutido (default): toolbar compacta, ocupa a altura do container pai — usado inline na tela de Modelagem
 */
export default function FormulasModeloEditor({ driverId, standalone = false, onPublished, onUnpublishedChange }: { driverId: number; standalone?: boolean; onPublished?: () => void; onUnpublishedChange?: (hasUnpublished: boolean) => void }) {
  const navigate = useNavigate();
  const { toasts, addToast, removeToast } = useToast();

  // Mount em 1 ida: SF 133 devolve DRIVER/CONTAS/LINHAS/VINCULOS como blocos JSON
  const { data: hotRows } = useSF(SF_IDS.hotFormulasModeloBase, { driverId: driverId || 0 });
  const driver = useMemo(() => jsonField(hotRows?.[0]?.DRIVER)[0] || null, [hotRows]);
  const contas = useMemo(() => jsonField(hotRows?.[0]?.CONTAS).sort((a, b) => String(a.CODIGO ?? '').localeCompare(String(b.CODIGO ?? ''))), [hotRows]);
  const rateios = useMemo(() => jsonField(hotRows?.[0]?.RATEIOS).sort((a: any, b: any) => String(a.NOME ?? '').localeCompare(String(b.NOME ?? ''))), [hotRows]);
  // Nomes de premissa geral disponiveis para a linha do tipo Premissa. A lista e
  // distinta entre versoes de proposito: o modelo nao pertence a uma versao, e
  // a linha amarra por nome (ver lib/linha-modelo).
  const premissaOpts = useMemo(
    () => [SEM_PREMISSA, ...jsonField(hotRows?.[0]?.PREMISSAS_NOMES).map((p: any) => String(p.NOME || '')).filter(Boolean)],
    [hotRows]
  );
  const sortLinhas = (rows: any[]) => rows.sort((a: any, b: any) => (Number(a.ORDEM) - Number(b.ORDEM)) || (Number(a.ID) - Number(b.ID)));

  // Modelo de pacote: ganha as colunas Granularidade e Rateio aplicado
  const isPacoteModel = driver?.ESCOPO === 'PACOTE';

  const rateioLabelOf = useCallback((r: any) => `#${r.ID} · ${toTitleCase(String(r.NOME || '').replace(/_/g, ' '))}`, []);
  const rateioOpts = useMemo(() => [SEM_RATEIO, ...rateios.map(rateioLabelOf)], [rateios, rateioLabelOf]);
  const rateioIdByLabel = useMemo(() => {
    const m = new Map<string, number>();
    rateios.forEach((r: any) => m.set(rateioLabelOf(r), Number(r.ID)));
    return m;
  }, [rateios, rateioLabelOf]);
  const rateioById = useMemo(() => new Map<number, any>(rateios.map((r: any) => [Number(r.ID), r])), [rateios]);

  // ── Cobertura de rateio (só pacote): CRs da conta sem quantidade no rateio
  // ficam de fora da distribuição — o alerta aparece aqui, onde se configura.
  const [covData, setCovData] = useState<{ itens: any[]; crContas: any[]; crCodes: Map<number, string> } | null>(null);
  useEffect(() => {
    if (!isPacoteModel || !driverId) { setCovData(null); return; }
    let cancel = false;
    (async () => {
      try {
        const [itens, crContas, crs] = await Promise.all([
          querySQL(`SELECT RATEIO_ID, CR_ID, QUANTIDADE FROM RATEIO_ITEM`),
          querySQL(`SELECT CONTA_ID, CR_ID FROM CR_CONTA WHERE ATIVO = true`),
          querySQL(`SELECT ID, CODIGO FROM CENTRO_RESULTADO WHERE ATIVO = 'true'`),
        ]);
        if (!cancel) setCovData({ itens, crContas, crCodes: new Map(crs.map((c: any) => [Number(c.ID), String(c.CODIGO)])) });
      } catch { /* alerta é informativo — não bloqueia o editor */ }
    })();
    return () => { cancel = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPacoteModel, driverId, rateios]);

  const contaLabel = useCallback((c: any) => `${c.CODIGO} · ${toTitleCase(c.NOME)}`, []);
  const contaOpts = useMemo(() => [SEM_CONTA, ...contas.map(contaLabel)], [contas, contaLabel]);
  const contaIdByLabel = useMemo(() => {
    const m = new Map<string, number>();
    contas.forEach((c: any) => m.set(contaLabel(c), c.ID));
    return m;
  }, [contas, contaLabel]);
  const contaById = useMemo(() => new Map<number, any>(contas.map((c: any) => [c.ID, c])), [contas]);

  // Fonte de dados do grid — o Handsontable muta este array in-place
  const [gridData, setGridData] = useState<GridRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  type RowMeta = { id: number | null; codigo: string | null };
  const rowMetaRef = useRef<RowMeta[]>([]);
  const pendingRef = useRef<Map<RowMeta, Promise<void>>>(new Map());
  const maxOrdemRef = useRef(0);
  // Sequencial do CODIGO (L1, L2, ...) — estavel por linha, usado nas formulas
  const codigoSeqRef = useRef(0);
  const hotRef = useRef<any>(null);
  const formulaEditorCleanupRef = useRef<(() => void) | null>(null);
  const formulaSuggestionsRef = useRef<FormulaSuggestionState | null>(null);
  const [formulaSuggestions, setFormulaSuggestions] = useState<FormulaSuggestionState | null>(null);
  // Publicacao (modelo 1B: edicoes seguem ao vivo; Publicar grava um snapshot no
  // historico e serve de marco "publicado em X"). publishedCanon = assinatura da
  // ultima versao publicada, para detectar alteracoes nao publicadas.
  const [publishedInfo, setPublishedInfo] = useState<{ numero: number; criadoEm: string } | null>(null);
  const [publishedCanon, setPublishedCanon] = useState<string | null>(null);
  const [hasUnpublished, setHasUnpublished] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [gridVersion, setGridVersion] = useState(0);
  const bumpGrid = useCallback(() => setGridVersion((v) => v + 1), []);
  // Historico (2B: somente visualizacao) — modal compartilhado ModeloHistoricoModal.
  // No modo embutido o botao vive no header da tela de Modelagem; aqui so no standalone.
  const [showHistory, setShowHistory] = useState(false);

  // Painel de ajuda no header (as dicas de fórmula) — fica fechado por padrao para
  // nao ocupar espaco; abre no clique do icone e fecha ao clicar fora / Escape.
  const [showHelp, setShowHelp] = useState(false);
  const helpRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showHelp) return;
    const onDown = (e: MouseEvent) => {
      if (helpRef.current && !helpRef.current.contains(e.target as Node)) setShowHelp(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowHelp(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [showHelp]);

  const updateFormulaSuggestions = useCallback((next: FormulaSuggestionState | null) => {
    formulaSuggestionsRef.current = next;
    setFormulaSuggestions(next);
  }, []);

  const normalize = (s: string) => s.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  // Dois gatilhos de autocomplete: '{' sugere contas contabeis, '[' sugere as
  // outras linhas do modelo (referenciadas pelo CODIGO estavel \u2014 ex.: [L2]).
  const refreshFormulaSuggestions = useCallback((textarea: HTMLTextAreaElement) => {
    const caret = textarea.selectionStart ?? textarea.value.length;
    const beforeCaret = textarea.value.slice(0, caret);
    const contaStart = beforeCaret.lastIndexOf('{');
    const linhaStart = beforeCaret.lastIndexOf('[');
    const contaOpen = contaStart !== -1 && beforeCaret.lastIndexOf('}') < contaStart;
    const linhaOpen = linhaStart !== -1 && beforeCaret.lastIndexOf(']') < linhaStart;
    let kind: 'conta' | 'linha' | null = null;
    let queryStart = -1;
    if (contaOpen && (!linhaOpen || contaStart > linhaStart)) { kind = 'conta'; queryStart = contaStart; }
    else if (linhaOpen) { kind = 'linha'; queryStart = linhaStart; }
    if (!kind) {
      updateFormulaSuggestions(null);
      return;
    }

    const normalizedQuery = normalize(beforeCaret.slice(queryStart + 1).trim());
    let items: any[] = [];
    if (kind === 'conta') {
      items = contas
        .filter((conta: any) => {
          if (!normalizedQuery) return true;
          const codigo = String(conta.CODIGO || '').toLocaleLowerCase('pt-BR');
          const nome = normalize(String(conta.NOME || ''));
          return codigo.includes(normalizedQuery) || nome.includes(normalizedQuery);
        })
        .slice(0, 8);
    } else {
      const hot = hotRef.current?.hotInstance;
      const editingRow = hot?.getSelectedLast?.()?.[0];
      const total = hot ? hot.countRows() : 0;
      for (let v = 0; v < total && items.length < 8; v++) {
        if (v === editingRow) continue;
        // TODA linha e referenciavel por [codigo] \u2014 nas vinculadas a conta o
        // motor resolve [Lx] como sinonimo do {codigo da conta}
        const meta = rowMetaRef.current[hot.toPhysicalRow(v)];
        if (!meta?.codigo) continue;
        const nome = String(hot.getDataAtCell(v, COL.NOME) || '');
        if (normalizedQuery && !normalize(`${meta.codigo} ${nome}`).includes(normalizedQuery)) continue;
        items.push({ CODIGO: meta.codigo, NOME: nome });
      }
    }

    if (items.length === 0) {
      updateFormulaSuggestions(null);
      return;
    }

    const rect = textarea.getBoundingClientRect();
    const width = Math.max(300, rect.width);
    updateFormulaSuggestions({
      kind,
      queryStart,
      caret,
      items,
      selectedIndex: 0,
      top: Math.min(rect.bottom + 4, window.innerHeight - 280),
      left: Math.min(rect.left, window.innerWidth - width - 12),
      width,
    });
  }, [contas, updateFormulaSuggestions]);

  const insertFormulaRef = useCallback((item: any) => {
    const state = formulaSuggestionsRef.current;
    const editor = hotRef.current?.hotInstance?.getActiveEditor?.();
    const textarea = editor?.TEXTAREA as HTMLTextAreaElement | undefined;
    if (!state || !textarea) return;

    const codigo = String(item.CODIGO || '');
    const reference = state.kind === 'linha' ? `[${codigo}]` : `{${codigo}}`;
    textarea.value = textarea.value.slice(0, state.queryStart) + reference + textarea.value.slice(state.caret);
    const nextCaret = state.queryStart + reference.length;
    textarea.focus();
    textarea.setSelectionRange(nextCaret, nextCaret);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    updateFormulaSuggestions(null);
  }, [updateFormulaSuggestions]);

  const cleanupFormulaEditor = useCallback(() => {
    formulaEditorCleanupRef.current?.();
    formulaEditorCleanupRef.current = null;
    updateFormulaSuggestions(null);
  }, [updateFormulaSuggestions]);

  const handleAfterBeginEditing = useCallback((_row: number, col: number) => {
    cleanupFormulaEditor();
    if (col !== COL.FORMULA) return;
    const editor = hotRef.current?.hotInstance?.getActiveEditor?.();
    const textarea = editor?.TEXTAREA as HTMLTextAreaElement | undefined;
    if (!textarea) return;

    // O editor padrao seleciona todo o texto. Colapsar no fim evita que a
    // primeira tecla apague uma formula existente e ainda permite reposicionar.
    requestAnimationFrame(() => {
      const end = textarea.value.length;
      textarea.setSelectionRange(end, end);
      refreshFormulaSuggestions(textarea);
    });

    const onInput = () => refreshFormulaSuggestions(textarea);
    const onKeyDown = (event: KeyboardEvent) => {
      const state = formulaSuggestionsRef.current;
      if (!state) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        event.stopImmediatePropagation();
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        const selectedIndex = (state.selectedIndex + direction + state.items.length) % state.items.length;
        updateFormulaSuggestions({ ...state, selectedIndex });
      } else if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        event.stopImmediatePropagation();
        insertFormulaRef(state.items[state.selectedIndex]);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        updateFormulaSuggestions(null);
      }
    };
    textarea.addEventListener('input', onInput);
    textarea.addEventListener('keydown', onKeyDown, true);
    textarea.addEventListener('blur', cleanupFormulaEditor);
    formulaEditorCleanupRef.current = () => {
      textarea.removeEventListener('input', onInput);
      textarea.removeEventListener('keydown', onKeyDown, true);
      textarea.removeEventListener('blur', cleanupFormulaEditor);
    };
  }, [cleanupFormulaEditor, insertFormulaRef, refreshFormulaSuggestions, updateFormulaSuggestions]);

  useEffect(() => cleanupFormulaEditor, [cleanupFormulaEditor]);

  // Carga: garante 1 linha por conta vinculada e monta o grid
  useEffect(() => {
    if (!driverId || contas.length === 0 || !driver) return;
    if (!isAutoravel(driver)) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const linhas = sortLinhas(jsonField(hotRows?.[0]?.LINHAS));
        const vinculos = jsonField(hotRows?.[0]?.VINCULOS);
        const comLinha = new Set(linhas.filter((l: any) => l.CONTA_ID).map((l: any) => Number(l.CONTA_ID)));
        const faltando = vinculos.map((v: any) => Number(v.CONTA_ID)).filter((id: number) => !comLinha.has(id));
        for (const contaId of faltando) {
          await createRecord('DRIVER_FORMULA', {
            DRIVER_ID: driverId, CONTA_ID: contaId, TIPO: 'INPUT', FORMULA: '', ORDEM: 0,
            ESCONDER: false, NEGRITO: false, FORMATO: 'SEM_PREFIXO',
          });
        }
        const finais = faltando.length > 0
          ? sortLinhas(jsonField((await execSF(SF_IDS.hotFormulasModeloBase, { driverId }))?.[0]?.LINHAS))
          : linhas;
        if (cancelled) return;

        const data: GridRow[] = [];
        const metas: { id: number | null; codigo: string | null }[] = [];
        let maxOrdem = 0;
        let maxCodigo = 0;
        finais.forEach((l: any) => {
          const conta = l.CONTA_ID ? contaById.get(Number(l.CONTA_ID)) : null;
          const nome = l.NOME_CUSTOM || l.LABEL || (conta ? toTitleCase(conta.NOME) : '');
          const rateio = l.RATEIO_ID != null ? rateioById.get(Number(l.RATEIO_ID)) : null;
          data.push([
            nome,
            ROTULO_TIPO[tipoLinha(l)],
            // A coluna 2 e compartilhada: formula (texto) ou premissa (seletor).
            tipoLinha(l) === 'PREMISSA' ? (l.PREMISSA_NOME || SEM_PREMISSA) : (l.FORMULA || ''),
            conta ? contaLabel(conta) : SEM_CONTA,
            toBool(l.ESCONDER),
            toBool(l.NEGRITO),
            FORMATO_DB_TO_LABEL[l.FORMATO] || FORMATO_DEFAULT,
            l.GRANULARIDADE === 'CR' ? 'Por CR' : GRAN_DEFAULT,
            rateio ? rateioLabelOf(rateio) : SEM_RATEIO,
          ]);
          metas.push({ id: Number(l.ID), codigo: l.CODIGO || null });
          maxOrdem = Math.max(maxOrdem, Number(l.ORDEM) || 0);
          const seq = /^L(\d+)$/.exec(String(l.CODIGO || ''));
          if (seq) maxCodigo = Math.max(maxCodigo, Number(seq[1]));
        });
        rowMetaRef.current = metas;
        maxOrdemRef.current = Math.max(maxOrdem, data.length);
        codigoSeqRef.current = Math.max(maxCodigo, metas.length);

        // Auto-cura: linha sem CODIGO nao pode ser referenciada em formula
        // ([Lx]) — atribui o proximo codigo livre e persiste. Cobre linhas
        // criadas por caminhos que nao gravam codigo (ex: auto-criacao de linha
        // ao rotear conta no Mapeamento) e legados. TODA linha tem codigo.
        finais.forEach((_l: any, i: number) => {
          const meta = metas[i];
          if (meta && meta.id != null && !meta.codigo) {
            meta.codigo = `L${++codigoSeqRef.current}`;
            updateRecord('DRIVER_FORMULA', meta.id, { CODIGO: meta.codigo })
              .catch((e) => console.error('backfill CODIGO:', e));
          }
        });

        // Ultima versao publicada (SF 133 devolve ULTIMA_VERSAO; SNAPSHOT vem como
        // string JSON — dupla parse). Serve de marco e base do "nao publicado".
        try {
          const raw = hotRows?.[0]?.ULTIMA_VERSAO;
          const uv = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
          if (uv && uv.NUMERO != null) {
            setPublishedInfo({ numero: Number(uv.NUMERO), criadoEm: String(uv.CRIADO_EM || '') });
            const snapArr = uv.SNAPSHOT ? (typeof uv.SNAPSHOT === 'string' ? JSON.parse(uv.SNAPSHOT) : uv.SNAPSHOT) : [];
            setPublishedCanon(canonFromSnapshot(Array.isArray(snapArr) ? snapArr : []));
          } else {
            setPublishedInfo(null);
            setPublishedCanon(null);
          }
        } catch { setPublishedInfo(null); setPublishedCanon(null); }

        setGridData(data);
        setGridVersion((v) => v + 1);
      } catch (e) {
        console.error(e);
        addToast('error', 'Erro ao carregar as linhas do modelo');
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driverId, contas.length, driver?.ID]);

  // Altura em pixels medida do container — NUNCA height="100%" (guia Handsontable)
  const wrapRef = useRef<HTMLDivElement>(null);
  const [tableHeight, setTableHeight] = useState(480);
  useEffect(() => {
    const update = () => {
      if (wrapRef.current) setTableHeight(Math.max(240, wrapRef.current.clientHeight));
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [loading, gridData]);

  // Arrastar em um unico movimento: o manualRowMove so inicia o drag se a linha
  // ja esta selecionada pelo row header (senao seria preciso clicar e arrastar em
  // dois passos). Este listener roda na fase de captura — antes do pipeline do
  // Handsontable — e seleciona a linha no instante do press na alca.
  useEffect(() => {
    const hot = hotRef.current?.hotInstance;
    const root = hot?.rootElement as HTMLElement | undefined;
    if (!hot || root == null) return;
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const th = (e.target as HTMLElement)?.closest?.('tbody th');
      if (!th) return;
      const coords = hot.getCoords(th as HTMLTableCellElement);
      if (!coords || coords.row < 0 || coords.col >= 0) return;
      const sel = hot.getSelectedRangeLast?.();
      if (hot.selection?.isSelectedByRowHeader?.() && sel
        && coords.row >= Math.min(sel.from.row, sel.to.row)
        && coords.row <= Math.max(sel.from.row, sel.to.row)) return;
      hot.selectRows(coords.row);
    };
    root.addEventListener('mousedown', onMouseDown, true);
    return () => root.removeEventListener('mousedown', onMouseDown, true);
  }, [loading, gridData]);

  // ============================================================
  // PUBLICACAO + HISTORICO
  // ============================================================
  // Assinatura canonica do estado atual do grid (ordem visual).
  const canonFromGrid = useCallback((): string => {
    const hot = hotRef.current?.hotInstance;
    if (!hot) return '';
    const total = hot.countRows();
    const list: any[] = [];
    for (let v = 0; v < total; v++) {
      const meta = rowMetaRef.current[hot.toPhysicalRow(v)];
      const tipo = hot.getDataAtCell(v, COL.TIPO) === 'Fórmula' ? 'FORMULA' : 'INPUT';
      const contaLabel = String(hot.getDataAtCell(v, COL.CONTA) || SEM_CONTA);
      const rateioLabel = String(hot.getDataAtCell(v, COL.RATEIO) || SEM_RATEIO);
      list.push({
        CODIGO: meta?.codigo || '',
        TIPO: tipo,
        FORMULA: tipo === 'FORMULA' ? String(hot.getDataAtCell(v, COL.FORMULA) || '') : '',
        CONTA_ID: contaLabel !== SEM_CONTA ? (contaIdByLabel.get(contaLabel) ?? null) : null,
        ESCONDER: toBool(hot.getDataAtCell(v, COL.ESCONDER)),
        NEGRITO: toBool(hot.getDataAtCell(v, COL.NEGRITO)),
        FORMATO: FORMATO_LABEL_TO_DB[String(hot.getDataAtCell(v, COL.FORMATO))] || 'SEM_PREFIXO',
        GRANULARIDADE: hot.getDataAtCell(v, COL.GRAN) === 'Por CR' ? 'CR' : '',
        RATEIO_ID: rateioLabel !== SEM_RATEIO ? (rateioIdByLabel.get(rateioLabel) ?? null) : null,
      });
    }
    return canonOrdered(list);
  }, [contaIdByLabel, rateioIdByLabel]);

  // Recalcula "tem alteracoes nao publicadas" sempre que o grid muda ou publica.
  useEffect(() => {
    if (loading || !gridData) return;
    const canon = canonFromGrid();
    const nextHasUnpublished = publishedCanon == null ? true : canon !== publishedCanon;
    setHasUnpublished(nextHasUnpublished);
    onUnpublishedChange?.(nextHasUnpublished);
  }, [gridVersion, publishedCanon, loading, gridData, canonFromGrid, onUnpublishedChange]);

  // Recalcula os alertas de cobertura de rateio a cada mudança do grid (pacote):
  // linha com conta + rateio cujos CRs da conta não têm quantidade no rateio.
  const [covWarnings, setCovWarnings] = useState<Array<{ linha: string; rateio: string; faltam: string[]; recebem: string[] }>>([]);
  const covCanonRef = useRef('');
  useEffect(() => {
    if (!isPacoteModel || loading || !gridData || !covData) {
      if (covCanonRef.current !== '') { covCanonRef.current = ''; setCovWarnings([]); }
      return;
    }
    const hot = hotRef.current?.hotInstance;
    if (!hot) return;
    const crsByConta = new Map<number, number[]>();
    covData.crContas.forEach((r: any) => {
      const arr = crsByConta.get(Number(r.CONTA_ID)) || [];
      arr.push(Number(r.CR_ID));
      crsByConta.set(Number(r.CONTA_ID), arr);
    });
    const out: Array<{ linha: string; rateio: string; faltam: string[]; recebem: string[] }> = [];
    for (let v = 0; v < hot.countRows(); v++) {
      const contaVal = String(hot.getDataAtCell(v, COL.CONTA) || SEM_CONTA);
      const rateioVal = String(hot.getDataAtCell(v, COL.RATEIO) || SEM_RATEIO);
      const granular = hot.getDataAtCell(v, COL.GRAN) === 'Por CR';
      if (contaVal === SEM_CONTA || rateioVal === SEM_RATEIO || granular) continue;
      const contaId = contaIdByLabel.get(contaVal);
      const rateioId = rateioIdByLabel.get(rateioVal);
      if (!contaId || !rateioId) continue;
      const crs = crsByConta.get(contaId) || [];
      if (crs.length === 0) continue;
      const cobertos = new Set(
        covData.itens
          .filter((it: any) => Number(it.RATEIO_ID) === rateioId && Number(it.QUANTIDADE) > 0)
          .map((it: any) => Number(it.CR_ID))
      );
      const faltam = crs.filter((c) => !cobertos.has(c));
      if (faltam.length === 0) continue;
      const code = (c: number) => covData.crCodes.get(c) || `CR${c}`;
      out.push({
        linha: String(hot.getDataAtCell(v, COL.NOME) || contaVal),
        rateio: rateioVal.replace(/^#\d+ · /, ''),
        faltam: faltam.map(code).sort(),
        recebem: crs.filter((c) => cobertos.has(c)).map(code).sort(),
      });
    }
    const canon = JSON.stringify(out);
    if (canon !== covCanonRef.current) { covCanonRef.current = canon; setCovWarnings(out); }
  }, [gridVersion, loading, gridData, covData, isPacoteModel, contaIdByLabel, rateioIdByLabel]);

  const publicar = useCallback(async () => {
    if (!driverId || publishing) return;
    setPublishing(true);
    try {
      // Garante que o auto-save terminou antes de tirar o snapshot no servidor.
      await Promise.allSettled([...pendingRef.current.values()]);
      const canonAgora = canonFromGrid();
      if (publishedCanon != null && canonAgora === publishedCanon) {
        addToast('success', 'Nenhuma alteração desde a última publicação');
        setPublishing(false);
        return;
      }
      const agora = new Date().toISOString().slice(0, 19);
      await execSF(SF_IDS.publicarModeloVersao, { driverId, agora });
      // Reflexo: limpa o cache do preenchimento para a proxima abertura pegar fresco.
      invalidateSFCache();
      const vs = (await execSF(SF_IDS.listarModeloVersoes, { driverId })) as ModeloVersao[];
      const top = vs?.[0];
      setPublishedCanon(canonAgora);
      if (top) setPublishedInfo({ numero: Number(top.NUMERO), criadoEm: String(top.CRIADO_EM) });
      setHasUnpublished(false);
      addToast('success', `Versão v${top?.NUMERO ?? ''} publicada`);
      // Reativo: avisa a lista de modelos (Mapeamento) para reavaliar o status do
      // modelo — o ícone volta a "Pronto" sem recarregar a página.
      onPublished?.();
    } catch (e) {
      console.error(e);
      addToast('error', 'Erro ao publicar o modelo');
    }
    setPublishing(false);
  }, [driverId, publishing, canonFromGrid, publishedCanon, addToast, onPublished]);

  // ============================================================
  // PERSISTENCIA (auto-save — sem botao salvar)
  // ============================================================
  const buildPayloadFromRow = useCallback((row: number): Record<string, any> => {
    const hot = hotRef.current?.hotInstance;
    const get = (col: number) => hot?.getDataAtCell(row, col);
    const contaVal = String(get(COL.CONTA) || SEM_CONTA);
    const contaId = contaVal !== SEM_CONTA ? (contaIdByLabel.get(contaVal) ?? null) : null;
    const rateioVal = String(get(COL.RATEIO) || SEM_RATEIO);
    return {
      DRIVER_ID: driverId,
      CONTA_ID: contaId,
      NOME_CUSTOM: String(get(COL.NOME) || '').trim(),
      TIPO: tipoDoRotulo(get(COL.TIPO)),
      FORMULA: tipoDoRotulo(get(COL.TIPO)) === 'FORMULA' ? String(get(COL.FORMULA) || '') : '',
      PREMISSA_NOME: tipoDoRotulo(get(COL.TIPO)) === 'PREMISSA'
        ? (String(get(COL.FORMULA) || '') === SEM_PREMISSA ? null : String(get(COL.FORMULA) || '') || null)
        : null,
      ESCONDER: toBool(get(COL.ESCONDER)),
      NEGRITO: toBool(get(COL.NEGRITO)),
      FORMATO: FORMATO_LABEL_TO_DB[String(get(COL.FORMATO))] || 'SEM_PREFIXO',
      GRANULARIDADE: get(COL.GRAN) === 'Por CR' ? 'CR' : null,
      RATEIO_ID: rateioVal !== SEM_RATEIO ? (rateioIdByLabel.get(rateioVal) ?? null) : null,
      ORDEM: ++maxOrdemRef.current,
    };
  }, [driverId, contaIdByLabel, rateioIdByLabel]);

  const persistRow = useCallback((meta: { id: number | null; codigo: string | null }, patch: Record<string, any>) => {
    const chain = pendingRef.current.get(meta) || Promise.resolve();
    const next = chain
      .then(async () => {
        if (meta.id == null) {
          // rowMetaRef segue a ordem FISICA (fonte de dados); com manualRowMove a
          // leitura das celulas precisa do indice VISUAL. O patch sobrepoe o
          // payload (ex.: ORDEM normalizada apos arrastar).
          const idx = rowMetaRef.current.indexOf(meta);
          if (idx === -1) return;
          const visualIdx = hotRef.current?.hotInstance?.toVisualRow(idx) ?? idx;
          const payload = { ...buildPayloadFromRow(visualIdx), CODIGO: meta.codigo, ...patch };
          const res: any = await createRecord('DRIVER_FORMULA', payload);
          let newId = res?.ID ?? res?.id ?? res?.result?.ID ?? res?.result?.id;
          if (!newId) {
            const rows = await querySQL(`SELECT MAX(ID) AS ID FROM DRIVER_FORMULA WHERE DRIVER_ID = ${driverId}`);
            newId = rows?.[0]?.ID;
          }
          meta.id = Number(newId) || null;
        } else {
          await updateRecord('DRIVER_FORMULA', meta.id, patch);
        }
      })
      .catch((e) => {
        console.error(e);
        addToast('error', 'Erro ao salvar alteração');
      });
    pendingRef.current.set(meta, next);
  }, [buildPayloadFromRow, driverId, addToast]);

  // Linha com conta ⇒ conta vinculada ao modelo/pacote no Mapeamento (CONTA_DRIVER).
  // Associar uma conta aqui cria/move a rota da conta para este driver; tirar a
  // conta da última linha que a usava desfaz o vínculo. Sem isso, linha e rota
  // descasam (conta lançada pelo pacote sem estar no pacote = ambiguidade).
  const syncContaVinculo = useCallback(async (novaContaId: number | null, antigaContaId: number | null) => {
    if (!driverId || novaContaId === antigaContaId) return;
    try {
      if (novaContaId != null) {
        const rows = await querySQL(`SELECT ID, DRIVER_ID FROM CONTA_DRIVER WHERE CONTA_ID = ${novaContaId} LIMIT 1`);
        if (rows.length === 0) {
          await createRecord('CONTA_DRIVER', {
            CONTA_ID: novaContaId, DRIVER_ID: driverId, PACOTE_ID: null,
            CRIADO_EM: new Date().toISOString().slice(0, 19),
          });
          addToast('success', isPacoteModel ? 'Conta adicionada ao pacote no Mapeamento' : 'Conta vinculada ao modelo no Mapeamento');
        } else if (Number(rows[0].DRIVER_ID) !== driverId) {
          await updateRecord('CONTA_DRIVER', Number(rows[0].ID), { DRIVER_ID: driverId, PACOTE_ID: null });
          addToast('success', isPacoteModel ? 'Conta movida para este pacote no Mapeamento' : 'Conta movida para este modelo no Mapeamento');
        }
        if (isPacoteModel) {
          // contas em pacote não têm personalização por CR — limpa exceções órfãs
          const excs = await querySQL(`SELECT ID FROM CONTA_DRIVER_EXCECAO WHERE CONTA_ID = ${novaContaId} AND ATIVO = true`);
          for (const e of excs) await removeRecord('CONTA_DRIVER_EXCECAO', Number(e.ID));
        }
      }
      if (antigaContaId != null) {
        // só desfaz o vínculo se nenhuma outra linha deste driver usa a conta
        const outras = await querySQL(
          `SELECT ID FROM DRIVER_FORMULA WHERE DRIVER_ID = ${driverId} AND CONTA_ID = ${antigaContaId} LIMIT 1`
        );
        if (outras.length === 0) {
          const cds = await querySQL(`SELECT ID FROM CONTA_DRIVER WHERE DRIVER_ID = ${driverId} AND CONTA_ID = ${antigaContaId}`);
          for (const cd of cds) await removeRecord('CONTA_DRIVER', Number(cd.ID));
        }
      }
    } catch (e) { console.error('sync conta-vinculo:', e); }
  }, [driverId, isPacoteModel, addToast]);

  const handleAfterChange = useCallback((changes: any[] | null, source: string) => {
    if (!changes || source === 'loadData' || source === 'tipoSync') return;
    const hot = hotRef.current?.hotInstance;
    if (!hot) return;
    const patchesByRow = new Map<number, Record<string, any>>();
    let needsRender = false;

    for (const [row, col, oldVal, newVal] of changes) {
      if (oldVal === newVal) continue;
      const patch = patchesByRow.get(row) || {};
      if (col === COL.NOME) patch.NOME_CUSTOM = String(newVal || '').trim();
      else if (col === COL.TIPO) {
        // A coluna 2 muda de natureza conforme o tipo (texto de formula x
        // seletor de premissa), entao ela e limpa a cada troca — deixar o
        // conteudo antigo faria a linha gravar uma formula como nome de
        // premissa, ou vice-versa.
        const tipo = tipoDoRotulo(newVal);
        patch.TIPO = tipo;
        if (tipo === 'INPUT') {
          patch.FORMULA = ''; patch.PREMISSA_NOME = null;
          hot.setDataAtCell(row, COL.FORMULA, '', 'tipoSync');
        } else if (tipo === 'PREMISSA') {
          patch.FORMULA = ''; patch.PREMISSA_NOME = null;
          hot.setDataAtCell(row, COL.FORMULA, SEM_PREMISSA, 'tipoSync');
        } else {
          patch.PREMISSA_NOME = null;
          hot.setDataAtCell(row, COL.FORMULA, '', 'tipoSync');
        }
        needsRender = true;
      } else if (col === COL.FORMULA) {
        const val = String(newVal || '');
        const tipoAtual = tipoDoRotulo(hot.getDataAtCell(row, COL.TIPO));
        if (tipoAtual === 'PREMISSA') {
          // Seletor de premissa — nunca vira formula.
          patch.PREMISSA_NOME = val === SEM_PREMISSA ? null : (val || null);
          patch.FORMULA = '';
        } else {
          patch.FORMULA = val;
          // Digitar na coluna promove a linha a Formula. So vale saindo de
          // Input: uma linha Premissa nao tem o que digitar aqui.
          if (val.trim() !== '' && tipoAtual === 'INPUT') {
            patch.TIPO = 'FORMULA';
            hot.setDataAtCell(row, COL.TIPO, ROTULO_TIPO.FORMULA, 'tipoSync');
            needsRender = true;
          }
        }
      } else if (col === COL.CONTA) {
        const label = String(newVal || SEM_CONTA);
        patch.CONTA_ID = label !== SEM_CONTA ? (contaIdByLabel.get(label) ?? null) : null;
        // guarda a conta anterior para sincronizar o vínculo no Mapeamento
        const oldLabel = String(oldVal || SEM_CONTA);
        (patch as any).__oldContaId = oldLabel !== SEM_CONTA ? (contaIdByLabel.get(oldLabel) ?? null) : null;
        needsRender = true; // badge de codigo no Nome aparece/some conforme a conta
      } else if (col === COL.ESCONDER) { patch.ESCONDER = toBool(newVal); needsRender = true; }
      else if (col === COL.NEGRITO) { patch.NEGRITO = toBool(newVal); needsRender = true; }
      else if (col === COL.FORMATO) patch.FORMATO = FORMATO_LABEL_TO_DB[String(newVal)] || 'SEM_PREFIXO';
      else if (col === COL.GRAN) {
        const porCR = newVal === 'Por CR';
        patch.GRANULARIDADE = porCR ? 'CR' : null;
        if (porCR && String(hot.getDataAtCell(row, COL.RATEIO) || SEM_RATEIO) !== SEM_RATEIO) {
          // Granular por CR e rateio são excludentes: por CR o gestor lança direto em cada CR
          patch.RATEIO_ID = null;
          hot.setDataAtCell(row, COL.RATEIO, SEM_RATEIO, 'tipoSync');
        }
        needsRender = true;
      } else if (col === COL.RATEIO) {
        const label = String(newVal || SEM_RATEIO);
        patch.RATEIO_ID = label !== SEM_RATEIO ? (rateioIdByLabel.get(label) ?? null) : null;
        needsRender = true;
      }
      patchesByRow.set(row, patch);
    }

    patchesByRow.forEach((patch, row) => {
      // afterChange traz indice VISUAL; rowMetaRef e indexado pelo FISICO
      const meta = rowMetaRef.current[hot.toPhysicalRow(row)];
      if (!meta || Object.keys(patch).length === 0) return;
      const trocouConta = '__oldContaId' in patch;
      const oldContaId = trocouConta ? ((patch as any).__oldContaId as number | null) : null;
      delete (patch as any).__oldContaId;
      // Aplicar um rateio a linha define quem recebe: todo setor com quantidade
      // nele passa a ter a conta desta linha mapeada. Sem isso o setor sem a conta
      // era descartado da divisao e os percentuais renormalizavam nos demais.
      const aplicouRateio = 'RATEIO_ID' in patch && patch.RATEIO_ID != null;
      persistRow(meta, patch);
      if (aplicouRateio) {
        // depois do persist da linha — a sincronizacao le DRIVER_FORMULA
        const chain = pendingRef.current.get(meta) || Promise.resolve();
        pendingRef.current.set(meta, chain
          .then(() => execSF(SF_IDS.sincronizarCrContaRateio, {}))
          .then(() => { /* vinculo criado */ })
          .catch(() => { /* sync best-effort */ }));
      }
      if (trocouConta) {
        // roda DEPOIS do persist da linha (mesma fila) — a checagem de "outra
        // linha usa a conta antiga" precisa ver o DRIVER_FORMULA já atualizado
        const chain = pendingRef.current.get(meta) || Promise.resolve();
        pendingRef.current.set(meta, chain.then(() =>
          syncContaVinculo(patch.CONTA_ID ?? null, oldContaId)
        ).catch(() => { /* sync best-effort */ }));
      }
    });
    if (patchesByRow.size > 0) bumpGrid();
    if (needsRender) requestAnimationFrame(() => hot.render());
  }, [contaIdByLabel, rateioIdByLabel, persistRow, bumpGrid, syncContaVinculo]);

  // ============================================================
  // ESTRUTURA — adicionar / remover linhas
  // ============================================================
  const handleAfterCreateRow = useCallback((index: number, amount: number, source?: string) => {
    const hot = hotRef.current?.hotInstance;
    const novas = Array.from({ length: amount }, () => ({
      id: null as number | null,
      codigo: `L${++codigoSeqRef.current}`,
    }));
    // afterCreateRow traz indice VISUAL; o splice do rowMetaRef e na posicao FISICA
    const physIndex = hot ? hot.toPhysicalRow(index) : index;
    rowMetaRef.current.splice(physIndex ?? index, 0, ...novas);
    if (!hot || source === 'loadData') return;
    // getSourceData() retorna COPIA no Handsontable 16 — escrever nela descartava
    // os defaults e a linha nova ficava toda null. setDataAtCell grava no dado
    // real; source 'tipoSync' evita que o auto-save persista estes defaults.
    const changes: [number, number, string | boolean][] = [];
    for (let i = index; i < index + amount; i++) {
      changes.push(
        [i, COL.NOME, ''], [i, COL.TIPO, 'Input'], [i, COL.FORMULA, ''], [i, COL.CONTA, SEM_CONTA],
        [i, COL.ESCONDER, false], [i, COL.NEGRITO, false], [i, COL.FORMATO, FORMATO_DEFAULT],
      );
      if (isPacoteModel) changes.push([i, COL.GRAN, GRAN_DEFAULT], [i, COL.RATEIO, SEM_RATEIO]);
    }
    hot.setDataAtCell(changes as any, 'tipoSync');
    // Persiste a linha JA na criacao (com o CODIGO). Antes, a linha so ia ao
    // banco na primeira edicao — se essa edicao se perdesse (editor que nao
    // abre apos clique fora do grid, aba fechada), a linha e o codigo sumiam
    // silenciosamente no proximo reload. Edicoes seguintes viram updates.
    novas.forEach((meta) => persistRow(meta, {}));
    bumpGrid();
  }, [bumpGrid, isPacoteModel, persistRow]);

  const removingRef = useRef<{ meta: { id: number | null; codigo: string | null }; contaId: number | null }[]>([]);
  const handleBeforeRemoveRow = useCallback((_index: number, _amount: number, physicalRows: number[]) => {
    const hot = hotRef.current?.hotInstance;
    removingRef.current = physicalRows
      .map((r) => {
        // getDataAtCell espera indice VISUAL; o hook entrega FISICOS
        const visualRow = hot ? hot.toVisualRow(r) : r;
        const label = String(hot?.getDataAtCell(visualRow ?? r, COL.CONTA) || SEM_CONTA);
        const meta = rowMetaRef.current[r];
        return meta ? { meta, contaId: label !== SEM_CONTA ? (contaIdByLabel.get(label) ?? null) : null } : null;
      })
      .filter(Boolean) as { meta: { id: number | null; codigo: string | null }; contaId: number | null }[];
    [...physicalRows].sort((a, b) => b - a).forEach((r) => rowMetaRef.current.splice(r, 1));
  }, [contaIdByLabel]);

  const handleAfterRemoveRow = useCallback(() => {
    const toRemove = removingRef.current;
    removingRef.current = [];
    toRemove.forEach(({ meta, contaId }) => {
      const chain = pendingRef.current.get(meta) || Promise.resolve();
      const next = chain
        .then(async () => {
          if (meta.id != null) await removeRecord('DRIVER_FORMULA', meta.id);
          // desfaz o vínculo no Mapeamento se esta era a última linha com a conta
          if (contaId != null) await syncContaVinculo(null, contaId);
        })
        .catch((e) => {
          console.error(e);
          addToast('error', 'Erro ao remover linha');
        });
      pendingRef.current.set(meta, next);
    });
    if (toRemove.length > 0) { addToast('success', toRemove.length === 1 ? 'Linha removida' : `${toRemove.length} linhas removidas`); bumpGrid(); }
  }, [driverId, addToast, bumpGrid, syncContaVinculo]);

  // Apos arrastar linhas (manualRowMove), normaliza ORDEM = posicao visual e
  // persiste em todas as linhas — e o que garante a nova ordem apos recarregar.
  const handleAfterRowMove = useCallback((_moved: number[], _final: number, _drop: number | undefined, movePossible: boolean, orderChanged: boolean) => {
    if (!movePossible || !orderChanged) return;
    const hot = hotRef.current?.hotInstance;
    if (!hot) return;
    const total = hot.countRows();
    for (let visual = 0; visual < total; visual++) {
      const meta = rowMetaRef.current[hot.toPhysicalRow(visual)];
      if (meta) persistRow(meta, { ORDEM: visual + 1 });
    }
    maxOrdemRef.current = total;
    bumpGrid();
  }, [persistRow, bumpGrid]);

  const addLinha = useCallback(() => {
    const hot = hotRef.current?.hotInstance;
    if (!hot) return;
    const n = hot.countRows();
    if (n === 0) hot.alter('insert_row_below');
    else hot.alter('insert_row_below', n - 1);
    const last = hot.countRows() - 1;
    // O clique no botao acontece FORA do grid: depois deste handler o Handsontable
    // processa o "clique fora" e da unlisten(), deixando o teclado morto — digitar
    // na celula recem-selecionada nao abria o editor. Selecionar e re-armar o
    // listen() precisa acontecer DEPOIS do ciclo completo do clique.
    setTimeout(() => {
      if (last >= 0) hot.selectCell(last, COL.NOME);
      hot.listen();
    }, 0);
  }, []);

  // ============================================================
  // VISUAL — negrito/esconder por linha, formula monoespacada
  // ============================================================
  // Universo de referencias validas para conferir uma formula:
  //  · {codigo} tem de ser uma conta do plano de contas;
  //  · [ref] tem de ser o codigo de uma linha deste modelo (L1, P2...) ou o nome
  //    dela — o avaliador aceita os dois.
  const codigosDeConta = useMemo(() => contas.map((c: any) => String(c.CODIGO ?? '')).filter(Boolean), [contas]);

  const referenciasDeLinha = useCallback((hot: any): string[] => {
    const refs: string[] = [];
    const total = hot.countRows();
    for (let r = 0; r < total; r++) {
      const codigo = rowMetaRef.current[hot.toPhysicalRow(r)]?.codigo;
      if (codigo) refs.push(String(codigo));
      const nome = String(hot.getDataAtCell(r, COL.NOME) || '').trim();
      if (nome) refs.push(nome);
    }
    return refs;
  }, []);

  const handleAfterRenderer = useCallback((td: HTMLTableCellElement, row: number, col: number) => {
    const hot = hotRef.current?.hotInstance;
    if (!hot) return;
    const negrito = toBool(hot.getDataAtCell(row, COL.NEGRITO));
    const esconder = toBool(hot.getDataAtCell(row, COL.ESCONDER));
    td.style.fontWeight = negrito && col !== COL.ESCONDER && col !== COL.NEGRITO ? '600' : '';
    td.style.opacity = esconder ? '0.45' : '';
    if (col === COL.FORMULA) {
      td.style.fontFamily = 'ui-monospace, SFMono-Regular, monospace';
      td.style.fontSize = '12px';
      // Fórmula errada tem de RECLAMAR aqui, na hora de escrever. O motor de
      // cálculo é tolerante — ele devolve 0 para quase todo erro, e um zero no
      // orçamento não se distingue de um zero legítimo. Este é o único ponto do
      // sistema onde o autor da fórmula ainda está olhando para ela.
      const ehFormula = tipoDoRotulo(hot.getDataAtCell(row, COL.TIPO)) === 'FORMULA';
      const texto = String(hot.getDataAtCell(row, COL.FORMULA) || '');
      // O levantamento das referências só roda quando há fórmula de fato: a
      // maioria das linhas é input, e assim o custo não acompanha a grade toda.
      const problemas = ehFormula
        ? problemasDaFormula(texto, { contas: codigosDeConta, linhas: referenciasDeLinha(hot) })
        : [];
      if (problemas.length > 0) {
        td.style.backgroundColor = '#fef3c7';
        td.title = problemas.join('\n');
      } else {
        td.style.backgroundColor = '';
        td.removeAttribute('title');
      }
    }
    // Validação (modelo de pacote): linha com conta contábil e sem granularidade
    // por CR precisa de rateio — sem isso o valor não desce para nenhum CR.
    if (isPacoteModel && col === COL.RATEIO) {
      const temConta = String(hot.getDataAtCell(row, COL.CONTA) || SEM_CONTA) !== SEM_CONTA;
      const porCR = hot.getDataAtCell(row, COL.GRAN) === 'Por CR';
      const semRateio = String(hot.getDataAtCell(row, COL.RATEIO) || SEM_RATEIO) === SEM_RATEIO;
      if (temConta && !porCR && semRateio) {
        td.style.backgroundColor = '#fef3c7';
        td.title = 'Linha com conta contábil e sem granularidade por CR precisa de um rateio aplicado';
      } else {
        td.style.backgroundColor = '';
        td.removeAttribute('title');
      }
    }
  }, [isPacoteModel, codigosDeConta, referenciasDeLinha]);

  const handleAfterOnCellMouseDown = useCallback((event: MouseEvent, coords: { row: number; col: number }) => {
    const hot = hotRef.current?.hotInstance;
    if (!hot || coords.row < 0) return;
    const { row, col } = coords;
    if (CHECKBOX_COLS.includes(col)) {
      const target = event.target as HTMLInputElement;
      if (target && target.type === 'checkbox') return;
      event.preventDefault();
      hot.setDataAtCell(row, col, !toBool(hot.getDataAtCell(row, col)));
    }
    if (col === COL.FORMULA && event.button === 0) {
      // Um clique ja abre a formula sem substituir o texto atual. Assim o
      // usuario pode mover o cursor e alterar apenas o trecho desejado.
      requestAnimationFrame(() => {
        hot.selectCell(row, col);
        const editor = hot.getActiveEditor?.();
        if (editor && !editor.isOpened?.()) editor.beginEditing();
      });
    }
    // As colunas de escolha (Tipo/Conta/Formato) renderizam um <select> nativo
    // dentro da propria celula (ver dropdownRenderer) — abre no clique sozinho.
  }, []);

  // Backspace/Delete com a celula de formula apenas selecionada: o atalho padrao
  // do grid APAGA a celula inteira. Abrimos o editor com a formula preservada
  // (Backspace remove so o ultimo caractere). Digitacao de caracteres nao precisa
  // de intercept — o FormulaCellEditor ja abre com o valor atual e o caractere
  // entra no fim. IMPORTANTE: usar o stopImmediatePropagation do Handsontable
  // (seta a flag interna que o grid checa), nao o nativo do DOM — o nativo nao
  // impede o atalho de limpar a celula.
  const handleBeforeKeyDown = useCallback((event: KeyboardEvent) => {
    const hot = hotRef.current?.hotInstance;
    const selected = hot?.getSelectedLast?.();
    const editor = hot?.getActiveEditor?.();
    if (!hot || !selected || selected[1] !== COL.FORMULA || editor?.isOpened?.()) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const singleCell = selected[0] === selected[2] && selected[1] === selected[3];
    const isBackspace = event.key === 'Backspace';
    if (!singleCell || (!isBackspace && event.key !== 'Delete')) return;

    event.preventDefault();
    Handsontable.dom.stopImmediatePropagation(event);
    editor?.beginEditing();
    if (!isBackspace) return;
    requestAnimationFrame(() => {
      const textarea = editor?.TEXTAREA as HTMLTextAreaElement | undefined;
      if (!textarea) return;
      const value = textarea.value.slice(0, -1);
      textarea.value = value;
      textarea.setSelectionRange(value.length, value.length);
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }, []);

  // Renderer de coluna de escolha: injeta um <select> nativo na celula. O popup
  // de opcoes e desenhado pelo navegador (nivel do SO), entao NUNCA fica cortado
  // pelo container com overflow nem vem vazio, e abre no primeiro clique — sem
  // depender de showPicker()/editor do Handsontable (que nao abriam de forma
  // confiavel dentro do container).
  const dropdownRenderer = useCallback(function (instance: any, td: HTMLTableCellElement, row: number, col: number, _prop: any, value: any) {
    const opts: string[] = col === COL.TIPO ? (isPacoteModel ? TIPO_OPTS_PACOTE : TIPO_OPTS_CR)
      : col === COL.FORMULA ? premissaOpts
      : col === COL.FORMATO ? FORMATO_OPTS
      : col === COL.GRAN ? GRAN_OPTS
      : col === COL.RATEIO ? rateioOpts
      : contaOpts;
    while (td.firstChild) td.removeChild(td.firstChild);
    td.classList.add('ht-selectcol');
    const doc: Document = instance.rootDocument || document;
    const select = doc.createElement('select');
    select.className = 'ht-cell-select';
    // Rateio só vale quando a linha NÃO é granular por CR (excludentes)
    if (col === COL.RATEIO && instance.getDataAtCell(row, COL.GRAN) === 'Por CR') {
      select.disabled = true;
      select.title = 'Linha granular por CR não usa rateio — o gestor lança direto em cada CR';
    }
    const cur = value == null ? '' : String(value);
    let found = false;
    for (const o of opts) {
      const opt = doc.createElement('option');
      opt.value = o;
      opt.textContent = o;
      if (o === cur) { opt.selected = true; found = true; }
      select.appendChild(opt);
    }
    if (!found && cur) {
      const opt = doc.createElement('option');
      opt.value = cur;
      opt.textContent = cur;
      opt.selected = true;
      select.appendChild(opt);
    }
    select.value = cur;
    // Impede o Handsontable de interceptar o clique (preventDefault) antes do
    // navegador abrir a lista nativa.
    select.addEventListener('mousedown', (e) => { e.stopPropagation(); });
    select.addEventListener('change', () => {
      instance.setDataAtCell(row, col, select.value, 'cellSelect');
    });
    td.appendChild(select);
    return td;
  }, [contaOpts, rateioOpts, premissaOpts, isPacoteModel]);

  // Definida DEPOIS do dropdownRenderer de proposito: ela o referencia na lista
  // de dependencias, e um `const` so existe a partir da sua linha.
  const cellsFunction = useCallback(function (this: any, row: number, col: number) {
    const meta: any = {};
    if (col === COL.FORMULA) {
      const inst = this.instance;
      const tipo = tipoDoRotulo(inst?.getSourceDataAtCell ? inst.getSourceDataAtCell(row, COL.TIPO) : null);
      if (tipo === 'PREMISSA') {
        // Mesma coluna, outra natureza: vira <select> das premissas gerais.
        meta.renderer = dropdownRenderer;
        meta.editor = false;
        meta.className = 'ht-selectcol';
      } else {
        meta.placeholder = tipo === 'FORMULA' ? PLACEHOLDER_FORMULA : PLACEHOLDER_INPUT;
      }
    } else if (col === COL.NOME) {
      meta.placeholder = 'Nome da linha';
    }
    return meta;
  }, [dropdownRenderer]);

  const copyRef = useCallback((ref: string) => {
    const done = () => addToast('success', `${ref} copiado — cole em uma fórmula`);
    const fallback = () => {
      const ta = document.createElement('textarea');
      ta.value = ref;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); } catch { addToast('error', 'Não foi possível copiar'); }
      document.body.removeChild(ta);
    };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(ref).then(done).catch(fallback);
    else fallback();
  }, [addToast]);

  // Coluna Nome: renderer de texto padrao + badge com o CODIGO da linha — TODA
  // linha tem [Lx], inclusive as vinculadas a conta (nelas o motor resolve [Lx]
  // e {codigo da conta} pro MESMO valor; [Lx] segue a linha se a conta mudar).
  // Clicar no badge copia a referencia [Lx] pronta para colar numa formula.
  const nomeRenderer = useCallback(function (instance: any, td: HTMLTableCellElement, row: number, col: number, prop: any, value: any, cellProperties: any) {
    textRenderer(instance, td, row, col, prop, value, cellProperties);
    const codigo = rowMetaRef.current[instance.toPhysicalRow(row)]?.codigo;
    if (!codigo) return td;
    const doc: Document = instance.rootDocument || document;
    const badge = doc.createElement('button');
    badge.type = 'button';
    badge.className = 'ht-line-code';
    badge.textContent = codigo;
    badge.title = `Copiar [${codigo}] para usar em fórmulas`;
    badge.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
    badge.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      copyRef(`[${codigo}]`);
    });
    td.appendChild(badge);
    return td;
  }, [copyRef]);

  // Lixeira por linha — exclusao visivel (o menu de botao direito segue como
  // atalho, mas nao pode ser o UNICO caminho: ninguem descobre clique direito).
  const deleteRenderer = useCallback(function (instance: any, td: HTMLTableCellElement, row: number) {
    Handsontable.dom.empty(td);
    td.className = 'htMiddle htCenter';
    const doc: Document = instance.rootDocument || document;
    const btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'ht-row-delete';
    btn.title = 'Excluir linha';
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>';
    btn.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      instance.alter('remove_row', row, 1);
    });
    td.appendChild(btn);
    return td;
  }, []);

  const colHeaders = useMemo(() => {
    const base = ['Nome', 'Tipo', 'Fórmula / Premissa', 'Conta contábil', HEADER_ESCONDER, HEADER_NEGRITO, 'Formato'];
    return [...(isPacoteModel ? [...base, 'Granularidade', 'Rateio aplicado'] : base), ''];
  }, [isPacoteModel]);
  // Campos de escolha (Tipo/Conta/Formato): <select> nativo dentro da celula via
  // dropdownRenderer + editor desligado. Abre no primeiro clique, popup do SO
  // (imune a overflow do container), nunca vem vazio. Substitui o editor
  // select/autocomplete do Handsontable, que nao abria de forma confiavel aqui.
  const columns = useMemo(() => {
    const base: any[] = [
      { type: 'text', wordWrap: false, renderer: nomeRenderer as any },
      { renderer: dropdownRenderer as any, editor: false, className: 'ht-selectcol' },
      { type: 'text', wordWrap: false, editor: FormulaCellEditor },
      { renderer: dropdownRenderer as any, editor: false, className: 'ht-selectcol' },
      { type: 'checkbox', className: 'htCenter' },
      { type: 'checkbox', className: 'htCenter' },
      { renderer: dropdownRenderer as any, editor: false, className: 'ht-selectcol' },
    ];
    if (isPacoteModel) {
      base.push(
        { renderer: dropdownRenderer as any, editor: false, className: 'ht-selectcol' },
        { renderer: dropdownRenderer as any, editor: false, className: 'ht-selectcol' },
      );
    }
    base.push({ renderer: deleteRenderer as any, editor: false }); // lixeira (sempre a ultima)
    return base;
  }, [dropdownRenderer, nomeRenderer, deleteRenderer, isPacoteModel]);

  const colWidths = useMemo(
    () => (isPacoteModel ? [200, 100, 260, 220, 56, 56, 110, 110, 170, 44] : [220, 110, 340, 240, 56, 56, 120, 44]),
    [isPacoteModel]
  );

  // ============================================================
  // BLOCOS COMPARTILHADOS
  // ============================================================
  // Alertas de cobertura de rateio — ficam acima do grid, onde se configura
  const coverageBanner = covWarnings.length === 0 ? null : (
    <div className="shrink-0 mb-2 space-y-1.5">
      {covWarnings.map((w) => (
        <div
          key={`${w.linha}-${w.rateio}`}
          className="flex items-center gap-2 flex-wrap rounded-lg px-3 py-2"
          style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)' }}
        >
          <AlertCircle size={14} style={{ color: '#d97706' }} className="shrink-0" />
          <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
            {w.recebem.length === 0
              ? <>O rateio <strong style={{ color: 'var(--color-text)' }}>{w.rateio}</strong> da linha <strong style={{ color: 'var(--color-text)' }}>{toTitleCase(w.linha)}</strong> não tem quantidade em nenhum setor da conta — o lançamento fica travado até preencher as quantidades na aba Tipos de Rateio.</>
              : <>O rateio <strong style={{ color: 'var(--color-text)' }}>{w.rateio}</strong> da linha <strong style={{ color: 'var(--color-text)' }}>{toTitleCase(w.linha)}</strong> não tem quantidade para {w.faltam.length === 1 ? 'o setor' : 'os setores'} <strong style={{ color: 'var(--color-text)' }}>{w.faltam.join(', ')}</strong> — o valor será distribuído apenas entre {w.recebem.join(', ')}. Preencha as quantidades na aba Tipos de Rateio para incluir todos os setores.</>}
          </span>
        </div>
      ))}
    </div>
  );

  const gridBlock = (
    <div
      ref={wrapRef}
      className="flex-1 min-h-0 overflow-hidden"
      style={standalone
        ? { border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', borderRadius: '0.75rem', boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)' }
        : { backgroundColor: 'var(--color-surface)' }}
    >
      {loading || gridData === null ? (
        <div className="h-full flex items-center justify-center text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          Carregando…
        </div>
      ) : (
        <HotTable
          ref={hotRef}
          data={gridData}
          colHeaders={colHeaders}
          columns={columns as any}
          rowHeaders={() => ROW_GRIP}
          rowHeaderWidth={30}
          manualRowMove={true}
          width="100%"
          height={tableHeight}
          stretchH="all"
          rowHeights={38}
          columnHeaderHeight={40}
          colWidths={colWidths}
          licenseKey="non-commercial-and-evaluation"
          contextMenu={{ items: { remove_row: { name: 'Excluir linha' } } } as any}
          undo={false}
          fillHandle={false}
          manualColumnResize={true}
          afterChange={handleAfterChange}
          afterCreateRow={handleAfterCreateRow}
          afterRowMove={handleAfterRowMove as any}
          beforeRemoveRow={handleBeforeRemoveRow}
          afterRemoveRow={handleAfterRemoveRow}
          afterRenderer={handleAfterRenderer as any}
          afterOnCellMouseDown={handleAfterOnCellMouseDown as any}
          beforeKeyDown={handleBeforeKeyDown as any}
          afterBeginEditing={handleAfterBeginEditing as any}
          cells={cellsFunction as any}
          className="ht-theme-main ht-formulas"
        />
      )}
    </div>
  );

  const formulaSuggestionsPopup = formulaSuggestions && createPortal(
    <div
      role="listbox"
      aria-label={formulaSuggestions.kind === 'linha' ? 'Sugestões de linhas do modelo' : 'Sugestões de contas contábeis'}
      className="rounded-lg overflow-hidden shadow-xl"
      style={{
        position: 'fixed',
        zIndex: 10000,
        top: formulaSuggestions.top,
        left: Math.max(12, formulaSuggestions.left),
        width: formulaSuggestions.width,
        maxHeight: 264,
        overflowY: 'auto',
        border: '1px solid var(--color-border)',
        backgroundColor: 'var(--color-surface)',
      }}
    >
      <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)' }}>
        {formulaSuggestions.kind === 'linha' ? 'Inserir linha' : 'Inserir conta'} · ↑↓ para navegar · Enter para selecionar
      </div>
      {formulaSuggestions.items.map((item: any, index: number) => (
        <button
          key={item.ID ?? item.CODIGO}
          type="button"
          role="option"
          aria-selected={index === formulaSuggestions.selectedIndex}
          onMouseDown={(event) => {
            event.preventDefault();
            insertFormulaRef(item);
          }}
          onMouseEnter={() => updateFormulaSuggestions({ ...formulaSuggestions, selectedIndex: index })}
          className="w-full flex items-center gap-3 px-3 py-2 text-left cursor-pointer"
          style={{
            color: 'var(--color-text)',
            backgroundColor: index === formulaSuggestions.selectedIndex ? 'var(--color-hover)' : 'var(--color-surface)',
          }}
        >
          <code className="shrink-0 text-[12px] font-semibold" style={{ color: 'var(--color-primary)' }}>{item.CODIGO}</code>
          <span className="min-w-0 truncate text-[12px]">
            {formulaSuggestions.kind === 'linha' ? (item.NOME || '(linha sem nome)') : toTitleCase(item.NOME)}
          </span>
        </button>
      ))}
    </div>,
    document.body,
  );

  const codePill = (text: string, primary = true) => (
    <code
      className="px-1.5 py-0.5 rounded font-mono text-[11px] whitespace-nowrap"
      style={{ backgroundColor: 'var(--color-hover)', color: primary ? 'var(--color-primary)' : 'var(--color-text)' }}
    >
      {text}
    </code>
  );

  // Botao de ajuda + painel expansivel (ancorado ao botao). Substitui a legenda
  // fixa embaixo do grid, que sumia quando o modelo ficava grande e exigia scroll.
  const helpControl = (
    <div ref={helpRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setShowHelp((v) => !v)}
        title="Ajuda: como escrever fórmulas"
        aria-expanded={showHelp}
        className="inline-flex items-center gap-1.5 px-3 py-2 text-[13px] font-medium rounded-lg transition-colors cursor-pointer"
        style={{
          color: showHelp ? 'var(--color-primary)' : 'var(--color-text-secondary)',
          backgroundColor: showHelp ? 'var(--color-primary-bg)' : 'transparent',
          border: '1px solid var(--color-border)',
        }}
        onMouseEnter={(e) => { if (!showHelp) e.currentTarget.style.backgroundColor = 'var(--color-hover)'; }}
        onMouseLeave={(e) => { if (!showHelp) e.currentTarget.style.backgroundColor = 'transparent'; }}
      >
        <HelpCircle size={15} /> Ajuda
      </button>
      {showHelp && (
        <div
          role="dialog"
          aria-label="Como escrever fórmulas"
          className="absolute right-0 mt-2 z-50 rounded-xl shadow-xl animate-scaleIn origin-top-right"
          style={{
            width: 340,
            maxWidth: 'calc(100vw - 32px)',
            border: '1px solid var(--color-border)',
            backgroundColor: 'var(--color-surface)',
          }}
        >
          <div className="flex items-center justify-between px-4 py-2.5" style={{ borderBottom: '1px solid var(--color-border)' }}>
            <span className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-secondary)' }}>
              Como escrever fórmulas
            </span>
            <button
              type="button"
              onClick={() => setShowHelp(false)}
              title="Fechar"
              className="p-1 rounded-md transition-colors cursor-pointer"
              style={{ color: 'var(--color-text-secondary)' }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-hover)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              <X size={14} />
            </button>
          </div>
          <div className="px-4 py-3 flex flex-col gap-3 text-[12px]" style={{ color: 'var(--color-text-secondary)' }}>
            <div className="flex items-start gap-2.5">
              {codePill('{3.1.01}')}
              <span className="min-w-0">valor de uma conta contábil</span>
            </div>
            <div className="flex items-start gap-2.5">
              {codePill('[L2]')}
              <span className="min-w-0">valor de outra linha — o código aparece ao lado do nome; clique nele para copiar</span>
            </div>
            <div className="flex items-start gap-2.5">
              {codePill('[L2] * [L3] + {3.1.01}', false)}
              <span className="min-w-0">exemplo combinando linhas e contas</span>
            </div>
            <div className="pt-2 flex flex-col gap-1.5" style={{ borderTop: '1px solid var(--color-border)' }}>
              <span>Digite <b style={{ color: 'var(--color-text)' }}>{'{'}</b> ou <b style={{ color: 'var(--color-text)' }}>[</b> na fórmula para autocompletar.</span>
              <span>Linhas <b style={{ color: 'var(--color-text)' }}>Input</b> são digitadas no preenchimento.</span>
              <span>Linhas <b style={{ color: 'var(--color-text)' }}>Premissa</b> trazem um valor cadastrado em Premissas Gerais — igual para todos os centros de resultado, e referenciável por <b style={{ color: 'var(--color-text)' }}>[Lx]</b> como qualquer outra linha.</span>
              <span>Arraste a alça no início da linha para reordenar.</span>
              <span>Para excluir, use a lixeira no fim da linha (ou o botão direito).</span>
              <span>Toda linha tem um código <b style={{ color: 'var(--color-text)' }}>[Lx]</b>. Em linha vinculada a conta, <b style={{ color: 'var(--color-text)' }}>[Lx]</b> e <b style={{ color: 'var(--color-text)' }}>{'{código da conta}'}</b> valem o mesmo — o [Lx] segue a linha mesmo se a conta mudar.</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  const addLinhaBtn = (
    <button
      onClick={addLinha}
      disabled={loading}
      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-[13px] font-medium rounded-lg text-white transition-opacity cursor-pointer disabled:opacity-50"
      style={{ backgroundColor: 'var(--color-primary)' }}
    >
      <Plus size={14} /> Adicionar linha
    </button>
  );

  // Selo de publicacao + botoes Histórico e Publicar. Edicoes seguem ao vivo; o
  // Publicar apenas grava o marco no historico e sinaliza o estado.
  const sealText = publishedInfo
    ? `Publicado v${publishedInfo.numero} · ${formatVersaoData(publishedInfo.criadoEm)}`
    : 'Nunca publicado';
  const publishControls = (
    <div className="flex items-center gap-2 shrink-0">
      <span
        className="hidden sm:inline-flex items-center gap-1.5 text-[11.5px] whitespace-nowrap"
        style={{ color: hasUnpublished ? '#b45309' : 'var(--color-text-secondary)' }}
        title={hasUnpublished ? 'Há alterações não publicadas' : 'Modelo publicado'}
      >
        <span
          className="inline-block w-1.5 h-1.5 rounded-full"
          style={{ backgroundColor: hasUnpublished ? '#f59e0b' : '#10b981' }}
        />
        {hasUnpublished ? (publishedInfo ? 'Alterações não publicadas' : 'Nunca publicado') : sealText}
      </span>
      {standalone && (
        <button
          type="button"
          onClick={() => setShowHistory(true)}
          disabled={loading}
          title="Histórico de versões publicadas"
          className="inline-flex items-center justify-center p-2 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
          style={{ color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
        >
          <History size={15} />
        </button>
      )}
      <button
        type="button"
        onClick={publicar}
        disabled={loading || publishing || !hasUnpublished}
        title={hasUnpublished ? 'Publicar a versão atual do modelo' : 'Sem alterações para publicar'}
        className="inline-flex items-center gap-1.5 px-3.5 py-2 text-[13px] font-medium rounded-lg transition-colors cursor-pointer disabled:opacity-50"
        style={{
          color: hasUnpublished ? 'var(--color-primary)' : 'var(--color-text-secondary)',
          border: `1px solid ${hasUnpublished ? 'var(--color-primary)' : 'var(--color-border)'}`,
          backgroundColor: hasUnpublished ? 'var(--color-primary-bg)' : 'transparent',
        }}
      >
        {publishing ? <UploadCloud size={15} className="animate-pulse" /> : hasUnpublished ? <UploadCloud size={15} /> : <Check size={15} />}
        {publishing ? 'Publicando…' : hasUnpublished ? 'Publicar' : 'Publicado'}
      </button>
    </div>
  );

  const historyModal = standalone && (
    <ModeloHistoricoModal
      driverId={driverId}
      open={showHistory}
      onClose={() => setShowHistory(false)}
      contaById={contaById}
    />
  );

  const nomeModelo = driver ? toTitleCase(String(driver.NOME || '').replace(/_/g, ' ')) : '';

  // ============================================================
  // RENDER — modelo não editável
  // ============================================================
  if (!loading && driver && !isAutoravel(driver)) {
    if (standalone) {
      return (
        <div className="max-w-3xl mx-auto py-16 px-6 text-center">
          <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4" style={{ backgroundColor: 'var(--color-primary-bg)', color: 'var(--color-primary)' }}>
            <Info size={20} />
          </div>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>Este modelo não é editável</h2>
          <p className="text-sm mt-2" style={{ color: 'var(--color-text-secondary)' }}>
            Modelos nativos ou criados pela IA não têm configuração de fórmulas — apenas o disclaimer na tela de Modelos.
          </p>
          <button
            onClick={() => navigate('/modelagem')}
            className="mt-6 inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg text-white cursor-pointer"
            style={{ backgroundColor: 'var(--color-primary)' }}
          >
            <ArrowLeft size={15} /> Voltar para Modelos
          </button>
        </div>
      );
    }
    return (
      <div className="h-full flex items-center justify-center text-center px-6" style={{ color: 'var(--color-text-secondary)' }}>
        <p className="text-sm">Este modelo não tem fórmulas configuráveis.</p>
      </div>
    );
  }

  // ============================================================
  // RENDER — standalone (página) vs embutido (aba Modelagem)
  // ============================================================
  if (standalone) {
    return (
      <div className="flex flex-col" style={{ height: 'calc(100vh - 120px)' }}>
        <ToastContainer toasts={toasts} onRemove={removeToast} />
        {formulaSuggestionsPopup}
        <div className="flex items-center justify-between gap-4 mb-5 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => navigate(-1)}
              title="Voltar"
              className="p-2 rounded-lg transition-colors cursor-pointer shrink-0"
              style={{ color: 'var(--color-text-secondary)' }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-hover)'; e.currentTarget.style.color = 'var(--color-text)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--color-text-secondary)'; }}
            >
              <ArrowLeft size={17} />
            </button>
            <div className="min-w-0">
              <div className="flex items-baseline gap-2.5 min-w-0">
                <h1 className="text-lg font-semibold truncate" style={{ color: 'var(--color-text)' }}>
                  {nomeModelo || '…'}
                </h1>
                <span className="text-[11px] tracking-[0.08em] font-medium uppercase shrink-0" style={{ color: 'var(--color-text-secondary)' }}>
                  Fórmulas
                </span>
              </div>
              <p className="text-[12px] mt-0.5 truncate" style={{ color: 'var(--color-text-secondary)' }}>
                Salvamento automático a cada edição
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">{publishControls}{helpControl}{addLinhaBtn}</div>
        </div>
        {coverageBanner}
        {gridBlock}
        {historyModal}
      </div>
    );
  }

  // Embutido — toolbar compacta, ocupa a altura do container pai
  return (
    <div className="flex flex-col h-full p-4">
      <ToastContainer toasts={toasts} onRemove={removeToast} />
      {formulaSuggestionsPopup}
      <div className="flex items-center justify-between gap-3 mb-3 shrink-0">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Fórmulas do modelo</h3>
          <p className="text-[12px] mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
            Salvamento automático a cada edição
          </p>
        </div>
        <div className="shrink-0 flex items-center gap-2 flex-wrap justify-end">{publishControls}{helpControl}{addLinhaBtn}</div>
      </div>
      {coverageBanner}
      {gridBlock}
      {historyModal}
    </div>
  );
}
