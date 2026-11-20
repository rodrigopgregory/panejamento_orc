// SF de exclusao de versao com cascata COMPLETA e escopo estrito.
//
// Por que existe: a tela apagava 7 das 21 tabelas que tem CICLO_ID, uma a uma pelo
// cliente (SELECT + N deletes por tabela). O resultado eram orfaos — benefícios,
// encargos, premissas, tokens de preenchimento e receita ficavam no banco apontando
// para um ciclo morto — e centenas de round-trips por exclusao.
//
// Duas garantias, nesta ordem:
// 1. ESCOPO: todo DELETE carrega WHERE CICLO_ID = {{cicloId}}. Nenhuma linha de
//    outro ciclo e alcancavel por esta funcao.
// 2. TUDO OU NADA: cada DELETE tambem exige que o ciclo esteja PENDENTE. Chamar
//    num ciclo ja iniciado nao apaga nada — em vez de apagar as filhas e falhar
//    na mae, deixando a versao viva e vazia.
//
// A lista de tabelas veio do INFORMATION_SCHEMA (21 com CICLO_ID), nao de memoria:
// a lista hardcoded que existia no repo tinha 20 e ja estava desatualizada.
import 'dotenv/config';
import {
  configureSdkMitra, createServerFunctionMitra, updateServerFunctionMitra,
  listServerFunctionsMitra,
} from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});
const projectId = parseInt(process.env.MITRA_PROJECT_ID);
const SF_NAME = 'excluirCicloCascata';

// Ordem filhas -> mae, seguindo a mesma sequencia ja validada em
// prepararImplantacaoLimpar. CICLO fica por ultimo.
const TABELAS = [
  'DRIVER_FORMULA_VALOR', 'AUMENTO_SALARIAL', 'CONTRATACAO_PROJETADA',
  'DESLIGAMENTO_PROJETADO', 'ORCAMENTO_PESSOAL', 'PROJECAO_HEADCOUNT',
  'ORCAMENTO_PACOTE', 'ORCAMENTO', 'HIST_PREMISSA', 'PREMISSA_IMPOSTO',
  'PREMISSA_DISSIDIO', 'PREMISSA_TURNOVER', 'PREMISSA_LINHA', 'RECEITA_PREMISSA',
  'BENEFICIO', 'ENCARGO', 'WORKFLOW_AUDITORIA', 'PREENCHIMENTO_TOKEN',
  'PACOTE_STATUS', 'ORCAMENTO_STATUS', 'DRIVER_CONFIG',
];

const PENDENTE = "EXISTS (SELECT 1 FROM CICLO c WHERE c.ID = {{cicloId}} AND c.STATUS = 'PENDENTE')";

const code = [
  ...TABELAS.map((t) => `DELETE FROM ${t} WHERE CICLO_ID = {{cicloId}} AND ${PENDENTE};`),
  `DELETE FROM CICLO WHERE ID = {{cicloId}} AND STATUS = 'PENDENTE';`,
  // A tela decide a mensagem por este retorno: 0 = excluida, 1 = recusada.
  `SELECT COUNT(*) AS RESTANTE FROM CICLO WHERE ID = {{cicloId}};`,
].join('\n');

const description = 'Exclui uma versao e TODAS as suas linhas filhas (21 tabelas com CICLO_ID), '
  + 'sempre restritas ao proprio ciclo. So age se o ciclo estiver PENDENTE: iniciada, nada e apagado. '
  + 'Param: cicloId. Retorna RESTANTE (0 = excluida, 1 = recusada porque ja foi iniciada).';

const listRes = await listServerFunctionsMitra({ projectId });
const list = listRes?.result || listRes || [];
const existing = (Array.isArray(list) ? list : []).find((f) => f.name === SF_NAME);

if (existing) {
  await updateServerFunctionMitra({ projectId, serverFunctionId: existing.id, code, description });
  console.log('SF atualizada, id =', existing.id);
} else {
  const r = await createServerFunctionMitra({ projectId, name: SF_NAME, type: 'SQL', code, description });
  console.log('SF criada, id =', r?.result?.serverFunctionId ?? JSON.stringify(r?.result ?? r));
}
