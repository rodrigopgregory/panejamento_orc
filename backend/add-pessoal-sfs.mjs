// Migracao aditiva: cria SFs dedicadas para o calculo de pessoal (folha),
// movendo o calculo do frontend (centenas de requisicoes) para o banco (4 requisicoes).
// Tambem adiciona 14 colaboradores ao CR002 (Diretoria de Tecnologia) para caso de teste com 20.
// Nao altera nem remove nada existente.
import 'dotenv/config';
import {
  configureSdkMitra,
  createServerFunctionMitra,
  listServerFunctionsMitra,
  executeServerFunctionMitra,
  createRecordsBatchMitra
} from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS
});

const projectId = parseInt(process.env.MITRA_PROJECT_ID);
const SF_QUERY = 18;

const MESES = Array.from({ length: 12 }, (_, i) => `SELECT ${i + 1} AS MES`).join(' UNION ALL ');

// Subquery das contas mapeadas com driver PESSOAL no CR (mesma regra da tela:
// codigos 5.1.01=salarios, 5.1.02=encargos, 5.1.03=beneficios).
// DISTINCT e obrigatorio: DRIVER_CONFIG tem linhas repetidas por conta (legado de ciclos antigos)
// e o app trata a tabela como global — sem DISTINCT o JOIN duplica e dobra os valores.
const CONTAS_PESSOAL = `SELECT DISTINCT dc.CONTA_ID, cc.CODIGO FROM DRIVER_CONFIG dc
    JOIN CONTA_CONTABIL cc ON cc.ID = dc.CONTA_ID
    WHERE dc.CR_ID = {{crId}} AND dc.DRIVER_TIPO = 'PESSOAL'
      AND cc.CODIGO IN ('5.1.01','5.1.02','5.1.03')`;

const SFS = [
  {
    name: 'pessoalListarColaboradores',
    code: `SELECT * FROM COLABORADOR WHERE CR_ID = {{crId}} AND ATIVO = 'true' ORDER BY NOME`,
    description: 'Lista colaboradores ativos de um CR (params: crId)'
  },
  {
    name: 'pessoalListarFolha',
    code: `SELECT * FROM ORCAMENTO_PESSOAL WHERE CICLO_ID = {{cicloId}} AND CR_ID = {{crId}}`,
    description: 'Lista a projecao de folha calculada de um ciclo/CR (params: cicloId, crId)'
  },
  {
    name: 'pessoalLimparFolha',
    code: `DELETE FROM ORCAMENTO_PESSOAL WHERE CICLO_ID = {{cicloId}} AND CR_ID = {{crId}}`,
    description: 'Remove a projecao de folha existente de um ciclo/CR antes do recalculo (params: cicloId, crId)'
  },
  {
    name: 'pessoalGerarFolha',
    // Calculo inteiro no banco: colaboradores x 12 meses, beneficios/encargos agregados por tipo de contrato.
    // Mesma semantica da tela: FIXO usa VALOR, demais usam SALARIO * PERCENTUAL / 100; encargos so para CLT.
    code: `INSERT INTO ORCAMENTO_PESSOAL (CICLO_ID, CR_ID, COLABORADOR_ID, MES, SALARIO, BENEFICIOS, ENCARGOS, TOTAL)
SELECT x.CICLO_ID, x.CR_ID, x.COLABORADOR_ID, x.MES, x.SALARIO, x.BEN, x.ENC, ROUND(x.SALARIO + x.BEN + x.ENC, 2)
FROM (
  SELECT {{cicloId}} AS CICLO_ID, {{crId}} AS CR_ID, c.ID AS COLABORADOR_ID, m.MES, c.SALARIO,
    ROUND(CASE WHEN c.TIPO_CONTRATO = 'CLT'
      THEN agg.BEN_CLT_FIXO + c.SALARIO * agg.BEN_CLT_PCT / 100
      ELSE agg.BEN_PJ_FIXO + c.SALARIO * agg.BEN_PJ_PCT / 100 END, 2) AS BEN,
    ROUND(CASE WHEN c.TIPO_CONTRATO = 'CLT' THEN c.SALARIO * agg.ENC_PCT / 100 ELSE 0 END, 2) AS ENC
  FROM COLABORADOR c
  CROSS JOIN (${MESES}) m
  CROSS JOIN (
    SELECT
      COALESCE((SELECT SUM(CASE WHEN TIPO = 'FIXO' THEN VALOR ELSE 0 END) FROM BENEFICIO WHERE CICLO_ID = {{cicloId}} AND APLICA_CLT = 'true'), 0) AS BEN_CLT_FIXO,
      COALESCE((SELECT SUM(CASE WHEN TIPO <> 'FIXO' THEN PERCENTUAL ELSE 0 END) FROM BENEFICIO WHERE CICLO_ID = {{cicloId}} AND APLICA_CLT = 'true'), 0) AS BEN_CLT_PCT,
      COALESCE((SELECT SUM(CASE WHEN TIPO = 'FIXO' THEN VALOR ELSE 0 END) FROM BENEFICIO WHERE CICLO_ID = {{cicloId}} AND APLICA_PJ = 'true'), 0) AS BEN_PJ_FIXO,
      COALESCE((SELECT SUM(CASE WHEN TIPO <> 'FIXO' THEN PERCENTUAL ELSE 0 END) FROM BENEFICIO WHERE CICLO_ID = {{cicloId}} AND APLICA_PJ = 'true'), 0) AS BEN_PJ_PCT,
      COALESCE((SELECT SUM(PERCENTUAL) FROM ENCARGO WHERE CICLO_ID = {{cicloId}} AND APLICA_CLT = 'true'), 0) AS ENC_PCT
  ) agg
  LEFT JOIN DESLIGAMENTO_PROJETADO dp
    ON dp.CICLO_ID = {{cicloId}} AND dp.CR_ID = {{crId}} AND dp.COLABORADOR_ID = c.ID
  WHERE c.CR_ID = {{crId}} AND c.ATIVO = 'true'
    AND m.MES < COALESCE(dp.MES_DESLIGAMENTO, 13)
) x`,
    description: 'Gera a projecao de folha, encerrando custos no mes do desligamento projetado (params: cicloId, crId)'
  },
  {
    name: 'pessoalLimparOrcamento',
    code: `DELETE FROM ORCAMENTO
WHERE CICLO_ID = {{cicloId}} AND CR_ID = {{crId}}
  AND CONTA_ID IN (
    SELECT dc.CONTA_ID FROM DRIVER_CONFIG dc
    JOIN CONTA_CONTABIL cc ON cc.ID = dc.CONTA_ID
    WHERE dc.CR_ID = {{crId}} AND dc.DRIVER_TIPO = 'PESSOAL'
      AND cc.CODIGO IN ('5.1.01','5.1.02','5.1.03')
  )`,
    description: 'Remove do ORCAMENTO as linhas das contas de pessoal do ciclo/CR antes de regravar (params: cicloId, crId)'
  },
  {
    name: 'pessoalGravarOrcamento',
    code: `INSERT INTO ORCAMENTO (CICLO_ID, CR_ID, CONTA_ID, MES, VALOR)
SELECT op.CICLO_ID, op.CR_ID, pc.CONTA_ID, op.MES,
  ROUND(SUM(CASE pc.CODIGO WHEN '5.1.01' THEN op.SALARIO WHEN '5.1.02' THEN op.ENCARGOS WHEN '5.1.03' THEN op.BENEFICIOS ELSE 0 END), 2)
FROM ORCAMENTO_PESSOAL op
JOIN (
  ${CONTAS_PESSOAL}
) pc ON 1 = 1
WHERE op.CICLO_ID = {{cicloId}} AND op.CR_ID = {{crId}}
GROUP BY op.CICLO_ID, op.CR_ID, pc.CONTA_ID, pc.CODIGO, op.MES`,
    description: 'Agrega a folha por mes e grava nas contas de pessoal do ORCAMENTO (params: cicloId, crId)'
  },
];

// 14 novos colaboradores para o CR002 (Diretoria de Tecnologia) — caso de teste com 20
const NOVOS_COLABORADORES = [
  { NOME: 'Bruno Cardoso', CARGO: 'Desenvolvedor Sr', SALARIO: 14500, TIPO_CONTRATO: 'CLT', DATA_ADMISSAO: '2022-02-01' },
  { NOME: 'Larissa Mendes', CARGO: 'Desenvolvedora Sr', SALARIO: 14000, TIPO_CONTRATO: 'CLT', DATA_ADMISSAO: '2021-09-13' },
  { NOME: 'Thiago Almeida', CARGO: 'Desenvolvedor Pl', SALARIO: 10500, TIPO_CONTRATO: 'CLT', DATA_ADMISSAO: '2023-03-06' },
  { NOME: 'Juliana Castro', CARGO: 'Desenvolvedora Pl', SALARIO: 10000, TIPO_CONTRATO: 'CLT', DATA_ADMISSAO: '2023-05-15' },
  { NOME: 'Gabriel Teixeira', CARGO: 'Desenvolvedor Jr', SALARIO: 6500, TIPO_CONTRATO: 'CLT', DATA_ADMISSAO: '2024-01-08' },
  { NOME: 'Beatriz Fonseca', CARGO: 'Desenvolvedora Jr', SALARIO: 6200, TIPO_CONTRATO: 'CLT', DATA_ADMISSAO: '2024-04-01' },
  { NOME: 'Ricardo Pires', CARGO: 'Arquiteto de Software', SALARIO: 21000, TIPO_CONTRATO: 'PJ', DATA_ADMISSAO: '2020-11-03' },
  { NOME: 'Vanessa Duarte', CARGO: 'Product Manager', SALARIO: 17000, TIPO_CONTRATO: 'CLT', DATA_ADMISSAO: '2021-06-14' },
  { NOME: 'Felipe Barros', CARGO: 'Product Designer', SALARIO: 11000, TIPO_CONTRATO: 'CLT', DATA_ADMISSAO: '2022-08-22' },
  { NOME: 'Amanda Reis', CARGO: 'QA Engineer', SALARIO: 9000, TIPO_CONTRATO: 'CLT', DATA_ADMISSAO: '2022-10-17' },
  { NOME: 'Lucas Vieira', CARGO: 'DevOps', SALARIO: 15500, TIPO_CONTRATO: 'PJ', DATA_ADMISSAO: '2021-12-01' },
  { NOME: 'Patricia Moraes', CARGO: 'Analista de Dados', SALARIO: 9500, TIPO_CONTRATO: 'CLT', DATA_ADMISSAO: '2023-02-13' },
  { NOME: 'Eduardo Santana', CARGO: 'Engenheiro de Dados', SALARIO: 13500, TIPO_CONTRATO: 'CLT', DATA_ADMISSAO: '2022-05-09' },
  { NOME: 'Renata Campos', CARGO: 'Scrum Master', SALARIO: 12000, TIPO_CONTRATO: 'CLT', DATA_ADMISSAO: '2023-07-03' },
];

const q = async (sql) => {
  const r = await executeServerFunctionMitra({ projectId, serverFunctionId: SF_QUERY, input: { sql } });
  return r.result.output.rows || [];
};

async function run() {
  // 1. Criar SFs (idempotente)
  const existing = await listServerFunctionsMitra({ projectId });
  const existingByName = new Map((existing?.result || existing || []).map((f) => [f.name, f.id]));

  for (const sf of SFS) {
    if (existingByName.has(sf.name)) {
      console.log(`= ja existe: ${sf.name} (id ${existingByName.get(sf.name)})`);
      continue;
    }
    const res = await createServerFunctionMitra({ projectId, type: 'SQL', ...sf });
    const id = res?.result?.serverFunctionId ?? res?.result?.id;
    console.log(`+ criada: ${sf.name} (id ${id})`);
  }

  const after = await listServerFunctionsMitra({ projectId });
  const byName = new Map((after?.result || after || []).map((f) => [f.name, f.id]));
  console.log('\n=== IDs para o frontend ===');
  for (const sf of SFS) console.log(`${sf.name}: ${byName.get(sf.name)}`);

  // 2. Seed: completar o CR002 (Diretoria de Tecnologia) ate 20 colaboradores (idempotente por nome)
  const crId = 2;
  const atuais = await q(`SELECT NOME FROM COLABORADOR WHERE CR_ID = ${crId}`);
  const nomes = new Set(atuais.map((c) => c.NOME));
  const faltantes = NOVOS_COLABORADORES.filter((c) => !nomes.has(c.NOME));
  if (faltantes.length > 0) {
    await createRecordsBatchMitra({
      projectId,
      tableName: 'COLABORADOR',
      records: faltantes.map((c) => ({ ...c, CR_ID: crId, EMPRESA_ID: 1, ATIVO: 'true' }))
    });
    console.log(`\n+ ${faltantes.length} colaboradores adicionados ao CR002`);
  } else {
    console.log('\n= colaboradores do CR002 ja adicionados');
  }
  const total = await q(`SELECT COUNT(*) AS N FROM COLABORADOR WHERE CR_ID = ${crId} AND ATIVO = 'true'`);
  console.log(`Total de colaboradores ativos no CR002: ${total[0].N}`);
}

run().catch((e) => { console.error(e); process.exit(1); });
