// Cria as SFs SQL consolidadas da tela de drivers (OrcamentoContent + Resumo do CR).
// Motivo: abrir um driver fazia ~20 consultas sequenciais via SF 76 (JS/sandbox ~550ms cada,
// concorrencia ~2 no servidor) = varios segundos. Estas SFs devolvem todos os blocos como
// campos JSON em UMA ida (~200ms), no mesmo padrao seguro das SFs 120/121: SQL dedicada,
// parametrizada por {{param}}, sem SQL vindo do frontend.
import 'dotenv/config';
import { configureSdkMitra, executeServerFunctionMitra, createServerFunctionMitra } from 'mitra-sdk';

configureSdkMitra({ baseURL: process.env.MITRA_BASE_URL, token: process.env.MITRA_TOKEN, integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS });
const projectId = parseInt(process.env.MITRA_PROJECT_ID);

// ── 1. Levanta colunas reais das tabelas (evita JSON_OBJECT desatualizado na mao) ──
const TABLES = ['CICLO','BENEFICIO','ENCARGO','CARGO','DRIVERS','DRIVER_FORMULA','DRE_CONFIG','ORCAMENTO','ORCAMENTO_PACOTE','REALIZADO_CONTABIL','COLABORADOR','ORCAMENTO_PESSOAL','PROJECAO_HEADCOUNT','CONTRATACAO_PROJETADA','PREMISSA_DISSIDIO','PREMISSA_TURNOVER','AUMENTO_SALARIAL','DESLIGAMENTO_PROJETADO','HIST_PREMISSA','DRIVER_FORMULA_VALOR','DRIVER_FORMULA_CR','PREMISSA_IMPOSTO','ORCAMENTO_STATUS','PACOTE_STATUS','RATEIO_CONFIG','RATEIO_CR','PKG_RATEIO_CONFIG'];
const schemaRes = await executeServerFunctionMitra({ projectId, serverFunctionId: 76, input: { sql:
  `SELECT TABLE_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${TABLES.map(t=>`'${t}'`).join(',')}) ORDER BY TABLE_NAME, ORDINAL_POSITION` } });
let sout = schemaRes?.result?.output; if (typeof sout === 'string') sout = JSON.parse(sout);
const S = {};
for (const r of (sout.rows || [])) (S[r.TABLE_NAME] ||= []).push(r.COLUMN_NAME);
for (const t of TABLES) if (!S[t]) throw new Error(`schema ausente: ${t}`);

// JSON_OBJECT('COL', alias.COL, ...) para todas as colunas da tabela
const jo = (table, alias) => S[table].map(c => `'${c}',${alias}.${c}`).join(',');
// Bloco simples: COALESCE((SELECT JSON_ARRAYAGG(...) FROM tabela t WHERE ...), JSON_ARRAY()) AS NOME
const blk = (name, table, where) =>
  `COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT(${jo(table,'t')})) FROM ${table} t WHERE ${where}),JSON_ARRAY()) AS ${name}`;
// Bloco com joins/colunas extras
const blkJ = (name, inner) => `COALESCE((${inner}),JSON_ARRAY()) AS ${name}`;

// ── 2. hotOrcBase — as 9 consultas do mount do OrcamentoContent em 1 ida ──
const CODE_BASE = `SELECT
  ${blk('CICLOS','CICLO',`t.STATUS != 'FECHADO'`)},
  ${blk('BENEFICIOS','BENEFICIO','1=1')},
  ${blk('ENCARGOS','ENCARGO','1=1')},
  ${blk('CARGOS','CARGO',`t.ATIVO = 'true'`)},
  ${blkJ('PACOTE_DRIVERS',`SELECT JSON_ARRAYAGG(JSON_OBJECT(${jo('DRIVERS','d')},'GESTOR_ID',gp.GESTOR_ID)) FROM DRIVERS d LEFT JOIN GESTOR_PACOTE gp ON gp.DRIVER_ID = d.ID WHERE d.TIPO_DRIVER = 'PACOTE' AND d.ATIVO = 'true'`)},
  ${blk('NORMAL_DRIVERS','DRIVERS',`t.TIPO_DRIVER = 'NORMAL' AND t.ATIVO = 'true'`)},
  ${blkJ('FORMULAS',`SELECT JSON_ARRAYAGG(JSON_OBJECT(${jo('DRIVER_FORMULA','df')},'CONTA_CODIGO',cc.CODIGO,'CONTA_NOME',cc.NOME)) FROM DRIVER_FORMULA df LEFT JOIN CONTA_CONTABIL cc ON cc.ID = df.CONTA_ID`)},
  ${blk('DRE_CONFIG','DRE_CONFIG','1=1')},
  ${blkJ('CONTAS',`SELECT JSON_ARRAYAGG(JSON_OBJECT('ID',c.ID,'CODIGO',c.CODIGO,'NOME',c.NOME,'TIPO',c.TIPO)) FROM CONTA_CONTABIL c`)}`;

// ── 3. hotOrcDetalheCr — loadData em modo CR (1 ida) ──
// Params: crId, cicloId, ano, anoPrev, gestorId (0 = sem filtro), controlCicloId (0 = sem versao controle)
const CONFIGS_CR = `SELECT JSON_ARRAYAGG(JSON_OBJECT('CR_ID',crc.CR_ID,'CR_CODIGO',cr.CODIGO,'CR_NOME',cr.NOME,'CONTA_ID',cc.ID,'CODIGO',cc.CODIGO,'CONTA_NOME',cc.NOME,'TIPO',cc.TIPO,'DRIVER_TIPO',d.NOME,'DRIVER_ID',d.ID))
 FROM CR_CONTA crc
 JOIN CONTA_CONTABIL cc ON cc.ID = crc.CONTA_ID
 LEFT JOIN CENTRO_RESULTADO cr ON cr.ID = crc.CR_ID
 LEFT JOIN CONTA_DRIVER_EXCECAO cde ON cde.CR_ID = crc.CR_ID AND cde.CONTA_ID = crc.CONTA_ID AND cde.ATIVO = true
 LEFT JOIN CONTA_DRIVER cd ON cd.CONTA_ID = crc.CONTA_ID
 LEFT JOIN DRIVERS d ON d.ID = COALESCE(cde.PACOTE_ID, cd.PACOTE_ID, cde.DRIVER_ID, cd.DRIVER_ID)
 WHERE crc.CR_ID = {{crId}} AND crc.ATIVO = true AND d.ID IS NOT NULL AND d.ATIVO = 'true'`;

const CODE_CR = `SELECT
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

// ── 4. hotOrcDetalhePkg — loadData em modo pacote (1 ida) ──
// Params: pkgId, cicloId, ano, anoPrev, controlCicloId (0 = sem versao controle)
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

const CODE_PKG = `SELECT
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

// ── 5. hotResumoCr — visao Resumo do CR (3 querySQL + SF 78 em 1 ida) ──
// Params: crId, cicloId, ano, anoPrev
const CODE_RESUMO = `SELECT
  ${blkJ('ORC',`SELECT JSON_ARRAYAGG(JSON_OBJECT('CONTA_ID',x.CONTA_ID,'MES',x.MES,'VALOR',x.VALOR,'CONTA_CODIGO',x.CONTA_CODIGO,'CONTA_NOME',x.CONTA_NOME)) FROM (SELECT o.CONTA_ID, o.MES, SUM(o.VALOR) AS VALOR, cc.CODIGO AS CONTA_CODIGO, cc.NOME AS CONTA_NOME FROM ORCAMENTO o JOIN CONTA_CONTABIL cc ON cc.ID = o.CONTA_ID WHERE o.CICLO_ID = {{cicloId}} AND o.CR_ID = {{crId}} GROUP BY o.CONTA_ID, o.MES, cc.CODIGO, cc.NOME) x`)},
  ${blkJ('REAL_ROWS',`SELECT JSON_ARRAYAGG(JSON_OBJECT('CONTA_ID',x.CONTA_ID,'MES',x.MES,'VALOR',x.VALOR)) FROM (SELECT rc.CONTA_ID, rc.MES, SUM(rc.VALOR) AS VALOR FROM REALIZADO_CONTABIL rc WHERE rc.ANO = {{ano}} AND rc.CR_ID = {{crId}} GROUP BY rc.CONTA_ID, rc.MES) x`)},
  ${blkJ('REAL_ANT',`SELECT JSON_ARRAYAGG(JSON_OBJECT('CONTA_ID',x.CONTA_ID,'MES',x.MES,'VALOR',x.VALOR)) FROM (SELECT rc.CONTA_ID, rc.MES, SUM(rc.VALOR) AS VALOR FROM REALIZADO_CONTABIL rc WHERE rc.ANO = {{anoPrev}} AND rc.CR_ID = {{crId}} GROUP BY rc.CONTA_ID, rc.MES) x`)},
  ${blkJ('DRV_CFG',`SELECT JSON_ARRAYAGG(JSON_OBJECT('CONTA_ID',x.CONTA_ID,'DRIVER_TIPO',x.DRIVER_TIPO)) FROM (SELECT DISTINCT crc.CONTA_ID, d.NOME AS DRIVER_TIPO FROM CR_CONTA crc LEFT JOIN CONTA_DRIVER_EXCECAO cde ON cde.CR_ID = crc.CR_ID AND cde.CONTA_ID = crc.CONTA_ID AND cde.ATIVO = true LEFT JOIN CONTA_DRIVER cd ON cd.CONTA_ID = crc.CONTA_ID LEFT JOIN DRIVERS d ON d.ID = COALESCE(cde.PACOTE_ID, cd.PACOTE_ID, cde.DRIVER_ID, cd.DRIVER_ID) WHERE crc.CR_ID = {{crId}} AND crc.ATIVO = true AND d.ID IS NOT NULL AND d.ATIVO = 'true') x`)}`;

// ── 6. hotResumoCrMes — drill de um mes no Resumo (3 querySQL em 1 ida) ──
// Params: crId, cicloId, ano, anoPrev, mes
const CODE_RESUMO_MES = `SELECT
  ${blkJ('ORC',`SELECT JSON_ARRAYAGG(JSON_OBJECT('CONTA_ID',x.CONTA_ID,'NOME',x.NOME,'CODIGO',x.CODIGO,'VALOR',x.VALOR)) FROM (SELECT o.CONTA_ID, cc.NOME, cc.CODIGO, SUM(o.VALOR) AS VALOR FROM ORCAMENTO o JOIN CONTA_CONTABIL cc ON cc.ID = o.CONTA_ID WHERE o.CICLO_ID = {{cicloId}} AND o.CR_ID = {{crId}} AND o.MES = {{mes}} GROUP BY o.CONTA_ID, cc.NOME, cc.CODIGO) x`)},
  ${blkJ('REAL_ROWS',`SELECT JSON_ARRAYAGG(JSON_OBJECT('CONTA_ID',x.CONTA_ID,'VALOR',x.VALOR)) FROM (SELECT rc.CONTA_ID, SUM(rc.VALOR) AS VALOR FROM REALIZADO_CONTABIL rc WHERE rc.ANO = {{ano}} AND rc.CR_ID = {{crId}} AND rc.MES = {{mes}} GROUP BY rc.CONTA_ID) x`)},
  ${blkJ('REAL_ANT',`SELECT JSON_ARRAYAGG(JSON_OBJECT('CONTA_ID',x.CONTA_ID,'VALOR',x.VALOR)) FROM (SELECT rc.CONTA_ID, SUM(rc.VALOR) AS VALOR FROM REALIZADO_CONTABIL rc WHERE rc.ANO = {{anoPrev}} AND rc.CR_ID = {{crId}} AND rc.MES = {{mes}} GROUP BY rc.CONTA_ID) x`)}`;

// ── Criacao ──
const defs = [
  { name: 'hotOrcBase', code: CODE_BASE, description: 'Mount do OrcamentoContent em 1 ida (CICLOS,BENEFICIOS,ENCARGOS,CARGOS,PACOTE_DRIVERS,NORMAL_DRIVERS,FORMULAS,DRE_CONFIG,CONTAS como JSON). Sem params.' },
  { name: 'hotOrcDetalheCr', code: CODE_CR, description: 'loadData do driver em modo CR em 1 ida (19 blocos JSON). Params: crId,cicloId,ano,anoPrev,gestorId(0=sem filtro),controlCicloId(0=sem).' },
  { name: 'hotOrcDetalhePkg', code: CODE_PKG, description: 'loadData do driver em modo PACOTE em 1 ida (22 blocos JSON). Params: pkgId,cicloId,ano,anoPrev,controlCicloId(0=sem).' },
  { name: 'hotResumoCr', code: CODE_RESUMO, description: 'Visao Resumo do CR em 1 ida (ORC,REAL,REAL_ANT,DRV_CFG como JSON). Params: crId,cicloId,ano,anoPrev.' },
  { name: 'hotResumoCrMes', code: CODE_RESUMO_MES, description: 'Drill mensal do Resumo do CR em 1 ida (ORC,REAL,REAL_ANT). Params: crId,cicloId,ano,anoPrev,mes.' },
];

for (const d of defs) {
  const r = await createServerFunctionMitra({ projectId, name: d.name, type: 'SQL', code: d.code, description: d.description });
  console.log(`${d.name} -> ID ${r?.result?.serverFunctionId ?? JSON.stringify(r?.result)}`);
}
console.log('done');
