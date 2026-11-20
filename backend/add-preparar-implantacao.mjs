// Cria (ou atualiza) a Server Function SQL que limpa os dados de DEMONSTRACAO
// do projeto na rotina "Preparar para implantacao". NAO executa a limpeza —
// apenas registra a SF. A limpeza so roda quando o frontend chama a SF com
// input { confirmacao: 'LIMPAR_DADOS_DEMO' } (trava de seguranca).
//
// Por que SQL e nao JAVASCRIPT: dentro do sandbox E2B a credencial de um SF JS
// e de outro tenant e o banco recusa DML com PERMISSION_DENIED. A SF SQL roda
// direto no JDBC do tenant do projeto, com permissao correta.
//
// Cada DELETE fica protegido pela trava: so remove linhas se {{confirmacao}}
// vier exatamente 'LIMPAR_DADOS_DEMO'. Chamada sem a confirmacao apaga 0 linhas.
// A ordem abaixo respeita foreign keys (tabelas filhas antes das maes).
//
// PRESERVA: INT_USER (usuarios reais), integracoes/JDBC, USUARIOS/config e os
// MODELOS NATIVOS de DRIVERS (ver PRESERVAR abaixo).

import 'dotenv/config';
import { configureSdkMitra, createServerFunctionMitra, updateServerFunctionMitra, listServerFunctionsMitra } from 'mitra-sdk';

function backURL(t) {
  try {
    const p = JSON.parse(Buffer.from(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    return p.backURL || '';
  } catch { return ''; }
}

const token = process.env.MITRA_TOKEN;
configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL || backURL(token),
  token,
  integrationURL: process.env.MITRA_BASE_URL_SPACE || process.env.MITRA_BASE_URL_INTEGRATIONS,
});
const projectId = parseInt(process.env.MITRA_PROJECT_ID);

const SF_NAME = 'prepararImplantacaoLimpar';

// Ordem segura de FK: filhas -> maes. Cobre ciclos, premissas (gerais, folha,
// receita), plano de contas, cadastros do ciclo, realizado/forecast, workflow,
// modelos/drivers, rateios e estudos do playground.
const TABELAS = [
  'PREMISSA_VALOR', 'PLAYGROUND_VERSAO', 'DRIVER_FORMULA_CR', 'DRIVER_FORMULA_VALOR',
  'RATEIO_ITEM', 'RATEIO_CR', 'AUMENTO_SALARIAL', 'CONTRATACAO_PROJETADA',
  'DESLIGAMENTO_PROJETADO', 'ORCAMENTO_PESSOAL', 'PROJECAO_HEADCOUNT', 'ORCAMENTO_PACOTE',
  'ORCAMENTO', 'HIST_PREMISSA', 'PREMISSA_IMPOSTO', 'PREMISSA_DISSIDIO',
  'PREMISSA_TURNOVER', 'PREMISSA_LINHA', 'BENEFICIO', 'ENCARGO', 'WORKFLOW_AUDITORIA',
  'PREENCHIMENTO_TOKEN', 'PACOTE_STATUS', 'ORCAMENTO_STATUS', 'DRIVER_CONFIG',
  'PKG_RATEIO_CONFIG', 'CONTA_DRIVER_EXCECAO', 'GESTOR_PACOTE', 'GESTOR_CR', 'CR_CONTA',
  'CONTA_DRIVER', 'DRIVER_VERSAO', 'DRIVER_FORMULA', 'RATEIO_CONFIG', 'RATEIO',
  'RECEITA_PRODUTO', 'RECEITA_CONFIG', 'REALIZADO_CONTABIL', 'COLABORADOR', 'CARGO',
  'CENTRO_RESULTADO', 'EMPRESA', 'GESTOR', 'DRE_CONFIG', 'CONTA_CONTABIL', 'DRIVERS',
  'PLAYGROUND', 'CICLO',
];

// Filtro extra por tabela: restringe o DELETE ao que e realmente dado de demo.
//
// DRIVERS: os modelos NATIVOS (BASE_ZERO, BASE_HISTORICO, PESSOAL) fazem parte do
// motor, nao da demonstracao. A tela de Modelagem ja proibe excluir/inativar eles
// (add-excluir-modelo.mjs -> erro 'nativo_protegido') e o roteiro de implantacao
// assume que eles existem (IMPLANTACAO.md: "os nativos ja existem"). Apagar aqui
// deixava o projeto sem as abas base do preenchimento. Os FILHOS do driver
// (DRIVER_CONFIG, CONTA_DRIVER, DRIVER_FORMULA, DRIVER_VERSAO...) continuam sendo
// limpos normalmente, entao o nativo volta vazio, pronto pro mapeamento real.
//
// O filtro cobre ORIGEM e NOME de proposito: ORIGEM='NATIVO' e o criterio oficial,
// e a lista de nomes e a rede de seguranca caso a coluna venha NULL por drift
// (mesma dupla checagem de add-excluir-modelo.mjs). RECEITA NAO entra: e
// ORIGEM='TELA', nao e nativo, e sai junto com os modelos de exemplo.
const PRESERVAR = {
  DRIVERS: "(ORIGEM IS NULL OR ORIGEM <> 'NATIVO') "
    + "AND NOME NOT IN ('BASE_ZERO', 'BASE_HISTORICO', 'PESSOAL')",
};

const code = TABELAS
  .map((t) => {
    const extra = PRESERVAR[t] ? `\n  AND ${PRESERVAR[t]}` : '';
    return `DELETE FROM ${t} WHERE '{{confirmacao}}' = 'LIMPAR_DADOS_DEMO'${extra};`;
  })
  .join('\n');

async function main() {
  const listRes = await listServerFunctionsMitra({ projectId });
  const list = listRes?.result || listRes || [];
  const existing = (Array.isArray(list) ? list : []).find((f) => f.name === SF_NAME);

  const description = 'Limpa os dados de demonstracao do projeto (rotina Preparar para implantacao). '
    + "Trava de seguranca: so apaga se input.confirmacao = 'LIMPAR_DADOS_DEMO'. "
    + 'Preserva INT_USER, integracoes, config e os modelos nativos (BASE_ZERO, BASE_HISTORICO, PESSOAL).';

  if (existing) {
    const id = existing.id ?? existing.serverFunctionId;
    await updateServerFunctionMitra({ projectId, serverFunctionId: id, code, description });
    console.log(`SF atualizada: id=${id} name=${SF_NAME}`);
  } else {
    const res = await createServerFunctionMitra({ projectId, name: SF_NAME, type: 'SQL', code, description });
    const id = res?.result?.serverFunctionId ?? res?.serverFunctionId ?? res?.result?.id ?? res?.id;
    console.log(`SF criada: id=${id} name=${SF_NAME}`);
  }
  console.log('IMPORTANTE: a SF foi apenas registrada. Nenhuma limpeza foi executada.');
}

main().catch((e) => { console.error('ERRO:', e?.message || e); process.exit(1); });
