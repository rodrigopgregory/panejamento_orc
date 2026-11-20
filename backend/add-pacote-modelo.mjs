// Fase 2 do refinamento do mapeamento: preenchimento de pacote dirigido pelo
// MODELO DE PACOTE (DRIVERS.ESCOPO='PACOTE', linhas com GRANULARIDADE/RATEIO_ID).
//
//  1) DRIVER_FORMULA_VALOR ganha PACOTE_ID (default 0 = uso em CR, comportamento
//     atual intacto). Um modelo de pacote pode ser compartilhado por N pacotes —
//     os valores de linha precisam da dimensao do pacote. Indice unico passa a
//     (FORMULA_ID, CICLO_ID, PACOTE_ID, CR_ID, MES). CR_ID=0 = valor unico do
//     pacote (linha sem granularidade); CR_ID real = linha granular por CR.
//  2) Nova SF upsertFormulaValorPkg (upsert com pacoteId) — espelho da SF 197.
//  3) SFs 124/125/126 regeneradas (schema-driven): NORMAL_DRIVERS/FORMULAS ganham
//     ESCOPO/GRANULARIDADE/RATEIO_ID; CLV do modo CR exclui linhas de pacote;
//     CLV do modo pacote inclui as linhas do proprio pacote; modo pacote ganha
//     blocos RATEIOS/RATEIO_ITENS (calculo on-the-fly da distribuicao).
//  4) SF 121: PKG_FILLED passa a contar par (conta, CR) LANCADO (linha existe),
//     nao VALOR<>0 — rateio pode legitimamente zerar um CR (qtd 0) e isso nao
//     pode travar o "Submeter pacote" em 99%.
//  5) Espelhos publicos 142/143/145 regenerados com os mesmos blocos (link do
//     gestor renderiza o modelo de pacote em modo leitura).
// Idempotente.
import 'dotenv/config';
import {
  configureSdkMitra, runDdlMitra, executeServerFunctionMitra,
  createServerFunctionMitra, updateServerFunctionMitra, readServerFunctionMitra,
  listServerFunctionsMitra, togglePublicExecutionMitra,
} from 'mitra-sdk';

configureSdkMitra({ baseURL: process.env.MITRA_BASE_URL, token: process.env.MITRA_TOKEN, integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS });
const projectId = parseInt(process.env.MITRA_PROJECT_ID);

async function query(sql) {
  const res = await executeServerFunctionMitra({ projectId, serverFunctionId: 76, input: { sql } });
  let output = res?.result?.output;
  if (typeof output === 'string') try { output = JSON.parse(output); } catch {}
  if (output && Array.isArray(output.rows)) return output.rows;
  if (Array.isArray(output)) return output;
  return [];
}
async function hasColumn(table, column) {
  const r = await query(`SELECT COUNT(*) AS N FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${table}' AND COLUMN_NAME = '${column}'`);
  return Number(r[0]?.N) > 0;
}
async function hasIndex(table, index) {
  const r = await query(`SELECT COUNT(*) AS N FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${table}' AND INDEX_NAME = '${index}'`);
  return Number(r[0]?.N) > 0;
}

// ── 1. DDL: DRIVER_FORMULA_VALOR.PACOTE_ID + troca do indice unico ──
if (!(await hasColumn('DRIVER_FORMULA_VALOR', 'PACOTE_ID'))) {
  await runDdlMitra({ projectId, sql: `ALTER TABLE DRIVER_FORMULA_VALOR ADD COLUMN PACOTE_ID INT NOT NULL DEFAULT 0` });
  console.log('DRIVER_FORMULA_VALOR.PACOTE_ID criada');
} else console.log('DRIVER_FORMULA_VALOR.PACOTE_ID ja existe');

// Cria o indice novo ANTES de derrubar o antigo (sem janela sem unicidade)
if (!(await hasIndex('DRIVER_FORMULA_VALOR', 'uq_dfv_pkg'))) {
  await runDdlMitra({ projectId, sql: `ALTER TABLE DRIVER_FORMULA_VALOR ADD UNIQUE INDEX uq_dfv_pkg (FORMULA_ID, CICLO_ID, PACOTE_ID, CR_ID, MES)` });
  console.log('indice uq_dfv_pkg criado');
} else console.log('indice uq_dfv_pkg ja existe');
if (await hasIndex('DRIVER_FORMULA_VALOR', 'uq_dfv')) {
  // DROP INDEX e classificado como destrutivo pela plataforma, mas nao apaga dados:
  // apenas troca a chave unica antiga (FORMULA_ID,CICLO_ID,CR_ID,MES) pela nova
  // uq_dfv_pkg (ja criada acima) que adiciona PACOTE_ID. Sem o drop, dois pacotes
  // compartilhando o mesmo modelo colidiriam na chave antiga (mesma linha/CR/mes).
  // A propria mensagem da plataforma instrui reenviar com confirmDestructive:true;
  // a SDK ainda nao expoe o campo, entao esta unica chamada vai direto ao endpoint
  // runDdl com o payload exigido. Confirmado na aprovacao da fase 2.
  const ddlRes = await fetch(`${process.env.MITRA_BASE_URL}/agentAiShortcut/runDdl`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.MITRA_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, sql: 'ALTER TABLE DRIVER_FORMULA_VALOR DROP INDEX uq_dfv', confirmDestructive: true }),
  });
  if (!ddlRes.ok) throw new Error(`DROP INDEX uq_dfv falhou: ${ddlRes.status} ${await ddlRes.text()}`);
  console.log('indice antigo uq_dfv removido');
} else console.log('indice antigo uq_dfv ja ausente');

// ── 2. SF upsertFormulaValorPkg ──
const UPSERT_PKG_CODE = `INSERT INTO DRIVER_FORMULA_VALOR (FORMULA_ID, CICLO_ID, PACOTE_ID, CR_ID, MES, VALOR) VALUES ({{formulaId}}, {{cicloId}}, {{pacoteId}}, {{crId}}, {{mes}}, {{valor}}) ON DUPLICATE KEY UPDATE VALOR = {{valor}}`;
const list = (await listServerFunctionsMitra({ projectId }))?.result || [];
const byName = (n) => list.find((s) => s.name === n);
let upsertPkgId;
{
  const found = byName('upsertFormulaValorPkg');
  if (found) {
    await updateServerFunctionMitra({ projectId, serverFunctionId: found.id, code: UPSERT_PKG_CODE });
    upsertPkgId = found.id;
    console.log(`SF upsertFormulaValorPkg atualizada (id ${found.id})`);
  } else {
    const r = await createServerFunctionMitra({
      projectId, name: 'upsertFormulaValorPkg', type: 'SQL', code: UPSERT_PKG_CODE,
      description: 'Upsert de valor de linha de MODELO DE PACOTE (DRIVER_FORMULA_VALOR com PACOTE_ID). Params: formulaId, cicloId, pacoteId, crId (0 = valor unico do pacote), mes, valor.',
    });
    upsertPkgId = r?.result?.serverFunctionId;
    console.log(`SF upsertFormulaValorPkg criada (id ${upsertPkgId})`);
  }
}

// ── 3. Regenerar SFs 124/125/126 + espelhos publicos 142/143/145 ──
const TABLES = ['CICLO','BENEFICIO','ENCARGO','CARGO','DRIVERS','DRIVER_FORMULA','DRE_CONFIG','ORCAMENTO','ORCAMENTO_PACOTE','REALIZADO_CONTABIL','COLABORADOR','ORCAMENTO_PESSOAL','PROJECAO_HEADCOUNT','CONTRATACAO_PROJETADA','PREMISSA_DISSIDIO','PREMISSA_TURNOVER','AUMENTO_SALARIAL','DESLIGAMENTO_PROJETADO','HIST_PREMISSA','DRIVER_FORMULA_VALOR','DRIVER_FORMULA_CR','PREMISSA_IMPOSTO','ORCAMENTO_STATUS','PACOTE_STATUS','RATEIO','RATEIO_ITEM'];
const schemaRows = await query(`SELECT TABLE_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${TABLES.map(t=>`'${t}'`).join(',')}) ORDER BY TABLE_NAME, ORDINAL_POSITION`);
const S = {};
for (const r of schemaRows) (S[r.TABLE_NAME] ||= []).push(r.COLUMN_NAME);
for (const t of TABLES) if (!S[t]) throw new Error(`schema ausente: ${t}`);

const jo = (table, alias) => S[table].map(c => `'${c}',${alias}.${c}`).join(',');
const blk = (name, table, where) =>
  `COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT(${jo(table,'t')})) FROM ${table} t WHERE ${where}),JSON_ARRAY()) AS ${name}`;
const blkJ = (name, inner) => `COALESCE((${inner}),JSON_ARRAY()) AS ${name}`;

// Blocos identicos aos do add-hot-orcamento.mjs, com as mudancas da fase 2
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
  ${blk('CLV','DRIVER_FORMULA_VALOR',`t.CICLO_ID = {{cicloId}} AND t.CR_ID = {{crId}} AND COALESCE(t.PACOTE_ID, 0) = 0`)},
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

// CLV do pacote: linhas do PROPRIO pacote (PACOTE_ID = pkgId, inclusive CR_ID=0 =
// valor unico) + legado CR-escopado (PACOTE_ID=0) dos CRs do pacote.
const CODE_PKG_BLOCKS = `
  ${blkJ('CR_IDS',`SELECT JSON_ARRAYAGG(JSON_OBJECT('CR_ID',x.CR_ID)) FROM ${CR_IN} x`)},
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
  ${blk('CLV','DRIVER_FORMULA_VALOR',`t.CICLO_ID = {{cicloId}} AND (t.PACOTE_ID = {{pkgId}} OR (COALESCE(t.PACOTE_ID, 0) = 0 AND t.CR_ID IN ${CR_IN}))`)},
  ${blk('OVERRIDES','DRIVER_FORMULA_CR',`t.CR_ID IN ${CR_IN}`)},
  ${blk('IMPOSTO_CENTRAL','PREMISSA_IMPOSTO',`t.CICLO_ID = {{cicloId}}`)},
  ${blk('STATUS','PACOTE_STATUS',`t.CICLO_ID = {{cicloId}} AND t.DRIVER_ID = {{pkgId}}`)},
  ${blk('RATEIOS','RATEIO',`t.ATIVO = true`)},
  ${blk('RATEIO_ITENS','RATEIO_ITEM','1=1')}`;

await updateServerFunctionMitra({ projectId, serverFunctionId: 124, code: `SELECT${CODE_BASE_BLOCKS}`,
  description: 'Mount do OrcamentoContent em 1 ida (blocos JSON; NORMAL_DRIVERS c/ ESCOPO, FORMULAS c/ GRANULARIDADE+RATEIO_ID). Sem params.' });
console.log('SF 124 atualizada');
await updateServerFunctionMitra({ projectId, serverFunctionId: 125, code: `SELECT${CODE_CR_BLOCKS}`,
  description: 'loadData do driver em modo CR em 1 ida. CLV exclui linhas de pacote (PACOTE_ID=0). Params: crId,cicloId,ano,anoPrev,gestorId(0=sem),controlCicloId(0=sem).' });
console.log('SF 125 atualizada');
await updateServerFunctionMitra({ projectId, serverFunctionId: 126, code: `SELECT${CODE_PKG_BLOCKS}`,
  description: 'loadData do driver em modo PACOTE em 1 ida. CLV inclui linhas do pacote (PACOTE_ID=pkgId); blocos RATEIOS/RATEIO_ITENS p/ distribuicao on-the-fly. Params: pkgId,cicloId,ano,anoPrev,controlCicloId(0=sem).' });
console.log('SF 126 atualizada');

// Nota: o bloco PKG_BUDGET da SF 125 (aba Pacotes do CR) foi adicionado por
// fix-pacote-cr-a-cr.mjs POR CIMA do codigo da 125 — reaplica aqui o mesmo bloco.
const PKG_OK = (cicloCol, driverCol) =>
  `EXISTS (SELECT 1 FROM PACOTE_STATUS ps WHERE ps.CICLO_ID = ${cicloCol} AND ps.DRIVER_ID = ${driverCol} AND ps.STATUS IN ('SUBMETIDO','APROVADO'))`;
{
  const sf125 = await readServerFunctionMitra({ projectId, serverFunctionId: 125 });
  let c = sf125?.result?.code || '';
  if (!c.includes('AS PKG_BUDGET')) {
    c += `,\n  ${blkJ('PKG_BUDGET', `SELECT JSON_ARRAYAGG(JSON_OBJECT('DRIVER_ID',op.DRIVER_ID,'CONTA_ID',op.CONTA_ID,'MES',op.MES,'CR_ID',op.CR_ID,'VALOR',op.VALOR)) FROM ORCAMENTO_PACOTE op WHERE op.CICLO_ID = {{cicloId}} AND op.CR_ID = {{crId}}`)}`;
    await updateServerFunctionMitra({ projectId, serverFunctionId: 125, code: c });
    console.log('SF 125: bloco PKG_BUDGET reaplicado');
  }
}

// ── 4. SF 121: PKG_FILLED conta par lancado (linha existe), nao VALOR<>0 ──
{
  const sf121 = await readServerFunctionMitra({ projectId, serverFunctionId: 121 });
  let c = sf121?.result?.code || '';
  const oldFrag = 'AND op.VALOR<>0 AND op.CR_ID IS NOT NULL';
  if (c.includes(oldFrag)) {
    c = c.replace(oldFrag, 'AND op.CR_ID IS NOT NULL');
    await updateServerFunctionMitra({ projectId, serverFunctionId: 121, code: c });
    console.log('SF 121: PKG_FILLED agora conta par lancado (linha existe)');
  } else if (c.includes("AND op.CR_ID IS NOT NULL")) {
    console.log('SF 121: PKG_FILLED ja atualizado');
  } else {
    console.log('AVISO: fragmento PKG_FILLED nao encontrado na SF 121 — revisar manualmente');
  }
}

// ── 5. Espelhos publicos 142/143/145 (token-gate identico ao add-public-orc-driver) ──
const CODE_PUB_BASE = `SELECT${CODE_BASE_BLOCKS}
FROM PREENCHIMENTO_TOKEN tk
WHERE tk.TOKEN = '{{token}}' AND tk.ATIVO = 'true'
LIMIT 1`;
const CODE_PUB_CR = `SELECT${CODE_CR_BLOCKS},
  ${blkJ('PKG_BUDGET', `SELECT JSON_ARRAYAGG(JSON_OBJECT('DRIVER_ID',op.DRIVER_ID,'CONTA_ID',op.CONTA_ID,'MES',op.MES,'CR_ID',op.CR_ID,'VALOR',op.VALOR)) FROM ORCAMENTO_PACOTE op WHERE op.CICLO_ID = {{cicloId}} AND op.CR_ID = {{crId}}`)}
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

for (const [name, code] of [
  ['publicHotOrcBase', CODE_PUB_BASE],
  ['publicHotOrcDetalheCr', CODE_PUB_CR],
  ['publicHotOrcDetalhePkg', CODE_PUB_PKG],
]) {
  const found = byName(name);
  if (!found) { console.log(`AVISO: SF publica ${name} nao encontrada — pulando`); continue; }
  await updateServerFunctionMitra({ projectId, serverFunctionId: found.id, code });
  await togglePublicExecutionMitra({ projectId, serverFunctionId: found.id, publicExecution: true });
  console.log(`SF ${name} (id ${found.id}) regenerada e mantida publica`);
}

// ── 6. Smokes ──
async function smoke(id, input, mustHave, label) {
  const res = await executeServerFunctionMitra({ projectId, serverFunctionId: id, input });
  const st = res?.result?.executionStatus;
  if (st !== 'COMPLETED') throw new Error(`SF ${id} (${label}) falhou: ${res?.result?.error || st}`);
  let out = res?.result?.output; if (typeof out === 'string') out = JSON.parse(out);
  const row = out?.rows?.[0];
  for (const k of mustHave) {
    if (row && !(k in row)) throw new Error(`SF ${id} (${label}) sem bloco ${k}`);
  }
  console.log(`SF ${id} (${label}) OK`);
}
await smoke(124, {}, ['NORMAL_DRIVERS','FORMULAS'], 'hotOrcBase');
await smoke(125, { crId: 0, cicloId: 0, ano: 2026, anoPrev: 2025, gestorId: 0, controlCicloId: 0 }, ['CLV','PKG_BUDGET','PACOTE_STATUS_ALL'], 'hotOrcDetalheCr');
await smoke(126, { pkgId: 0, cicloId: 0, ano: 2026, anoPrev: 2025, controlCicloId: 0 }, ['CLV','RATEIOS','RATEIO_ITENS','CONFIGS','BUDGET'], 'hotOrcDetalhePkg');
await smoke(121, { cicloId: 0, gestorId: 0, ano: 2026 }, ['PKG_TOTAIS','PKG_FILLED'], 'hotKanbanMount');

// Roundtrip do upsert com pacote (formulaId=0 improvavel de existir — limpa depois)
await executeServerFunctionMitra({ projectId, serverFunctionId: upsertPkgId, input: { formulaId: 0, cicloId: 0, pacoteId: 999999, crId: 0, mes: 1, valor: 123 } });
const chk = await query(`SELECT VALOR FROM DRIVER_FORMULA_VALOR WHERE FORMULA_ID = 0 AND PACOTE_ID = 999999`);
if (Number(chk[0]?.VALOR) !== 123) throw new Error('roundtrip upsertFormulaValorPkg falhou');
await executeServerFunctionMitra({ projectId, serverFunctionId: upsertPkgId, input: { formulaId: 0, cicloId: 0, pacoteId: 999999, crId: 0, mes: 1, valor: 456 } });
const chk2 = await query(`SELECT COUNT(*) AS N, MAX(VALOR) AS V FROM DRIVER_FORMULA_VALOR WHERE FORMULA_ID = 0 AND PACOTE_ID = 999999`);
if (Number(chk2[0]?.N) !== 1 || Number(chk2[0]?.V) !== 456) throw new Error('upsert nao atualizou pela chave nova');
const { runDmlMitra } = await import('mitra-sdk');
await runDmlMitra({ projectId, sql: `DELETE FROM DRIVER_FORMULA_VALOR WHERE FORMULA_ID = 0 AND PACOTE_ID = 999999` });
console.log(`roundtrip upsertFormulaValorPkg OK (id ${upsertPkgId})`);
console.log('done — SF upsertFormulaValorPkg id:', upsertPkgId);
