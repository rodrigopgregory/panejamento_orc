import 'dotenv/config';
import { configureSdkMitra, runDmlMitra } from 'mitra-sdk';

function backUrlFromToken(token) {
  try {
    const raw = (token || '').replace(/^Bearer\s+/i, '');
    const payload = JSON.parse(Buffer.from(raw.split('.')[1], 'base64').toString('utf8'));
    return payload.backURL || payload.backUrl;
  } catch { return null; }
}

const baseURL = process.env.MITRA_BASE_URL || backUrlFromToken(process.env.MITRA_TOKEN);

configureSdkMitra({
  baseURL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS || process.env.MITRA_BASE_URL_SPACE || baseURL,
});
const projectId = parseInt(process.env.MITRA_PROJECT_ID);

const DESC = 'Licenças e serviços de software contratados.';

try {
  const r = await runDmlMitra({
    projectId,
    sql: `UPDATE DRIVERS SET DESCRICAO = '${DESC}' WHERE TIPO_DRIVER = 'PACOTE' AND (NOME = 'Custos Software' OR NOME = 'CUSTOS_SOFTWARE' OR LOWER(NOME) = 'custos software' OR LOWER(NOME) = 'custos_software')`,
  });
  console.log('OK:', r);
} catch (e) {
  console.error('FAIL:', e?.message || e);
}
