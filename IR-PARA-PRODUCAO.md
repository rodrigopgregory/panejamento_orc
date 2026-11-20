# Ir para produção — retirar o ambiente de demonstração

> Este roteiro existe para ser seguido **no ambiente de quem duplicar este projeto**,
> quando a pessoa decidir virar a chave de "demonstração" para "produção de verdade".
> É um checklist para humano **e** para o assistente. Siga na ordem. Não pule a validação.

## O que é o ambiente de demonstração (contexto)

Para facilitar demos, hoje o projeto tem:
- **Logins de demonstração** (personas fake: Paula/Admin, Andre/Gestor…) na tela de login.
- Uma **"chave mestra"** embutida no app (a variável `VITE_MITRA_TOKEN` no `frontend/.env`),
  usada pelas personas demo. Enquanto ela existir e for usada, o app consegue falar com o
  servidor sem cada pessoa fazer login real.

Em produção, cada pessoa faz **login real** (Google/Microsoft/e-mail) e passa a ver **só os
dados dela**; e os **links públicos** (do e-mail) continuam funcionando sem login. A retirada
do ambiente demo é o que "liga" isso de forma limpa.

## Processo (na ordem)

### 1. Confirmar com o dono do projeto
Pergunte explicitamente se é para retirar o ambiente de demonstração. Só siga com o "sim".

### 2. Desligar os logins de demonstração  *(determinístico — um clique)*
Entrando como a persona **Admin**: menu do usuário (onde troca de perfil) →
**"Remover logins de demonstração"** → confirmar.
- Isso grava `LOGINS_DEMO_ATIVOS = 'false'` em **dois lugares**: na tabela `APP_CONFIG`
  (fonte da verdade — lida na tela de login pela SF **pública** `publicLoginsDemoAtivos`,
  que não exige token) e na **variável de projeto** (fallback/compatibilidade). Depois desloga.
- Pré-requisito (já feito no template; rodar de novo é inofensivo — é idempotente):
  `node backend/add-public-demo-flag.mjs` (cria `APP_CONFIG` + SFs `publicLoginsDemoAtivos`
  e `gravarLoginsDemoFlag`).
- A tela de login passa a mostrar **apenas o login real**. É reversível: volte a flag para
  `'true'` nos dois lugares (SF `gravarLoginsDemoFlag` com `valor='true'` + a variável).
- Equivalente por código, se preferir: executar a SF `gravarLoginsDemoFlag` com
  `input: { valor: 'false' }` e `setVariableMitra({ projectId, key: 'LOGINS_DEMO_ATIVOS', value: 'false' })`.

### 3. Retirar a "chave mestra" (VITE_MITRA_TOKEN)  *(determinístico — uma constante + rebuild)*
Objetivo: o app não pode mais usar o token compartilhado embutido; deve depender **só** da
sessão de login real e dos links públicos.
- Em `frontend/src/mitra-config.ts`, mude **`DEMO_BUILD` para `false`** e rode
  `npm run build`. Toda leitura de `VITE_MITRA_TOKEN*` é centralizada no `pickEnvToken()`,
  que com `DEMO_BUILD=false` retorna sempre `null` — o `initMitra()` passa a depender só da
  sessão real do login e do modo público (`configurePublicSdk`, sem token).
- **Verificação obrigatória pós-build:** procure o **valor** do token (os primeiros ~20
  caracteres do `VITE_MITRA_TOKEN` do `frontend/.env`) dentro de `dist/assets/` — deve dar
  **0 ocorrências**. Sem essa verificação, não considere o passo concluído.
- O ovo-e-galinha da `LoginPage` já está resolvido: a flag dos logins demo é lida pela SF
  **pública** `publicLoginsDemoAtivos` (tabela `APP_CONFIG`), que funciona sem token.
- Não introduza nenhuma outra leitura de `import.meta.env.VITE_MITRA_TOKEN` em runtime —
  a leitura é centralizada de propósito para este passo ser auditável.

### 4. (Opcional) Limpar dados de demonstração  *(destrutivo — só com autorização explícita)*
Estudos do Playground de demo, lançamentos de teste, etc. **Nunca** apague sem o dono
autorizar por escrito, listando exatamente o que será removido.

### 5. Validar (OBRIGATÓRIO — não pule)
- [ ] **Login real** (Google/Microsoft/e-mail) funciona e leva ao app.
- [ ] **Segmentação por usuário**: cada pessoa vê só os dados dela. Teste rápido: dois usuários
      diferentes → cada um vê só os próprios estudos do Playground (segmentação por `:VAR_USER`).
- [ ] **Link público do e-mail**: quem recebe o link preenche e submete **sem login**, e não
      enxerga dados de outro gestor (o escopo vem do token UUID, validado no servidor).
- [ ] **Sem login**, o app cai na tela de login (o guard exige usuário).
- [ ] As personas de demonstração **não aparecem** mais na tela de login.

### 6. Não quebrar
- Links públicos e SFs públicas **não dependem de login** — devem continuar funcionando.
- A segmentação real por usuário depende do login real (passo 3). Público continua por token.

## Reverter (se precisar voltar ao modo demo)
- Volte a flag para `'true'` nos dois lugares: SF `gravarLoginsDemoFlag` com
  `input: { valor: 'true' }` + variável de projeto `LOGINS_DEMO_ATIVOS` (as personas
  voltam a aparecer).
- Volte `DEMO_BUILD` para `true` em `frontend/src/mitra-config.ts` e rode
  `npm run build`, se tiver ido para produção.

---
*Referências no código:* botão em `components/Layout.tsx` (`RemoverDemoItem` / `doRemoverDemo`);
flag em `lib/demo-tokens.ts` (`loginsDemoAtivos` / `removerLoginsDemo`); gate da tela em
`pages/LoginPage.tsx`; configuração do SDK em `mitra-config.ts`; login público em
`pages/PreenchimentoPublicoPage.tsx`.
