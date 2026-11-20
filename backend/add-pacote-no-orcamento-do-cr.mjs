// O valor rateado do pacote e orcamento do CR — tem que entrar no resultado dele.
//
// O DRE server-side ja fazia isso: SF 86/88/90 (dreOrcado*) e 127/128 (hotResumoCr*)
// somam ORCAMENTO + ORCAMENTO_PACOTE, so contando o pacote depois de SUBMETIDO ou
// APROVADO (antes disso o numero ainda muda). Quem ficou de fora foi a tela de
// preenchimento do CR (SF 125 e o espelho publico 143): la o Resumo do CR lia so
// ORCAMENTO, entao o custo rateado do pacote sumia do resultado daquele setor.
//
// Este script alinha o bloco ORC_CONTROLE (versao de comparacao) ao mesmo padrao.
//
// Por que NAO tocamos no bloco BUDGET: ele nao e so leitura — o frontend procura a
// linha dentro dele para decidir entre INSERT e UPDATE, e faz PATCH em ORCAMENTO
// usando o ID encontrado. Se linhas de ORCAMENTO_PACOTE entrassem ali, um save
// poderia gravar na tabela errada usando um ID que nao e dela. O valor corrente do
// pacote e somado no frontend, que ja recebe PKG_BUDGET e PACOTE_STATUS_ALL.
import 'dotenv/config';
import {
  configureSdkMitra,
  readServerFunctionMitra,
  updateServerFunctionMitra,
} from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});
const projectId = parseInt(process.env.MITRA_PROJECT_ID);

const ORIGINAL = "COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('ID',t.ID,'CICLO_ID',t.CICLO_ID,'CR_ID',t.CR_ID,'CONTA_ID',t.CONTA_ID,'MES',t.MES,'VALOR',t.VALOR,'QUANTIDADE',t.QUANTIDADE,'VALOR_UNITARIO',t.VALOR_UNITARIO)) FROM ORCAMENTO t WHERE t.CICLO_ID = {{controlCicloId}} AND t.CR_ID = {{crId}}),JSON_ARRAY()) AS ORC_CONTROLE";

// Mesma forma do UNION ALL da SF 86/127, incluindo o gate de status do pacote.
const CORRIGIDO = "COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('ID',x.ID,'CICLO_ID',x.CICLO_ID,'CR_ID',x.CR_ID,'CONTA_ID',x.CONTA_ID,'MES',x.MES,'VALOR',x.VALOR,'QUANTIDADE',x.QUANTIDADE,'VALOR_UNITARIO',x.VALOR_UNITARIO)) FROM (SELECT t.ID, t.CICLO_ID, t.CR_ID, t.CONTA_ID, t.MES, t.VALOR, t.QUANTIDADE, t.VALOR_UNITARIO FROM ORCAMENTO t WHERE t.CICLO_ID = {{controlCicloId}} AND t.CR_ID = {{crId}} UNION ALL SELECT op.ID, op.CICLO_ID, op.CR_ID, op.CONTA_ID, op.MES, op.VALOR, NULL, NULL FROM ORCAMENTO_PACOTE op WHERE op.CICLO_ID = {{controlCicloId}} AND op.CR_ID = {{crId}} AND EXISTS (SELECT 1 FROM PACOTE_STATUS ps WHERE ps.CICLO_ID = op.CICLO_ID AND ps.DRIVER_ID = op.DRIVER_ID AND ps.STATUS IN ('SUBMETIDO','APROVADO'))) x),JSON_ARRAY()) AS ORC_CONTROLE";

async function corrigir(sfId, nome) {
  const atual = await readServerFunctionMitra({ projectId, serverFunctionId: sfId });
  const code = atual.result?.code || '';
  if (!code) throw new Error(`SF ${sfId} (${nome}) sem codigo — abortando`);

  if (code.includes('FROM ORCAMENTO_PACOTE op WHERE op.CICLO_ID = {{controlCicloId}}')) {
    console.log(`  SF ${sfId} (${nome}): ORC_CONTROLE ja soma o pacote — nada a fazer`);
    return;
  }
  if (!code.includes(ORIGINAL)) {
    throw new Error(`SF ${sfId} (${nome}): bloco ORC_CONTROLE fora do formato esperado — abortando sem alterar`);
  }
  const novo = code.replace(ORIGINAL, CORRIGIDO);
  if (novo === code) throw new Error(`SF ${sfId} (${nome}): substituicao sem efeito — abortando`);
  if ((novo.match(/AS ORC_CONTROLE/g) || []).length !== 1) {
    throw new Error(`SF ${sfId} (${nome}): ORC_CONTROLE duplicado — abortando`);
  }
  await updateServerFunctionMitra({ projectId, serverFunctionId: sfId, code: novo });
  console.log(`  ok: SF ${sfId} (${nome}) — ORC_CONTROLE agora soma o pacote submetido (${code.length} -> ${novo.length} chars)`);
}

async function main() {
  console.log('ORC_CONTROLE das SFs de detalhe do CR passa a somar o pacote');
  await corrigir(125, 'hotOrcDetalheCr');
  await corrigir(143, 'publicHotOrcDetalheCr');
  console.log('\nPronto. Valide com: node smoke-pacote-no-orcamento.mjs');
}

main().catch((e) => { console.error(e); process.exit(1); });
