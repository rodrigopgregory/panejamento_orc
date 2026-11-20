// AUDITORIA SOMENTE-LEITURA — nao altera nada.
//
// Confere, para o ciclo vigente, se a folha projetada em ORCAMENTO_PESSOAL
// chegou inteira ao ORCAMENTO (e, por consequencia, ao DRE).
//
// Duas formas de o valor se perder ou dobrar, ambas silenciosas:
//
//  1. BLOCO SEM DESTINO — a gravacao da folha (SF 61) e um INSERT..SELECT cujo
//     destino sai de CR_CONTA x driver PESSOAL. Se a conta de um bloco
//     (salario 5.1.01.01, encargos 5.1.02, beneficios 5.1.03) nao estiver
//     vinculada naquele CR, o bloco grava ZERO linhas sem erro. A Projecao
//     Mensal continua certa (le ORCAMENTO_PESSOAL) e so o orcamento perde.
//
//  2. CONTA LEGADA COM SALDO — 5.1.01/5.1.02/5.1.03 foram substituidas pelas
//     analiticas (5.1.01.01, 5.1.02.01/02, 5.1.03.01/02). A SF 60 ja limpa as
//     legadas, mas so do CR que esta sendo recalculado. Um CR que nao roda a
//     folha desde esse ajuste fica com o valor antigo parado la — e o DRE, que
//     agrega por prefixo '5.1', soma o antigo junto com o novo.
//
// Uso: node check-pessoal-orcamento-dre.mjs
import 'dotenv/config';
import { configureSdkMitra, executeServerFunctionMitra } from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});

const projectId = parseInt(process.env.MITRA_PROJECT_ID);
const SF_CONSULTA_SEGURA = 76;

async function q(sql) {
  const r = await executeServerFunctionMitra({ projectId, serverFunctionId: SF_CONSULTA_SEGURA, input: { sql } });
  if (r?.result?.executionStatus === 'FAILED') throw new Error(r.result.error || 'consulta falhou');
  let o = r?.result?.output;
  if (typeof o === 'string') try { o = JSON.parse(o); } catch { /* deixa como veio */ }
  return o?.rows || o?.result?.rows || (Array.isArray(o) ? o : []);
}

const brl = (n) => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const BLOCOS = [
  { rotulo: 'Salário', campo: 'SALARIO', codigo: '5.1.01.01' },
  { rotulo: 'Encargos', campo: 'ENCARGOS', codigo: '5.1.02' },
  { rotulo: 'Benefícios', campo: 'BENEFICIOS', codigo: '5.1.03' },
];
const LEGADAS = ['5.1.01', '5.1.02', '5.1.03'];

async function main() {
  const [ciclo] = await q("SELECT ID, NOME, ANO FROM CICLO WHERE VERSAO_ATUAL = 'true' ORDER BY ID DESC LIMIT 1");
  if (!ciclo) { console.log('Nenhum ciclo vigente.'); return; }
  console.log(`Ciclo vigente: ${ciclo.ID} — ${ciclo.NOME} (${ciclo.ANO})\n`);

  const crs = await q('SELECT ID, CODIGO, NOME FROM CENTRO_RESULTADO ORDER BY ID');
  const nomeCr = (id) => { const c = crs.find((x) => Number(x.ID) === Number(id)); return c ? `${c.CODIGO}` : `CR ${id}`; };

  const projecao = await q(`
    SELECT CR_ID, SUM(COALESCE(SALARIO,0)) AS SALARIO, SUM(COALESCE(ENCARGOS,0)) AS ENCARGOS,
           SUM(COALESCE(BENEFICIOS,0)) AS BENEFICIOS
    FROM ORCAMENTO_PESSOAL WHERE CICLO_ID = ${ciclo.ID} GROUP BY CR_ID ORDER BY CR_ID`);

  const lancado = await q(`
    SELECT o.CR_ID, c.CODIGO, SUM(o.VALOR) AS VALOR
    FROM ORCAMENTO o JOIN CONTA_CONTABIL c ON c.ID = o.CONTA_ID
    WHERE o.CICLO_ID = ${ciclo.ID} AND c.CODIGO LIKE '5.1%'
    GROUP BY o.CR_ID, c.CODIGO`);
  const valorDe = (crId, codigo) => {
    const l = lancado.find((x) => Number(x.CR_ID) === Number(crId) && x.CODIGO === codigo);
    return l ? Number(l.VALOR) : null;
  };

  // Vinculo vivo conta x driver PESSOAL, por CR (mesmo COALESCE da SF 61).
  const vinculo = await q(`
    SELECT rc.CR_ID, cc.CODIGO
    FROM CR_CONTA rc
    JOIN CONTA_CONTABIL cc ON cc.ID = rc.CONTA_ID
    LEFT JOIN CONTA_DRIVER_EXCECAO cde ON cde.CR_ID = rc.CR_ID AND cde.CONTA_ID = rc.CONTA_ID AND cde.ATIVO = true
    LEFT JOIN CONTA_DRIVER cd ON cd.CONTA_ID = rc.CONTA_ID
    LEFT JOIN DRIVERS d ON d.ID = COALESCE(cde.DRIVER_ID, cd.DRIVER_ID)
    WHERE rc.ATIVO = true AND d.NOME = 'PESSOAL'`);
  const temVinculo = (crId, codigo) =>
    vinculo.some((v) => Number(v.CR_ID) === Number(crId) && v.CODIGO === codigo);

  let problemas = 0;

  console.log('== Projetado x lancado, bloco a bloco ==');
  for (const p of projecao) {
    console.log(`\n${nomeCr(p.CR_ID)}:`);
    for (const b of BLOCOS) {
      const projetado = Number(p[b.campo]) || 0;
      const posto = valorDe(p.CR_ID, b.codigo);
      const vinculado = temVinculo(p.CR_ID, b.codigo);
      if (projetado <= 0) { console.log(`  ${b.rotulo}: sem projecao`); continue; }
      if (!vinculado) {
        problemas++;
        console.log(`  ${b.rotulo}: FALHA — projetado ${brl(projetado)}, conta ${b.codigo} NAO vinculada ao driver PESSOAL neste CR (valor descartado)`);
      } else if (posto == null) {
        problemas++;
        console.log(`  ${b.rotulo}: FALHA — projetado ${brl(projetado)}, nada lancado em ${b.codigo}`);
      } else if (Math.abs(posto - projetado) > 0.05) {
        problemas++;
        console.log(`  ${b.rotulo}: DEFASADO — projetado ${brl(projetado)}, lancado ${brl(posto)} (dif ${brl(posto - projetado)}); rode Calcular Folha`);
      } else {
        console.log(`  ${b.rotulo}: ok (${brl(projetado)})`);
      }
    }
  }

  console.log('\n== Saldo parado em conta legada (dobra no DRE, que agrega por prefixo 5.1) ==');
  const legado = lancado.filter((l) => LEGADAS.includes(l.CODIGO) && l.CODIGO === '5.1.01');
  if (!legado.length) console.log('  nenhum');
  for (const l of legado) {
    problemas++;
    console.log(`  ${nomeCr(l.CR_ID)} | ${l.CODIGO} = ${brl(l.VALOR)} (substituida por 5.1.01.01)`);
  }

  console.log(`\n${problemas === 0 ? 'Nada a corrigir.' : `${problemas} ponto(s) de atencao.`}`);
}

main().catch((e) => { console.error('ERRO:', e?.message || e); process.exit(1); });
