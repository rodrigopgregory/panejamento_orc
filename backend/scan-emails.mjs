import 'dotenv/config';
import { configureSdkMitra, listServerFunctionsMitra, readServerFunctionMitra } from 'mitra-sdk';
configureSdkMitra({ baseURL: process.env.MITRA_BASE_URL, token: process.env.MITRA_TOKEN, integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS });
const projectId = parseInt(process.env.MITRA_PROJECT_ID);
const list = (await listServerFunctionsMitra({ projectId }))?.result || [];
for (const f of list) {
  try {
    const fn = await readServerFunctionMitra({ projectId, serverFunctionId: f.id });
    const code = fn?.result?.code || '';
    if (code.includes('sendEmailMitra') || code.includes('75c95f') || code.includes('8b5cf6')) {
      const green = (code.match(/75c95f/g) || []).length;
      const purple = (code.match(/8b5cf6/g) || []).length;
      console.log(`SF ${f.id} ${f.name}: sendEmail=${code.includes('sendEmailMitra')} verde=${green} roxo=${purple}`);
    }
  } catch { /* skip */ }
}
