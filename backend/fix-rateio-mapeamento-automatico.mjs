// Rateio de pacote: o setor com quantidade cadastrada passa a receber de verdade.
//
// PROBLEMA
// Uma linha de modelo de pacote com RATEIO_ID divide o total lancado entre os
// setores. Mas quem "recebe" era decidido pelo CR_CONTA (conta mapeada no setor),
// nao pelo rateio: setor com quantidade cadastrada e sem a conta mapeada era
// descartado e os percentuais renormalizavam entre os demais. Efeito medido neste
// projeto: o rateio Pessoal tinha quantidade para 8 setores (peso 43), mas so 5
// tinham a conta 4.1.5 mapeada — 9/43 (21%) do peso ia parar nos outros 5, e os
// setores CR001/CR003/CR005 nao viam o pacote em tela nenhuma.
//
// CORRECAO (mecanismo permanente)
// 1. SF sincronizarCrContaRateio: cria o vinculo conta x setor a partir do rateio.
//    Idempotente e set-based — roda inteira, nao so sobre a linha tocada. O
//    frontend a chama quando muda a quantidade de um rateio e quando muda o
//    rateio de uma linha de modelo, entao o vinculo nasce junto com o cadastro.
// 2. SF 191 (criarVersaoOrcamento): para de copiar linhas de ORCAMENTO de contas
//    que pertencem a um pacote. Era isso que duplicava o valor a cada nova versao
//    (o valor de pacote ja vem na copia de ORCAMENTO_PACOTE, logo abaixo).
// 3. Backfill + limpeza dos residuos que os dois defeitos ja deixaram.
import 'dotenv/config';
import {
  configureSdkMitra,
  listServerFunctionsMitra,
  readServerFunctionMitra,
  updateServerFunctionMitra,
  createServerFunctionMitra,
  runDmlMitra,
  executeServerFunctionMitra,
} from 'mitra-sdk';

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

// Origem da verdade de quem recebe: quantidade > 0 no rateio aplicado a uma linha
// de modelo de pacote que tem conta contabil. ON DUPLICATE KEY (UQ_CR_CONTA) torna
// a SF idempotente — mesmo padrao da SF 224 (mapear por historico).
const SQL_SINCRONIZAR = `INSERT INTO CR_CONTA (CR_ID, CONTA_ID, ATIVO, CRIADO_EM)
SELECT DISTINCT ri.CR_ID, df.CONTA_ID, true, DATE_FORMAT(NOW(), '%Y-%m-%dT%H:%i:%s')
FROM DRIVER_FORMULA df
JOIN DRIVERS d ON d.ID = df.DRIVER_ID AND d.ESCOPO = 'PACOTE'
JOIN RATEIO_ITEM ri ON ri.RATEIO_ID = df.RATEIO_ID AND ri.QUANTIDADE > 0
WHERE df.CONTA_ID IS NOT NULL AND df.RATEIO_ID IS NOT NULL
ON DUPLICATE KEY UPDATE ATIVO = true`;

const DESC_SINCRONIZAR = 'Cria o vinculo conta x setor a partir dos rateios aplicados em linhas de modelo de pacote (setor com quantidade > 0 passa a receber). Idempotente, sem params.';

// A copia de ORCAMENTO da SF 191 nao pode levar contas que hoje pertencem a um
// pacote — o valor delas vem da copia de ORCAMENTO_PACOTE.
const TRECHO_ORIGINAL = '" + novoId + ", CR_ID, CONTA_ID, MES, VALOR, QUANTIDADE, VALOR_UNITARIO FROM ORCAMENTO WHERE CICLO_ID = " + origemId,';
const TRECHO_CORRIGIDO = '" + novoId + ", CR_ID, CONTA_ID, MES, VALOR, QUANTIDADE, VALOR_UNITARIO FROM ORCAMENTO WHERE CICLO_ID = " + origemId + " AND CONTA_ID NOT IN (SELECT cd.CONTA_ID FROM CONTA_DRIVER cd JOIN DRIVERS d ON d.ID = cd.DRIVER_ID WHERE d.ESCOPO = \'PACOTE\')",';

async function acharSF(nome) {
  const todas = await listServerFunctionsMitra({ projectId });
  return (todas.result || todas || []).find((f) => f.name === nome) || null;
}

async function passo1_sincronizadora() {
  console.log('\n1. SF sincronizarCrContaRateio');
  const existente = await acharSF('sincronizarCrContaRateio');
  if (existente) {
    await updateServerFunctionMitra({
      projectId, serverFunctionId: existente.id, code: SQL_SINCRONIZAR, description: DESC_SINCRONIZAR,
    });
    console.log(`  ok: atualizada (id ${existente.id})`);
    return existente.id;
  }
  const r = await createServerFunctionMitra({
    projectId, name: 'sincronizarCrContaRateio', type: 'SQL', code: SQL_SINCRONIZAR, description: DESC_SINCRONIZAR,
  });
  const id = r.result?.serverFunctionId;
  console.log(`  ok: criada (id ${id})`);
  return id;
}

async function passo2_criarVersao() {
  console.log('\n2. SF 191 criarVersaoOrcamento — nao duplicar conta de pacote');
  const atual = await readServerFunctionMitra({ projectId, serverFunctionId: 191 });
  const code = atual.result?.code || '';
  if (!code) throw new Error('SF 191 sem codigo — abortando');
  if (code.includes("d.ESCOPO = 'PACOTE')\",")) {
    console.log('  ja corrigida — nada a fazer');
    return;
  }
  if (!code.includes(TRECHO_ORIGINAL)) {
    throw new Error('SF 191: trecho da copia de ORCAMENTO nao encontrado — abortando sem alterar');
  }
  const novo = code.replace(TRECHO_ORIGINAL, TRECHO_CORRIGIDO);
  if (novo === code) throw new Error('SF 191: substituicao nao teve efeito — abortando');
  await updateServerFunctionMitra({ projectId, serverFunctionId: 191, code: novo });
  console.log(`  ok: copia de ORCAMENTO agora ignora contas de pacote (${code.length} -> ${novo.length} chars)`);
}

async function passo3_backfill(sfId) {
  console.log('\n3. Backfill dos vinculos que faltavam');
  const antes = await q(`SELECT DISTINCT ri.CR_ID, cr.CODIGO CR, df.CONTA_ID, cc.CODIGO CONTA
    FROM DRIVER_FORMULA df
    JOIN DRIVERS d ON d.ID = df.DRIVER_ID AND d.ESCOPO='PACOTE'
    JOIN RATEIO_ITEM ri ON ri.RATEIO_ID = df.RATEIO_ID AND ri.QUANTIDADE > 0
    JOIN CENTRO_RESULTADO cr ON cr.ID = ri.CR_ID
    JOIN CONTA_CONTABIL cc ON cc.ID = df.CONTA_ID
    WHERE df.CONTA_ID IS NOT NULL AND df.RATEIO_ID IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM CR_CONTA x WHERE x.CR_ID=ri.CR_ID AND x.CONTA_ID=df.CONTA_ID AND x.ATIVO=true)`);
  if (antes.length === 0) { console.log('  nenhum vinculo faltando'); return; }
  console.log(`  faltando ${antes.length}:`);
  antes.forEach((r) => console.log(`    ${r.CR} x conta ${r.CONTA}`));
  const r = await executeServerFunctionMitra({ projectId, serverFunctionId: sfId, input: {} });
  if (r?.result?.executionStatus === 'FAILED') throw new Error(`sincronizacao falhou: ${r?.result?.error}`);
  const depois = await q(`SELECT COUNT(*) N FROM (
    SELECT DISTINCT ri.CR_ID, df.CONTA_ID
    FROM DRIVER_FORMULA df
    JOIN DRIVERS d ON d.ID = df.DRIVER_ID AND d.ESCOPO='PACOTE'
    JOIN RATEIO_ITEM ri ON ri.RATEIO_ID = df.RATEIO_ID AND ri.QUANTIDADE > 0
    WHERE df.CONTA_ID IS NOT NULL AND df.RATEIO_ID IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM CR_CONTA x WHERE x.CR_ID=ri.CR_ID AND x.CONTA_ID=df.CONTA_ID AND x.ATIVO=true)) t`);
  console.log(`  ok: faltando agora ${depois[0]?.N ?? '?'}`);
}

// So e duplicata quando a MESMA versao tem as duas fontes para a mesma conta de
// pacote. Versao antiga que so tem ORCAMENTO e historico legitimo de antes da
// conta virar pacote — nao se toca. Versao FECHADA tambem fica intacta.
const JOIN_DUPLICATA = `JOIN CONTA_DRIVER cd ON cd.CONTA_ID = o.CONTA_ID
  JOIN DRIVERS d ON d.ID = cd.DRIVER_ID AND d.ESCOPO = 'PACOTE'
  JOIN CICLO c ON c.ID = o.CICLO_ID AND c.STATUS <> 'FECHADO'`;
const WHERE_DUPLICATA = `WHERE EXISTS (
    SELECT 1 FROM ORCAMENTO_PACOTE p WHERE p.CICLO_ID = o.CICLO_ID AND p.CONTA_ID = o.CONTA_ID)`;

const SQL_PREVIA_DUPLICATA = `SELECT o.CICLO_ID, c.NOME CICLO, cr.CODIGO CR, cc.CODIGO CONTA,
    COUNT(*) LINHAS, SUM(o.VALOR) TOTAL
  FROM ORCAMENTO o
  ${JOIN_DUPLICATA}
  JOIN CENTRO_RESULTADO cr ON cr.ID = o.CR_ID
  JOIN CONTA_CONTABIL cc ON cc.ID = o.CONTA_ID
  ${WHERE_DUPLICATA}
  GROUP BY o.CICLO_ID, c.NOME, cr.CODIGO, cc.CODIGO`;

const SQL_CONTA_DUPLICATA = `SELECT COUNT(*) N FROM ORCAMENTO o ${JOIN_DUPLICATA} ${WHERE_DUPLICATA}`;
const SQL_DELETE_DUPLICATA = `DELETE o FROM ORCAMENTO o ${JOIN_DUPLICATA} ${WHERE_DUPLICATA}`;

async function passo4_limparDuplicatas() {
  console.log('\n4. Limpeza das linhas duplicadas em ORCAMENTO');
  const alvo = await q(SQL_PREVIA_DUPLICATA);
  if (alvo.length === 0) { console.log('  nenhuma duplicata'); return; }
  alvo.forEach((r) => console.log(`  apagar: versao ${r.CICLO_ID} (${r.CICLO}) · ${r.CR} · conta ${r.CONTA} · ${r.LINHAS} linhas · total ${r.TOTAL}`));
  await runDmlMitra({ projectId, sql: SQL_DELETE_DUPLICATA });
  const resto = await q(SQL_CONTA_DUPLICATA);
  console.log(`  ok: restam ${resto[0]?.N ?? '?'} linhas duplicadas`);
}

async function main() {
  const sfId = await passo1_sincronizadora();
  await passo2_criarVersao();
  await passo3_backfill(sfId);
  await passo4_limparDuplicatas();
  console.log(`\nPronto. Use o id ${sfId} em SF_IDS.sincronizarCrContaRateio no frontend.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
