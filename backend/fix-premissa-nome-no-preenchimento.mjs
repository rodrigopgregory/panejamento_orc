// A linha de PREMISSA do modelo nao resolvia valor nenhum no preenchimento.
//
// O vinculo entre a linha do modelo e a premissa geral e por NOME (ver
// lib/linha-modelo: DRIVER_FORMULA nao tem CICLO_ID, entao amarrar por ID faria
// a linha apontar para a premissa da versao anterior). O nome mora em
// DRIVER_FORMULA.PREMISSA_NOME — e o bloco FORMULAS das SFs que alimentam o
// PREENCHIMENTO nao devolvia essa coluna.
//
// Efeito: cl.PREMISSA_NOME chegava null, valorPremissa procurava a chave "_6",
// nao achava e devolvia 0. A linha da aliquota aparecia zerada e toda formula
// que a citava ([P1]) virava zero — o imposto sumia da grade sem erro nenhum.
//
// A tela de modelagem nunca sofreu porque ela le por outra SF (133), que ja
// trazia a coluna. Por isso o vinculo parecia certo de um lado e o valor sumia
// do outro.
//
// Aqui a correcao e aditiva: acrescenta a coluna ao JSON_OBJECT das duas SFs de
// preenchimento (124 interna e 142 do link do gestor). Nenhum campo existente
// muda de nome ou de posicao.
import 'dotenv/config';
import { configureSdkMitra, readServerFunctionMitra, updateServerFunctionMitra } from 'mitra-sdk';

configureSdkMitra({ baseURL: process.env.MITRA_BASE_URL, token: process.env.MITRA_TOKEN, integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS });
const projectId = parseInt(process.env.MITRA_PROJECT_ID);

const ANCORA = "'RATEIO_ID',df.RATEIO_ID";
const NOVO = "'RATEIO_ID',df.RATEIO_ID,'PREMISSA_NOME',df.PREMISSA_NOME";

for (const serverFunctionId of [124, 142]) {
  const atual = await readServerFunctionMitra({ projectId, serverFunctionId });
  const code = atual.result?.code || '';
  const nome = atual.result?.name;

  if (code.includes("'PREMISSA_NOME',df.PREMISSA_NOME")) {
    console.log(`SF ${serverFunctionId} (${nome}): ja tem PREMISSA_NOME, nada a fazer.`);
    continue;
  }
  const ocorrencias = code.split(ANCORA).length - 1;
  if (ocorrencias !== 1) {
    console.error(`SF ${serverFunctionId} (${nome}): esperava 1 ancora "${ANCORA}", achei ${ocorrencias}. Abortando sem gravar.`);
    process.exit(1);
  }

  await updateServerFunctionMitra({ projectId, serverFunctionId, code: code.replace(ANCORA, NOVO) });
  console.log(`SF ${serverFunctionId} (${nome}): PREMISSA_NOME adicionado ao bloco FORMULAS.`);
}
