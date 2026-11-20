import 'dotenv/config';
import { configureSdkMitra, runDmlMitra, createRecordsBatchMitra } from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS
});

const projectId = parseInt(process.env.MITRA_PROJECT_ID);

async function migrate() {
  console.log('=== Migration: Contas contábeis específicas de folha ===\n');

  const novasContas = [
    { CODIGO: '5.1.01.01', NOME: 'Salários e Ordenados', TIPO: 'DESPESA', ATIVO: 'true' },
    { CODIGO: '5.1.02.01', NOME: 'INSS', TIPO: 'DESPESA', ATIVO: 'true' },
    { CODIGO: '5.1.02.02', NOME: 'Férias', TIPO: 'DESPESA', ATIVO: 'true' },
    { CODIGO: '5.1.03.01', NOME: 'Vale Alimentação', TIPO: 'DESPESA', ATIVO: 'true' },
    { CODIGO: '5.1.03.02', NOME: 'Seguro de Vida e Convênio Médico', TIPO: 'DESPESA', ATIVO: 'true' },
  ];

  for (const conta of novasContas) {
    try {
      await createRecordsBatchMitra({ projectId, tableName: 'CONTA_CONTABIL', records: [conta] });
      console.log(`OK: ${conta.CODIGO} - ${conta.NOME}`);
    } catch (e) {
      console.log(`Skip ${conta.CODIGO}: ${String(e.message || e).substring(0, 80)}`);
    }
  }

  console.log('\nMigração concluída!');
}

migrate();
