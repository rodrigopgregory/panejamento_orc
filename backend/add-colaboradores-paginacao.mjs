import 'dotenv/config';
import { configureSdkMitra, createServerFunctionMitra, listServerFunctionsMitra } from 'mitra-sdk';
configureSdkMitra({ baseURL: process.env.MITRA_BASE_URL, token: process.env.MITRA_TOKEN, integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS });
const projectId = parseInt(process.env.MITRA_PROJECT_ID);

// Lista paginada com filtro opcional de CR e busca (nome/cargo). Volume-safe: LIMIT/OFFSET no banco.
// busca ja chega escapada do frontend (sqlEscape); estas SFs sao autenticadas, nao publicas.
const WHERE = `WHERE ('{{crId}}' = '' OR c.CR_ID = {{crId}})
  AND ('{{busca}}' = '' OR c.NOME LIKE '%{{busca}}%' OR c.CARGO LIKE '%{{busca}}%')`;

await createServerFunctionMitra({
  projectId, name: 'colaboradoresPaginados', type: 'SQL',
  code: `SELECT c.*, cr.CODIGO as CR_CODIGO, cr.NOME as CR_NOME, e.NOME as EMPRESA_NOME
    FROM COLABORADOR c
    LEFT JOIN CENTRO_RESULTADO cr ON cr.ID = c.CR_ID
    LEFT JOIN EMPRESA e ON e.ID = c.EMPRESA_ID
    ${WHERE}
    ORDER BY c.NOME
    LIMIT {{limit}} OFFSET {{offset}}`,
  description: 'Colaboradores paginados (filtro CR + busca nome/cargo). Params: crId, busca, limit, offset.'
});

await createServerFunctionMitra({
  projectId, name: 'colaboradoresCount', type: 'SQL',
  code: `SELECT COUNT(*) AS TOTAL FROM COLABORADOR c ${WHERE}`,
  description: 'Total de colaboradores para paginacao. Params: crId, busca.'
});

const list = await listServerFunctionsMitra({ projectId });
const fns = (list.result || list);
for (const n of ['colaboradoresPaginados','colaboradoresCount']) {
  const f = fns.find(x => x.name === n);
  console.log(n, '=>', f?.id);
}
