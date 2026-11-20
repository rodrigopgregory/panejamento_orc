// SOMENTE LEITURA — nao altera nada.
//
// Responde "que contas sao essas": lista o plano de contas de pessoal (5.1),
// mostra em quais CRs cada uma esta vinculada ao driver PESSOAL e aponta,
// por CR, exatamente qual codigo esta faltando para a folha cair no orcamento.
//
// Uso: node listar-contas-pessoal.mjs
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

async function main() {
  const [ciclo] = await q("SELECT ID, NOME, ANO FROM CICLO WHERE VERSAO_ATUAL = 'true' ORDER BY ID DESC LIMIT 1");
  console.log(`Ciclo vigente: ${ciclo.ID} — ${ciclo.NOME} (${ciclo.ANO})\n`);

  const contas = await q(`
    SELECT ID, CODIGO, NOME, TIPO, ATIVO FROM CONTA_CONTABIL
    WHERE CODIGO LIKE '5.1%' ORDER BY CODIGO`);

  console.log('== Plano de contas de pessoal (prefixo 5.1) ==');
  for (const c of contas) {
    const alvo = BLOCOS.find((b) => b.codigo === c.CODIGO);
    console.log(`  ${c.CODIGO.padEnd(12)} id=${String(c.ID).padEnd(4)} ${String(c.NOME).padEnd(38)} ativo=${c.ATIVO}${alvo ? `   <== destino do bloco ${alvo.rotulo}` : ''}`);
  }

  const crs = await q('SELECT ID, CODIGO, NOME FROM CENTRO_RESULTADO ORDER BY CODIGO');
  const cr = (id) => crs.find((x) => Number(x.ID) === Number(id));

  // Vinculo vivo conta x driver, por CR (mesmo COALESCE da SF 61 que grava a folha).
  const vinculos = await q(`
    SELECT rc.CR_ID, cc.CODIGO, cc.NOME, d.NOME AS DRIVER
    FROM CR_CONTA rc
    JOIN CONTA_CONTABIL cc ON cc.ID = rc.CONTA_ID
    LEFT JOIN CONTA_DRIVER_EXCECAO cde ON cde.CR_ID = rc.CR_ID AND cde.CONTA_ID = rc.CONTA_ID AND cde.ATIVO = true
    LEFT JOIN CONTA_DRIVER cd ON cd.CONTA_ID = rc.CONTA_ID
    LEFT JOIN DRIVERS d ON d.ID = COALESCE(cde.DRIVER_ID, cd.DRIVER_ID)
    WHERE rc.ATIVO = true AND cc.CODIGO LIKE '5.1%'`);

  const projecao = await q(`
    SELECT CR_ID, SUM(COALESCE(SALARIO,0)) AS SALARIO, SUM(COALESCE(ENCARGOS,0)) AS ENCARGOS,
           SUM(COALESCE(BENEFICIOS,0)) AS BENEFICIOS
    FROM ORCAMENTO_PESSOAL WHERE CICLO_ID = ${ciclo.ID} GROUP BY CR_ID`);

  console.log('\n== Por CR com folha projetada: situacao de cada conta-destino ==');
  for (const p of projecao) {
    const c = cr(p.CR_ID);
    console.log(`\n${c ? `${c.CODIGO} — ${c.NOME}` : `CR ${p.CR_ID}`}:`);
    for (const b of BLOCOS) {
      const projetado = Number(p[b.campo]) || 0;
      if (projetado <= 0) continue;
      const v = vinculos.find((x) => Number(x.CR_ID) === Number(p.CR_ID) && x.CODIGO === b.codigo);
      if (!v) {
        console.log(`  ${b.codigo.padEnd(12)} ${b.rotulo.padEnd(11)} AUSENTE na matriz do CR — projetado ${brl(projetado)} sera descartado`);
      } else if (v.DRIVER !== 'PESSOAL') {
        console.log(`  ${b.codigo.padEnd(12)} ${b.rotulo.padEnd(11)} presente, mas com driver "${v.DRIVER || '(nenhum)'}" — precisa ser PESSOAL`);
      } else {
        console.log(`  ${b.codigo.padEnd(12)} ${b.rotulo.padEnd(11)} OK (driver PESSOAL)`);
      }
    }
    // Outras contas 5.1 que esse CR tem marcadas como PESSOAL (nao sao destino de folha).
    const extras = vinculos.filter(
      (x) => Number(x.CR_ID) === Number(p.CR_ID) && x.DRIVER === 'PESSOAL' && !BLOCOS.some((b) => b.codigo === x.CODIGO)
    );
    for (const e of extras) console.log(`  ${e.CODIGO.padEnd(12)} ${'(extra)'.padEnd(11)} vinculada a PESSOAL, mas a folha nao grava nela — ${e.NOME}`);
  }

  console.log('\n== Todas as contas 5.1 marcadas como PESSOAL, por CR ==');
  for (const c of crs) {
    const vs = vinculos.filter((x) => Number(x.CR_ID) === Number(c.ID) && x.DRIVER === 'PESSOAL');
    if (!vs.length) continue;
    console.log(`  ${c.CODIGO}: ${vs.map((v) => v.CODIGO).sort().join(', ')}`);
  }
}

main().catch((e) => { console.error('ERRO:', e?.message || e); process.exit(1); });
