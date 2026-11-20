import 'dotenv/config';
import { configureSdkMitra, togglePublicExecutionMitra, readServerFunctionMitra } from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS
});

const projectId = parseInt(process.env.MITRA_PROJECT_ID);

console.log('Tornando SF 39 publica...');
const res = await togglePublicExecutionMitra({ projectId, serverFunctionId: 39, publicExecution: true });
console.log('Resultado:', JSON.stringify(res, null, 2));

console.log('\nConfirmando...');
const sf = await readServerFunctionMitra({ projectId, serverFunctionId: 39 });
console.log('PublicExecution:', sf.result?.publicExecution);
