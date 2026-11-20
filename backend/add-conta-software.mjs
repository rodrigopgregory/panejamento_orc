import 'dotenv/config';
import { configureSdkMitra, createRecordsBatchMitra } from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS
});

const projectId = parseInt(process.env.MITRA_PROJECT_ID);

async function addContaSoftware() {
  await createRecordsBatchMitra({
    projectId,
    tableName: 'CONTA_CONTABIL',
    records: [
      { CODIGO: '4.1.5', NOME: 'Despesas com Software', TIPO: 'DESPESA_OPERACIONAL', NATUREZA: 'DEVEDORA', ATIVO: 'true' }
    ]
  });
  console.log('Conta "Despesas com Software" criada com sucesso!');
}

addContaSoftware();
