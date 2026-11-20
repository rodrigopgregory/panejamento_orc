// Migracao ADITIVA — muda o padrao do FORMATO das linhas de formula para SEM_PREFIXO.
// Os valores MONETARIO existentes vieram todos do default da migracao anterior
// (add-formula-grid-cols.mjs, ontem) — nenhum foi escolha do usuario, entao a
// conversao em massa e segura. Nada e removido.
import 'dotenv/config';
import { configureSdkMitra, runDdlMitra, runDmlMitra } from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});

const projectId = parseInt(process.env.MITRA_PROJECT_ID);

async function migrate() {
  // Default da coluna (sintaxe varia por banco — skip silencioso se nao suportar)
  for (const sql of [
    "ALTER TABLE DRIVER_FORMULA ALTER COLUMN FORMATO SET DEFAULT 'SEM_PREFIXO'",
    "ALTER TABLE DRIVER_FORMULA ALTER FORMATO SET DEFAULT 'SEM_PREFIXO'",
  ]) {
    try {
      await runDdlMitra({ projectId, sql });
      console.log('OK: default da coluna FORMATO = SEM_PREFIXO');
      break;
    } catch (e) {
      console.log('Skip default:', String(e.message || e).substring(0, 100));
    }
  }

  await runDmlMitra({
    projectId,
    sql: "UPDATE DRIVER_FORMULA SET FORMATO = 'SEM_PREFIXO' WHERE FORMATO = 'MONETARIO' OR FORMATO IS NULL OR FORMATO = ''",
  });
  console.log('OK: linhas existentes convertidas para SEM_PREFIXO');
  console.log('Migration complete!');
}

migrate().catch(console.error);
