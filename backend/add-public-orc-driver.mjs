// Tela publica de preenchimento — o link do gestor renderiza o MESMO componente
// OrcamentoContent da visao kanban (mesmo container, mesmas abas, mesmo Handsontable,
// mesmos graficos). Para isso, cria versoes PUBLICAS token-escopadas das SFs quentes
// do driver (124/125/126) + uma SF de escrita multi-operacao:
//
//   publicHotOrcBase       (token)                                        -> espelho da SF 124
//   publicHotOrcDetalheCr  (token, crId, cicloId, ano, anoPrev, gestorId, controlCicloId) -> espelho da SF 125
//   publicHotOrcDetalhePkg (token, pkgId, cicloId, ano, anoPrev, controlCicloId)          -> espelho da SF 126
//   publicOrcWrite         (token, op, ...payload)                        -> escritas do driver
//
// Seguranca: a autorizacao NUNCA vem de IDs do cliente — todo SELECT/DML faz JOIN em
// PREENCHIMENTO_TOKEN (token ativo) e GESTOR_CR / PACOTE_STATUS (posse do CR/pacote).
// Token invalido => SELECT devolve 0 linhas e DML nao afeta nada. Escritas sao
// bloqueadas quando o CR ja esta APROVADO (mesma regra readOnly da tela interna).
// Aditivo e idempotente — nao altera as SFs internas nem as publicas existentes.
import 'dotenv/config';
import {
  configureSdkMitra,
  createServerFunctionMitra,
  updateServerFunctionMitra,
  listServerFunctionsMitra,
  togglePublicExecutionMitra,
  executeServerFunctionMitra,
} from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});
const projectId = parseInt(process.env.MITRA_PROJECT_ID);

// ── 1. Levanta colunas reais (mesma tecnica do add-hot-orcamento.mjs) ──
const TABLES = ['CICLO','BENEFICIO','ENCARGO','CARGO','DRIVERS','DRIVER_FORMULA','DRE_CONFIG','ORCAMENTO','ORCAMENTO_PACOTE','REALIZADO_CONTABIL','COLABORADOR','ORCAMENTO_PESSOAL','PROJECAO_HEADCOUNT','CONTRATACAO_PROJETADA','PREMISSA_DISSIDIO','PREMISSA_TURNOVER','AUMENTO_SALARIAL','DESLIGAMENTO_PROJETADO','HIST_PREMISSA','DRIVER_FORMULA_VALOR','DRIVER_FORMULA_CR','PREMISSA_IMPOSTO','ORCAMENTO_STATUS','PACOTE_STATUS','RATEIO_CONFIG','RATEIO_CR','PKG_RATEIO_CONFIG'];
const schemaRes = await executeServerFunctionMitra({ projectId, serverFunctionId: 76, input: { sql:
  `SELECT TABLE_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${TABLES.map(t=>`'${t}'`).join(',')}) ORDER BY TABLE_NAME, ORDINAL_POSITION` } });
let sout = schemaRes?.result?.output; if (typeof sout === 'string') sout = JSON.parse(sout);
const S = {};
for (const r of (sout.rows || [])) (S[r.TABLE_NAME] ||= []).push(r.COLUMN_NAME);
for (const t of TABLES) if (!S[t]) throw new Error(`schema ausente: ${t}`);

const jo = (table, alias) => S[table].map(c => `'${c}',${alias}.${c}`).join(',');
const blk = (name, table, where) =>
  `COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT(${jo(table,'t')})) FROM ${table} t WHERE ${where}),JSON_ARRAY()) AS ${name}`;
const blkJ = (name, inner) => `COALESCE((${inner}),JSON_ARRAY()) AS ${name}`;

// ── 2. Blocos identicos aos das SFs 124/125/126 (mesma fonte geradora) ──
const CODE_BASE_BLOCKS = `
  ${blk('CICLOS','CICLO',`t.STATUS != 'FECHADO'`)},
  ${blk('BENEFICIOS','BENEFICIO','1=1')},
  ${blk('ENCARGOS','ENCARGO','1=1')},
  ${blk('CARGOS','CARGO',`t.ATIVO = 'true'`)},
  ${blkJ('PACOTE_DRIVERS',`SELECT JSON_ARRAYAGG(JSON_OBJECT(${jo('DRIVERS','d')},'GESTOR_ID',gp.GESTOR_ID)) FROM DRIVERS d LEFT JOIN GESTOR_PACOTE gp ON gp.DRIVER_ID = d.ID WHERE d.TIPO_DRIVER = 'PACOTE' AND d.ATIVO = 'true'`)},
  ${blk('NORMAL_DRIVERS','DRIVERS',`t.TIPO_DRIVER = 'NORMAL' AND t.ATIVO = 'true'`)},
  ${blkJ('FORMULAS',`SELECT JSON_ARRAYAGG(JSON_OBJECT(${jo('DRIVER_FORMULA','df')},'CONTA_CODIGO',cc.CODIGO,'CONTA_NOME',cc.NOME)) FROM DRIVER_FORMULA df LEFT JOIN CONTA_CONTABIL cc ON cc.ID = df.CONTA_ID`)},
  ${blk('DRE_CONFIG','DRE_CONFIG','1=1')},
  ${blkJ('CONTAS',`SELECT JSON_ARRAYAGG(JSON_OBJECT('ID',c.ID,'CODIGO',c.CODIGO,'NOME',c.NOME,'TIPO',c.TIPO)) FROM CONTA_CONTABIL c`)}`;

const CONFIGS_CR = `SELECT JSON_ARRAYAGG(JSON_OBJECT('CR_ID',crc.CR_ID,'CR_CODIGO',cr.CODIGO,'CR_NOME',cr.NOME,'CONTA_ID',cc.ID,'CODIGO',cc.CODIGO,'CONTA_NOME',cc.NOME,'TIPO',cc.TIPO,'DRIVER_TIPO',d.NOME,'DRIVER_ID',d.ID))
 FROM CR_CONTA crc
 JOIN CONTA_CONTABIL cc ON cc.ID = crc.CONTA_ID
 LEFT JOIN CENTRO_RESULTADO cr ON cr.ID = crc.CR_ID
 LEFT JOIN CONTA_DRIVER_EXCECAO cde ON cde.CR_ID = crc.CR_ID AND cde.CONTA_ID = crc.CONTA_ID AND cde.ATIVO = true
 LEFT JOIN CONTA_DRIVER cd ON cd.CONTA_ID = crc.CONTA_ID
 LEFT JOIN DRIVERS d ON d.ID = COALESCE(cde.PACOTE_ID, cd.PACOTE_ID, cde.DRIVER_ID, cd.DRIVER_ID)
 WHERE crc.CR_ID = {{crId}} AND crc.ATIVO = true AND d.ID IS NOT NULL AND d.ATIVO = 'true'`;

const CODE_CR_BLOCKS = `
  ${blkJ('CONFIGS', CONFIGS_CR)},
  ${blk('BUDGET','ORCAMENTO',`t.CICLO_ID = {{cicloId}} AND t.CR_ID = {{crId}}`)},
  ${blk('REALIZADO','REALIZADO_CONTABIL',`t.CR_ID = {{crId}} AND t.ANO = {{anoPrev}}`)},
  ${blk('REALIZADO_ATUAL','REALIZADO_CONTABIL',`t.CR_ID = {{crId}} AND t.ANO = {{ano}}`)},
  ${blk('ORC_CONTROLE','ORCAMENTO',`t.CICLO_ID = {{controlCicloId}} AND t.CR_ID = {{crId}}`)},
  ${blk('COLABORADORES','COLABORADOR',`t.CR_ID = {{crId}} AND t.ATIVO = 'true'`)},
  ${blk('ORCAMENTO_PESSOAL','ORCAMENTO_PESSOAL',`t.CICLO_ID = {{cicloId}} AND t.CR_ID = {{crId}}`)},
  ${blk('HEADCOUNT','PROJECAO_HEADCOUNT',`t.CICLO_ID = {{cicloId}} AND t.CR_ID = {{crId}}`)},
  ${blkJ('CONTRATACOES',`SELECT JSON_ARRAYAGG(JSON_OBJECT(${jo('CONTRATACAO_PROJETADA','cp')},'CARGO_NOME',cg.NOME,'SALARIO_MEDIO',cg.SALARIO_MEDIO)) FROM CONTRATACAO_PROJETADA cp JOIN CARGO cg ON cg.ID = cp.CARGO_ID WHERE cp.CICLO_ID = {{cicloId}} AND cp.CR_ID = {{crId}}`)},
  ${blkJ('DISSIDIOS',`SELECT JSON_ARRAYAGG(JSON_OBJECT(${jo('PREMISSA_DISSIDIO','pd')},'EMPRESA_NOME',e.NOME)) FROM PREMISSA_DISSIDIO pd JOIN EMPRESA e ON e.ID = pd.EMPRESA_ID WHERE pd.CICLO_ID = {{cicloId}}`)},
  ${blkJ('TURNOVERS',`SELECT JSON_ARRAYAGG(JSON_OBJECT(${jo('PREMISSA_TURNOVER','pt')},'EMPRESA_NOME',e.NOME)) FROM PREMISSA_TURNOVER pt JOIN EMPRESA e ON e.ID = pt.EMPRESA_ID WHERE pt.CICLO_ID = {{cicloId}}`)},
  ${blkJ('AUMENTOS',`SELECT JSON_ARRAYAGG(JSON_OBJECT(${jo('AUMENTO_SALARIAL','a')},'COLAB_NOME',c.NOME,'SALARIO',c.SALARIO)) FROM AUMENTO_SALARIAL a JOIN COLABORADOR c ON c.ID = a.COLABORADOR_ID WHERE a.CICLO_ID = {{cicloId}}`)},
  ${blkJ('DESLIGAMENTOS',`SELECT JSON_ARRAYAGG(JSON_OBJECT(${jo('DESLIGAMENTO_PROJETADO','d')},'COLAB_NOME',c.NOME)) FROM DESLIGAMENTO_PROJETADO d JOIN COLABORADOR c ON c.ID = d.COLABORADOR_ID WHERE d.CICLO_ID = {{cicloId}} AND d.CR_ID = {{crId}}`)},
  ${blk('HIST_PREMISSA','HIST_PREMISSA',`t.CICLO_ID = {{cicloId}} AND t.CR_ID = {{crId}}`)},
  ${blk('CLV','DRIVER_FORMULA_VALOR',`t.CICLO_ID = {{cicloId}} AND t.CR_ID = {{crId}}`)},
  ${blk('OVERRIDES','DRIVER_FORMULA_CR',`t.CR_ID = {{crId}}`)},
  ${blk('IMPOSTO_CENTRAL','PREMISSA_IMPOSTO',`t.CICLO_ID = {{cicloId}}`)},
  ${blk('STATUS','ORCAMENTO_STATUS',`t.CICLO_ID = {{cicloId}} AND t.CR_ID = {{crId}} AND ({{gestorId}} = 0 OR t.GESTOR_ID = {{gestorId}})`)},
  ${blk('PACOTE_STATUS_ALL','PACOTE_STATUS',`t.CICLO_ID = {{cicloId}}`)}`;

const CR_IN = `(SELECT DISTINCT crc2.CR_ID FROM CR_CONTA crc2
 LEFT JOIN CONTA_DRIVER_EXCECAO cde2 ON cde2.CR_ID = crc2.CR_ID AND cde2.CONTA_ID = crc2.CONTA_ID AND cde2.ATIVO = true
 LEFT JOIN CONTA_DRIVER cd2 ON cd2.CONTA_ID = crc2.CONTA_ID
 WHERE crc2.ATIVO = true AND COALESCE(cde2.PACOTE_ID, cd2.PACOTE_ID, cde2.DRIVER_ID, cd2.DRIVER_ID) = {{pkgId}})`;

const CONFIGS_PKG = `SELECT JSON_ARRAYAGG(JSON_OBJECT('CR_ID',crc.CR_ID,'CR_CODIGO',cr.CODIGO,'CR_NOME',cr.NOME,'CONTA_ID',cc.ID,'CODIGO',cc.CODIGO,'CONTA_NOME',cc.NOME,'TIPO',cc.TIPO,'DRIVER_TIPO',d.NOME,'DRIVER_ID',d.ID))
 FROM CR_CONTA crc
 JOIN CONTA_CONTABIL cc ON cc.ID = crc.CONTA_ID
 LEFT JOIN CENTRO_RESULTADO cr ON cr.ID = crc.CR_ID
 LEFT JOIN CONTA_DRIVER_EXCECAO cde ON cde.CR_ID = crc.CR_ID AND cde.CONTA_ID = crc.CONTA_ID AND cde.ATIVO = true
 LEFT JOIN CONTA_DRIVER cd ON cd.CONTA_ID = crc.CONTA_ID
 LEFT JOIN DRIVERS d ON d.ID = COALESCE(cde.DRIVER_ID, cd.DRIVER_ID)
 WHERE COALESCE(cde.PACOTE_ID, cd.PACOTE_ID, cde.DRIVER_ID, cd.DRIVER_ID) = {{pkgId}}
   AND crc.ATIVO = true AND d.ID IS NOT NULL AND d.ATIVO = 'true' AND d.TIPO_DRIVER = 'NORMAL'`;

const CODE_PKG_BLOCKS = `
  ${blkJ('CR_IDS',`SELECT JSON_ARRAYAGG(JSON_OBJECT('CR_ID',x.CR_ID)) FROM ${CR_IN} x`)},
  ${blk('RATEIO_CONFIG','RATEIO_CONFIG',`t.ID = (SELECT MAX(ID) FROM RATEIO_CONFIG WHERE DRIVER_ID = {{pkgId}})`)},
  ${blk('RATEIO_CR','RATEIO_CR',`t.RATEIO_CONFIG_ID = (SELECT MAX(ID) FROM RATEIO_CONFIG WHERE DRIVER_ID = {{pkgId}})`)},
  ${blkJ('CONFIGS', CONFIGS_PKG)},
  ${blkJ('BUDGET',`SELECT JSON_ARRAYAGG(JSON_OBJECT('ID',op.ID,'CONTA_ID',op.CONTA_ID,'MES',op.MES,'CR_ID',op.CR_ID,'VALOR',op.VALOR)) FROM ORCAMENTO_PACOTE op WHERE op.CICLO_ID = {{cicloId}} AND op.DRIVER_ID = {{pkgId}}`)},
  ${blk('REALIZADO','REALIZADO_CONTABIL',`t.ANO = {{anoPrev}} AND t.CR_ID IN ${CR_IN}`)},
  ${blk('REALIZADO_ATUAL','REALIZADO_CONTABIL',`t.ANO = {{ano}} AND t.CR_ID IN ${CR_IN}`)},
  ${blkJ('ORC_CONTROLE',`SELECT JSON_ARRAYAGG(JSON_OBJECT('ID',op.ID,'CONTA_ID',op.CONTA_ID,'MES',op.MES,'CR_ID',op.CR_ID,'VALOR',op.VALOR)) FROM ORCAMENTO_PACOTE op WHERE op.CICLO_ID = {{controlCicloId}} AND op.DRIVER_ID = {{pkgId}}`)},
  ${blk('COLABORADORES','COLABORADOR',`t.ATIVO = 'true' AND t.CR_ID IN ${CR_IN}`)},
  ${blk('ORCAMENTO_PESSOAL','ORCAMENTO_PESSOAL',`t.CICLO_ID = {{cicloId}} AND t.CR_ID IN ${CR_IN}`)},
  ${blk('HEADCOUNT','PROJECAO_HEADCOUNT',`t.CICLO_ID = {{cicloId}} AND t.CR_ID IN ${CR_IN}`)},
  ${blkJ('CONTRATACOES',`SELECT JSON_ARRAYAGG(JSON_OBJECT(${jo('CONTRATACAO_PROJETADA','cp')},'CARGO_NOME',cg.NOME,'SALARIO_MEDIO',cg.SALARIO_MEDIO)) FROM CONTRATACAO_PROJETADA cp JOIN CARGO cg ON cg.ID = cp.CARGO_ID WHERE cp.CICLO_ID = {{cicloId}} AND cp.CR_ID IN ${CR_IN}`)},
  ${blkJ('DISSIDIOS',`SELECT JSON_ARRAYAGG(JSON_OBJECT(${jo('PREMISSA_DISSIDIO','pd')},'EMPRESA_NOME',e.NOME)) FROM PREMISSA_DISSIDIO pd JOIN EMPRESA e ON e.ID = pd.EMPRESA_ID WHERE pd.CICLO_ID = {{cicloId}}`)},
  ${blkJ('TURNOVERS',`SELECT JSON_ARRAYAGG(JSON_OBJECT(${jo('PREMISSA_TURNOVER','pt')},'EMPRESA_NOME',e.NOME)) FROM PREMISSA_TURNOVER pt JOIN EMPRESA e ON e.ID = pt.EMPRESA_ID WHERE pt.CICLO_ID = {{cicloId}}`)},
  ${blkJ('AUMENTOS',`SELECT JSON_ARRAYAGG(JSON_OBJECT(${jo('AUMENTO_SALARIAL','a')},'COLAB_NOME',c.NOME,'SALARIO',c.SALARIO)) FROM AUMENTO_SALARIAL a JOIN COLABORADOR c ON c.ID = a.COLABORADOR_ID WHERE a.CICLO_ID = {{cicloId}}`)},
  ${blkJ('DESLIGAMENTOS',`SELECT JSON_ARRAYAGG(JSON_OBJECT(${jo('DESLIGAMENTO_PROJETADO','d')},'COLAB_NOME',c.NOME)) FROM DESLIGAMENTO_PROJETADO d JOIN COLABORADOR c ON c.ID = d.COLABORADOR_ID WHERE d.CICLO_ID = {{cicloId}} AND d.CR_ID IN ${CR_IN}`)},
  ${blk('HIST_PREMISSA','HIST_PREMISSA',`t.CICLO_ID = {{cicloId}} AND t.CR_ID IN ${CR_IN}`)},
  ${blk('CLV','DRIVER_FORMULA_VALOR',`t.CICLO_ID = {{cicloId}} AND t.CR_ID IN ${CR_IN}`)},
  ${blk('OVERRIDES','DRIVER_FORMULA_CR',`t.CR_ID IN ${CR_IN}`)},
  ${blk('IMPOSTO_CENTRAL','PREMISSA_IMPOSTO',`t.CICLO_ID = {{cicloId}}`)},
  ${blk('STATUS','PACOTE_STATUS',`t.CICLO_ID = {{cicloId}} AND t.DRIVER_ID = {{pkgId}}`)},
  ${blk('PKG_RATEIO_CONFIG','PKG_RATEIO_CONFIG',`t.PACOTE_ID = {{pkgId}}`)}`;

// ── 3. Gates de token (o SELECT so devolve a linha se o token autoriza) ──
// Token invalido/inativo => 0 linhas => frontend trata como vazio.
const CODE_PUB_BASE = `SELECT${CODE_BASE_BLOCKS}
FROM PREENCHIMENTO_TOKEN tk
WHERE tk.TOKEN = '{{token}}' AND tk.ATIVO = 'true'
LIMIT 1`;

const CODE_PUB_CR = `SELECT${CODE_CR_BLOCKS}
FROM PREENCHIMENTO_TOKEN tk
WHERE tk.TOKEN = '{{token}}' AND tk.ATIVO = 'true'
  AND tk.CICLO_ID = {{cicloId}} AND tk.GESTOR_ID = {{gestorId}}
  AND EXISTS (SELECT 1 FROM GESTOR_CR gc WHERE gc.GESTOR_ID = tk.GESTOR_ID AND gc.CR_ID = {{crId}})
LIMIT 1`;

const CODE_PUB_PKG = `SELECT${CODE_PKG_BLOCKS}
FROM PREENCHIMENTO_TOKEN tk
WHERE tk.TOKEN = '{{token}}' AND tk.ATIVO = 'true'
  AND tk.CICLO_ID = {{cicloId}}
  AND EXISTS (SELECT 1 FROM PACOTE_STATUS ps WHERE ps.CICLO_ID = tk.CICLO_ID AND ps.GESTOR_ID = tk.GESTOR_ID AND ps.DRIVER_ID = {{pkgId}})
LIMIT 1`;

// ── 4. publicOrcWrite — escritas do driver, todas token-escopadas ──
// Cada operacao replica exatamente a mutacao que a tela interna faz via REST/SFs
// (58/60/61), com a autorizacao embutida no proprio DML (JOIN no token + posse do CR).
// Escritas sao bloqueadas quando o CR ja esta APROVADO (mesma regra da tela interna,
// onde readOnly so ativa em APROVADO).
const CODE_WRITE = `
const { runDmlMitra } = require('mitra-sdk');
const projectId = parseInt(process.env.MITRA_PROJECT_ID);

const token = String(event.token || '').replace(/[^0-9a-fA-F-]/g, '').slice(0, 36);
const op = String(event.op || '');
const crId = Number(event.crId);
if (!token || !op || !Number.isInteger(crId)) return { ok: false, error: 'params_invalidos' };

const esc = (s, max) => String(s == null ? '' : s).replace(/\\\\/g, '').replace(/'/g, "''").slice(0, max || 500);
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const intOr0 = (v) => { const n = Number(v); return Number.isInteger(n) ? n : 0; };
const agora = new Date().toISOString().slice(0, 19);

// Fragmentos do gate — todo DML embute a autorizacao: token ativo, ciclo NAO
// fechado, CR pertence ao gestor do token e CR nao esta SUBMETIDO/APROVADO.
// SUBMETIDO tambem bloqueia: o CR esta sob avaliacao do aprovador e os dados
// nao podem mudar debaixo dele (a UI ja abre em visualizacao; o gate garante
// o mesmo no servidor). Token invalido => JOIN nao casa => DML nao afeta nada.
const TK_SRC = "PREENCHIMENTO_TOKEN tkk JOIN GESTOR_CR gck ON gck.GESTOR_ID = tkk.GESTOR_ID AND gck.CR_ID = " + crId;
const TK_COND = "tkk.TOKEN = '" + token + "' AND tkk.ATIVO = 'true'" +
  " AND NOT EXISTS (SELECT 1 FROM CICLO ckk WHERE ckk.ID = tkk.CICLO_ID AND ckk.STATUS = 'FECHADO')" +
  " AND NOT EXISTS (SELECT 1 FROM (SELECT CICLO_ID, CR_ID, STATUS FROM ORCAMENTO_STATUS) osk" +
  " WHERE osk.CICLO_ID = tkk.CICLO_ID AND osk.CR_ID = " + crId + " AND osk.STATUS IN ('APROVADO','SUBMETIDO'))";

const dml = (sql) => runDmlMitra({ projectId, sql });

if (op === 'orcCells') {
  // Upsert em lote de celulas do ORCAMENTO (delete + insert), com QUANTIDADE/VALOR_UNITARIO.
  const raw = Array.isArray(event.cells) ? event.cells : [];
  const cells = [];
  for (const c of raw) {
    const conta = Number(c.contaId), mes = Number(c.mes);
    if (Number.isInteger(conta) && Number.isInteger(mes) && mes >= 1 && mes <= 12) {
      cells.push({ conta, mes, val: num(c.valor), qtd: num(c.qtd), vu: num(c.vu) });
    }
  }
  if (cells.length === 0) return { ok: true, saved: 0 };
  const pairs = cells.map(c => '(' + c.conta + ',' + c.mes + ')').join(',');
  await dml("DELETE o FROM ORCAMENTO o" +
    " JOIN PREENCHIMENTO_TOKEN tkk ON tkk.CICLO_ID = o.CICLO_ID" +
    " JOIN GESTOR_CR gck ON gck.GESTOR_ID = tkk.GESTOR_ID AND gck.CR_ID = o.CR_ID" +
    " WHERE o.CR_ID = " + crId + " AND (o.CONTA_ID, o.MES) IN (" + pairs + ") AND " + TK_COND);
  const derived = cells.map(c => 'SELECT ' + c.conta + ' AS CONTA_ID, ' + c.mes + ' AS MES, ' + c.val + ' AS VALOR, ' + c.qtd + ' AS QUANTIDADE, ' + c.vu + ' AS VALOR_UNITARIO').join(' UNION ALL ');
  await dml("INSERT INTO ORCAMENTO (CICLO_ID, CR_ID, CONTA_ID, MES, VALOR, QUANTIDADE, VALOR_UNITARIO)" +
    " SELECT tkk.CICLO_ID, " + crId + ", v.CONTA_ID, v.MES, v.VALOR, v.QUANTIDADE, v.VALOR_UNITARIO" +
    " FROM " + TK_SRC +
    " JOIN (" + derived + ") v" +
    " JOIN CR_CONTA crck ON crck.CR_ID = " + crId + " AND crck.CONTA_ID = v.CONTA_ID AND crck.ATIVO = true" +
    " WHERE " + TK_COND);
  return { ok: true, saved: cells.length };
}

if (op === 'formulaCells') {
  // Upsert de valores de linha custom de formula (DRIVER_FORMULA_VALOR).
  const raw = Array.isArray(event.cells) ? event.cells : [];
  const cells = [];
  for (const c of raw) {
    const fid = Number(c.formulaId), mes = Number(c.mes);
    if (Number.isInteger(fid) && Number.isInteger(mes) && mes >= 1 && mes <= 12) cells.push({ fid, mes, val: num(c.valor) });
  }
  if (cells.length === 0) return { ok: true, saved: 0 };
  const pairs = cells.map(c => '(' + c.fid + ',' + c.mes + ')').join(',');
  await dml("DELETE fv FROM DRIVER_FORMULA_VALOR fv" +
    " JOIN PREENCHIMENTO_TOKEN tkk ON tkk.CICLO_ID = fv.CICLO_ID" +
    " JOIN GESTOR_CR gck ON gck.GESTOR_ID = tkk.GESTOR_ID AND gck.CR_ID = fv.CR_ID" +
    " WHERE fv.CR_ID = " + crId + " AND (fv.FORMULA_ID, fv.MES) IN (" + pairs + ") AND " + TK_COND);
  const derived = cells.map(c => 'SELECT ' + c.fid + ' AS FORMULA_ID, ' + c.mes + ' AS MES, ' + c.val + ' AS VALOR').join(' UNION ALL ');
  await dml("INSERT INTO DRIVER_FORMULA_VALOR (FORMULA_ID, CICLO_ID, CR_ID, MES, VALOR)" +
    " SELECT v.FORMULA_ID, tkk.CICLO_ID, " + crId + ", v.MES, v.VALOR" +
    " FROM " + TK_SRC + " JOIN (" + derived + ") v WHERE " + TK_COND);
  return { ok: true, saved: cells.length };
}

if (op === 'histPremissa') {
  const contaId = Number(event.contaId);
  if (!Number.isInteger(contaId)) return { ok: false, error: 'contaId_invalido' };
  const pct = num(event.percentual);
  const modo = event.modo === 'igual' ? 'igual' : 'sazonalidade';
  const just = esc(event.justificativa, 1000);
  await dml("DELETE hp FROM HIST_PREMISSA hp" +
    " JOIN PREENCHIMENTO_TOKEN tkk ON tkk.CICLO_ID = hp.CICLO_ID" +
    " JOIN GESTOR_CR gck ON gck.GESTOR_ID = tkk.GESTOR_ID AND gck.CR_ID = hp.CR_ID" +
    " WHERE hp.CR_ID = " + crId + " AND hp.CONTA_ID = " + contaId + " AND " + TK_COND);
  // ON DUPLICATE KEY UPDATE: HIST_PREMISSA tem UNIQUE (CICLO_ID, CR_ID, CONTA_ID).
  // O SELECT acima pode render mais de uma linha (token x GESTOR_CR); sem isto, o
  // segundo registro bateria no indice unico e derrubaria o save do gestor.
  await dml("INSERT INTO HIST_PREMISSA (CICLO_ID, CR_ID, CONTA_ID, PERCENTUAL, MODO, JUSTIFICATIVA, CRIADO_EM)" +
    " SELECT tkk.CICLO_ID, " + crId + ", " + contaId + ", " + pct + ", '" + modo + "', '" + just + "', '" + agora + "'" +
    " FROM " + TK_SRC + " WHERE " + TK_COND +
    " ON DUPLICATE KEY UPDATE PERCENTUAL = VALUES(PERCENTUAL), MODO = VALUES(MODO)," +
    " JUSTIFICATIVA = VALUES(JUSTIFICATIVA), CRIADO_EM = VALUES(CRIADO_EM)");
  return { ok: true };
}

if (op === 'aumentoUpsert') {
  const colabId = Number(event.colaboradorId);
  if (!Number.isInteger(colabId)) return { ok: false, error: 'colaboradorId_invalido' };
  const pct = num(event.percentual);
  const mesAp = Math.min(12, Math.max(1, intOr0(event.mesAplicacao) || 1));
  const motivo = esc(event.motivo, 500);
  // colaborador precisa pertencer ao CR do gestor
  await dml("DELETE a FROM AUMENTO_SALARIAL a" +
    " JOIN COLABORADOR cbk ON cbk.ID = a.COLABORADOR_ID AND cbk.CR_ID = " + crId +
    " JOIN PREENCHIMENTO_TOKEN tkk ON tkk.CICLO_ID = a.CICLO_ID" +
    " JOIN GESTOR_CR gck ON gck.GESTOR_ID = tkk.GESTOR_ID AND gck.CR_ID = " + crId +
    " WHERE a.COLABORADOR_ID = " + colabId + " AND " + TK_COND);
  await dml("INSERT INTO AUMENTO_SALARIAL (CICLO_ID, COLABORADOR_ID, PERCENTUAL, MES_APLICACAO, MOTIVO, CRIADO_EM)" +
    " SELECT tkk.CICLO_ID, " + colabId + ", " + pct + ", " + mesAp + ", '" + motivo + "', '" + agora + "'" +
    " FROM " + TK_SRC +
    " JOIN COLABORADOR cbk ON cbk.ID = " + colabId + " AND cbk.CR_ID = " + crId +
    " WHERE " + TK_COND);
  return { ok: true };
}

if (op === 'aumentoDelete') {
  const id = Number(event.id);
  if (!Number.isInteger(id)) return { ok: false, error: 'id_invalido' };
  await dml("DELETE a FROM AUMENTO_SALARIAL a" +
    " JOIN COLABORADOR cbk ON cbk.ID = a.COLABORADOR_ID AND cbk.CR_ID = " + crId +
    " JOIN PREENCHIMENTO_TOKEN tkk ON tkk.CICLO_ID = a.CICLO_ID" +
    " JOIN GESTOR_CR gck ON gck.GESTOR_ID = tkk.GESTOR_ID AND gck.CR_ID = " + crId +
    " WHERE a.ID = " + id + " AND " + TK_COND);
  return { ok: true };
}

if (op === 'contratCreate') {
  const cargoId = Number(event.cargoId);
  if (!Number.isInteger(cargoId)) return { ok: false, error: 'cargoId_invalido' };
  const mesEnt = Math.min(12, Math.max(1, intOr0(event.mesEntrada) || 1));
  const qtd = Math.max(1, intOr0(event.qtdVagas) || 1);
  const motivo = esc(event.motivo, 200);
  await dml("INSERT INTO CONTRATACAO_PROJETADA (CICLO_ID, CR_ID, CARGO_ID, MES_ENTRADA, MOTIVO, QTD_VAGAS, CRIADO_EM)" +
    " SELECT tkk.CICLO_ID, " + crId + ", " + cargoId + ", " + mesEnt + ", '" + motivo + "', " + qtd + ", '" + agora + "'" +
    " FROM " + TK_SRC + " WHERE " + TK_COND);
  return { ok: true };
}

if (op === 'contratDelete') {
  const id = Number(event.id);
  if (!Number.isInteger(id)) return { ok: false, error: 'id_invalido' };
  await dml("DELETE cp FROM CONTRATACAO_PROJETADA cp" +
    " JOIN PREENCHIMENTO_TOKEN tkk ON tkk.CICLO_ID = cp.CICLO_ID" +
    " JOIN GESTOR_CR gck ON gck.GESTOR_ID = tkk.GESTOR_ID AND gck.CR_ID = cp.CR_ID" +
    " WHERE cp.CR_ID = " + crId + " AND cp.ID = " + id + " AND " + TK_COND);
  return { ok: true };
}

if (op === 'desligamentoUpsert') {
  const colabId = Number(event.colaboradorId);
  const mesDesligamento = intOr0(event.mesDesligamento);
  if (!Number.isInteger(colabId)) return { ok: false, error: 'colaboradorId_invalido' };
  if (mesDesligamento < 1 || mesDesligamento > 12) return { ok: false, error: 'mes_desligamento_invalido' };
  await dml("DELETE dp FROM DESLIGAMENTO_PROJETADO dp" +
    " JOIN COLABORADOR cbk ON cbk.ID = dp.COLABORADOR_ID AND cbk.CR_ID = " + crId +
    " JOIN PREENCHIMENTO_TOKEN tkk ON tkk.CICLO_ID = dp.CICLO_ID" +
    " JOIN GESTOR_CR gck ON gck.GESTOR_ID = tkk.GESTOR_ID AND gck.CR_ID = " + crId +
    " WHERE dp.COLABORADOR_ID = " + colabId + " AND " + TK_COND);
  await dml("INSERT INTO DESLIGAMENTO_PROJETADO (CICLO_ID, CR_ID, COLABORADOR_ID, MES_DESLIGAMENTO, CRIADO_EM)" +
    " SELECT tkk.CICLO_ID, " + crId + ", " + colabId + ", " + mesDesligamento + ", '" + agora + "'" +
    " FROM " + TK_SRC +
    " JOIN COLABORADOR cbk ON cbk.ID = " + colabId + " AND cbk.CR_ID = " + crId +
    " WHERE " + TK_COND);
  return { ok: true };
}

if (op === 'desligamentoDelete') {
  const id = Number(event.id);
  if (!Number.isInteger(id)) return { ok: false, error: 'id_invalido' };
  await dml("DELETE dp FROM DESLIGAMENTO_PROJETADO dp" +
    " JOIN COLABORADOR cbk ON cbk.ID = dp.COLABORADOR_ID AND cbk.CR_ID = " + crId +
    " JOIN PREENCHIMENTO_TOKEN tkk ON tkk.CICLO_ID = dp.CICLO_ID" +
    " JOIN GESTOR_CR gck ON gck.GESTOR_ID = tkk.GESTOR_ID AND gck.CR_ID = " + crId +
    " WHERE dp.ID = " + id + " AND " + TK_COND);
  return { ok: true };
}

if (op === 'pessoalRecalc') {
  // Mesmo fluxo interno: limparFolha (SF 58) -> insert projecao (calculada no
  // cliente, identica a tela interna) -> limparOrcamento (SF 60) -> gravarOrcamento (SF 61).
  const raw = Array.isArray(event.records) ? event.records : [];
  const recs = [];
  for (const r of raw) {
    const mes = Number(r.MES);
    if (!Number.isInteger(mes) || mes < 1 || mes > 12) continue;
    const colab = r.COLABORADOR_ID == null ? 'NULL' : intOr0(r.COLABORADOR_ID);
    recs.push({ colab, mes, sal: num(r.SALARIO), ben: num(r.BENEFICIOS), enc: num(r.ENCARGOS), tot: num(r.TOTAL) });
  }
  // 1) limpar folha (mesma SQL da SF 58, token-escopada)
  await dml("DELETE opk FROM ORCAMENTO_PESSOAL opk" +
    " JOIN PREENCHIMENTO_TOKEN tkk ON tkk.CICLO_ID = opk.CICLO_ID" +
    " JOIN GESTOR_CR gck ON gck.GESTOR_ID = tkk.GESTOR_ID AND gck.CR_ID = opk.CR_ID" +
    " WHERE opk.CR_ID = " + crId + " AND " + TK_COND);
  // 2) inserir projecao em chunks
  for (let i = 0; i < recs.length; i += 200) {
    const chunk = recs.slice(i, i + 200);
    const derived = chunk.map(r => 'SELECT ' + r.colab + ' AS COLABORADOR_ID, ' + r.mes + ' AS MES, ' + r.sal + ' AS SALARIO, ' + r.ben + ' AS BENEFICIOS, ' + r.enc + ' AS ENCARGOS, ' + r.tot + ' AS TOTAL').join(' UNION ALL ');
    await dml("INSERT INTO ORCAMENTO_PESSOAL (CICLO_ID, CR_ID, COLABORADOR_ID, MES, SALARIO, BENEFICIOS, ENCARGOS, TOTAL)" +
      " SELECT tkk.CICLO_ID, " + crId + ", v.COLABORADOR_ID, v.MES, v.SALARIO, v.BENEFICIOS, v.ENCARGOS, v.TOTAL" +
      " FROM " + TK_SRC + " JOIN (" + derived + ") v WHERE " + TK_COND);
  }
  // 3) limpar contas de pessoal do ORCAMENTO (mesma SQL da SF 60, token-escopada)
  const CONTAS_PESSOAL = "SELECT DISTINCT dck.CONTA_ID FROM DRIVER_CONFIG dck JOIN CONTA_CONTABIL cck ON cck.ID = dck.CONTA_ID" +
    " WHERE dck.CR_ID = " + crId + " AND dck.DRIVER_TIPO = 'PESSOAL' AND cck.CODIGO IN ('5.1.01','5.1.02','5.1.03')";
  await dml("DELETE o FROM ORCAMENTO o" +
    " JOIN PREENCHIMENTO_TOKEN tkk ON tkk.CICLO_ID = o.CICLO_ID" +
    " JOIN GESTOR_CR gck ON gck.GESTOR_ID = tkk.GESTOR_ID AND gck.CR_ID = o.CR_ID" +
    " WHERE o.CR_ID = " + crId + " AND o.CONTA_ID IN (" + CONTAS_PESSOAL + ") AND " + TK_COND);
  // 4) regravar agregando da folha (mesma SQL da SF 61, token-escopada)
  await dml("INSERT INTO ORCAMENTO (CICLO_ID, CR_ID, CONTA_ID, MES, VALOR)" +
    " SELECT opk.CICLO_ID, opk.CR_ID, pc.CONTA_ID, opk.MES," +
    " ROUND(SUM(CASE pc.CODIGO WHEN '5.1.01' THEN opk.SALARIO WHEN '5.1.02' THEN opk.ENCARGOS WHEN '5.1.03' THEN opk.BENEFICIOS ELSE 0 END), 2)" +
    " FROM ORCAMENTO_PESSOAL opk" +
    " JOIN PREENCHIMENTO_TOKEN tkk ON tkk.CICLO_ID = opk.CICLO_ID" +
    " JOIN GESTOR_CR gck ON gck.GESTOR_ID = tkk.GESTOR_ID AND gck.CR_ID = opk.CR_ID" +
    " JOIN (SELECT DISTINCT dck.CONTA_ID, cck.CODIGO FROM DRIVER_CONFIG dck JOIN CONTA_CONTABIL cck ON cck.ID = dck.CONTA_ID" +
    " WHERE dck.CR_ID = " + crId + " AND dck.DRIVER_TIPO = 'PESSOAL' AND cck.CODIGO IN ('5.1.01','5.1.02','5.1.03')) pc ON 1 = 1" +
    " WHERE opk.CR_ID = " + crId + " AND " + TK_COND +
    " GROUP BY opk.CICLO_ID, opk.CR_ID, pc.CONTA_ID, pc.CODIGO, opk.MES");
  return { ok: true, inserted: recs.length };
}

if (op === 'confirmDriver') {
  // Confirma/desfaz confirmacao de um modelo do CR: garante a linha em
  // ORCAMENTO_STATUS e grava o CSV de drivers confirmados. Todos confirmados e
  // PENDENTE -> CONFIRMADO; deixou de ter todos e CONFIRMADO -> volta a PENDENTE
  // (desfazer confirmacao); demais status (REPROVADO) sao preservados.
  const csv = String(event.driversCsv || '').replace(/[^A-Za-z0-9_, -]/g, '').slice(0, 500);
  const all = event.allConfirmed ? 1 : 0;
  await dml("INSERT INTO ORCAMENTO_STATUS (CICLO_ID, GESTOR_ID, CR_ID, STATUS, DRIVERS_CONFIRMADOS, ATUALIZADO_EM)" +
    " SELECT tkk.CICLO_ID, tkk.GESTOR_ID, " + crId + ", 'PENDENTE', '', '" + agora + "'" +
    " FROM " + TK_SRC + " WHERE " + TK_COND +
    " AND NOT EXISTS (SELECT 1 FROM (SELECT CICLO_ID, CR_ID FROM ORCAMENTO_STATUS) s WHERE s.CICLO_ID = tkk.CICLO_ID AND s.CR_ID = " + crId + ")");
  await dml("UPDATE ORCAMENTO_STATUS os" +
    " JOIN PREENCHIMENTO_TOKEN tkk ON tkk.CICLO_ID = os.CICLO_ID" +
    " JOIN GESTOR_CR gck ON gck.GESTOR_ID = tkk.GESTOR_ID AND gck.CR_ID = os.CR_ID" +
    " SET os.DRIVERS_CONFIRMADOS = '" + csv + "'," +
    " os.STATUS = CASE" +
    "   WHEN " + all + " = 1 AND os.STATUS = 'PENDENTE' THEN 'CONFIRMADO'" +
    "   WHEN " + all + " = 0 AND os.STATUS = 'CONFIRMADO' THEN 'PENDENTE'" +
    "   ELSE os.STATUS END," +
    " os.ATUALIZADO_EM = '" + agora + "'" +
    " WHERE os.CR_ID = " + crId + " AND " + TK_COND);
  // Trilha de auditoria: registra qual modelo foi confirmado/desfeito, por quem
  // (gestor do token) e por qual via (LINK). Token-escopado como todo o resto.
  const chDrv = String(event.changedDriver || '').replace(/[^A-Za-z0-9_ -]/g, '').slice(0, 120);
  const chEvt = event.changedAction === 'DESFAZER' ? 'CONFIRMACAO_DESFEITA' : 'MODELO_CONFIRMADO';
  if (chDrv) {
    await dml("INSERT INTO WORKFLOW_AUDITORIA (CICLO_ID, TIPO, CR_ID, GESTOR_ID, EVENTO, COMENTARIO, AUTOR, ORIGEM, CRIADO_EM)" +
      " SELECT tkk.CICLO_ID, 'CR', " + crId + ", tkk.GESTOR_ID, '" + chEvt + "', '" + chDrv + "', g.NOME, 'LINK', '" + agora + "'" +
      " FROM " + TK_SRC + " JOIN GESTOR g ON g.ID = tkk.GESTOR_ID WHERE " + TK_COND);
  }
  return { ok: true };
}

return { ok: false, error: 'op_desconhecida' };`;

// ── 5. Upsert das SFs + toggle public ──
async function upsertSF({ name, type, code, description }) {
  const all = await listServerFunctionsMitra({ projectId });
  const list = all?.result || all?.content || all || [];
  const existing = Array.isArray(list) ? list.find((s) => s.name === name) : null;
  let id;
  if (existing) {
    await updateServerFunctionMitra({ projectId, serverFunctionId: existing.id, code, description });
    id = existing.id;
    console.log(`  ~ atualizada ${name} (id ${id})`);
  } else {
    const res = await createServerFunctionMitra({ projectId, name, type, code, description });
    id = res?.result?.serverFunctionId || res?.serverFunctionId || res?.id;
    console.log(`  + criada ${name} (id ${id})`);
  }
  await togglePublicExecutionMitra({ projectId, serverFunctionId: id, publicExecution: true });
  console.log(`    -> PUBLICA`);
  return id;
}

const ids = {};
ids.base = await upsertSF({ name: 'publicHotOrcBase', type: 'SQL', code: CODE_PUB_BASE,
  description: 'Espelho publico da SF 124 (mount do OrcamentoContent) escopado por token. Params: token' });
ids.cr = await upsertSF({ name: 'publicHotOrcDetalheCr', type: 'SQL', code: CODE_PUB_CR,
  description: 'Espelho publico da SF 125 (driver modo CR) escopado por token+posse do CR. Params: token,crId,cicloId,ano,anoPrev,gestorId,controlCicloId' });
ids.pkg = await upsertSF({ name: 'publicHotOrcDetalhePkg', type: 'SQL', code: CODE_PUB_PKG,
  description: 'Espelho publico da SF 126 (driver modo pacote) escopado por token+posse do pacote. Params: token,pkgId,cicloId,ano,anoPrev,controlCicloId' });
ids.write = await upsertSF({ name: 'publicOrcWrite', type: 'JAVASCRIPT', code: CODE_WRITE,
  description: 'Escritas do driver publico (orcCells,formulaCells,histPremissa,aumentoUpsert/Delete,contratCreate/Delete,desligamentoUpsert/Delete,pessoalRecalc,confirmDriver), token-escopadas. Params: token,op,crId,...' });

console.log('\n=== IDs para o frontend ===');
console.log(JSON.stringify(ids));
