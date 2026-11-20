-- tipo: JAVASCRIPT | Envia email nativo (sendEmailMitra). projectId vem de event.projectId (fallback projeto atual).
const { sendEmailMitra } = require('mitra-sdk');

// projectId vem do frontend (event.projectId) — NUNCA hardcodar outro projeto.
// Fallback para o projeto atual caso o caller nao passe.
const projectId = event.projectId || 52243;

const to = Array.isArray(event.to) ? event.to : [event.to];
const result = await sendEmailMitra({
  projectId,
  to,
  subject: event.subject,
  body: event.body,
});

return { success: true, message: result.message || 'Email enviado', recipientCount: to.length };