// AJUSTE DE DADOS — ciclo vigente (INICIADA) apenas.
//
// Duas correcoes, nesta ordem:
//
//  1. VINCULO FALTANDO NO CR005 — a matriz de contas do CR005 nao tem
//     5.1.01.01 (Salario) nem 5.1.03 (Beneficios). A gravacao da folha (SF 61)
//     e um INSERT..SELECT cujo destino sai de CR_CONTA x driver PESSOAL: sem a
//     linha na matriz, o bloco grava zero linhas sem erro. O driver global ja
//     aponta as duas contas para PESSOAL (CONTA_DRIVER), entao basta a linha
//     em CR_CONTA.
//
//  2. REGRAVAR A FOLHA NO ORCAMENTO — roda SF 60 (limpa) + SF 61 (grava) para
//     cada CR com projecao no ciclo. Nao recalcula salario: ORCAMENTO_PESSOAL
//     nao e tocado, so e reagregado para o ORCAMENTO. E o mesmo par de SFs que
//     o botao "Calcular Folha" dispara, e por isso tambem limpa o saldo parado
//     nas contas legadas 5.1.01/5.1.02/5.1.03 do CR (SF 60), que hoje o DRE
//     soma em cima das analiticas por agregar pelo prefixo 5.1.
//
// Idempotente: rodar duas vezes leva ao mesmo estado.
// Uso: node fix-cr005-vinculo-pessoal.mjs
import 'dotenv/config';
import { configureSdkMitra, runQueryMitra, createRecordsBatchMitra, executeServerFunctionMitra } from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});

const projectId = parseInt(process.env.MITRA_PROJECT_ID);
const SF_LIMPAR_ORCAMENTO = 60;
const SF_GRAVAR_ORCAMENTO = 61;

const q = async (sql) => (await runQueryMitra({ projectId, sql })).result?.rows || [];
const brl = (n) => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function execSF(serverFunctionId, input) {
  const r = await executeServerFunctionMitra({ projectId, serverFunctionId, input });
  if (r?.result?.executionStatus === 'FAILED') throw new Error(`SF ${serverFunctionId}: ${r.result.error}`);
  return r;
}

// Foto das contas de pessoal do ciclo, para comparar antes x depois.
async function foto(cicloId) {
  const rows = await q(`
    SELECT cr.CODIGO AS CR, cc.CODIGO AS CONTA, ROUND(SUM(o.VALOR), 2) AS VALOR
    FROM ORCAMENTO o
    JOIN CONTA_CONTABIL cc ON cc.ID = o.CONTA_ID
    JOIN CENTRO_RESULTADO cr ON cr.ID = o.CR_ID
    WHERE o.CICLO_ID = ${cicloId} AND cc.CODIGO LIKE '5.1%'
    GROUP BY cr.CODIGO, cc.CODIGO`);
  return new Map(rows.map((r) => [`${r.CR}|${r.CONTA}`, Number(r.VALOR)]));
}

async function main() {
  const [ciclo] = await q("SELECT ID, NOME, ANO, STATUS FROM CICLO WHERE VERSAO_ATUAL = 'true' ORDER BY ID DESC LIMIT 1");
  if (!ciclo) throw new Error('nenhum ciclo vigente');
  if (ciclo.STATUS === 'FECHADO') throw new Error(`ciclo ${ciclo.ID} esta FECHADO — nao se mexe em versao fechada`);
  console.log(`Ciclo vigente: ${ciclo.ID} — ${ciclo.NOME} (${ciclo.STATUS})\n`);

  const antes = await foto(ciclo.ID);

  // ── 1. Vinculo faltando no CR005 ───────────────────────────────────────
  const CR005 = 5;
  const FALTANTES = [
    { contaId: 28, codigo: '5.1.01.01', rotulo: 'Salário' },
    { contaId: 12, codigo: '5.1.03', rotulo: 'Benefícios' },
  ];

  console.log('== 1. Matriz de contas do CR005 ==');
  const jaTem = await q(
    `SELECT CONTA_ID, ATIVO FROM CR_CONTA WHERE CR_ID = ${CR005} AND CONTA_ID IN (${FALTANTES.map((f) => f.contaId).join(',')})`);
  const novos = [];
  for (const f of FALTANTES) {
    const existente = jaTem.find((r) => Number(r.CONTA_ID) === f.contaId);
    if (!existente) novos.push({ CR_ID: CR005, CONTA_ID: f.contaId, ATIVO: true, CRIADO_EM: new Date().toISOString().slice(0, 19) });
    else console.log(`  ${f.codigo} ja existe (ativo=${existente.ATIVO}) — nada a fazer`);
  }
  if (novos.length) {
    await createRecordsBatchMitra({ projectId, tableName: 'CR_CONTA', records: novos });
    for (const f of FALTANTES.filter((f) => novos.some((n) => n.CONTA_ID === f.contaId))) {
      console.log(`  ${f.codigo} (${f.rotulo}) vinculada ao CR005`);
    }
  }

  // Confere que o vinculo resolve para PESSOAL pelo mesmo COALESCE da SF 61.
  const conferido = await q(`
    SELECT cc.CODIGO FROM CR_CONTA rc
    JOIN CONTA_CONTABIL cc ON cc.ID = rc.CONTA_ID
    LEFT JOIN CONTA_DRIVER_EXCECAO cde ON cde.CR_ID = rc.CR_ID AND cde.CONTA_ID = rc.CONTA_ID AND cde.ATIVO = true
    LEFT JOIN CONTA_DRIVER cd ON cd.CONTA_ID = rc.CONTA_ID
    LEFT JOIN DRIVERS d ON d.ID = COALESCE(cde.DRIVER_ID, cd.DRIVER_ID)
    WHERE rc.CR_ID = ${CR005} AND rc.ATIVO = true AND d.NOME = 'PESSOAL'
      AND cc.CODIGO IN ('5.1.01.01','5.1.02','5.1.03')`);
  const resolvidas = conferido.map((r) => r.CODIGO).sort();
  console.log(`  destinos de folha ativos no CR005: ${resolvidas.join(', ')}`);
  if (resolvidas.length !== 3) throw new Error('CR005 ainda nao resolve os 3 destinos — abortado antes de regravar');

  // ── 2. Regravar a folha no orcamento ───────────────────────────────────
  const crs = await q(`
    SELECT DISTINCT op.CR_ID, cr.CODIGO FROM ORCAMENTO_PESSOAL op
    JOIN CENTRO_RESULTADO cr ON cr.ID = op.CR_ID
    WHERE op.CICLO_ID = ${ciclo.ID} ORDER BY cr.CODIGO`);

  console.log('\n== 2. Regravando a folha no orcamento (SF 60 + 61) ==');
  for (const c of crs) {
    await execSF(SF_LIMPAR_ORCAMENTO, { cicloId: ciclo.ID, crId: c.CR_ID });
    await execSF(SF_GRAVAR_ORCAMENTO, { cicloId: ciclo.ID, crId: c.CR_ID });
    console.log(`  ${c.CODIGO} regravado`);
  }

  // ── Antes x depois ─────────────────────────────────────────────────────
  const depois = await foto(ciclo.ID);
  console.log('\n== Antes x depois (contas 5.1 do ciclo) ==');
  const chaves = [...new Set([...antes.keys(), ...depois.keys()])].sort();
  let mudou = 0;
  for (const k of chaves) {
    const a = antes.get(k) ?? 0;
    const d = depois.get(k) ?? 0;
    if (Math.abs(a - d) < 0.005) continue;
    mudou++;
    const [cr, conta] = k.split('|');
    console.log(`  ${cr} ${conta.padEnd(11)} ${brl(a).padStart(14)} -> ${brl(d).padStart(14)}`);
  }
  if (!mudou) console.log('  nada mudou');

  const somaAntes = [...antes.values()].reduce((s, v) => s + v, 0);
  const somaDepois = [...depois.values()].reduce((s, v) => s + v, 0);
  console.log(`\nTotal do grupo 5.1 no ciclo: ${brl(somaAntes)} -> ${brl(somaDepois)} (${brl(somaDepois - somaAntes)})`);
}

main().catch((e) => { console.error('ERRO:', e?.message || e); process.exit(1); });
