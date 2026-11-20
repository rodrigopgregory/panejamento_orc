# Auditoria de Implantação — itens específicos deste template

> **Versão da auditoria: 1.0.0** (histórico no fim deste arquivo)
> Documento **separado e versionado à parte** do runbook `IMPLANTACAO.md` (que é
> intocável): os itens de auditoria evoluem AQUI conforme o template ganha módulos
> e conforme implantações reais revelam novos pontos de verificação. Ao adicionar
> ou alterar itens, registre no histórico e suba a versão.

## Quando usar este documento

O agente consulta este documento em **quatro momentos**:

| Momento | O que rodar |
|---|---|
| **Após cada carga/etapa do §2** (cadastros base) | Seção 1 (auditoria de dados — `node backend/check-implantacao-dados.mjs`) |
| **Fechamento do §6** (validação da implantação) | Seções 1 + 2 + 3 + 4, nesta ordem |
| **Antes do handoff (§7)** | Reexecutar a Seção 1 e conferir que as demais continuam verdes |
| **Após mudança de fonte, dono, canal ou granularidade** (gates reabertos) | Seções afetadas pela mudança |

Os resultados (verde/vermelho, evidência, correções) são registrados no
`estado-implantacao.md` e no `tarefas.md` da empresa — este documento não é
preenchido por implantação; ele é o gabarito.

---

## Seção 1 — Auditoria de dados (automatizada, read-only)

Rodar: `node backend/check-implantacao-dados.mjs` — sai com código ≠ 0 se houver
bloqueio. Cobre, no banco:

- exatamente 1 ciclo `INICIADA` (status que o motor trata como "ciclo aberto");
- nenhum CR ativo sem gestor; nenhum gestor sem e-mail válido;
- sem duplicados ativos em `CR_CONTA`; sem FKs órfãs (CR→EMPRESA, GESTOR_CR, CR_CONTA);
- toda conta orçável (em `CR_CONTA` ativa) coberta por algum prefixo `CONTA` da
  `DRE_CONFIG` (senão some da DRE);
- toda conta orçável com vínculo em `CONTA_DRIVER` (aviso — pode ser conta recém-mapeada).

Todo item **vermelho é bloqueio** do gate em andamento.

## Seção 2 — Auditoria de segurança por leitura

Antes do teste manual com 2 contas — dá o farol sem depender de reproduzir o ataque.
Baixe o código das SFs (`readServerFunctionMitra` para cada `listServerFunctionsMitra`)
e confira:

- [ ] **Toda SF pública** (magic-link) ancora a autorização **no token dentro do SQL** — deve
      partir de `FROM/JOIN PREENCHIMENTO_TOKEN ... WHERE TOKEN = '{{token}}' AND ATIVO='true'`.
      Onde a SF recebe um id do cliente (`{{crId}}`, `{{pkgId}}`, `refId`), tem de existir um
      guard de posse: `EXISTS (SELECT 1 FROM GESTOR_CR gc WHERE gc.GESTOR_ID = t.GESTOR_ID AND
      gc.CR_ID = {{crId}})` (ou `PACOTE_STATUS` para pacote). Token inválido / CR de outro
      gestor ⇒ 0 linhas (leitura) ou no-op (escrita). **Nunca** confie em `gestorId` do cliente
      sozinho — ele só vale se cruzado com `tk.GESTOR_ID = {{gestorId}}`.
- [ ] **Escritas públicas (JS):** token sanitizado (`replace(/[^0-9a-fA-F-]/g,'')`), params
      re-coeridos server-side (numérico/escape), **todo DML embute o gate de token+posse**, e
      escrita bloqueada quando o escopo está `SUBMETIDO`/`APROVADO` e o ciclo `FECHADO`.
- [ ] **Segmentação por usuário logado:** dados privados por usuário filtram por `:VAR_USER`
      no SQL (ex.: estudos do Playground — `WHERE USUARIO_ID = :VAR_USER`), inclusive no `get`
      por id (`WHERE ID = {{id}} AND USUARIO_ID = :VAR_USER`) para evitar IDOR. Observação: a
      segmentação por `:VAR_USER` só é real **com login real** (produção); sob a chave mestra
      demo, `:VAR_USER` resolve para o mesmo usuário do token — outro motivo para o passo 3
      do `IR-PARA-PRODUCAO.md`.
- [ ] **Flag de demo e chave mestra:** SF pública `publicLoginsDemoAtivos` retorna **somente**
      a flag (nada além); em build de produção (`DEMO_BUILD=false`), o valor do
      `VITE_MITRA_TOKEN` não aparece em `dist/assets/` (0 ocorrências).

## Seção 3 — Checklist funcional geral

- [ ] DRE fecha com um caso de teste conhecido (valor lançado → linha certa, sinal certo)
- [ ] Rateios somam 100% e distribuem sem duplicar valores na DRE
- [ ] Cada gestor vê apenas seus CRs/pacotes (teste com 2+ usuários)
- [ ] Links públicos preenchem e submetem sem login, sem vazar dados de outro gestor
- [ ] Waterfall e dashboard consistentes com a DRE
- [ ] Simulação no Playground funciona com os modelos da empresa
- [ ] Gatilhos de integração funcionam (regra dos gatilhos do §0 do runbook): ação
      "Atualizar da fonte" importa de verdade, atualiza o indicador de última
      atualização e registra a execução — ou o cron rodou no horário esperado
- [ ] A atualização do realizado executa o pacote completo da base financeira na ordem
      `empresas → centros de resultado → contas contábeis → realizado`; os três
      cadastros ficam visíveis em **Cadastros** e uma dimensão sem correspondência
      impede a publicação parcial do realizado

## Seção 4 — Casos de teste por tratamento configurado

Rodar um caso para **cada tratamento que a empresa usa** (conforme o
`mapa-implantacao.md`):

- [ ] **Driver NORMAL:** valor lançado num CR aparece na DRE na linha certa (pelo prefixo)
      e com o sinal correto
- [ ] **Modelo (escopo CR):** fórmula (`[L2] * [L3]`, `{3.1.01}`) calcula; alterar um input
      recalcula a linha; publicar versão congela o modelo
- [ ] **Pacote + rateio:** valor único distribui por CR (soma dos rateios = total) e a DRE
      **não duplica** o valor
- [ ] **Modelo de pacote:** linha `GRANULARIDADE='CR'` aceita input por CR; linha com
      `RATEIO_ID` distribui; submissão trava com `rateio_pendente` se faltar `RATEIO_ITEM`
- [ ] **Premissas:** alíquota de imposto aplica na conta certa; dissídio/turnover refletem
      na folha
- [ ] **Pessoal:** "Recalcular folha" gera `ORCAMENTO_PESSOAL` e grava em `ORCAMENTO`
      (`5.1.01`/`5.1.02`/`5.1.03`); desligamento projetado corta a partir do mês definido
- [ ] **Receita:** premissa `Quantidade × Valor Hora` (serviço) / `Ticket Médio` (produto)
      gera a receita no CR/mês corretos
- [ ] **Extensão (se houver):** os 5 testes de aceite do §4.1 do runbook passam
- [ ] **Fora de escopo:** contas assim classificadas NÃO aparecem em `CR_CONTA` nem em
      tela de preenchimento, e a justificativa está no mapa

---

## Histórico de versões da auditoria

| Versão | Data | Mudança |
|---|---|---|
| 1.0.0 | 2026-07-22 | Criação: itens migrados do §6 do runbook (protocolo 1.2.0) + auditoria de dados automatizada (`check-implantacao-dados.mjs`) + itens da flag demo/chave mestra + caso de teste "Fora de escopo". |
