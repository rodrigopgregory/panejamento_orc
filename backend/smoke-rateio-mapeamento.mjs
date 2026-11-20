// Invariante do rateio de pacote: TODO setor com quantidade > 0 num rateio aplicado
// a uma linha de modelo de pacote precisa ter a conta daquela linha mapeada. Se
// faltar, o setor e descartado da divisao e os percentuais renormalizam entre os
// demais — ele recebe zero e nao ve o pacote em tela nenhuma, sem aviso.
//
// Tambem confere que conta de pacote nao tem valor em ORCAMENTO e ORCAMENTO_PACOTE
// ao mesmo tempo na MESMA versao (duplicata que a copia de versao criava).
// Versao FECHADA fica de fora: la, ORCAMENTO sozinho e historico de antes da conta
// virar pacote, e nao duplicata.
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

let falhou = false;

const semVinculo = await q(`SELECT DISTINCT cr.CODIGO CR, cc.CODIGO CONTA, d.NOME PACOTE, ri.QUANTIDADE
  FROM DRIVER_FORMULA df
  JOIN DRIVERS d ON d.ID = df.DRIVER_ID AND d.ESCOPO = 'PACOTE'
  JOIN RATEIO_ITEM ri ON ri.RATEIO_ID = df.RATEIO_ID AND ri.QUANTIDADE > 0
  JOIN CENTRO_RESULTADO cr ON cr.ID = ri.CR_ID
  JOIN CONTA_CONTABIL cc ON cc.ID = df.CONTA_ID
  WHERE df.CONTA_ID IS NOT NULL AND df.RATEIO_ID IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM CR_CONTA x WHERE x.CR_ID = ri.CR_ID AND x.CONTA_ID = df.CONTA_ID AND x.ATIVO = true)`);
if (semVinculo.length === 0) {
  console.log('ok      todo setor com quantidade no rateio tem a conta mapeada');
} else {
  falhou = true;
  console.log(`FALHOU  ${semVinculo.length} setor(es) no rateio sem a conta mapeada — receberiam zero:`);
  semVinculo.forEach((r) => console.log(`          ${r.CR} x ${r.CONTA} (${r.PACOTE}, quantidade ${r.QUANTIDADE})`));
}

const duplicadas = await q(`SELECT o.CICLO_ID, c.NOME CICLO, cr.CODIGO CR, cc.CODIGO CONTA,
    COUNT(*) LINHAS, SUM(o.VALOR) TOTAL
  FROM ORCAMENTO o
  JOIN CONTA_DRIVER cd ON cd.CONTA_ID = o.CONTA_ID
  JOIN DRIVERS d ON d.ID = cd.DRIVER_ID AND d.ESCOPO = 'PACOTE'
  JOIN CICLO c ON c.ID = o.CICLO_ID AND c.STATUS <> 'FECHADO'
  JOIN CENTRO_RESULTADO cr ON cr.ID = o.CR_ID
  JOIN CONTA_CONTABIL cc ON cc.ID = o.CONTA_ID
  WHERE EXISTS (SELECT 1 FROM ORCAMENTO_PACOTE p WHERE p.CICLO_ID = o.CICLO_ID AND p.CONTA_ID = o.CONTA_ID)
  GROUP BY o.CICLO_ID, c.NOME, cr.CODIGO, cc.CODIGO`);
if (duplicadas.length === 0) {
  console.log('ok      nenhuma conta de pacote com valor duplicado em ORCAMENTO');
} else {
  falhou = true;
  console.log(`FALHOU  ${duplicadas.length} duplicata(s) — conta de pacote com valor tambem em ORCAMENTO:`);
  duplicadas.forEach((r) => console.log(`          versao ${r.CICLO_ID} (${r.CICLO}) ${r.CR} x ${r.CONTA}: ${r.LINHAS} linhas, total ${r.TOTAL}`));
}

process.exit(falhou ? 1 : 0);
