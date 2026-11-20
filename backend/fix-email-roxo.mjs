// Padroniza os e-mails das SFs no ROXO da marca (#8b5cf6/#a78bfa) — aprovacao,
// reprovacao e submissao ainda saiam com o verde antigo (#75c95f/#9ad889).
// Lembrete/disparo (frontend, buildEmailHtml) ja eram roxos. Idempotente.
import 'dotenv/config';
import { configureSdkMitra, readServerFunctionMitra, updateServerFunctionMitra } from 'mitra-sdk';
configureSdkMitra({ baseURL: process.env.MITRA_BASE_URL, token: process.env.MITRA_TOKEN, integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS });
const projectId = parseInt(process.env.MITRA_PROJECT_ID);
for (const id of [171, 147, 70]) {
  const fn = await readServerFunctionMitra({ projectId, serverFunctionId: id });
  let code = fn?.result?.code || '';
  if (!code.includes('75c95f')) { console.log(`SF ${id}: ja roxo`); continue; }
  code = code.replace(/#75c95f/g, '#8b5cf6').replace(/#9ad889/g, '#a78bfa');
  await updateServerFunctionMitra({ projectId, serverFunctionId: id, code });
  console.log(`SF ${id}: e-mails agora em roxo`);
}
