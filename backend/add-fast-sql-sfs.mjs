// Cria SFs dedicadas tipo SQL (sem sandbox E2B) para DRE, Kanban e Dashboard.
// Motivo: SF 76/79 (JAVASCRIPT) pagam ~500-600ms de sandbox por chamada; as telas
// quentes precisam de leituras ~8ms direto no banco, disparadas em paralelo.
// Seguranca: cada SF e um SELECT fixo parametrizado ({{param}}), padrao das SFs 41-61/77-78.
// Listas de IDs entram como CSV numerico via FIND_IN_SET('{{param}}') — sem SQL arbitrario.
import 'dotenv/config';
import { configureSdkMitra, createServerFunctionMitra, listServerFunctionsMitra, executeServerFunctionMitra } from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});
const projectId = parseInt(process.env.MITRA_PROJECT_ID);

const SFS = [
  // ── Base (tabelas estaticas — cacheaveis no cliente) ──
  { name: 'baseCiclos', code: `SELECT * FROM CICLO ORDER BY ANO DESC`, description: 'Lista todos os ciclos ordenados por ano desc (sem params)' },
  { name: 'baseDreConfig', code: `SELECT * FROM DRE_CONFIG ORDER BY ORDEM`, description: 'Linhas de configuracao do DRE (sem params)' },
  { name: 'baseContas', code: `SELECT * FROM CONTA_CONTABIL`, description: 'Plano de contas completo (sem params)' },
  { name: 'baseCrs', code: `SELECT * FROM CENTRO_RESULTADO ORDER BY NOME`, description: 'Centros de resultado (sem params)' },
  { name: 'baseEmpresas', code: `SELECT * FROM EMPRESA WHERE ATIVO = 'true' ORDER BY NOME`, description: 'Empresas ativas (sem params)' },
  { name: 'baseGestorCrs', code: `SELECT CR_ID FROM GESTOR_CR WHERE GESTOR_ID = {{gestorId}}`, description: 'CRs de um gestor — param gestorId (int)' },

  // ── DRE: agregacoes de ORCAMENTO / REALIZADO_CONTABIL ──
  // Filtros opcionais: CSV numerico vazio = sem filtro (padrao FIND_IN_SET)
  { name: 'dreOrcadoPorConta', code: `SELECT o.CONTA_ID, o.MES, SUM(o.VALOR) as VALOR
FROM ORCAMENTO o
WHERE o.CICLO_ID = {{cicloId}}
  AND ('{{crIds}}' = '' OR FIND_IN_SET(o.CR_ID, '{{crIds}}'))
  AND ('{{contaIds}}' = '' OR FIND_IN_SET(o.CONTA_ID, '{{contaIds}}'))
GROUP BY o.CONTA_ID, o.MES`, description: 'Orcado agregado por conta e mes — params cicloId (int), crIds (CSV opcional), contaIds (CSV opcional)' },

  { name: 'dreRealizadoPorConta', code: `SELECT rc.CONTA_ID, rc.MES, SUM(rc.VALOR) as VALOR
FROM REALIZADO_CONTABIL rc
WHERE rc.ANO = {{ano}}
  AND ('{{crIds}}' = '' OR FIND_IN_SET(rc.CR_ID, '{{crIds}}'))
  AND ('{{contaIds}}' = '' OR FIND_IN_SET(rc.CONTA_ID, '{{contaIds}}'))
  AND ('{{empresaId}}' = '' OR rc.EMPRESA_ID = '{{empresaId}}')
GROUP BY rc.CONTA_ID, rc.MES`, description: 'Realizado agregado por conta e mes — params ano (int), crIds/contaIds (CSV opcional), empresaId (opcional)' },

  { name: 'dreOrcadoPorCr', code: `SELECT o.CR_ID, o.MES, SUM(o.VALOR) as VALOR
FROM ORCAMENTO o
WHERE o.CICLO_ID = {{cicloId}}
  AND ('{{contaIds}}' = '' OR FIND_IN_SET(o.CONTA_ID, '{{contaIds}}'))
  AND ('{{crIds}}' = '' OR FIND_IN_SET(o.CR_ID, '{{crIds}}'))
GROUP BY o.CR_ID, o.MES`, description: 'Orcado agregado por CR e mes — params cicloId (int), contaIds/crIds (CSV opcional)' },

  { name: 'dreRealizadoPorCr', code: `SELECT rc.CR_ID, rc.MES, SUM(rc.VALOR) as VALOR
FROM REALIZADO_CONTABIL rc
WHERE rc.ANO = {{ano}}
  AND ('{{contaIds}}' = '' OR FIND_IN_SET(rc.CONTA_ID, '{{contaIds}}'))
  AND ('{{crIds}}' = '' OR FIND_IN_SET(rc.CR_ID, '{{crIds}}'))
GROUP BY rc.CR_ID, rc.MES`, description: 'Realizado agregado por CR e mes — params ano (int), contaIds/crIds (CSV opcional)' },

  { name: 'dreOrcadoPorEmpresa', code: `SELECT cr.EMPRESA_ID, o.MES, SUM(o.VALOR) as VALOR
FROM ORCAMENTO o
JOIN CENTRO_RESULTADO cr ON cr.ID = o.CR_ID
WHERE o.CICLO_ID = {{cicloId}}
  AND ('{{contaIds}}' = '' OR FIND_IN_SET(o.CONTA_ID, '{{contaIds}}'))
  AND ('{{crIds}}' = '' OR FIND_IN_SET(o.CR_ID, '{{crIds}}'))
GROUP BY cr.EMPRESA_ID, o.MES`, description: 'Orcado agregado por empresa e mes — params cicloId (int), contaIds/crIds (CSV opcional)' },

  { name: 'dreRealizadoPorEmpresa', code: `SELECT rc.EMPRESA_ID, rc.MES, SUM(rc.VALOR) as VALOR
FROM REALIZADO_CONTABIL rc
WHERE rc.ANO = {{ano}}
  AND ('{{contaIds}}' = '' OR FIND_IN_SET(rc.CONTA_ID, '{{contaIds}}'))
  AND ('{{crIds}}' = '' OR FIND_IN_SET(rc.CR_ID, '{{crIds}}'))
GROUP BY rc.EMPRESA_ID, rc.MES`, description: 'Realizado agregado por empresa e mes — params ano (int), contaIds/crIds (CSV opcional)' },

  // ── Kanban (Workflow) — todas dependem so de cicloId, rodam em paralelo ──
  { name: 'kanbanGestores', code: `SELECT g.*, GROUP_CONCAT(gc.CR_ID) as CR_IDS
FROM GESTOR g
JOIN GESTOR_CR gc ON gc.GESTOR_ID = g.ID
WHERE g.ATIVO = 'true'
GROUP BY g.ID`, description: 'Gestores ativos com seus CRs concatenados (sem params)' },

  { name: 'kanbanStatusCrs', code: `SELECT os.*, g.NOME as GESTOR_NOME, g.EMAIL as GESTOR_EMAIL,
       cr.CODIGO as CR_CODIGO, cr.NOME as CR_NOME
FROM ORCAMENTO_STATUS os
JOIN GESTOR g ON g.ID = os.GESTOR_ID
JOIN CENTRO_RESULTADO cr ON cr.ID = os.CR_ID
WHERE os.CICLO_ID = {{cicloId}}
ORDER BY g.NOME, cr.CODIGO`, description: 'Cards de status por CR do kanban — param cicloId (int)' },

  { name: 'kanbanStatusPacotes', code: `SELECT ps.*, g.NOME as GESTOR_NOME, g.EMAIL as GESTOR_EMAIL,
       d.NOME as DRIVER_NOME, d.DESCRICAO as DRIVER_DESCRICAO
FROM PACOTE_STATUS ps
JOIN GESTOR g ON g.ID = ps.GESTOR_ID
JOIN DRIVERS d ON d.ID = ps.DRIVER_ID
WHERE ps.CICLO_ID = {{cicloId}}
ORDER BY g.NOME, d.NOME`, description: 'Cards de status por pacote do kanban — param cicloId (int)' },

  // Mesma logica da SF 77 (config viva), mas derivando os CRs do proprio ciclo:
  // elimina a espera do frontend por ORCAMENTO_STATUS antes de pedir os totais.
  { name: 'kanbanModelosPorCiclo', code: `SELECT crc.CR_ID, COUNT(DISTINCT d.NOME) AS TOTAL
FROM CR_CONTA crc
LEFT JOIN CONTA_DRIVER_EXCECAO cde ON cde.CR_ID = crc.CR_ID AND cde.CONTA_ID = crc.CONTA_ID AND cde.ATIVO = true
LEFT JOIN CONTA_DRIVER cd ON cd.CONTA_ID = crc.CONTA_ID
LEFT JOIN DRIVERS d ON d.ID = COALESCE(cde.PACOTE_ID, cd.PACOTE_ID, cde.DRIVER_ID, cd.DRIVER_ID)
WHERE crc.CR_ID IN (SELECT DISTINCT CR_ID FROM ORCAMENTO_STATUS WHERE CICLO_ID = {{cicloId}})
  AND crc.ATIVO = true AND d.ID IS NOT NULL AND d.ATIVO = 'true'
GROUP BY crc.CR_ID`, description: 'Total de modelos vivos por CR dos cards do ciclo (config viva, mesma logica da SF 77) — param cicloId (int)' },

  { name: 'kanbanPacoteTotais', code: `SELECT pkg.ID AS PACOTE_ID, COUNT(DISTINCT modelo.ID) AS TOTAL
FROM DRIVERS pkg
JOIN CR_CONTA crc ON crc.ATIVO = true
LEFT JOIN CONTA_DRIVER_EXCECAO cde ON cde.CR_ID = crc.CR_ID AND cde.CONTA_ID = crc.CONTA_ID AND cde.ATIVO = true
LEFT JOIN CONTA_DRIVER cd ON cd.CONTA_ID = crc.CONTA_ID
LEFT JOIN DRIVERS modelo ON modelo.ID = COALESCE(cde.DRIVER_ID, cd.DRIVER_ID) AND modelo.TIPO_DRIVER = 'NORMAL'
WHERE pkg.ID IN (SELECT DISTINCT DRIVER_ID FROM PACOTE_STATUS WHERE CICLO_ID = {{cicloId}})
  AND COALESCE(cde.PACOTE_ID, cd.PACOTE_ID, cde.DRIVER_ID, cd.DRIVER_ID) = pkg.ID
  AND modelo.ID IS NOT NULL
GROUP BY pkg.ID`, description: 'Total de modelos NORMAL por pacote dos cards do ciclo — param cicloId (int)' },

  // ── Dashboard ──
  { name: 'dashStatusAgg', code: `SELECT STATUS, SUM(QTD) as QTD FROM (
  SELECT STATUS, COUNT(*) as QTD FROM ORCAMENTO_STATUS WHERE CICLO_ID = {{cicloId}} GROUP BY STATUS
  UNION ALL
  SELECT STATUS, COUNT(*) as QTD FROM PACOTE_STATUS WHERE CICLO_ID = {{cicloId}} GROUP BY STATUS
) t GROUP BY STATUS`, description: 'Contagem de status agregada (CRs + pacotes) do ciclo — param cicloId (int)' },
];

async function main() {
  const existing = await listServerFunctionsMitra({ projectId });
  const byName = new Map((existing.result || existing || []).map(f => [f.name, f]));

  const ids = {};
  for (const sf of SFS) {
    const found = byName.get(sf.name);
    if (found) {
      console.log(`= ja existe: ${sf.name} (id ${found.id})`);
      ids[sf.name] = found.id;
      continue;
    }
    const res = await createServerFunctionMitra({ projectId, name: sf.name, type: 'SQL', code: sf.code, description: sf.description });
    const id = res?.result?.serverFunctionId ?? res?.result?.id;
    console.log(`+ criada: ${sf.name} (id ${id})`);
    ids[sf.name] = id;
  }

  // Confirma IDs pelo list (fonte da verdade)
  const after = await listServerFunctionsMitra({ projectId });
  const list = after.result || after || [];
  for (const sf of SFS) {
    const f = list.find(x => x.name === sf.name);
    if (f) ids[sf.name] = f.id;
  }
  console.log('\n=== IDS ===');
  console.log(JSON.stringify(ids, null, 2));

  // ── Smoke tests + timing ──
  const t = async (name, input) => {
    const t0 = Date.now();
    const r = await executeServerFunctionMitra({ projectId, serverFunctionId: ids[name], input });
    const ms = Date.now() - t0;
    const out = r?.result?.output;
    const rows = typeof out === 'string' ? JSON.parse(out).rows : out?.rows;
    console.log(`${name}: ${ms}ms, ${rows?.length ?? '?'} rows ${r?.result?.executionStatus === 'FAILED' ? 'FAILED: ' + r?.result?.error : ''}`);
    return rows || [];
  };

  console.log('\n=== SMOKE ===');
  const ciclos = await t('baseCiclos', {});
  const cicloId = ciclos[0]?.ID;
  await t('baseDreConfig', {});
  await t('baseContas', {});
  await t('baseCrs', {});
  await t('baseEmpresas', {});
  await t('baseGestorCrs', { gestorId: 1 });
  await t('dreOrcadoPorConta', { cicloId, crIds: '', contaIds: '' });
  await t('dreOrcadoPorConta', { cicloId, crIds: '1,2', contaIds: '' });
  await t('dreRealizadoPorConta', { ano: 2025, crIds: '', contaIds: '', empresaId: '' });
  await t('dreOrcadoPorCr', { cicloId, contaIds: '', crIds: '' });
  await t('dreRealizadoPorCr', { ano: 2025, contaIds: '', crIds: '' });
  await t('dreOrcadoPorEmpresa', { cicloId, contaIds: '', crIds: '' });
  await t('dreRealizadoPorEmpresa', { ano: 2025, contaIds: '', crIds: '' });
  await t('kanbanGestores', {});
  await t('kanbanStatusCrs', { cicloId });
  await t('kanbanStatusPacotes', { cicloId });
  await t('kanbanModelosPorCiclo', { cicloId });
  await t('kanbanPacoteTotais', { cicloId });
  await t('dashStatusAgg', { cicloId });

  // Burst paralelo — simula 1 carregamento de tela
  console.log('\n=== BURST PARALELO (6 SFs como o load do DRE) ===');
  const t0 = Date.now();
  await Promise.all([
    executeServerFunctionMitra({ projectId, serverFunctionId: ids.baseCiclos, input: {} }),
    executeServerFunctionMitra({ projectId, serverFunctionId: ids.baseDreConfig, input: {} }),
    executeServerFunctionMitra({ projectId, serverFunctionId: ids.baseContas, input: {} }),
    executeServerFunctionMitra({ projectId, serverFunctionId: ids.baseCrs, input: {} }),
    executeServerFunctionMitra({ projectId, serverFunctionId: ids.baseEmpresas, input: {} }),
    executeServerFunctionMitra({ projectId, serverFunctionId: ids.dreOrcadoPorConta, input: { cicloId, crIds: '', contaIds: '' } }),
  ]);
  console.log(`6 SFs em paralelo: ${Date.now() - t0}ms total`);
}

main().catch(e => { console.error(e); process.exit(1); });
