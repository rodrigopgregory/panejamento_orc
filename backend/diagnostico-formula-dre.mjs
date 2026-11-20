// DIAGNOSTICO SOMENTE-LEITURA — nao altera nada.
//
// Pergunta: uma conta cujo valor e CALCULADO por formula no modelo chega ao DRE?
//
// O DRE le ORCAMENTO (SFs 86-91, SQL puro). Ele nao conhece formula. Entao o
// valor de uma conta calculada so aparece no DRE se alguem tiver GRAVADO o
// resultado em ORCAMENTO. Este script mede quantas contas estao calculadas na
// tela e vazias no banco.
//
// Uso: node diagnostico-formula-dre.mjs
import 'dotenv/config';
import { configureSdkMitra, runQueryMitra } from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});

const projectId = parseInt(process.env.MITRA_PROJECT_ID);
const q = async (sql) => (await runQueryMitra({ projectId, sql })).result?.rows || [];
const brl = (n) => Number(n || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function main() {
  const [ciclo] = await q("SELECT ID, NOME, ANO, STATUS FROM CICLO WHERE VERSAO_ATUAL = 'true' ORDER BY ID DESC LIMIT 1");
  console.log(`Ciclo vigente: ${ciclo.ID} — ${ciclo.NOME}\n`);

  console.log('=== 1. Linhas de modelo vinculadas a conta contabil ===');
  const linhas = await q(`
    SELECT f.ID, f.DRIVER_ID, d.NOME AS DRIVER, f.CONTA_ID, c.CODIGO, c.NOME AS CONTA,
           f.TIPO, f.FORMULA, f.CODIGO AS COD_LINHA, f.NOME_CUSTOM, f.PREMISSA_NOME
    FROM DRIVER_FORMULA f
    LEFT JOIN DRIVERS d ON d.ID = f.DRIVER_ID
    LEFT JOIN CONTA_CONTABIL c ON c.ID = f.CONTA_ID
    ORDER BY d.NOME, f.ORDEM`);
  for (const l of linhas) {
    const alvo = l.CONTA_ID ? `${l.CODIGO} ${l.CONTA}` : `(linha livre ${l.COD_LINHA || l.NOME_CUSTOM || ''})`;
    console.log(`  [${l.DRIVER}] ${String(l.TIPO || 'INPUT').padEnd(8)} ${alvo}  ${l.FORMULA ? '= ' + l.FORMULA : ''}${l.PREMISSA_NOME ? ' -> premissa: ' + l.PREMISSA_NOME : ''}`);
  }

  console.log('\n=== 2. Conta calculada por formula: tem valor no ORCAMENTO? ===');
  const calc = linhas.filter((l) => String(l.TIPO).toUpperCase() === 'FORMULA' && l.CONTA_ID);
  if (calc.length === 0) console.log('  (nenhuma conta marcada TIPO=FORMULA)');
  for (const l of calc) {
    const [r] = await q(`
      SELECT COUNT(*) AS LINHAS, ROUND(COALESCE(SUM(VALOR),0), 2) AS TOTAL
      FROM ORCAMENTO WHERE CICLO_ID = ${ciclo.ID} AND CONTA_ID = ${l.CONTA_ID}`);
    const marca = Number(r.LINHAS) === 0 ? '  <-- ZERO NO DRE' : '';
    console.log(`  [${l.DRIVER}] ${l.CODIGO} ${l.CONTA}: ${r.LINHAS} linhas, ${brl(r.TOTAL)}${marca}`);
  }

  console.log('\n=== 3. Impostos: aliquota central x o que esta no ORCAMENTO ===');
  const imp = await q(`
    SELECT p.CONTA_ID, c.CODIGO, c.NOME, p.PERCENTUAL
    FROM PREMISSA_IMPOSTO p LEFT JOIN CONTA_CONTABIL c ON c.ID = p.CONTA_ID
    WHERE p.CICLO_ID = ${ciclo.ID}`);
  for (const i of imp) {
    const [r] = await q(`
      SELECT COUNT(*) AS LINHAS, ROUND(COALESCE(SUM(VALOR),0), 2) AS TOTAL
      FROM ORCAMENTO WHERE CICLO_ID = ${ciclo.ID} AND CONTA_ID = ${i.CONTA_ID}`);
    console.log(`  ${i.CODIGO} ${i.NOME}: aliquota ${i.PERCENTUAL}% | ORCAMENTO ${r.LINHAS} linhas, ${brl(r.TOTAL)}`);
  }
  const cfgImp = await q(`
    SELECT dc.CONTA_ID, c.CODIGO, COUNT(*) AS N
    FROM DRIVER_CONFIG dc LEFT JOIN CONTA_CONTABIL c ON c.ID = dc.CONTA_ID
    WHERE dc.TIPO = 'IMPOSTO' GROUP BY dc.CONTA_ID, c.CODIGO`);
  console.log(`  Contas marcadas TIPO=IMPOSTO em DRIVER_CONFIG: ${cfgImp.map((x) => `${x.CODIGO} (${x.N} CRs)`).join(', ') || '(nenhuma)'}`);

  console.log('\n=== 4. Premissas livres cadastradas ===');
  const prem = await q(`
    SELECT l.NOME, COUNT(v.ID) AS MESES, ROUND(COALESCE(MIN(v.VALOR),0),4) AS MIN_V, ROUND(COALESCE(MAX(v.VALOR),0),4) AS MAX_V
    FROM PREMISSA_LINHA l LEFT JOIN PREMISSA_VALOR v ON v.LINHA_ID = l.ID
    WHERE l.CICLO_ID = ${ciclo.ID} GROUP BY l.ID, l.NOME ORDER BY l.ORDEM`);
  if (prem.length === 0) console.log('  (nenhuma)');
  for (const p of prem) console.log(`  ${p.NOME}: ${p.MESES} meses preenchidos, faixa ${p.MIN_V} a ${p.MAX_V}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
