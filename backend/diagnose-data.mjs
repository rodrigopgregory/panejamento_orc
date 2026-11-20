import 'dotenv/config';
import { configureSdkMitra, executeServerFunctionMitra, listTablesMitra } from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS
});

const projectId = parseInt(process.env.MITRA_PROJECT_ID);
const SF_QUERY = 18;

async function q(sql) {
  const res = await executeServerFunctionMitra({ projectId, serverFunctionId: SF_QUERY, input: { sql } });
  let output = res?.result?.output;
  if (typeof output === 'string') try { output = JSON.parse(output); } catch {}
  if (output && Array.isArray(output.rows)) return output.rows;
  if (Array.isArray(output)) return output;
  return [];
}

async function diagnose() {
  console.log('=== DIAGNOSTICO DE DADOS ===\n');

  // 1. Listar tabelas existentes
  const tables = await listTablesMitra({ projectId });
  const list = tables?.result || tables || [];
  console.log('Tabelas existentes:');
  list.forEach(t => console.log(`  - ${t.name || t.NAME || t}`));
  console.log();

  // 2. Contar registros nas tabelas principais
  const tabelas = [
    'CENTRO_RESULTADO', 'CONTA_CONTABIL', 'DRIVERS', 'CICLO',
    'ORCAMENTO', 'REALIZADO_CONTABIL', 'COLABORADOR', 'CARGO',
    'GESTOR', 'GESTOR_PACOTE', 'PACOTE_STATUS', 'DRIVER_CONFIG',
    'DRE_CONFIG', 'CR_CONTA', 'CONTA_DRIVER', 'ORCAMENTO_PACOTE',
    'RATEIO_CONFIG', 'RATEIO_CR', 'PREMISSA', 'INT_USER'
  ];

  console.log('Contagem por tabela:');
  for (const t of tabelas) {
    try {
      const rows = await q(`SELECT COUNT(*) AS N FROM ${t}`);
      const n = rows[0]?.N ?? rows[0]?.n ?? 0;
      console.log(`  ${t.padEnd(25)} ${n}`);
    } catch (e) {
      console.log(`  ${t.padEnd(25)} (erro: ${String(e.message || e).substring(0, 60)})`);
    }
  }
}

diagnose().catch(e => { console.error('Diagnose failed:', e); process.exit(1); });
