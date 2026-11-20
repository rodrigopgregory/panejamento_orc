import 'dotenv/config';
import { configureSdkMitra, createServerFunctionMitra, listServerFunctionsMitra } from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS
});

const projectId = parseInt(process.env.MITRA_PROJECT_ID);

async function migrate() {
  // Check if SF already exists
  const sfs = await listServerFunctionsMitra({ projectId });
  const existing = sfs.result?.find(sf => sf.name === 'executarConsulta');
  if (existing) {
    console.log('SF executarConsulta already exists with ID:', existing.id);
    return existing.id;
  }

  // Create generic query SF - type SQL with {{sql}} placeholder
  const sf = await createServerFunctionMitra({
    projectId,
    name: 'executarConsulta',
    type: 'SQL',
    code: '{{sql}}',
    description: 'Executa consulta SQL dinâmica passada como parâmetro'
  });

  console.log('SF executarConsulta created:', JSON.stringify(sf.result, null, 2));

  // List all SFs to get the ID
  const allSfs = await listServerFunctionsMitra({ projectId });
  console.log('\nAll Server Functions:');
  for (const s of allSfs.result || []) {
    console.log(`  ID: ${s.id} | Name: ${s.name} | Type: ${s.type}`);
  }
}

migrate().catch(console.error);
