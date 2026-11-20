// Cria as SFs SQL consolidadas das telas de cadastro/consulta que ainda carregavam pelo
// caminho sandbox (useQuery/querySQL via SF 76, ~700ms-1,7s por chamada, concorrencia ~2).
// Uma SF por tela, todos os blocos de mount como campos JSON em UMA ida (~200ms) — mesmo
// padrao seguro das SFs 120-128: SQL fixa no servidor, parametrizada, sem SQL do frontend.
// Onde a tela dependia do ciclo selecionado (beneficios/encargos), o param cicloId aceita
// 0 = resolver o ciclo default direto no SQL (elimina a cascata "carrega ciclos -> carrega dados").
import 'dotenv/config';
import { configureSdkMitra, executeServerFunctionMitra, createServerFunctionMitra } from 'mitra-sdk';

configureSdkMitra({ baseURL: process.env.MITRA_BASE_URL, token: process.env.MITRA_TOKEN, integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS });
const projectId = parseInt(process.env.MITRA_PROJECT_ID);

// ── 1. Colunas reais das tabelas (gera JSON_OBJECT sempre atualizado) ──
const TABLES = ['COLABORADOR','CENTRO_RESULTADO','EMPRESA','CARGO','CICLO','BENEFICIO','ENCARGO','PREMISSA_DISSIDIO','PREMISSA_TURNOVER','GESTOR_CR','DRIVERS','CONTA_CONTABIL','CR_CONTA','CONTA_DRIVER','CONTA_DRIVER_EXCECAO','DRIVER_FORMULA','DRE_CONFIG','GESTOR','ORCAMENTO_STATUS'];
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

// Blocos repetidos entre telas
const CRS = blk('CRS','CENTRO_RESULTADO',`t.ATIVO = 'true'`);
const EMPRESAS = blk('EMPRESAS','EMPRESA','1=1');
const CARGOS = blk('CARGOS','CARGO',`t.ATIVO = 'true'`);
const CONTAS_FULL = blk('CONTAS','CONTA_CONTABIL','1=1');
const CONTA_DRIVERS = blk('CONTA_DRIVERS','CONTA_DRIVER','1=1');
const EXCECOES = blk('EXCECOES','CONTA_DRIVER_EXCECAO','t.ATIVO = true');
const DRIVERS_ATIVOS = blk('DRIVERS','DRIVERS',`t.ATIVO = 'true'`);

// Resolucao de ciclo default no SQL ({{cicloId}} = 0)
const OPEN_DEFAULT = `(SELECT ID FROM CICLO WHERE STATUS != 'FECHADO' ORDER BY ANO DESC, ID DESC LIMIT 1)`;
const ATUAL_DEFAULT = `COALESCE((SELECT ID FROM CICLO WHERE VERSAO_ATUAL = 'true' ORDER BY ID DESC LIMIT 1), (SELECT ID FROM CICLO ORDER BY ANO DESC, ID DESC LIMIT 1))`;
const cicloEffOpen = `CASE WHEN {{cicloId}} > 0 THEN {{cicloId}} ELSE ${OPEN_DEFAULT} END`;
const cicloEffAtual = `CASE WHEN {{cicloId}} > 0 THEN {{cicloId}} ELSE ${ATUAL_DEFAULT} END`;

// ── 129 hotFolhaBase (cicloId: 0 = ciclo aberto default) ──
const CODE_FOLHA = `SELECT
  ${blkJ('COLABORADORES',`SELECT JSON_ARRAYAGG(JSON_OBJECT(${jo('COLABORADOR','c')},'CR_CODIGO',cr.CODIGO,'CR_NOME',cr.NOME,'EMPRESA_NOME',e.NOME)) FROM COLABORADOR c LEFT JOIN CENTRO_RESULTADO cr ON cr.ID = c.CR_ID LEFT JOIN EMPRESA e ON e.ID = c.EMPRESA_ID`)},
  ${CRS}, ${EMPRESAS}, ${CARGOS},
  ${blk('CICLOS','CICLO',`t.STATUS != 'FECHADO'`)},
  ${blk('BENEFICIOS','BENEFICIO',`t.CICLO_ID = ${cicloEffOpen}`)},
  ${blk('ENCARGOS','ENCARGO',`t.CICLO_ID = ${cicloEffOpen}`)},
  ${blkJ('DISSIDIOS',`SELECT JSON_ARRAYAGG(JSON_OBJECT(${jo('PREMISSA_DISSIDIO','pd')},'EMPRESA_NOME',e.NOME)) FROM PREMISSA_DISSIDIO pd JOIN EMPRESA e ON e.ID = pd.EMPRESA_ID`)},
  ${blkJ('TURNOVERS',`SELECT JSON_ARRAYAGG(JSON_OBJECT(${jo('PREMISSA_TURNOVER','pt')},'EMPRESA_NOME',e.NOME)) FROM PREMISSA_TURNOVER pt JOIN EMPRESA e ON e.ID = pt.EMPRESA_ID`)}`;

// ── 130 hotGestoresBase (sem params) ──
const CODE_GESTORES = `SELECT
  ${CRS},
  ${blkJ('GESTOR_CRS',`SELECT JSON_ARRAYAGG(JSON_OBJECT(${jo('GESTOR_CR','gc')},'CODIGO',cr.CODIGO,'CR_NOME',cr.NOME)) FROM GESTOR_CR gc JOIN CENTRO_RESULTADO cr ON cr.ID = gc.CR_ID`)},
  ${blkJ('GESTOR_PACOTES',`SELECT JSON_ARRAYAGG(JSON_OBJECT('GESTOR_ID',gp.GESTOR_ID,'ID',gp.ID,'DRIVER_NOME',d.NOME,'DRIVER_ID',d.ID)) FROM GESTOR_PACOTE gp JOIN DRIVERS d ON d.ID = gp.DRIVER_ID AND d.ATIVO = 'true' AND d.TIPO_DRIVER = 'PACOTE'`)},
  ${blkJ('PACOTES',`SELECT JSON_ARRAYAGG(JSON_OBJECT('ID',d.ID,'NOME',d.NOME)) FROM DRIVERS d WHERE d.ATIVO = 'true' AND d.TIPO_DRIVER = 'PACOTE'`)}`;

// ── 131 hotRegrasBase (sem params) ──
const CODE_REGRAS = `SELECT
  ${CRS}, ${CONTAS_FULL},
  ${blk('CR_CONTAS','CR_CONTA','t.ATIVO = true')},
  ${blkJ('GESTORES_CR',`SELECT JSON_ARRAYAGG(JSON_OBJECT('CR_ID',x.CR_ID,'GESTORES',x.GESTORES)) FROM (SELECT gc.CR_ID, GROUP_CONCAT(g.NOME ORDER BY g.NOME SEPARATOR ', ') AS GESTORES FROM GESTOR_CR gc JOIN GESTOR g ON g.ID = gc.GESTOR_ID WHERE g.ATIVO = 'true' GROUP BY gc.CR_ID) x`)},
  ${DRIVERS_ATIVOS}, ${CONTA_DRIVERS}, ${EXCECOES}`;

// ── 132 hotModelagemBase (sem params) ──
const CODE_MODELAGEM = `SELECT
  ${DRIVERS_ATIVOS}, ${CONTAS_FULL}, ${CRS}, ${CONTA_DRIVERS}, ${EXCECOES},
  ${blkJ('DRIVER_CONFIGS',`SELECT JSON_ARRAYAGG(JSON_OBJECT('DRIVER_ID',x.DRIVER_ID,'QTD',x.QTD)) FROM (SELECT DRIVER_ID, COUNT(*) AS QTD FROM DRIVER_FORMULA WHERE TIPO = 'FORMULA' AND FORMULA IS NOT NULL AND FORMULA <> '' GROUP BY DRIVER_ID) x`)},
  ${blkJ('CR_CONTA',`SELECT JSON_ARRAYAGG(JSON_OBJECT('ID',cc.ID,'CR_ID',cc.CR_ID,'CONTA_ID',cc.CONTA_ID)) FROM CR_CONTA cc WHERE cc.ATIVO = true`)}`;

// ── 133 hotFormulasModeloBase (driverId) ──
const CODE_FORMULAS = `SELECT
  ${blk('DRIVER','DRIVERS','t.ID = {{driverId}}')},
  ${blkJ('CONTAS',`SELECT JSON_ARRAYAGG(JSON_OBJECT('ID',c.ID,'CODIGO',c.CODIGO,'NOME',c.NOME)) FROM CONTA_CONTABIL c`)},
  ${blk('LINHAS','DRIVER_FORMULA','t.DRIVER_ID = {{driverId}}')},
  ${blkJ('VINCULOS',`SELECT JSON_ARRAYAGG(JSON_OBJECT('CONTA_ID',cd.CONTA_ID)) FROM CONTA_DRIVER cd WHERE cd.DRIVER_ID = {{driverId}}`)}`;

// ── 134 hotColabRefs (sem params) ──
const CODE_COLAB = `SELECT ${CRS}, ${EMPRESAS}, ${CARGOS}`;

// ── 135 hotBeneficiosBase (cicloId: 0 = VERSAO_ATUAL, senao mais recente) ──
const CODE_BENEFICIOS = `SELECT
  ${blk('CICLOS','CICLO','1=1')},
  ${blk('BENEFICIOS','BENEFICIO',`t.CICLO_ID = ${cicloEffAtual}`)},
  ${blk('ENCARGOS','ENCARGO',`t.CICLO_ID = ${cicloEffAtual}`)}`;

// ── 136 hotPessoalBase (cicloId: 0 = ciclo aberto default) ──
const CODE_PESSOAL = `SELECT
  ${blk('CICLOS','CICLO',`t.STATUS != 'FECHADO'`)},
  ${CRS},
  ${blk('BENEFICIOS','BENEFICIO',`t.CICLO_ID = ${cicloEffOpen}`)},
  ${blk('ENCARGOS','ENCARGO',`t.CICLO_ID = ${cicloEffOpen}`)}`;

// ── 137 hotResultadoBase (sem params) ──
const CODE_RESULTADO = `SELECT
  ${CRS},
  ${blkJ('ANOS',`SELECT JSON_ARRAYAGG(JSON_OBJECT('ANO',x.ANO)) FROM (SELECT DISTINCT ANO FROM REALIZADO_CONTABIL) x`)},
  ${blk('DRE_CONFIG','DRE_CONFIG','1=1')},
  ${blkJ('CONTAS',`SELECT JSON_ARRAYAGG(JSON_OBJECT('ID',c.ID,'CODIGO',c.CODIGO,'NOME',c.NOME,'TIPO',c.TIPO)) FROM CONTA_CONTABIL c`)}`;

// ── 138 hotOrcamentoStatus (crId, gestorId; 0 = sem status/modelos) ──
// Junta gestores+CRs do mount com o loadStatus (ciclo aberto + status + contagem de
// modelos do CR, mesma query da SF 77) — eram 2 useQuery + 2 querySQL + 1 execSF.
const CODE_ORC_STATUS = `SELECT
  ${blk('GESTORES','GESTOR',`t.ATIVO = 'true'`)},
  ${CRS},
  ${blk('CICLO_ABERTO','CICLO',`t.ID = ${OPEN_DEFAULT}`)},
  ${blk('STATUS','ORCAMENTO_STATUS',`t.CICLO_ID = ${OPEN_DEFAULT} AND t.CR_ID = {{crId}} AND t.GESTOR_ID = {{gestorId}}`)},
  ${blkJ('MODELOS',`SELECT JSON_ARRAYAGG(JSON_OBJECT('CR_ID',x.CR_ID,'TOTAL',x.TOTAL)) FROM (SELECT crc.CR_ID, COUNT(DISTINCT d.NOME) AS TOTAL FROM CR_CONTA crc LEFT JOIN CONTA_DRIVER_EXCECAO cde ON cde.CR_ID = crc.CR_ID AND cde.CONTA_ID = crc.CONTA_ID AND cde.ATIVO = true LEFT JOIN CONTA_DRIVER cd ON cd.CONTA_ID = crc.CONTA_ID LEFT JOIN DRIVERS d ON d.ID = COALESCE(cde.PACOTE_ID, cd.PACOTE_ID, cde.DRIVER_ID, cd.DRIVER_ID) WHERE crc.CR_ID = {{crId}} AND crc.ATIVO = true AND d.ID IS NOT NULL AND d.ATIVO = 'true' AND d.TIPO_DRIVER = 'NORMAL' GROUP BY crc.CR_ID) x`)}`;

const defs = [
  { name: 'hotFolhaBase', code: CODE_FOLHA, description: 'Mount da Folha em 1 ida (COLABORADORES,CRS,EMPRESAS,CARGOS,CICLOS,BENEFICIOS,ENCARGOS,DISSIDIOS,TURNOVERS). Param: cicloId (0 = ciclo aberto default).' },
  { name: 'hotGestoresBase', code: CODE_GESTORES, description: 'Mount de Gestores em 1 ida (CRS,GESTOR_CRS,GESTOR_PACOTES,PACOTES). Sem params.' },
  { name: 'hotRegrasBase', code: CODE_REGRAS, description: 'Mount de Regras Contabeis em 1 ida (CRS,CONTAS,CR_CONTAS,GESTORES_CR,DRIVERS,CONTA_DRIVERS,EXCECOES). Sem params.' },
  { name: 'hotModelagemBase', code: CODE_MODELAGEM, description: 'Mount de Modelagem em 1 ida (DRIVERS,CONTAS,CRS,CONTA_DRIVERS,EXCECOES,DRIVER_CONFIGS,CR_CONTA). Sem params.' },
  { name: 'hotFormulasModeloBase', code: CODE_FORMULAS, description: 'Mount de Formulas do Modelo em 1 ida (DRIVER,CONTAS,LINHAS,VINCULOS). Param: driverId.' },
  { name: 'hotColabRefs', code: CODE_COLAB, description: 'Refs de Colaboradores em 1 ida (CRS,EMPRESAS,CARGOS). Sem params.' },
  { name: 'hotBeneficiosBase', code: CODE_BENEFICIOS, description: 'Mount de Beneficios em 1 ida (CICLOS,BENEFICIOS,ENCARGOS). Param: cicloId (0 = VERSAO_ATUAL ou mais recente).' },
  { name: 'hotPessoalBase', code: CODE_PESSOAL, description: 'Mount de Pessoal em 1 ida (CICLOS,CRS,BENEFICIOS,ENCARGOS). Param: cicloId (0 = ciclo aberto default).' },
  { name: 'hotResultadoBase', code: CODE_RESULTADO, description: 'Mount de Resultado Contabil em 1 ida (CRS,ANOS,DRE_CONFIG,CONTAS). Sem params.' },
  { name: 'hotOrcamentoStatus', code: CODE_ORC_STATUS, description: 'Mount+loadStatus da tela Orcamento em 1 ida (GESTORES,CRS,CICLO_ABERTO,STATUS,MODELOS). Params: crId,gestorId (0 = sem status).' },
];

for (const d of defs) {
  const r = await createServerFunctionMitra({ projectId, name: d.name, type: 'SQL', code: d.code, description: d.description });
  console.log(`${d.name} -> ID ${r?.result?.serverFunctionId ?? JSON.stringify(r?.result)}`);
}
console.log('done');
