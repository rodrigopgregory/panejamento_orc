import 'dotenv/config';
import { configureSdkMitra, createServerFunctionMitra, listServerFunctionsMitra } from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS
});

const projectId = parseInt(process.env.MITRA_PROJECT_ID);

async function migrate() {
  // Create new JAVASCRIPT SF for sending email via native Mitra service
  try {
    const sf = await createServerFunctionMitra({
      projectId,
      name: 'enviarEmailMitraNativo',
      type: 'JAVASCRIPT',
      code: `
const { sendEmailMitra } = require('mitra-sdk');

const to = Array.isArray(event.to) ? event.to : [event.to];
const result = await sendEmailMitra({
  projectId: ${projectId},
  to,
  subject: event.subject,
  body: event.body,
});

return { success: true, message: result.message || 'Email enviado', recipientCount: to.length };
      `.trim(),
      description: 'Envia email para gestores usando servico nativo Mitra (sendEmailMitra)',
    });
    console.log('OK: New SF created:', JSON.stringify(sf.result));
  } catch (e) {
    console.error('Error creating SF:', e.message || e);
  }

  // List all SFs to confirm
  const sfs = await listServerFunctionsMitra({ projectId });
  for (const sf of sfs.result) {
    console.log(`SF ${sf.id}: ${sf.name} (${sf.type})`);
  }
}

migrate();
