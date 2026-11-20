// Adiciona a coluna ORIGEM na tabela DRIVERS para a taxonomia pedida pelo gestor:
//   NATIVO — drivers do sistema (BASE_ZERO, BASE_HISTORICO, PESSOAL): sem config, so disclaimer
//   IA     — drivers criados pela IA: mesmo tratamento do nativo (sem config, so disclaimer)
//   TELA   — drivers criados pelo usuario na tela (ex: RECEITA): totalmente configuraveis
// Migracao 100% aditiva: nao altera nem remove nada existente.
import 'dotenv/config';
import { configureSdkMitra, runDdlMitra, runDmlMitra } from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS
});

const projectId = parseInt(process.env.MITRA_PROJECT_ID);

async function migrate() {
  try {
    await runDdlMitra({
      projectId,
      sql: `ALTER TABLE DRIVERS ADD COLUMN ORIGEM VARCHAR(10)`
    });
    console.log('OK: coluna ORIGEM adicionada em DRIVERS');
  } catch (e) {
    console.log('Skip ALTER (coluna pode ja existir):', String(e.message || e).substring(0, 100));
  }

  try {
    await runDmlMitra({
      projectId,
      sql: `UPDATE DRIVERS SET ORIGEM = 'NATIVO' WHERE NOME IN ('BASE_ZERO', 'BASE_HISTORICO', 'PESSOAL')`
    });
    console.log('OK: nativos classificados (BASE_ZERO, BASE_HISTORICO, PESSOAL)');
  } catch (e) {
    console.log('Erro backfill NATIVO:', String(e.message || e).substring(0, 100));
  }

  try {
    // Todo o resto (RECEITA e demais customizados/pacotes) foi criado via tela
    await runDmlMitra({
      projectId,
      sql: `UPDATE DRIVERS SET ORIGEM = 'TELA' WHERE ORIGEM IS NULL`
    });
    console.log('OK: demais drivers classificados como TELA');
  } catch (e) {
    console.log('Erro backfill TELA:', String(e.message || e).substring(0, 100));
  }

  console.log('Migracao ORIGEM concluida!');
}

migrate();
