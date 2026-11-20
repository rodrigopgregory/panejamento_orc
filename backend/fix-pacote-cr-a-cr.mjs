// Preenchimento de pacote CR a CR + consolidacao de ORCAMENTO_PACOTE nas leituras.
//
// Contexto: o pacote passou a ser preenchido POR CR (uma linha por CR no grid),
// sem rateio. Este script corrige as SFs de leitura que ignoravam ORCAMENTO_PACOTE
// e o denominador do CR que contava pacotes:
//
//  1. SF 121 hotKanbanMount
//     - MODELOS: filtra d.TIPO_DRIVER='NORMAL' (regra canonica: pacotes FICAM FORA
//       do denominador do CR — sem isso o "Submeter CR" nunca habilita quando o CR
//       tem conta delegada a pacote).
//     - FIN.ORCADO: soma ORCAMENTO + ORCAMENTO_PACOTE (pacotes SUBMETIDO/APROVADO).
//     - Novos blocos PKG_TOTAIS / PKG_FILLED: progresso real por pacote
//       (pares conta x CR preenchidos vs mapeados).
//  2. SF 125 hotOrcDetalheCr + SF 143 publicHotOrcDetalheCr: novo bloco PKG_BUDGET
//     (linhas de ORCAMENTO_PACOTE do CR) — a aba "Pacotes" dentro do CR mostrava
//     zeros porque lia so ORCAMENTO.
//  3. SF 127 hotResumoCr / SF 128 hotResumoCrMes: ORC consolida ORCAMENTO_PACOTE.
//  4. SFs 86/88/90 dreOrcadoPor{Conta,Cr,Empresa}: orcado consolida ORCAMENTO_PACOTE.
//  5. SF 192 publicDreGestor: ORCADO consolida ORCAMENTO_PACOTE dos CRs do gestor.
//
// Consolidacao sempre limitada a pacotes com PACOTE_STATUS SUBMETIDO/APROVADO no
// ciclo — coerente com a promessa da UI ("valores visiveis apos o gestor do pacote
// submeter"). Script idempotente: pode rodar de novo sem duplicar blocos.
import 'dotenv/config';
import {
  configureSdkMitra,
  readServerFunctionMitra,
  updateServerFunctionMitra,
  togglePublicExecutionMitra,
  executeServerFunctionMitra,
} from 'mitra-sdk';

function backUrlFromToken(token) {
  try {
    const raw = (token || '').replace(/^Bearer\s+/i, '');
    const payload = JSON.parse(Buffer.from(raw.split('.')[1], 'base64').toString('utf8'));
    return payload.backURL || payload.backUrl;
  } catch { return null; }
}

const token = process.env.MITRA_TOKEN;
const baseURL = process.env.MITRA_BASE_URL || backUrlFromToken(token);
const projectId = Number(process.env.MITRA_PROJECT_ID);
configureSdkMitra({ baseURL, token, integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS || baseURL });

// Filtro padrao: so pacotes submetidos/aprovados no ciclo consolidam
const PKG_OK = (cicloExpr, driverExpr) =>
  `EXISTS (SELECT 1 FROM PACOTE_STATUS ps WHERE ps.CICLO_ID = ${cicloExpr} AND ps.DRIVER_ID = ${driverExpr} AND ps.STATUS IN ('SUBMETIDO','APROVADO'))`;

// ─────────────────────────────────────────────────────────────────────────────
// SF 121 — hotKanbanMount (kanban do gestor no /preenchimento)
// ─────────────────────────────────────────────────────────────────────────────
const SF121_CODE = `SELECT
  COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('ID',os.ID,'CICLO_ID',os.CICLO_ID,'CR_ID',os.CR_ID,'GESTOR_ID',os.GESTOR_ID,'STATUS',os.STATUS,'DRIVERS_CONFIRMADOS',os.DRIVERS_CONFIRMADOS,'COMENTARIO',os.COMENTARIO,'ATUALIZADO_EM',os.ATUALIZADO_EM,'CR_CODIGO',cr.CODIGO,'CR_NOME',cr.NOME))
     FROM ORCAMENTO_STATUS os JOIN CENTRO_RESULTADO cr ON cr.ID=os.CR_ID WHERE os.CICLO_ID={{cicloId}} AND os.GESTOR_ID={{gestorId}}), JSON_ARRAY()) AS CARDS,
  COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('CR_ID',s.CR_ID,'ORCADO',(SELECT COALESCE(SUM(VALOR),0) FROM ORCAMENTO WHERE CICLO_ID=s.CICLO_ID AND CR_ID=s.CR_ID) + (SELECT COALESCE(SUM(op.VALOR),0) FROM ORCAMENTO_PACOTE op WHERE op.CICLO_ID=s.CICLO_ID AND op.CR_ID=s.CR_ID AND ${PKG_OK('op.CICLO_ID', 'op.DRIVER_ID')}),'REALIZADO',(SELECT COALESCE(SUM(VALOR),0) FROM REALIZADO_CONTABIL WHERE ANO={{ano}} AND CR_ID=s.CR_ID)))
     FROM ORCAMENTO_STATUS s WHERE s.CICLO_ID={{cicloId}} AND s.GESTOR_ID={{gestorId}}), JSON_ARRAY()) AS FIN,
  COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('ID',d.ID,'NOME',d.NOME,'DESCRICAO',d.DESCRICAO,'COR',d.COR,'ORIGEM',d.ORIGEM,'TIPO_DRIVER',d.TIPO_DRIVER,'ATIVO',d.ATIVO,'GP_ID',gp.ID))
     FROM DRIVERS d JOIN GESTOR_PACOTE gp ON gp.DRIVER_ID=d.ID WHERE gp.GESTOR_ID={{gestorId}} AND d.TIPO_DRIVER='PACOTE' AND d.ATIVO='true'), JSON_ARRAY()) AS PACOTES,
  COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('ID',ID,'CICLO_ID',CICLO_ID,'DRIVER_ID',DRIVER_ID,'GESTOR_ID',GESTOR_ID,'STATUS',STATUS,'DRIVERS_CONFIRMADOS',DRIVERS_CONFIRMADOS,'COMENTARIO',COMENTARIO,'ATUALIZADO_EM',ATUALIZADO_EM))
     FROM PACOTE_STATUS WHERE CICLO_ID={{cicloId}} AND GESTOR_ID={{gestorId}}), JSON_ARRAY()) AS PACOTE_STATUS,
  COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('CR_ID',cr_id,'TOTAL',total)) FROM (
     SELECT crc.CR_ID cr_id, COUNT(DISTINCT d.NOME) total FROM CR_CONTA crc
     LEFT JOIN CONTA_DRIVER_EXCECAO cde ON cde.CR_ID=crc.CR_ID AND cde.CONTA_ID=crc.CONTA_ID AND cde.ATIVO=true
     LEFT JOIN CONTA_DRIVER cd ON cd.CONTA_ID=crc.CONTA_ID
     LEFT JOIN DRIVERS d ON d.ID=COALESCE(cde.PACOTE_ID,cd.PACOTE_ID,cde.DRIVER_ID,cd.DRIVER_ID)
     WHERE crc.CR_ID IN (SELECT CR_ID FROM ORCAMENTO_STATUS WHERE CICLO_ID={{cicloId}} AND GESTOR_ID={{gestorId}}) AND crc.ATIVO=true AND d.ID IS NOT NULL AND d.ATIVO='true' AND d.TIPO_DRIVER='NORMAL'
     GROUP BY crc.CR_ID) m), JSON_ARRAY()) AS MODELOS,
  COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('DRIVER_ID',pt.driver_id,'TOTAL',pt.total)) FROM (
     SELECT d.ID driver_id, COUNT(DISTINCT CONCAT(crc.CR_ID,'_',crc.CONTA_ID)) total FROM CR_CONTA crc
     LEFT JOIN CONTA_DRIVER_EXCECAO cde ON cde.CR_ID=crc.CR_ID AND cde.CONTA_ID=crc.CONTA_ID AND cde.ATIVO=true
     LEFT JOIN CONTA_DRIVER cd ON cd.CONTA_ID=crc.CONTA_ID
     JOIN DRIVERS d ON d.ID=COALESCE(cde.PACOTE_ID,cd.PACOTE_ID,cde.DRIVER_ID,cd.DRIVER_ID)
     WHERE crc.ATIVO=true AND d.TIPO_DRIVER='PACOTE' AND d.ATIVO='true'
     GROUP BY d.ID) pt), JSON_ARRAY()) AS PKG_TOTAIS,
  COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('DRIVER_ID',pf.driver_id,'FILLED',pf.filled)) FROM (
     SELECT op.DRIVER_ID driver_id, COUNT(DISTINCT CONCAT(op.CR_ID,'_',op.CONTA_ID)) filled
     FROM ORCAMENTO_PACOTE op WHERE op.CICLO_ID={{cicloId}} AND op.VALOR<>0 AND op.CR_ID IS NOT NULL
     GROUP BY op.DRIVER_ID) pf), JSON_ARRAY()) AS PKG_FILLED`;

// ─────────────────────────────────────────────────────────────────────────────
// SF 127 — hotResumoCr (Resumo do CR)
// ─────────────────────────────────────────────────────────────────────────────
const SF127_CODE = `SELECT
  COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('CONTA_ID',x.CONTA_ID,'MES',x.MES,'VALOR',x.VALOR,'CONTA_CODIGO',x.CONTA_CODIGO,'CONTA_NOME',x.CONTA_NOME)) FROM (SELECT z.CONTA_ID, z.MES, SUM(z.VALOR) AS VALOR, cc.CODIGO AS CONTA_CODIGO, cc.NOME AS CONTA_NOME FROM (SELECT o.CONTA_ID, o.MES, o.VALOR FROM ORCAMENTO o WHERE o.CICLO_ID = {{cicloId}} AND o.CR_ID = {{crId}} UNION ALL SELECT op.CONTA_ID, op.MES, op.VALOR FROM ORCAMENTO_PACOTE op WHERE op.CICLO_ID = {{cicloId}} AND op.CR_ID = {{crId}} AND ${PKG_OK('op.CICLO_ID', 'op.DRIVER_ID')}) z JOIN CONTA_CONTABIL cc ON cc.ID = z.CONTA_ID GROUP BY z.CONTA_ID, z.MES, cc.CODIGO, cc.NOME) x),JSON_ARRAY()) AS ORC,
  COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('CONTA_ID',x.CONTA_ID,'MES',x.MES,'VALOR',x.VALOR)) FROM (SELECT rc.CONTA_ID, rc.MES, SUM(rc.VALOR) AS VALOR FROM REALIZADO_CONTABIL rc WHERE rc.ANO = {{ano}} AND rc.CR_ID = {{crId}} GROUP BY rc.CONTA_ID, rc.MES) x),JSON_ARRAY()) AS REAL_ROWS,
  COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('CONTA_ID',x.CONTA_ID,'MES',x.MES,'VALOR',x.VALOR)) FROM (SELECT rc.CONTA_ID, rc.MES, SUM(rc.VALOR) AS VALOR FROM REALIZADO_CONTABIL rc WHERE rc.ANO = {{anoPrev}} AND rc.CR_ID = {{crId}} GROUP BY rc.CONTA_ID, rc.MES) x),JSON_ARRAY()) AS REAL_ANT,
  COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('CONTA_ID',x.CONTA_ID,'DRIVER_TIPO',x.DRIVER_TIPO)) FROM (SELECT DISTINCT crc.CONTA_ID, d.NOME AS DRIVER_TIPO FROM CR_CONTA crc LEFT JOIN CONTA_DRIVER_EXCECAO cde ON cde.CR_ID = crc.CR_ID AND cde.CONTA_ID = crc.CONTA_ID AND cde.ATIVO = true LEFT JOIN CONTA_DRIVER cd ON cd.CONTA_ID = crc.CONTA_ID LEFT JOIN DRIVERS d ON d.ID = COALESCE(cde.PACOTE_ID, cd.PACOTE_ID, cde.DRIVER_ID, cd.DRIVER_ID) WHERE crc.CR_ID = {{crId}} AND crc.ATIVO = true AND d.ID IS NOT NULL AND d.ATIVO = 'true') x),JSON_ARRAY()) AS DRV_CFG`;

// ─────────────────────────────────────────────────────────────────────────────
// SF 128 — hotResumoCrMes (drill mensal do Resumo)
// ─────────────────────────────────────────────────────────────────────────────
const SF128_CODE = `SELECT
  COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('CONTA_ID',x.CONTA_ID,'NOME',x.NOME,'CODIGO',x.CODIGO,'VALOR',x.VALOR)) FROM (SELECT z.CONTA_ID, cc.NOME, cc.CODIGO, SUM(z.VALOR) AS VALOR FROM (SELECT o.CONTA_ID, o.VALOR FROM ORCAMENTO o WHERE o.CICLO_ID = {{cicloId}} AND o.CR_ID = {{crId}} AND o.MES = {{mes}} UNION ALL SELECT op.CONTA_ID, op.VALOR FROM ORCAMENTO_PACOTE op WHERE op.CICLO_ID = {{cicloId}} AND op.CR_ID = {{crId}} AND op.MES = {{mes}} AND ${PKG_OK('op.CICLO_ID', 'op.DRIVER_ID')}) z JOIN CONTA_CONTABIL cc ON cc.ID = z.CONTA_ID GROUP BY z.CONTA_ID, cc.NOME, cc.CODIGO) x),JSON_ARRAY()) AS ORC,
  COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('CONTA_ID',x.CONTA_ID,'VALOR',x.VALOR)) FROM (SELECT rc.CONTA_ID, SUM(rc.VALOR) AS VALOR FROM REALIZADO_CONTABIL rc WHERE rc.ANO = {{ano}} AND rc.CR_ID = {{crId}} AND rc.MES = {{mes}} GROUP BY rc.CONTA_ID) x),JSON_ARRAY()) AS REAL_ROWS,
  COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('CONTA_ID',x.CONTA_ID,'VALOR',x.VALOR)) FROM (SELECT rc.CONTA_ID, SUM(rc.VALOR) AS VALOR FROM REALIZADO_CONTABIL rc WHERE rc.ANO = {{anoPrev}} AND rc.CR_ID = {{crId}} AND rc.MES = {{mes}} GROUP BY rc.CONTA_ID) x),JSON_ARRAY()) AS REAL_ANT`;

// ─────────────────────────────────────────────────────────────────────────────
// SFs 86/88/90 — DRE orcado (conta / CR / empresa)
// ─────────────────────────────────────────────────────────────────────────────
const ORC_UNION = `(SELECT o.CONTA_ID, o.MES, o.VALOR, o.CR_ID FROM ORCAMENTO o WHERE o.CICLO_ID = {{cicloId}}
UNION ALL
SELECT op.CONTA_ID, op.MES, op.VALOR, op.CR_ID FROM ORCAMENTO_PACOTE op WHERE op.CICLO_ID = {{cicloId}} AND op.CR_ID IS NOT NULL AND ${PKG_OK('op.CICLO_ID', 'op.DRIVER_ID')}) z`;

const SF86_CODE = `SELECT z.CONTA_ID, z.MES, SUM(z.VALOR) as VALOR
FROM ${ORC_UNION}
WHERE ('{{crIds}}' = '' OR FIND_IN_SET(z.CR_ID, '{{crIds}}'))
  AND ('{{contaIds}}' = '' OR FIND_IN_SET(z.CONTA_ID, '{{contaIds}}'))
GROUP BY z.CONTA_ID, z.MES`;

const SF88_CODE = `SELECT z.CR_ID, z.MES, SUM(z.VALOR) as VALOR
FROM ${ORC_UNION}
WHERE ('{{contaIds}}' = '' OR FIND_IN_SET(z.CONTA_ID, '{{contaIds}}'))
  AND ('{{crIds}}' = '' OR FIND_IN_SET(z.CR_ID, '{{crIds}}'))
GROUP BY z.CR_ID, z.MES`;

const SF90_CODE = `SELECT cr.EMPRESA_ID, z.MES, SUM(z.VALOR) as VALOR
FROM ${ORC_UNION}
JOIN CENTRO_RESULTADO cr ON cr.ID = z.CR_ID
WHERE ('{{contaIds}}' = '' OR FIND_IN_SET(z.CONTA_ID, '{{contaIds}}'))
  AND ('{{crIds}}' = '' OR FIND_IN_SET(z.CR_ID, '{{crIds}}'))
GROUP BY cr.EMPRESA_ID, z.MES`;

// ─────────────────────────────────────────────────────────────────────────────
// SF 192 — publicDreGestor (DRE publica do gestor via token)
// ─────────────────────────────────────────────────────────────────────────────
const SF192_CODE = `SELECT
  COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('CICLO_ID', x.CICLO_ID, 'CICLO_NOME', x.CICLO_NOME, 'ANO', x.ANO))
    FROM (
      SELECT t.CICLO_ID, c.NOME AS CICLO_NOME, c.ANO
      FROM PREENCHIMENTO_TOKEN t
      JOIN CICLO c ON c.ID = t.CICLO_ID
      WHERE t.TOKEN = '{{token}}' AND t.ATIVO = 'true'
        AND (t.EXPIRA_EM IS NULL OR t.EXPIRA_EM >= '{{agora}}')
      ORDER BY t.ID DESC LIMIT 1
    ) x), JSON_ARRAY()) AS CTX,
  COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('NOME_LINHA', x.NOME_LINHA, 'PREFIXO_CONTA', x.PREFIXO_CONTA, 'SINAL', x.SINAL, 'IS_SUBTOTAL', x.IS_SUBTOTAL))
    FROM (SELECT NOME_LINHA, PREFIXO_CONTA, SINAL, IS_SUBTOTAL FROM DRE_CONFIG ORDER BY ORDEM, ID) x), JSON_ARRAY()) AS CONFIG,
  COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('ID', x.ID, 'CODIGO', x.CODIGO, 'NOME', x.NOME))
    FROM (
      SELECT DISTINCT cc.ID, cc.CODIGO, cc.NOME
      FROM PREENCHIMENTO_TOKEN t
      JOIN GESTOR_CR gc ON gc.GESTOR_ID = t.GESTOR_ID
      JOIN CR_CONTA crc ON crc.CR_ID = gc.CR_ID AND crc.ATIVO = true
      JOIN CONTA_CONTABIL cc ON cc.ID = crc.CONTA_ID
      WHERE t.TOKEN = '{{token}}' AND t.ATIVO = 'true'
        AND (t.EXPIRA_EM IS NULL OR t.EXPIRA_EM >= '{{agora}}')
    ) x), JSON_ARRAY()) AS CONTAS,
  COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('CONTA_ID', x.CONTA_ID, 'MES', x.MES, 'VALOR', x.VALOR))
    FROM (
      SELECT z.CONTA_ID, z.MES, SUM(z.VALOR) AS VALOR FROM (
        SELECT o.CONTA_ID, o.MES, o.VALOR
        FROM PREENCHIMENTO_TOKEN t
        JOIN GESTOR_CR gc ON gc.GESTOR_ID = t.GESTOR_ID
        JOIN ORCAMENTO o ON o.CICLO_ID = t.CICLO_ID AND o.CR_ID = gc.CR_ID
        WHERE t.TOKEN = '{{token}}' AND t.ATIVO = 'true'
          AND (t.EXPIRA_EM IS NULL OR t.EXPIRA_EM >= '{{agora}}')
        UNION ALL
        SELECT op.CONTA_ID, op.MES, op.VALOR
        FROM PREENCHIMENTO_TOKEN t
        JOIN GESTOR_CR gc ON gc.GESTOR_ID = t.GESTOR_ID
        JOIN ORCAMENTO_PACOTE op ON op.CICLO_ID = t.CICLO_ID AND op.CR_ID = gc.CR_ID
        WHERE t.TOKEN = '{{token}}' AND t.ATIVO = 'true'
          AND (t.EXPIRA_EM IS NULL OR t.EXPIRA_EM >= '{{agora}}')
          AND ${PKG_OK('op.CICLO_ID', 'op.DRIVER_ID')}
      ) z GROUP BY z.CONTA_ID, z.MES
    ) x), JSON_ARRAY()) AS ORCADO,
  COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('CONTA_ID', x.CONTA_ID, 'MES', x.MES, 'VALOR', x.VALOR))
    FROM (
      SELECT rc.CONTA_ID, rc.MES, SUM(rc.VALOR) AS VALOR
      FROM PREENCHIMENTO_TOKEN t
      JOIN CICLO c ON c.ID = t.CICLO_ID
      JOIN GESTOR_CR gc ON gc.GESTOR_ID = t.GESTOR_ID
      JOIN REALIZADO_CONTABIL rc ON rc.CR_ID = gc.CR_ID AND rc.ANO = c.ANO - 1
      WHERE t.TOKEN = '{{token}}' AND t.ATIVO = 'true'
        AND (t.EXPIRA_EM IS NULL OR t.EXPIRA_EM >= '{{agora}}')
      GROUP BY rc.CONTA_ID, rc.MES
    ) x), JSON_ARRAY()) AS REALIZADO_AA,
  COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('CONTA_ID', x.CONTA_ID, 'MES', x.MES, 'VALOR', x.VALOR))
    FROM (
      SELECT rc.CONTA_ID, rc.MES, SUM(rc.VALOR) AS VALOR
      FROM PREENCHIMENTO_TOKEN t
      JOIN CICLO c ON c.ID = t.CICLO_ID
      JOIN GESTOR_CR gc ON gc.GESTOR_ID = t.GESTOR_ID
      JOIN REALIZADO_CONTABIL rc ON rc.CR_ID = gc.CR_ID AND rc.ANO = c.ANO
      WHERE t.TOKEN = '{{token}}' AND t.ATIVO = 'true'
        AND (t.EXPIRA_EM IS NULL OR t.EXPIRA_EM >= '{{agora}}')
      GROUP BY rc.CONTA_ID, rc.MES
    ) x), JSON_ARRAY()) AS REALIZADO_ATUAL`;

// Bloco PKG_BUDGET (linhas de ORCAMENTO_PACOTE do CR) — appendado nas SFs 125/143
const PKG_BUDGET_BLOCK = `COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('ID',t.ID,'CICLO_ID',t.CICLO_ID,'DRIVER_ID',t.DRIVER_ID,'CR_ID',t.CR_ID,'CONTA_ID',t.CONTA_ID,'MES',t.MES,'VALOR',t.VALOR)) FROM ORCAMENTO_PACOTE t WHERE t.CICLO_ID = {{cicloId}} AND t.CR_ID = {{crId}}),JSON_ARRAY()) AS PKG_BUDGET`;

async function updateSF(id, code, label) {
  await updateServerFunctionMitra({ projectId, serverFunctionId: id, code });
  console.log(`OK  SF ${id} (${label}) atualizada`);
}

async function appendPkgBudget(id, label) {
  const fn = await readServerFunctionMitra({ projectId, serverFunctionId: id });
  const current = fn?.result?.code || fn?.code || '';
  if (!current) throw new Error(`SF ${id} (${label}): code vazio no read`);
  if (current.includes('AS PKG_BUDGET')) {
    console.log(`SKIP SF ${id} (${label}) ja tem PKG_BUDGET`);
    return;
  }
  let next;
  if (/\nFROM PREENCHIMENTO_TOKEN tk/.test(current)) {
    // SF publica: blocos terminam antes do FROM do token — inserir ali
    next = current.replace(/\nFROM PREENCHIMENTO_TOKEN tk/, `,\n  ${PKG_BUDGET_BLOCK}\nFROM PREENCHIMENTO_TOKEN tk`);
  } else {
    next = `${current},\n  ${PKG_BUDGET_BLOCK}`;
  }
  await updateServerFunctionMitra({ projectId, serverFunctionId: id, code: next });
  console.log(`OK  SF ${id} (${label}) + PKG_BUDGET`);
}

async function smoke(id, input, checkFields, label) {
  const res = await executeServerFunctionMitra({ projectId, serverFunctionId: id, input });
  const st = res?.result?.executionStatus;
  if (st !== 'COMPLETED') throw new Error(`SF ${id} (${label}) smoke FAILED: ${res?.result?.error || st}`);
  let out = res?.result?.output;
  if (typeof out === 'string') { try { out = JSON.parse(out); } catch { /* keep */ } }
  const row = out?.rows?.[0] || {};
  for (const f of checkFields) {
    if (!(f in row)) throw new Error(`SF ${id} (${label}): campo ${f} ausente no output`);
  }
  console.log(`OK  SF ${id} (${label}) smoke passou (${checkFields.join(', ')})`);
}

async function main() {
  await updateSF(121, SF121_CODE, 'hotKanbanMount');
  await updateSF(127, SF127_CODE, 'hotResumoCr');
  await updateSF(128, SF128_CODE, 'hotResumoCrMes');
  await updateSF(86, SF86_CODE, 'dreOrcadoPorConta');
  await updateSF(88, SF88_CODE, 'dreOrcadoPorCr');
  await updateSF(90, SF90_CODE, 'dreOrcadoPorEmpresa');
  await updateSF(192, SF192_CODE, 'publicDreGestor');
  await togglePublicExecutionMitra({ projectId, serverFunctionId: 192, publicExecution: true });
  console.log('OK  SF 192 mantida publica');

  await appendPkgBudget(125, 'hotOrcDetalheCr');
  await appendPkgBudget(143, 'publicHotOrcDetalheCr');
  await togglePublicExecutionMitra({ projectId, serverFunctionId: 143, publicExecution: true });
  console.log('OK  SF 143 mantida publica');

  // Smoke tests (leitura, sem efeitos colaterais)
  await smoke(121, { cicloId: 0, gestorId: 0, ano: 2026 }, ['CARDS', 'FIN', 'MODELOS', 'PKG_TOTAIS', 'PKG_FILLED'], 'hotKanbanMount');
  await smoke(127, { crId: 0, cicloId: 0, ano: 2026, anoPrev: 2025 }, ['ORC', 'DRV_CFG'], 'hotResumoCr');
  await smoke(128, { crId: 0, cicloId: 0, ano: 2026, anoPrev: 2025, mes: 1 }, ['ORC'], 'hotResumoCrMes');
  await smoke(86, { cicloId: 0, crIds: '', contaIds: '' }, [], 'dreOrcadoPorConta');
  await smoke(88, { cicloId: 0, crIds: '', contaIds: '' }, [], 'dreOrcadoPorCr');
  await smoke(90, { cicloId: 0, crIds: '', contaIds: '' }, [], 'dreOrcadoPorEmpresa');
  await smoke(125, { crId: 0, cicloId: 0, ano: 2026, anoPrev: 2025, gestorId: 0, controlCicloId: 0 }, ['BUDGET', 'PKG_BUDGET', 'PACOTE_STATUS_ALL'], 'hotOrcDetalheCr');
  await smoke(192, { token: 'smoke-test-token', agora: '2026-07-13T00:00:00' }, ['CTX', 'ORCADO'], 'publicDreGestor');

  console.log('\nTodas as SFs atualizadas e validadas.');
}

main().catch((e) => { console.error('FALHA:', e?.message || e); process.exit(1); });
