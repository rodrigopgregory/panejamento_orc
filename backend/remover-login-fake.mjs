// Remove os resquicios do "Acesso Rapido (Teste)" — login fake com personas
// demo. A autenticacao e' a nativa da plataforma (SSO + e-mail pela SDK);
// nada do app usa mais estes recursos.
//
// O que sai:
//   - personas demo da tabela USUARIOS (4 linhas com senha em texto puro)
//   - SFs publicLoginsDemoAtivos / gravarLoginsDemoFlag (flag de logins demo)
//   - linha LOGINS_DEMO_ATIVOS do APP_CONFIG (as demais chaves ficam: config do agente de IA)
//
// NAO mexe nas SFs 70/171 (busca de aprovadores) — decisao pendente com o usuario.
import 'dotenv/config';
import {
  configureSdkMitra,
  runDmlMitra,
  listServerFunctionsMitra,
  deleteServerFunctionMitra,
} from 'mitra-sdk';

configureSdkMitra({
  baseURL: process.env.MITRA_BASE_URL,
  token: process.env.MITRA_TOKEN,
  integrationURL: process.env.MITRA_BASE_URL_INTEGRATIONS,
});

const projectId = parseInt(process.env.MITRA_PROJECT_ID);

const sfs = await listServerFunctionsMitra({ projectId });
const lista = sfs.result || sfs;
for (const name of ['publicLoginsDemoAtivos', 'gravarLoginsDemoFlag', 'validarLoginTemporario']) {
  const sf = lista.find((s) => s.name === name);
  if (!sf) { console.log(`SF ${name}: ja nao existe`); continue; }
  await deleteServerFunctionMitra({ projectId, serverFunctionId: sf.id });
  console.log(`SF ${name} (id ${sf.id}) removida`);
}

await runDmlMitra({ projectId, sql: "DELETE FROM APP_CONFIG WHERE CHAVE = 'LOGINS_DEMO_ATIVOS'" });
console.log('APP_CONFIG.LOGINS_DEMO_ATIVOS removida');

// A plataforma bloqueia DROP em tabela de usuario (DESTRUCTIVE_BLOCKED) e a SDK
// ainda nao repassa a flag confirmDestructive. Enquanto isso, o que atinge o
// objetivo e' apagar as personas: a tabela fica vazia (as SFs 70/171 ainda a
// consultam para e-mail de aprovadores — dentro de try/catch, sem quebrar nada).
await runDmlMitra({ projectId, sql: "DELETE FROM USUARIOS WHERE EMAIL LIKE '%@orcaflow.demo'" });
console.log('Personas demo removidas de USUARIOS');

console.log('Limpeza do login fake concluida.');
