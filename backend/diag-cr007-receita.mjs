// SOMENTE LEITURA — confere a cadeia do imposto de receita de um CR.
//
// Responde "o numero da tela bate com o numero gravado?": monta o que a grade
// calcula (soma das receitas x aliquota da premissa) e poe lado a lado com o que
// esta em ORCAMENTO, que e o que o DRE le. Divergencia aqui significa modelo
// confirmado ANTES da ultima mudanca — a materializacao so acontece no confirmar.
//
//   node diag-cr007-receita.mjs [CR_CODIGO] [CICLO_ID]
import 'dotenv/config';
import { configureSdkMitra, runQueryMitra } from 'mitra-sdk';
configureSdkMitra({ baseURL: process.env.MITRA_BASE_URL, token: process.env.MITRA_TOKEN, integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS });
const projectId = parseInt(process.env.MITRA_PROJECT_ID);
const q = async (sql) => (await runQueryMitra({ projectId, sql })).result?.rows || [];

const CR = process.argv[2] || 'CR007';
const ciclo = Number(process.argv[3] || 0)
  || Number((await q(`SELECT ID FROM CICLO WHERE STATUS <> 'FECHADO' ORDER BY ID DESC LIMIT 1`))[0]?.ID);

const [info] = await q(`SELECT ID, NOME, ULTIMO_MES_REALIZADO FROM CICLO WHERE ID = ${ciclo}`);
const [cr] = await q(`SELECT ID, NOME FROM CENTRO_RESULTADO WHERE CODIGO = '${CR}'`);
console.log(`${CR} (${cr?.NOME}) — ciclo ${ciclo} "${info?.NOME}", fechado ate o mes ${info?.ULTIMO_MES_REALIZADO}`);

const [status] = await q(`SELECT STATUS, DRIVERS_CONFIRMADOS FROM ORCAMENTO_STATUS WHERE CICLO_ID = ${ciclo} AND CR_ID = ${cr.ID}`);
console.log(`status: ${status?.STATUS} | modelos confirmados: ${status?.DRIVERS_CONFIRMADOS || '(nenhum)'}`);
if (status?.STATUS === 'SUBMETIDO' || status?.STATUS === 'APROVADO') {
  console.log('>> a tela abre em modo leitura neste status: nao da pra digitar nem reconfirmar.');
}

console.log('\n--- linhas do modelo RECEITA, na ordem em que aparecem na grade ---');
console.table(await q(`SELECT df.ORDEM, df.CODIGO, df.TIPO, COALESCE(df.NOME_CUSTOM, cc.CODIGO) AS ROTULO,
  cc.NOME AS CONTA, df.PREMISSA_NOME, df.FORMULA,
  CASE WHEN df.CONTA_ID IS NULL OR EXISTS (SELECT 1 FROM CR_CONTA rc WHERE rc.CR_ID = ${cr.ID} AND rc.CONTA_ID = df.CONTA_ID)
       THEN 'sim' ELSE 'NAO (conta fora do CR)' END AS APARECE
  FROM DRIVER_FORMULA df
  LEFT JOIN CONTA_CONTABIL cc ON cc.ID = df.CONTA_ID
  JOIN DRIVERS d ON d.ID = df.DRIVER_ID
  WHERE d.NOME = 'RECEITA' AND df.ESCONDER = false ORDER BY df.ORDEM`));

const orc = await q(`SELECT cc.CODIGO, o.MES, o.VALOR FROM ORCAMENTO o
  JOIN CONTA_CONTABIL cc ON cc.ID = o.CONTA_ID
  WHERE o.CR_ID = ${cr.ID} AND o.CICLO_ID = ${ciclo} AND cc.CODIGO LIKE '3.%'`);
const valor = (codigo, mes) => Number(orc.find(r => r.CODIGO === codigo && Number(r.MES) === mes)?.VALOR || 0);

const prem = await q(`SELECT pl.NOME, pv.MES, pv.VALOR FROM PREMISSA_LINHA pl
  JOIN PREMISSA_VALOR pv ON pv.LINHA_ID = pl.ID WHERE pl.CICLO_ID = ${ciclo}`);
const pct = (nome, mes) => Number(prem.find(r => r.NOME === nome && Number(r.MES) === mes)?.VALOR || 0);

// As duas contas de imposto do modelo, com a premissa que cada uma consome.
const IMPOSTOS = [
  { conta: '3.2.01', premissa: 'Alíquota ISS sobre Serviços' },
  { conta: '3.2.02', premissa: 'Alíquota PIS/COFINS' },
];
const BASES = ['3.1.02', '3.1.01', '3.1.04'];

for (const imp of IMPOSTOS) {
  console.log(`\n--- ${imp.conta}: (${BASES.join(' + ')}) x ${imp.premissa} ---`);
  console.table(Array.from({ length: 12 }, (_, i) => i + 1).map((mes) => {
    const base = BASES.reduce((s, c) => s + valor(c, mes), 0);
    const aliquota = pct(imp.premissa, mes);
    const naTela = Math.round(base * aliquota / 100);
    const gravado = Math.round(valor(imp.conta, mes));
    return {
      MES: mes, FECHADO: mes <= Number(info?.ULTIMO_MES_REALIZADO) ? 'sim' : '',
      BASE: base, 'ALIQ %': aliquota, 'NA TELA': naTela, 'EM ORCAMENTO': gravado,
      OK: naTela === gravado ? 'ok' : 'DIVERGE',
    };
  }));
}
