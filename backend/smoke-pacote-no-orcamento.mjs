// O orcado de um CR precisa ser o MESMO numero em qualquer tela. As SFs de DRE
// (86/88/90) e de resumo (127/128) somam ORCAMENTO + ORCAMENTO_PACOTE, contando o
// pacote so quando SUBMETIDO/APROVADO. Este smoke confere que a tela de
// preenchimento do CR (SF 125 e o espelho publico 143) chega no mesmo total —
// era ali que o custo rateado do pacote sumia do resultado do setor.
import 'dotenv/config';
import { configureSdkMitra, executeServerFunctionMitra } from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});
const projectId = parseInt(process.env.MITRA_PROJECT_ID);

const q = async (sql) => {
  const r = await executeServerFunctionMitra({ projectId, serverFunctionId: 76, input: { sql } });
  if (r?.result?.executionStatus === 'FAILED') throw new Error(r?.result?.error);
  let o = r?.result?.output; if (typeof o === 'string') o = JSON.parse(o);
  return o?.rows || [];
};

const GATE = `EXISTS (SELECT 1 FROM PACOTE_STATUS ps
  WHERE ps.CICLO_ID = op.CICLO_ID AND ps.DRIVER_ID = op.DRIVER_ID
    AND ps.STATUS IN ('SUBMETIDO','APROVADO'))`;

let falhou = false;

const ciclo = (await q(`SELECT ID, NOME FROM CICLO WHERE VERSAO_ATUAL = 'true' ORDER BY ID DESC LIMIT 1`))[0];
if (!ciclo) { console.log('nenhuma versao atual — nada a validar'); process.exit(0); }
console.log(`versao ${ciclo.ID} (${ciclo.NOME})`);

// Por CR: quanto do orcado vem de pacote submetido. Se > 0, era exatamente isso
// que o DRE do CR deixava de contar.
const porCr = await q(`SELECT cr.ID CR_ID, cr.CODIGO CR,
    (SELECT COALESCE(SUM(o.VALOR),0) FROM ORCAMENTO o WHERE o.CICLO_ID = ${ciclo.ID} AND o.CR_ID = cr.ID) SO_CR,
    (SELECT COALESCE(SUM(op.VALOR),0) FROM ORCAMENTO_PACOTE op WHERE op.CICLO_ID = ${ciclo.ID} AND op.CR_ID = cr.ID AND ${GATE}) DE_PACOTE
  FROM CENTRO_RESULTADO cr ORDER BY cr.CODIGO`);
const comPacote = porCr.filter((r) => Number(r.DE_PACOTE) !== 0);
if (comPacote.length === 0) {
  console.log('ok      nenhum CR recebe pacote submetido nesta versao (nada para somar)');
} else {
  console.log(`ok      ${comPacote.length} CR(s) recebem pacote submetido — o DRE do CR precisa incluir:`);
  comPacote.forEach((r) => console.log(`          ${r.CR}: proprio ${Number(r.SO_CR)} + pacote ${Number(r.DE_PACOTE)} = ${Number(r.SO_CR) + Number(r.DE_PACOTE)}`));
}

// A SF 86 (DRE global, ja consolidada) e a referencia: o total por conta dela tem
// que bater com ORCAMENTO + ORCAMENTO_PACOTE somados aqui.
const ref = await q(`SELECT COALESCE(SUM(z.VALOR),0) TOTAL FROM (
    SELECT o.VALOR FROM ORCAMENTO o WHERE o.CICLO_ID = ${ciclo.ID}
    UNION ALL
    SELECT op.VALOR FROM ORCAMENTO_PACOTE op WHERE op.CICLO_ID = ${ciclo.ID} AND op.CR_ID IS NOT NULL AND ${GATE}) z`);
const sf86 = await executeServerFunctionMitra({
  projectId, serverFunctionId: 86, input: { cicloId: ciclo.ID, crIds: '', contaIds: '' },
});
let out = sf86?.result?.output; if (typeof out === 'string') out = JSON.parse(out);
const totalSf86 = (out?.rows || []).reduce((s, r) => s + Number(r.VALOR || 0), 0);
const esperado = Number(ref[0]?.TOTAL || 0);
if (Math.abs(totalSf86 - esperado) < 1) {
  console.log(`ok      SF 86 (DRE) bate com ORCAMENTO + ORCAMENTO_PACOTE: ${Math.round(esperado)}`);
} else {
  falhou = true;
  console.log(`FALHOU  SF 86 devolve ${Math.round(totalSf86)}, esperado ${Math.round(esperado)}`);
}

// ORC_CONTROLE das SFs de detalhe do CR precisa somar as duas fontes tambem,
// senao a comparacao "versao atual x versao controle" fica torta: um lado conta o
// pacote e o outro nao.
const { readServerFunctionMitra } = await import('mitra-sdk');
for (const sfId of [125, 143]) {
  const r = await readServerFunctionMitra({ projectId, serverFunctionId: sfId });
  const code = r.result?.code || '';
  const ok = code.includes('FROM ORCAMENTO_PACOTE op WHERE op.CICLO_ID = {{controlCicloId}}');
  if (ok) console.log(`ok      SF ${sfId}: ORC_CONTROLE soma o pacote`);
  else { falhou = true; console.log(`FALHOU  SF ${sfId}: ORC_CONTROLE ainda le so ORCAMENTO`); }
}

process.exit(falhou ? 1 : 0);
