-- tipo: JAVASCRIPT | Envia email ao gestor com link do workflow

const sdk = require('mitra-sdk');
await sdk.sendEmailMitra({
  projectId: 44374,
  to: [event.to],
  subject: event.subject || ('Mitra FP&A - Nova versao orcamentaria: ' + event.versaoNome),
  body: event.body || ('<p>Ola ' + event.gestorNome + ', acesse: <a href="' + event.workflowUrl + '">Workflow</a></p>')
});
return { success: true, sentTo: event.to };
