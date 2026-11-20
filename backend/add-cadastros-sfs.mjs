// Migracao aditiva: cria SFs dedicadas e parametrizadas para a tela de Cadastros
// (EMPRESA, CONTA_CONTABIL, CENTRO_RESULTADO) com paginacao server-side.
// Nao altera nem remove nada existente.
import 'dotenv/config';
import { configureSdkMitra, createServerFunctionMitra, listServerFunctionsMitra } from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS
});

const projectId = parseInt(process.env.MITRA_PROJECT_ID);

const SFS = [
  // ===== EMPRESA =====
  {
    name: 'cadastroListarEmpresas',
    code: `SELECT ID, NOME, CNPJ, ATIVO FROM EMPRESA
WHERE ('{{busca}}' = '' OR LOWER(NOME) LIKE LOWER('%{{busca}}%') OR LOWER(CNPJ) LIKE LOWER('%{{busca}}%'))
  AND ('{{ativo}}' = '' OR ATIVO = '{{ativo}}')
ORDER BY NOME
LIMIT {{limit}} OFFSET {{offset}}`,
    description: 'Lista empresas paginada com busca (nome/CNPJ) e filtro de status'
  },
  {
    name: 'cadastroContarEmpresas',
    code: `SELECT COUNT(*) AS TOTAL FROM EMPRESA
WHERE ('{{busca}}' = '' OR LOWER(NOME) LIKE LOWER('%{{busca}}%') OR LOWER(CNPJ) LIKE LOWER('%{{busca}}%'))
  AND ('{{ativo}}' = '' OR ATIVO = '{{ativo}}')`,
    description: 'Total de empresas para paginacao (mesmos filtros da listagem)'
  },
  {
    name: 'cadastroCriarEmpresa',
    code: `INSERT INTO EMPRESA (NOME, CNPJ, ATIVO, CRIADO_EM) VALUES ('{{nome}}', '{{cnpj}}', '{{ativo}}', '{{criadoEm}}')`,
    description: 'Cria empresa (params: nome, cnpj, ativo, criadoEm)'
  },
  {
    name: 'cadastroAtualizarEmpresa',
    code: `UPDATE EMPRESA SET NOME = '{{nome}}', CNPJ = '{{cnpj}}', ATIVO = '{{ativo}}' WHERE ID = {{id}}`,
    description: 'Atualiza empresa por ID'
  },
  {
    name: 'cadastroExcluirEmpresa',
    code: `DELETE FROM EMPRESA WHERE ID = {{id}}`,
    description: 'Exclui empresa por ID'
  },
  // ===== CONTA_CONTABIL =====
  {
    name: 'cadastroListarContas',
    code: `SELECT ID, CODIGO, NOME, TIPO, NATUREZA, ATIVO FROM CONTA_CONTABIL
WHERE ('{{busca}}' = '' OR LOWER(CODIGO) LIKE LOWER('%{{busca}}%') OR LOWER(NOME) LIKE LOWER('%{{busca}}%'))
  AND ('{{tipo}}' = '' OR TIPO = '{{tipo}}')
ORDER BY CODIGO
LIMIT {{limit}} OFFSET {{offset}}`,
    description: 'Lista contas contabeis paginada com busca (codigo/nome) e filtro de tipo'
  },
  {
    name: 'cadastroContarContas',
    code: `SELECT COUNT(*) AS TOTAL FROM CONTA_CONTABIL
WHERE ('{{busca}}' = '' OR LOWER(CODIGO) LIKE LOWER('%{{busca}}%') OR LOWER(NOME) LIKE LOWER('%{{busca}}%'))
  AND ('{{tipo}}' = '' OR TIPO = '{{tipo}}')`,
    description: 'Total de contas contabeis para paginacao (mesmos filtros da listagem)'
  },
  {
    name: 'cadastroCriarConta',
    code: `INSERT INTO CONTA_CONTABIL (CODIGO, NOME, TIPO, NATUREZA, ATIVO) VALUES ('{{codigo}}', '{{nome}}', '{{tipo}}', '{{natureza}}', '{{ativo}}')`,
    description: 'Cria conta contabil (params: codigo, nome, tipo, natureza, ativo)'
  },
  {
    name: 'cadastroAtualizarConta',
    code: `UPDATE CONTA_CONTABIL SET CODIGO = '{{codigo}}', NOME = '{{nome}}', TIPO = '{{tipo}}', NATUREZA = '{{natureza}}', ATIVO = '{{ativo}}' WHERE ID = {{id}}`,
    description: 'Atualiza conta contabil por ID'
  },
  {
    name: 'cadastroExcluirConta',
    code: `DELETE FROM CONTA_CONTABIL WHERE ID = {{id}}`,
    description: 'Exclui conta contabil por ID'
  },
  // ===== CENTRO_RESULTADO =====
  {
    name: 'cadastroListarCRs',
    code: `SELECT CR.ID, CR.CODIGO, CR.NOME, CR.EMPRESA_ID, CR.ATIVO, E.NOME AS EMPRESA_NOME
FROM CENTRO_RESULTADO CR
LEFT JOIN EMPRESA E ON E.ID = CR.EMPRESA_ID
WHERE ('{{busca}}' = '' OR LOWER(CR.CODIGO) LIKE LOWER('%{{busca}}%') OR LOWER(CR.NOME) LIKE LOWER('%{{busca}}%'))
  AND ('{{empresaId}}' = '' OR CR.EMPRESA_ID = '{{empresaId}}')
ORDER BY CR.CODIGO
LIMIT {{limit}} OFFSET {{offset}}`,
    description: 'Lista centros de resultado paginada com nome da empresa, busca e filtro por empresa'
  },
  {
    name: 'cadastroContarCRs',
    code: `SELECT COUNT(*) AS TOTAL FROM CENTRO_RESULTADO CR
WHERE ('{{busca}}' = '' OR LOWER(CR.CODIGO) LIKE LOWER('%{{busca}}%') OR LOWER(CR.NOME) LIKE LOWER('%{{busca}}%'))
  AND ('{{empresaId}}' = '' OR CR.EMPRESA_ID = '{{empresaId}}')`,
    description: 'Total de centros de resultado para paginacao (mesmos filtros da listagem)'
  },
  {
    name: 'cadastroCriarCR',
    code: `INSERT INTO CENTRO_RESULTADO (CODIGO, NOME, EMPRESA_ID, ATIVO) VALUES ('{{codigo}}', '{{nome}}', {{empresaId}}, '{{ativo}}')`,
    description: 'Cria centro de resultado (params: codigo, nome, empresaId, ativo)'
  },
  {
    name: 'cadastroAtualizarCR',
    code: `UPDATE CENTRO_RESULTADO SET CODIGO = '{{codigo}}', NOME = '{{nome}}', EMPRESA_ID = {{empresaId}}, ATIVO = '{{ativo}}' WHERE ID = {{id}}`,
    description: 'Atualiza centro de resultado por ID'
  },
  {
    name: 'cadastroExcluirCR',
    code: `DELETE FROM CENTRO_RESULTADO WHERE ID = {{id}}`,
    description: 'Exclui centro de resultado por ID'
  },
];

async function run() {
  const existing = await listServerFunctionsMitra({ projectId });
  const existingByName = new Map((existing?.result || existing || []).map((f) => [f.name, f.id]));

  const ids = {};
  for (const sf of SFS) {
    if (existingByName.has(sf.name)) {
      ids[sf.name] = existingByName.get(sf.name);
      console.log(`= ja existe: ${sf.name} (id ${ids[sf.name]})`);
      continue;
    }
    const res = await createServerFunctionMitra({ projectId, type: 'SQL', ...sf });
    const id = res?.result?.serverFunctionId ?? res?.result?.id;
    ids[sf.name] = id;
    console.log(`+ criada: ${sf.name} (id ${id})`);
  }

  // Confirma IDs finais via list (fonte da verdade)
  const after = await listServerFunctionsMitra({ projectId });
  const byName = new Map((after?.result || after || []).map((f) => [f.name, f.id]));
  console.log('\n=== IDs para o frontend ===');
  for (const sf of SFS) console.log(`${sf.name}: ${byName.get(sf.name)}`);
}

run().catch((e) => { console.error(e); process.exit(1); });
