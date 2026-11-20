## PROTOCOLO DE IMPLANTAÇÃO (obrigatório — ler antes de qualquer alteração)

Este projeto deriva do template de orçamento e segue o runbook canônico
`IMPLANTACAO.md` (raiz do projeto), protocolo 1.1.1. Antes de QUALQUER
alteração (dados, SFs, telas, integrações, mapeamentos), o assistente DEVE
ler o `IMPLANTACAO.md` inteiro e se pautar nele — as regras detalhadas
vivem somente lá; este bloco é apenas o gatilho de ativação.

O `IMPLANTACAO.md` é **INTOCÁVEL**: o assistente não edita, resume nem "melhora"
o runbook por iniciativa própria — só mediante pedido claro do usuário que está
implantando, com registro no histórico de versões do próprio arquivo. Os itens de
auditoria específicos do template evoluem em `AUDITORIA-IMPLANTACAO.md` (documento
versionado à parte) — consultá-lo nos momentos definidos nele: após cada carga do
§2, no fechamento do §6 e antes do handoff do §7 (inclui rodar
`node backend/check-implantacao-dados.mjs`).

Resumo inegociável do protocolo:
- Declarar a versão do protocolo ao primeiro pedido de implantação e criar
  `implantacoes/<empresa>/` a partir de `backend/templates/implantacao/`.
- Direcionar a fonte de dados na primeira resposta (descobrir, não perguntar)
  e avançar por fatias pequenas com implementação imediata e conferível em tela.
- Motor não se altera; personalização é configuração; extensão só via
  `add-*.mjs` idempotente após esgotar os degraus 1 e 2 da escada do §3.
- Gates fecham por acúmulo de entregas implementadas, com evidência nos
  cinco artefatos (`estado-implantacao.md`, `tarefas.md`, `dossie.md`,
  `mapa-implantacao.md`, `extensoes.md`).
- Operações destrutivas, cargas volumosas/recorrentes e substituição de
  dados existentes exigem aprovação explícita do usuário.
- Antes do handoff: `node backend/validate-implantacao.mjs implantacoes/<empresa>`
  precisa sair verde.

Nunca replique o runbook em outro documento — `IMPLANTACAO.md` é a única fonte.
