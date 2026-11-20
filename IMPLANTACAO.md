# Implantação — personalizar este template para uma empresa

> **Protocolo de implantação: 1.2.0** (histórico de mudanças no fim deste arquivo)
> **Fonte canônica:** este arquivo. Modelos e diretrizes apenas apontam para esta versão;
> nunca replique o runbook inteiro em outro documento.

> **⛔ ARQUIVO INTOCÁVEL.** Este runbook NÃO pode ser editado, resumido, renumerado ou
> "melhorado" pelo assistente — em nenhuma implantação, por nenhum motivo próprio.
> A única exceção é o **usuário que está implantando pedir claramente** um ajuste
> específico neste arquivo; nesse caso, registrar a mudança no histórico de versões
> (fim do arquivo) e subir a versão do protocolo. Itens de auditoria específicos da
> implantação do template evoluem no documento separado `AUDITORIA-IMPLANTACAO.md`
> (versionado à parte) — nunca aqui.

> **Status: COMPLETO.** Todas as fases (§0–§7) estão preenchidas com o modo de operação
> incremental, formato de carga, mini-roteiros por tratamento, convenção de scripts e
> passo a passo de workflow/links — grounded nas tabelas, telas e Server Functions
> reais do motor. Siga a ordem de dependências; feche os gates por **acúmulo de
> entregas implementadas**, não por papelada. Os checklists de auditoria vivem em
> `AUDITORIA-IMPLANTACAO.md`.

> Este roteiro é para ser seguido **no ambiente de quem duplicar este projeto**, quando
> for implantar o orçamento em uma empresa real. É um runbook para humano **e** para o
> assistente. O agente **direciona** a implantação: descobre sozinho o que é
> descobrível, propõe pronto, **implementa na estrutura existente assim que cada fatia
> é aprovada** e devolve algo conferível numa tela a cada rodada. O consultor decide o
> que é de negócio; o agente executa — na mesma rodada.

---

## §0 — Como usar este documento

### Contrato de ativação obrigatório

Todo projeto derivado deste template deve receber, na criação, o conteúdo de
`backend/templates/implantacao/diretrizes-adicionais.md` nas suas diretrizes adicionais.
Essa diretriz é o gatilho que obriga o assistente a ler este runbook antes de qualquer
alteração. O texto é curto de propósito: as regras detalhadas vivem somente aqui.
Para aplicar ou atualizar o bloco sem apagar diretrizes já existentes, execute uma vez:
`node backend/apply-implantacao-diretrizes.mjs`.

Ao primeiro pedido de implantação, o assistente deve:

1. declarar a versão deste protocolo que está usando;
2. criar `implantacoes/<empresa>/` a partir dos modelos em
   `backend/templates/implantacao/`;
3. **direcionar a fonte de dados na primeira resposta** (§1.0): ler o que já existe no
   projeto, afirmar a forma de integração e executar o mapeamento inicial na mesma
   rodada — sem abrir com questionário;
4. avançar por fatias aprovadas (ver "Modo de operação" abaixo); operações destrutivas,
   cargas volumosas/recorrentes e substituição de dados existentes continuam atrás de
   aprovação explícita;
5. atualizar `estado-implantacao.md` ao concluir cada gate;
6. executar `node backend/validate-implantacao.mjs implantacoes/<empresa>` antes do
   handoff. Saída diferente de zero significa implantação incompleta.

Se o projeto já estiver parcialmente implantado, não presuma gates retroativamente:
reconstrua as evidências, apresente-as ao usuário e só então registre a aprovação.

### Modo de operação — entregas pequenas, implementação imediata

A régua de qualidade de uma rodada de implantação **não é o dossiê atualizado — é o
que ficou implementado e conferível numa tela**. O ciclo de toda rodada é:

1. **DIRECIONAR** — o assistente lê o projeto (conexões, integrações, telas, tabelas)
   e **afirma** o caminho ("sua fonte é Sankhya via gateway; vou mapear empresas,
   plano de contas e realizado direto na fonte"). Não pergunta o que pode descobrir
   sozinho.
2. **EXECUTAR** — roda a leitura/probe na hora (read-only, amostras limitadas).
3. **IMPLEMENTAR** — devolve o achado já como configuração aplicada na estrutura
   existente do motor (ou pronta para aplicar com uma única aprovação).
4. **MOSTRAR** — aponta a tela onde o consultor confere o resultado ("as 5 empresas
   já estão carregadas — confere na tela e me diz se a razão social bate").

Regras do modo de operação:

- **Toda rodada termina com uma entrega conferível** — um cadastro carregado, uma SF
  criada, um gatilho plugado numa tela. Rodada que só atualiza documento é rodada
  falha. Exceção única: quando a próxima ação é destrutiva ou depende de decisão de
  negócio que só o consultor pode tomar.
- **Fatias pequenas, na ordem de dependência.** Não espere a descoberta "completa"
  para começar: empresas aprovadas → carrega empresas; plano aprovado → carrega
  plano. O consultor vê progresso em toda interação.
- **Perguntas sempre acompanham uma entrega.** Máximo 3–5 por rodada, só decisão de
  negócio, e nunca numa mensagem que não entrega nada ("carreguei X — confere na
  tela; enquanto isso, me confirma Y").
- **Motor primeiro.** Tudo se implementa na estrutura existente (tabelas, telas, SFs
  do motor). Só quando o caso descrito pelo consultor comprovadamente não encaixa
  (escada do §3) o assistente propõe itens adicionais — e aí propõe um desenho
  pronto, não pergunta genericamente.
- **Os artefatos (seção Evidências) são registro, não entrega.** Atualizam-se como
  subproduto da implementação, nunca como o produto da rodada.

### Regra dos gatilhos — todo fluxo mapeado ganha seu encaixe na tela

Quando um fluxo de dados é definido, o encaixe operacional é implementado **na mesma
entrega**, na tela onde o dado é consumido — não fica como "SF solta" esperando o fim
da implantação:

| Fluxo definido | Encaixe obrigatório (mesma entrega) |
|---|---|
| Importação **sob demanda** (ex.: realizado contábil) | Ação "Atualizar da fonte" na tela que exibe o dado (ex.: **Resultado Contábil**) + sincronização prévia dos cadastros financeiros dependentes na tela **Cadastros** + indicador de última atualização + registro de cada execução |
| Importação **periódica** | Cron da SF (Spring cron, 6 campos) + indicador de última atualização na tela |
| Consulta **online** (cadastro leve) | SF INTEGRATION consumida pelo ponto de uso real (tela ou carga) |
| Preenchimento por gestor | Entra no link público e na completude/submissão existentes (§4.1) |

Exemplo condutor: se a controladoria decidiu que o realizado é importado sob demanda,
a entrega do realizado só está completa quando a mesma execução, nesta ordem:

1. atualiza empresas, centros de resultado e contas contábeis a partir da fonte;
2. materializa esses registros nas tabelas do motor e os disponibiliza na tela
   **Cadastros**;
3. valida que todo lançamento possui empresa, centro e conta correspondentes;
4. somente então publica o realizado na tela **Resultado Contábil**, mostra quando foi
   a última carga e registra a execução.

Essa sequência é o **pacote da base financeira**. O botão não pode atualizar apenas
`REALIZADO_CONTABIL` usando dimensões antigas. Se qualquer cadastro necessário não
puder ser conciliado, a carga do realizado falha sem publicar uma base parcialmente
atualizada; o histórico deve informar a entidade e os registros pendentes.

### Evidências obrigatórias

Cada implantação mantém cinco artefatos vivos, todos no diretório da empresa:

| Artefato | Finalidade | Atualização mínima |
|---|---|---|
| `estado-implantacao.md` | Versão do protocolo, fase atual e aceite dos gates | em toda transição de fase |
| `tarefas.md` | Checklist executável de todas as fases e validações | antes e depois de cada atividade |
| `dossie.md` | Descoberta, matriz fonte × dono × canal e decisões de integração | durante §1 e quando a origem mudar |
| `mapa-implantacao.md` | Conta → tratamento → responsável → justificativa | durante §3 e ao alterar mapeamentos |
| `extensoes.md` | Degraus 1/2 esgotados, desenho e testes de cada extensão | durante §4; declarar `NENHUMA` quando não houver |

Uma mensagem de chat não substitui evidência, e um artefato atualizado não substitui
implementação: o gate só fecha quando a configuração correspondente está **no ar** e o
`estado-implantacao.md` registra quem aprovou e quando. Os artefatos são o registro do
que foi implementado — preenchê-los nunca é a entrega da rodada.

**As três camadas do template** — antes de qualquer ação, o agente deve classificar o que
vai tocar:

| Camada | O que é | Regra |
|---|---|---|
| **Motor** | Telas, Server Functions, tabelas core (DRIVERS, DRIVER_FORMULA*, RATEIO*, ORCAMENTO_PACOTE, workflow, versões, auditoria) | **Não mexer.** Personalização nunca passa por reescrever o motor |
| **Configuração** | Ciclo, CRs, plano de contas, DRE config, regras contábeis, gestores, premissas, mapeamento conta → tratamento | O grosso da implantação — só dados e parametrização |
| **Extensão** | Tabelas auxiliares novas e modelos personalizados específicos da empresa | Sempre via scripts `add-*.mjs` idempotentes, seguindo §4 |

**Regras invioláveis:**
- NUNCA editar este runbook (`IMPLANTACAO.md`) — só mediante pedido claro do usuário
  que está implantando, com registro no histórico de versões e bump do protocolo
- Itens de auditoria evoluem SOMENTE em `AUDITORIA-IMPLANTACAO.md` (documento
  versionado à parte) — consultar esse documento nos momentos definidos nele
  (após cada carga, no fechamento do §6 e antes do handoff do §7)
- NUNCA reexecutar o setup completo do backend (recria schema e apaga dados)
- NUNCA editar/renumerar migrations já aplicadas — correção é sempre script novo
- NUNCA alterar tabelas core sem necessidade comprovada e sem autorização do usuário
- Toda decisão de mapeamento passa por `AskUserQuestion` antes de ser executada
- Cada fase fecha com sua **Saída** validada; dentro da fase, o avanço é por fatias
  implementadas (Modo de operação), nunca por documentação acumulada
- Diretrizes adicionais ativam o protocolo, mas não substituem este documento
- Nunca marque gate como aprovado sem evidência materializada nos cinco artefatos
- Mudança de fonte, dono, canal ou granularidade reabre os gates afetados

**Formato de cada fase:** `Entrada` → `Ação` → `Saída` → `GATE` (aprovação explícita do
usuário). O GATE fecha por **acúmulo de fatias já implementadas e conferidas** — não
por uma aprovação de papelada ao final da fase.

---

## §1 — Direcionamento da fonte e mapeamento inicial

Esta fase **não é um questionário** — é a primeira sequência de entregas. O assistente
direciona, executa e implementa; o consultor confirma e decide o que é de negócio.
Regra viva: nenhuma pergunta cuja resposta esteja no projeto ou na fonte — **descubra,
não pergunte**.

### §1.0 — Direcione a integração (não pergunte qual é)

**Primeiro ato de qualquer implantação:** ler o que existe e **afirmar** a forma de
integração — o consultor não deve precisar explicar de onde vêm os dados.

**Leitura (sem perguntar nada):**
- `listJdbcConnectionsMitra` — quais conexões há? `driverId 21/22` = **Sankhya DB**;
  `Auto connect` = banco do próprio projeto.
- `listIntegrationsMitra` / `listDataLoadersMitra` / `listOnlineTablesMitra` — já
  existe importação configurada? Reaproveite; não recrie.
- `listIntegrationTemplatesMitra` — templates disponíveis (**prioritários** sobre
  qualquer solução "da internet"; lista vazia = possível erro operacional, revalidar).

**Decisão de direcionamento:**
- **Há integração/conexão configurada** (ex.: Sankhya via gateway) → declarar: *"Sua
  fonte é [X]. Vou mapear os cadastros principais direto na fonte agora."* — e
  executar o §1.1 **na mesma rodada**.
- **Há mais de uma candidata** → 1 pergunta objetiva de escolha (`AskUserQuestion`),
  já executando em paralelo o que não depende da resposta.
- **Não há nada** → direcionar a conexão: propor o template certo, instruir
  credenciais **pela interface do Mitra** (nunca no chat) e, para dado sem sistema
  (planilha/CSV), definir o formato da carga (§2). **Sem dados fictícios** — em
  integração, só dados reais depois de credencial válida.

**Guia de integração (obrigatório, mas por entrega):** integração externa continua
exigindo estudar o guia antes de implementar pipeline:
`https://github.com/brunobortp-netizen/guia-integracao-dados/blob/master/guia-integracao-dados.md`
As fases do guia (**Discovery → Arquitetura → Alinhamento → Contrato → Implementação**)
valem **por entrega, não como um contratão único ao final**:
- Probes **read-only com amostras limitadas** (contagens, TOP N) fazem parte do
  Discovery e não dependem de contrato — execute-as de imediato.
- Cadastros leves (empresas, CRs, plano de contas) têm contrato curto próprio,
  aprovado na fatia (§1.2), que libera a carga daquela entidade na mesma rodada.
- Dado volumoso/recorrente (realizado) tem seu contrato específico (modelo, cursor,
  deletes, janela, ordem estrita JDBC → Data Loader → DDL → SF → Cron → Logs) antes
  do pipeline definitivo.
- **Substituir dados existentes do template continua exigindo autorização explícita.**

### §1.1 — Mapeie os cadastros principais direto na fonte (mesma rodada)

Com a fonte direcionada, **executar imediatamente** o mapeamento dos quatro blocos que
condicionam a implantação — e voltar com números reais, não com perguntas:

| # | Bloco | O que levantar na fonte | Vira o quê no motor |
|---|---|---|---|
| 1 | **Empresas** | lista real (razão social, CNPJ) | linhas em `EMPRESA` (pré-requisito do CR) |
| 2 | **Centros de custo/resultado** | contagem, granularidade, hierarquia por prefixo, ativos × inativos | `CENTRO_RESULTADO` — validar a **granularidade de decisão** antes de importar milhares |
| 3 | **Plano de contas** | tabela real da fonte, código/nome/tipo/natureza, hierarquia implícita no código | `CONTA_CONTABIL` + proposta de `DRE_CONFIG` (ordem, subtotais, sinais) |
| 4 | **Realizado contábil** | volume total, período coberto, cursor de atualização (`DT_ALTERACAO` etc.), taxa de alteração | pacote da base financeira: sincroniza `EMPRESA`, `CENTRO_RESULTADO` e `CONTA_CONTABIL`, expõe os cadastros na tela **Cadastros** e só então atualiza `REALIZADO_CONTABIL` pelo **gatilho na tela Resultado Contábil** (regra dos gatilhos, §0) |

Com o volume medido, **propor a periodicidade por entidade** — é proposta do
assistente, não pergunta aberta: cadastro leve → online ou carga pontual; realizado
volumoso → importação (sob demanda ou periódica — decisão de negócio da
controladoria). Formato da proposta (do guia): Resumo Técnico + opções com
prós/contras em linguagem de negócio + recomendação com motivo.

O que **não** dá para inferir e é sempre perguntado (com parcimônia, junto de uma
entrega): gestor de cada CR (nome + **e-mail**; 1 gestor por CR), ciclo (nome, ano,
calendário; exatamente 1 `INICIADA` — status que o motor trata como "ciclo aberto"),
políticas de RH (só se houver módulo Pessoal),
despesas centralizadas candidatas a **pacote** (propor a partir das contas; o
consultor confirma), impostos sobre receita (propor a partir das contas de receita →
`PREMISSA_IMPOSTO`).

### §1.2 — Volte com proposta implementável — e implemente ao aprovar

O retorno do mapeamento é **por fatia**, no formato:

```
[Entidade] — o que encontrei na fonte (números reais)
Como encaixa no motor (tabela/tela de destino, regra do motor aplicável)
O que vou implementar agora (carga/SF/gatilho, escopo exato)
Pergunta (só se houver decisão de negócio; máx 3–5 na rodada)
```

Ao OK de cada fatia (via `AskUserQuestion`), **implementar na mesma rodada**, seguindo
o formato de carga do §2 e a regra dos gatilhos do §0. Sequência típica com ERP
conectado:

1. Empresas confirmadas → carga em `EMPRESA` → conferir na tela.
2. CRs confirmados (granularidade!) → carga em `CENTRO_RESULTADO` → tela Mapeamento.
3. Plano confirmado → carga em `CONTA_CONTABIL` + proposta de `DRE_CONFIG` → tela
   DRE Config.
4. Periodicidade do realizado decidida → pipeline único da base financeira que, a cada
   execução, sincroniza empresas, CRs e contas → valida todas as dimensões → atualiza o
   realizado + **ação na tela Resultado Contábil** (sob demanda) ou cron (periódica) +
   cadastros conferíveis na tela **Cadastros** + indicador de última atualização.

O dossiê (`implantacoes/<empresa>/dossie.md`, a partir do template) consolida **o que
foi implementado e decidido** — fonte no topo (resumo técnico + contratos por
entrega), matriz fonte × dono × canal, uma seção por bloco. Ao final, já rascunhe a
tabela do §7 (mapa de implantação) com **todas as contas listadas** e a coluna
"Tratamento" em branco — preenchida em lotes no §3.

**Entrada:** projeto lido + fonte direcionada.
**Ação:** mapear na fonte, propor por fatia, implementar cada fatia aprovada.
**Saída:** cadastros principais **no ar** e conferidos nas telas; periodicidade do
realizado definida e seu gatilho implementado.
**GATE §1:** fecha por acúmulo — fonte direcionada + fatias dos 4 blocos aprovadas e
implementadas. Registrar no `estado-implantacao.md` o aceite de cada fatia.

---

## §2 — Cadastros base

> **Com ERP conectado, a carga sai da fonte via integração — não peça planilha ao
> cliente.** Empresas, CRs e contas normalmente já entraram como fatias do §1; esta
> fase completa o que **não vive no ERP** (ciclo, gestores e e-mails, vínculos
> CR × conta, DRE Config, regras contábeis, rateios) e valida o conjunto.
> Planilha/CSV é o fallback para dado que não existe em sistema.

**Ordem de carga (obrigatória):**
1. Ciclo
2. Centros de resultado
3. Contas contábeis
4. Gestores
5. Vínculos CR × conta
6. Configuração da DRE (grupos, ordem, sinais)
7. Regras contábeis

**Pré-requisito:** carregue `EMPRESA` (`NOME, CNPJ, ATIVO`) antes do passo 2 — o CR
referencia `EMPRESA_ID`.

**Formato de cada carga** (colunas do CSV/planilha), tela para conferir e validação:

| # | Cadastro | Tabela | Colunas da carga | Tela para conferir | Validação pós-carga |
|---|---|---|---|---|---|
| 1 | Ciclo | `CICLO` | `NOME, ANO, STATUS` (`STATUS='INICIADA'` — é o status que o motor trata como ciclo aberto; `FECHADO` encerra) | Ciclos | exatamente 1 ciclo `INICIADA`; ano correto |
| 2 | Centro de resultado | `CENTRO_RESULTADO` | `CODIGO, NOME, EMPRESA_ID, ATIVO` | Mapeamento / Gestores | `EMPRESA_ID` resolve; sem `CODIGO` duplicado |
| 3 | Conta contábil | `CONTA_CONTABIL` | `CODIGO, NOME, TIPO, NATUREZA, ATIVO` | Mapeamento | `CODIGO` segue a convenção de prefixo da DRE |
| 4 | Gestor | `GESTOR` | `NOME, EMAIL, ATIVO` | Gestores | e-mail válido (destino do link público) |
| 5 | Gestor × CR | `GESTOR_CR` | `GESTOR_ID, CR_ID` | Gestores | **1 gestor por CR**; todo CR ativo tem dono |
| 6 | Vínculo CR × conta | `CR_CONTA` | `CR_ID, CONTA_ID, ATIVO, CRIADO_EM` | Mapeamento → "Setores e contas" | cada (CR,conta) orçável marcado; sem duplicados |
| 7 | Config da DRE | `DRE_CONFIG` | `ORDEM, NOME_LINHA, TIPO, PREFIXO_CONTA, SINAL, IS_SUBTOTAL` | DRE Config | `TIPO∈{CONTA,SUBTOTAL}`; `SINAL∈{1,-1}`; prefixos cobrem todas as contas |
| 8 | Tipos de rateio (catálogo) | `RATEIO` + `RATEIO_ITEM` | `RATEIO: NOME, DESCRICAO, TIPO(QUANTIDADE\|PERCENTUAL), ATIVO` · `RATEIO_ITEM: RATEIO_ID, CR_ID, QUANTIDADE` | Mapeamento → "Tipos de rateio" | itens somam a base esperada; sem CR repetido no mesmo rateio |

> **Passos 1–7 = a "Ordem de carga (obrigatória)" acima.** O passo 8 (catálogo de rateio)
> pode ser pré-carregado aqui, mas o vínculo conta→driver/rateio propriamente dito é
> decidido conta a conta no **§3** (aba "Drivers por conta" do Mapeamento) — não antecipe.

**Convenções de tipo (importante):** as tabelas fundacionais são provisionadas pelo
auto-schema da plataforma. Datas são `VARCHAR` (`YYYY-MM-DD` ou `YYYY-MM-DDTHH:MM:SS`), e
`ATIVO` é a **string** `'true'`/`'false'` (não booleano). A hierarquia de contas é
**implícita no `CODIGO`** (prefixo pontuado) — não existe coluna de conta-pai.

**Validações pós-carga (rodar após cada etapa, antes do gate):**
- Toda FK resolve (CR→EMPRESA, GESTOR_CR→GESTOR/CR, CR_CONTA→CR/CONTA).
- Antes de publicar cada atualização do realizado, empresas, CRs e contas foram
  sincronizados na mesma execução e aparecem na tela **Cadastros**; nenhum lançamento
  referencia dimensão ausente ou cadastro obsoleto.
- Nenhum CR ativo sem gestor; nenhum gestor com 2 CRs pela mesma conta.
- Toda conta orçável tem prefixo coberto por alguma linha `CONTA` da `DRE_CONFIG` (senão
  some da DRE).
- Sem duplicados em `CR_CONTA` (use `check-cr-conta-duplicates.mjs` como referência).

**Entrada:** fatias implementadas no §1 + dados que não vivem no ERP (gestores, ciclo,
vínculos), por planilha ou informados pelo consultor.
**Ação:** completar a carga na ordem acima, validando após cada etapa — cada etapa é
uma entrega conferível, não acumule tudo para o fim.
**Saída:** cadastros conferidos nas telas (Ciclos, Gestores, DRE Config, Regra Contábil).
**GATE §2:** fecha por acúmulo — usuário validou cada cadastro na tela conforme foi
entrando.

---

## §3 — Mapeamento conta a conta (coração da implantação)

Para **cada conta/grupo de despesa** do plano da empresa, classificar o tratamento no
motor usando a árvore de decisão. Registrar cada decisão no mapa de implantação (§7).

**Trabalhe em lotes com implementação imediata.** Não espere o mapa 100% para começar
a configurar: agrupe as contas (por grupo da DRE ou por tratamento provável), proponha
o lote via `AskUserQuestion` e **configure o lote aprovado na mesma rodada** (vínculo
em `CONTA_DRIVER`, pacotes, modelos, premissas). A cada lote, aponte a tela onde o
consultor confere (Mapeamento → "Drivers por conta"). O GATE §3 fecha quando o acúmulo
de lotes cobre 100% das contas — **já configuradas, não só classificadas**.

**Regra zero — o dono do dado define o canal.** Antes de classificar pelo formato do
dado, pergunte **quem preenche**. Formato não define canal; dono define. Vale para todo
dado do orçamento — inclusive os que "parecem premissa":

| Dono do dado | Canal | Exemplo |
|---|---|---|
| Controladoria | Telas centrais (Premissas, DRE Config, cadastros) | Dissídio, imposto, teto de reajuste, meta de crescimento |
| Gestor | Canal de preenchimento (link por e-mail, escopo por token, workflow de submissão/aprovação) | Lançamentos por driver/modelo/pacote; volume e preço da carteira dele |
| Sistema/carga | Tabelas carregadas (planilha/data loader) | Base histórica, realizado, cadastros importados |

**Árvore de decisão:**

| Pergunta ao consultor | Resposta → Tratamento |
|---|---|
| Quem orça essa despesa? | Cada gestor no seu CR → **driver NORMAL** · Um responsável central → **PACOTE** |
| O valor é digitado direto ou calculado (qtd × preço, linhas, fórmulas)? | Calculado → **modelo personalizado** (DRIVER_FORMULA, escopo CR ou PACOTE) |
| Dentro do pacote, a linha varia por CR? | Sim → linha com **granularidade** por CR |
| Como o valor central chega aos CRs? | → tipo de **rateio** (fixo, proporcional, igualitário, manual) |
| Depende de política corporativa (dissídio, imposto, turnover)? | → **premissa** |
| É folha/headcount? | → módulo **pessoal** (cargos, colaboradores, contratações/desligamentos projetados) |
| Depende de dados que o motor não tem (frota, contratos, apólices…)? | → **tabela auxiliar nova** (§4) |
| A conta não se orça (patrimonial, transitória, encerrada, apenas contábil)? | → **Fora de escopo** — registrar no mapa com justificativa; a conta NÃO entra em `CR_CONTA` nem ganha driver |

> **"Fora de escopo" é uma classificação legítima e obrigatória de registrar** — todo
> plano real tem contas que não se orçam. O que é proibido é deixá-la em branco no
> mapa: sem a linha classificada, ninguém sabe se a conta foi analisada ou esquecida.

**Mini-roteiros por tratamento** — para cada um: o que criar, onde configurar, onde o
gestor preenche, e um exemplo do próprio template. O vínculo conta→driver mora sempre em
`CONTA_DRIVER` (1 driver por conta, global) com override por CR em `CONTA_DRIVER_EXCECAO`;
a resolução no motor é `COALESCE(excecao.PACOTE_ID, conta.PACOTE_ID, excecao.DRIVER_ID,
conta.DRIVER_ID)`.

- **Driver NORMAL** — driver em `DRIVERS` (`TIPO_DRIVER='NORMAL'`, `ESCOPO='CR'`). Os
  nativos já existem (`BASE_ZERO`, `BASE_HISTORICO`, `RECEITA`, `PESSOAL`). Vincular à conta
  na tela **Mapeamento → "Drivers por conta"**; o gestor lança os números em **Orçamento**
  (`OrcamentoContent`) e no link público. Valores caem em `ORCAMENTO` (por CR). Ex:
  `BASE_HISTORICO` — projeção sobre o histórico com variação %. Se um CR usa driver
  diferente do global, criar exceção em `CONTA_DRIVER_EXCECAO`.

- **Modelo personalizado (escopo CR)** — driver `ORIGEM='TELA'`, `ESCOPO='CR'` criado em
  **Modelagem**; as **linhas** são registros em `DRIVER_FORMULA` (`TIPO` = `INPUT` ou
  `FORMULA`; fórmula referencia conta por `{3.1.01}` e outra linha por `[L2]`). Editar em
  **Modelagem → Fórmulas do modelo** (`FormulasModeloEditor`); **publicar versão** congela
  o modelo (`DRIVER_VERSAO`). Vincular a conta ao modelo no Mapeamento. Valores calculados
  em `DRIVER_FORMULA_VALOR`; override de fórmula por CR em `DRIVER_FORMULA_CR`.

- **Pacote simples + rateio** — driver `TIPO_DRIVER='PACOTE'`; responsável em
  `GESTOR_PACOTE`; estado do preenchimento em `PACOTE_STATUS` (ciclo+gestor+driver). A conta
  é roteada ao pacote no **Mapeamento** (grava `PACOTE_ID` em `CONTA_DRIVER`). O gestor do
  pacote preenche **uma vez** (tela consolidada, PKG mode) → `ORCAMENTO_PACOTE`, e o valor
  é distribuído por CR via `ORCAMENTO_PACOTE.CR_ID` — **conta uma vez na DRE**. Rateio
  reutilizável em `RATEIO`/`RATEIO_ITEM` (aba "Tipos de rateio"). Ex: driver
  `CUSTOS_SOFTWARE` (id 5), conta "Despesas com Software", 20% para cada um de 5 CRs.

- **Modelo de pacote (granularidade + rateio por linha)** — o driver de cálculo é
  `TIPO_DRIVER='NORMAL'` mas **`ESCOPO='PACOTE'`** (o *pacote* é a rota). Nas linhas
  (`DRIVER_FORMULA`) as colunas `GRANULARIDADE` e `RATEIO_ID` (visíveis só quando
  `ESCOPO='PACOTE'`): `GRANULARIDADE='CR'` = input por CR (acordeão); `RATEIO_ID` = um
  valor único distribuído. Valores em `DRIVER_FORMULA_VALOR` com `PACOTE_ID` (`CR_ID=0` =
  valor único; `CR_ID` real = linha granular). Criado em **Modelagem**, preenchido pelo
  gestor do pacote. **Gate:** submissão bloqueada (`rateio_pendente`) se uma linha rateada
  não tem `RATEIO_ITEM` com quantidade.

- **Premissas (dissídio, impostos, turnover)** — **dono é a controladoria** (regra zero):
  nunca vira dado de gestor. Alíquotas por conta/ciclo em `PREMISSA_IMPOSTO`; premissas
  gerais mensais em `PREMISSA_LINHA`/`PREMISSA_VALOR` (12 meses por linha); dissídio,
  turnover e aumento em `PREMISSA_DISSIDIO`/`PREMISSA_TURNOVER`/`AUMENTO_SALARIAL`
  (consumidos pelo módulo Pessoal). Tela **Premissas** ("Premissas Gerais" / "Alíquotas de
  Impostos"); histórico automático em `HIST_PREMISSA`.

- **Pessoal/folha** — cadastros `CARGO`, `COLABORADOR`, `BENEFICIO`, `ENCARGO`; projeções
  `CONTRATACAO_PROJETADA` e `DESLIGAMENTO_PROJETADO`. "Recalcular folha"
  (`pessoalGerarFolha`) aplica salário + benefícios + encargos (onde `APLICA_CLT='true'`),
  respeita o corte do desligamento projetado, materializa em `ORCAMENTO_PESSOAL` e grava em
  `ORCAMENTO` nas contas `5.1.01` (salário) / `5.1.02` (encargos) / `5.1.03` (benefícios).
  Telas **Pessoal** (grid + "Recalcular folha"), **Folha**, e cadastros Cargos /
  Colaboradores / Benefícios. Depende das premissas de RH acima.

- **Receita (produtos, premissas de receita)** — driver `RECEITA`; `RECEITA_CONFIG` marca a
  conta como `SERVICO` ou `PRODUTO`; `RECEITA_PRODUTO` lista as linhas de produto. Os
  valores por CR/conta/mês ficam em `ORCAMENTO`, pelo padrão de grade de modelo
  orçamentário; o percentual de imposto fica em `PREMISSA_IMPOSTO`. Config em
  **Mapeamento/Modelagem**; preenchimento em **Orçamento**/link, nas contas mapeadas ao
  driver `RECEITA`.

**Quando não encaixa — escada de 3 degraus.** Antes de aceitar "não encaixa no motor",
subir a escada na ordem (exemplo condutor: projetar receita por SKU):

1. **Questionar a granularidade.** Pergunta-chave ao consultor: *"em que nível a empresa
   realmente DECIDE o orçamento?"* Muitas empresas dizem "por SKU" mas decidem por
   família/categoria — o SKU é nível de **dado**, não de **decisão**. Orce no nível de
   decisão usando o motor como está; o detalhe fica fora do orçamento ou vira abertura
   informativa. Resolve a maioria dos casos sem extensão nenhuma.
2. **Encaixar via modelo personalizado.** Se a decisão é mesmo no nível fino e o volume é
   tratável (dezenas/poucas centenas de linhas), vira modelo (DRIVER_FORMULA): uma linha
   por item, colunas de qtd × preço, fórmulas. O item vira linha de modelo, não tabela
   nova — e o canal de preenchimento já renderiza modelos no link público do gestor.
3. **Extensão de verdade (dados pesados).** Milhares de linhas não se digitam em grid.
   Desenho obrigatório em 3 partes: **base carregada** (tabela auxiliar com histórico como
   proposta inicial) + **lançamento do gestor pelo canal de preenchimento** (§4.1) +
   **agregação que desemboca nas tabelas que o motor lê**. As premissas centrais
   (teto de reajuste, meta) continuam com a controladoria e o cálculo confronta na
   submissão.

**Regra de ouro:** a extensão pode mudar **como** o número é calculado, nunca **onde**
ele desemboca. O resultado sempre aterrissa nas tabelas que o motor já lê (orçamento →
DRE → waterfall → workflow). Orçamento paralelo que vive só na tabela auxiliar é
proibido — a DRE mentiria e aprovação/versões/auditoria ficariam cegas ao valor.

**Entrada:** plano de contas da §1, decisões por lote via `AskUserQuestion`.
**Ação:** executar o mini-roteiro do tratamento escolhido, lote a lote, implementando
na mesma rodada.
**Saída:** mapa de implantação com 100% das contas classificadas e configuradas.
**GATE §3:** fecha por acúmulo de lotes aprovados e implementados (conta → tratamento
→ responsável).

---

## §4 — Regras de extensão (tabelas auxiliares e modelos novos)

Quando o motor não cobre a necessidade, estender — nunca alterar o motor.

**Critério:** se a informação pertence a uma **entidade nova** do domínio da empresa
(frota, contratos, apólices…), vira **tabela auxiliar**; se é só **parâmetro de cálculo**,
vira linha de modelo ou premissa.

**Regras:**
- Um script `add-<recurso>.mjs` idempotente por mudança (padrão já usado no projeto)
- FK obrigatória para as entidades do motor que a tabela referencia (CR, conta, ciclo…)
- **Separar cadastro de lançamento** (padrão do motor): a entidade em uma tabela
  (ex: `RECEITA_SKU`) e os valores por ciclo/mês em outra (ex: `RECEITA_SKU_VALOR`)
- **Premissas — valores de controladoria moram no motor:** percentuais/parâmetros
  definidos pela controladoria reutilizam `PREMISSA_LINHA`/`PREMISSA_VALOR` (tela de
  Premissas, versionamento e histórico de graça); a extensão guarda apenas o **vínculo
  dimensional** que o motor não conhece (ex: categoria → linha de premissa). **Dado
  preenchido por gestor NUNCA vira premissa central** — vai pelo canal de preenchimento
  (§4.1), conforme a regra zero do §3
- **Nomenclatura dos scripts** (mesma convenção já usada no `backend/`): `add-<recurso>.mjs`
  (aditivo — nova tabela/SF/coluna), `migrate-<recurso>.mjs` (mudança estrutural de
  schema/dados), `fix-<problema>.mjs` (correção pontual), `seed-<dado>.mjs` (dados de
  demo/sample), `cleanup-<alvo>.mjs` (remoção de dados), `check-<alvo>.mjs` (inspeção
  read-only), `validate-<alvo>.mjs` (verificação pós-hoc), `secure-`/`harden-<alvo>.mjs`
  (endurecimento de segurança). Para a extensão de uma empresa use **`add-<recurso>.mjs`**
  (ex: `add-receita-sku.mjs`).
- **Nomenclatura das tabelas auxiliares:** nome descritivo da entidade, separando cadastro
  de lançamento (ex: `RECEITA_SKU` + `RECEITA_SKU_VALOR`). Evite os prefixos reservados
  `INT_` (internos da plataforma) e os nomes das tabelas do motor. Sem acentos/emojis
  (o banco não aceita).
- **Checklist de idempotência do script** (o script tem de poder rodar 2× sem duplicar):
  - [ ] Primeiro import `import 'dotenv/config'`; `configureSdkMitra` com `process.env.*`;
        `projectId = parseInt(process.env.MITRA_PROJECT_ID)`
  - [ ] DDL idempotente: `CREATE TABLE IF NOT EXISTS`, ou probe em `INFORMATION_SCHEMA`
        (helpers `hasColumn()`/`hasIndex()`) antes de `ALTER TABLE`; índices em `try/catch`
  - [ ] SF via **upsert por NOME**: `listServerFunctionsMitra` → `find(s => s.name === name)`
        → `updateServerFunctionMitra` se existe, senão `createServerFunctionMitra`;
        `togglePublicExecutionMitra` se pública. Nunca hardcode `serverFunctionId` de criação
  - [ ] Patch em SF existente (string-surgery): `readServerFunctionMitra` → guard
        `if (code.includes('<marcador>')) return` → `throw` se a âncora sumiu → `replace` →
        `updateServerFunctionMitra`. Não recriar a SF inteira
  - [ ] ID de retorno extraído defensivamente:
        `res?.result?.serverFunctionId || res?.serverFunctionId || res?.id`
  - [ ] Não altera SFs internas nem públicas do motor — só adiciona
  - [ ] Smoke test no fim: executa a SF nova, valida `rowCount` e que **token inválido não
        vaza** dados
  - [ ] Nada destrutivo sem confirmação explícita (o motor só usa `runDdl` destrutivo com
        `confirmDestructive` explícito, em caso isolado)

### §4.1 — Extensão do canal de preenchimento (dado de gestor fora do formato)

Quando o degrau 3 da escada (§3) envolve dado preenchido por **gestor** (ex: volume e
preço por SKU lançados pelo gestor comercial), a extensão pluga no **link público** que
ele já recebe por e-mail — nunca numa tela central, nunca num canal paralelo (formulário
avulso, planilha por e-mail).

**Pré-condições (gate antes de qualquer código):**
- [ ] Degraus 1 e 2 da escada esgotados e documentados (por que granularidade e modelo
      não resolvem)
- [ ] Desenho em 3 partes aprovado pelo usuário: tabelas + SFs + ponto de agregação

**Arquitetura do canal (o que o motor já dá — reutilizar, não recriar):**
- `PREENCHIMENTO_TOKEN`: 1 token UUID por ciclo+gestor — o escopo vem daí
- SFs públicas token-escopadas: a autorização é derivada **do token dentro do próprio
  SQL** (JOIN no token ativo + posse do CR/pacote via `GESTOR_CR`/`PACOTE_STATUS`);
  token inválido ⇒ SELECT devolve 0 linhas e escrita é no-op
- Página pública renderiza os mesmos componentes da visão interna, com escrita
  bloqueada quando o status é APROVADO
- Referência de implementação: scripts `add-public-*.mjs` e
  `secure-public-preenchimento.mjs` deste repositório

**Receita (1 script `add-<recurso>.mjs` + bloco no frontend):**
1. DDL das tabelas (cadastro + lançamento) e carga da base histórica como proposta
   inicial — o gestor ajusta, não começa do zero
2. SF pública de leitura `public<Recurso>Base(token)` — escopo pelo token no SQL
3. SF pública de escrita `public<Recurso>Write(token, op, payload)` — upsert com
   re-coerção numérica server-side, respeitando o bloqueio de status
4. SF de agregação — consolida por conta/CR/mês e **materializa nas tabelas de
   orçamento que a DRE lê**, no salvar/submeter
5. Frontend: o recurso aparece como **mais um item a orçar** no link do gestor
   (grid pré-populado), entrando na contagem de completude e na submissão existentes —
   mecânica concreta na subseção abaixo
6. Validação na submissão contra as premissas de controladoria (ex: reajuste acima do
   teto ⇒ alerta ou trava)

**Como o item entra no link público (mecânica concreta do passo 5):**

O link do gestor NÃO descobre tabelas novas sozinho. O que ele renderiza vem de dois
lugares, e a costura depende do degrau da escada (§3):

- **Degrau 2 (modelo personalizado) — zero frontend.** As abas que o gestor vê dentro
  de um CR/pacote são **dirigidas por dados**: o mount (`hotOrcBase`) devolve
  `NORMAL_DRIVERS`/`PACOTE_DRIVERS` a partir de `CR_CONTA` × `CONTA_DRIVER`, e o
  `OrcamentoContent` (o MESMO componente da visão interna, reusado pela página
  pública) monta uma aba por driver/modelo. Ou seja: se a solução coube em modelo
  personalizado (ex: modelo com linha por SKU), basta o mapeamento conta→driver no
  banco — a aba aparece no link do gestor automaticamente, com grid, confirmação,
  completude e submissão de graça.

- **Degrau 3 (tabela auxiliar de verdade) — 3 pontos de costura no frontend, todos em
  `PreenchimentoPublicoPage.tsx`.** Uma tabela de extensão (ex: `RECEITA_SKU_VALOR`)
  não passa pelo `CONTA_DRIVER`, então ela precisa ser plugada explicitamente:
  1. **Card na home do link** — a SF `publicHome` (que devolve ctx + cards de CRs +
     cards de pacotes com progresso em UMA ida) ganha um bloco a mais (ou uma SF
     pública irmã) devolvendo o card do recurso: nome, status e progresso
     (ex: "Receita — SKUs · 32/40 linhas · PENDENTE"), escopado pelo token no SQL
  2. **View + grid do recurso** — um novo `kind` no `View` da página (hoje:
     `home | cr | pacote`) com um componente de grid (Handsontable, mesmo padrão dos
     modelos) alimentado por `public<Recurso>Base(token)` e escrevendo pela fila de
     escrita pública existente (`publicOrcWrite`/flush) na
     `public<Recurso>Write(token, op, payload)` — pré-populado com a base histórica,
     somente leitura quando o status for APROVADO
  3. **Completude e submissão** — o card entra na contagem de progresso da home e o
     submeter do escopo (`publicSubmeterCR`/`submeterPacote`) passa a exigir/incluir o
     recurso: antes de submeter, `flushPublicOrcQueue()` garante o banco em dia e a SF
     de agregação (passo 4) materializa o consolidado nas tabelas do motor

  Resumo do degrau 3: **backend descobre nada — cada recurso novo é 1 bloco na
  `publicHome`, 1 view com grid na página pública e 1 gancho na submissão.** É pouco
  código porque token, fila de escrita, cache e componentes de grid já existem — mas é
  código explícito, e por isso o gate de pré-condições exige esgotar os degraus 1 e 2
  antes.

**Requisitos inegociáveis:**
- Autorização SEMPRE pelo token no SQL — nunca por ID vindo do cliente
- Parâmetros re-coeridos server-side nas SFs de escrita
- Escrita bloqueada quando o escopo já está aprovado (mesma regra da tela interna)
- O item participa do progresso e da submissão do link — sem botão/fluxo próprio
- A agregação desemboca nas tabelas do motor (regra de ouro do §3)
- Script idempotente e aditivo — não altera SFs internas nem públicas existentes

**Testes de aceite da extensão:**
- [ ] Token do gestor A não enxerga nem escreve dados do gestor B
- [ ] Token inválido/expirado ⇒ zero linhas e escrita no-op
- [ ] Item conta no % de completude e trava/entra na submissão corretamente
- [ ] Após submeter, DRE/waterfall refletem o agregado (sem duplicação)
- [ ] Escopo aprovado ⇒ grid em somente leitura

**GATE §4:** cada extensão proposta é aprovada pelo usuário antes de executar o script.

---

## §5 — Workflow, acessos e links públicos

- Vincular gestores a CRs e responsáveis a pacotes
- Configurar fluxo de aprovação (workflow, motivos de reprovação)
- Gerar/testar links públicos de preenchimento (sem login, escopo por token)

**Statuses do workflow:** `PENDENTE`, `CONFIRMADO`, `SUBMETIDO`, `APROVADO`, `REPROVADO`
(o kanban tem 4 colunas — `CONFIRMADO` dobra em PENDENTE). As transições válidas são
enforçadas no servidor (`avaliarWorkflowStatus`, interno); `REPROVADO` exige comentário; um
escopo `APROVADO` fica intocável até ser reaberto. Toda transição grava em
`WORKFLOW_AUDITORIA` com `ORIGEM` = `APP` (app) ou `LINK` (link público).

**Passo a passo:**
1. **Gestor × CR** — vincular em `GESTOR_CR` (tela **Gestores**). Regra: 1 gestor por CR;
   todo CR ativo com dono.
2. **Responsável × pacote** — `GESTOR_PACOTE` (dono) + `PACOTE_STATUS` (estado por
   ciclo+gestor+driver). A posse em runtime é derivada do `PACOTE_STATUS`.
3. **Fluxo de aprovação** — conferir transições e **motivos de reprovação** na tela
   **Workflow** (kanban); a **Auditoria** (`listarAuditoriaGeral`) mostra o histórico geral.
   O gate `rateio_pendente` (§3) bloqueia submissão de pacote com rateio incompleto.
4. **Tokens de preenchimento** — `PREENCHIMENTO_TOKEN` guarda 1 UUID por **ciclo+gestor**
   (gerado com `UUID()`; backfill de referência em `secure-public-preenchimento.mjs`). O
   link é `/preenchimento-publico?token=<UUID>` — a autorização vem **do token dentro do
   SQL** (JOIN no token ativo + posse via `GESTOR_CR`/`PACOTE_STATUS`), nunca de um id
   vindo do cliente.

**Teste de cada perfil (obrigatório):**
- **Gestor de CR (link público):** abre o link, vê **só os seus CRs**, preenche e submete
  (`publicSubmeterCR`); não enxerga CRs de outro gestor.
- **Gestor de pacote:** vê a tela consolidada do pacote, preenche **uma vez** e submete
  (`submeterPacote`) — bloqueado se o rateio estiver pendente.
- **Aprovador:** vê os submetidos no kanban; aprova ou reprova (reprovação **exige motivo**
  e dispara e-mail ao gestor com o link de reabertura).
- **Token inválido/expirado:** SELECT devolve **0 linhas** e a escrita é **no-op** — testar
  com um UUID falso (`00000000-0000-0000-0000-000000000000`).

**GATE §5:** cada gestor confirmado com o escopo certo (vê só o que deve).

---

## §6 — Validação da implantação

A validação é conduzida pelo documento **`AUDITORIA-IMPLANTACAO.md`** (raiz do
projeto) — os itens de auditoria específicos do template vivem e evoluem **lá**,
versionados à parte deste runbook. Nada de "pronto" sem tudo verde.

**O que executar nesta fase (na ordem):**

1. **Auditoria de dados automatizada** — `node backend/check-implantacao-dados.mjs`
   (read-only). Todo item vermelho é bloqueio.
2. **Auditoria de segurança por leitura** — seção correspondente do
   `AUDITORIA-IMPLANTACAO.md` (SFs públicas, escritas, `:VAR_USER`), antes do teste
   manual com 2 contas.
3. **Checklist funcional geral** — DRE, rateios, escopos por gestor, links públicos,
   waterfall/dashboard, playground e gatilhos de integração, conforme o
   `AUDITORIA-IMPLANTACAO.md`.
4. **Casos de teste por tratamento** — um caso para **cada tratamento que a empresa
   usa** (driver, modelo, pacote, modelo de pacote, premissas, pessoal, receita,
   extensão), conforme o `AUDITORIA-IMPLANTACAO.md`.

Os resultados (verde/vermelho, evidência e correções) são registrados no
`estado-implantacao.md` e no `tarefas.md` da empresa. Se o `AUDITORIA-IMPLANTACAO.md`
tiver sido atualizado desde a última rodada (a versão dele consta no topo do próprio
documento), reexecutar os itens novos/alterados.

**GATE §6:** usuário aprova a validação completa (auditoria de dados verde + todos os
itens do `AUDITORIA-IMPLANTACAO.md` aplicáveis verdes).

---

## §7 — Registro e handoff

1. Finalizar o **mapa de implantação** em
   `implantacoes/<empresa>/mapa-implantacao.md` — uma linha
   por conta, **100% das contas classificadas**. Formato:

   | Conta (código) | Nome | Tratamento | Driver/Modelo | Escopo | Responsável | Rateio | Justificativa | Status |
   |---|---|---|---|---|---|---|---|---|
   | 3.1.01 | Despesas com Software | Pacote | CUSTOS_SOFTWARE | Pacote | Sarah (TI) | 20% × 5 CRs | despesa central, 1 dono | ✅ |
   | 4.1.01 | Salários | Pessoal | PESSOAL | CR | gestor do CR | — | folha/headcount | ✅ |
   | 5.2.03 | Receita Serviços | Receita | RECEITA | CR | gestor comercial | — | qtd × valor hora | ✅ |

   Onde **Tratamento** ∈ {Driver NORMAL, Modelo CR, Pacote, Modelo de pacote, Premissa,
   Pessoal, Receita, Extensão, Fora de escopo}; **Escopo** ∈ {CR, Pacote, —};
   **Responsável** = quem preenche (regra zero; `—` para Fora de escopo);
   **Justificativa** = por que esse tratamento (e, se subiu a escada do §3, qual degrau
   e por quê; para Fora de escopo, por que a conta não se orça).
2. Finalizar `implantacoes/<empresa>/extensoes.md`, declarando `NENHUMA` ou registrando
   para cada extensão os degraus 1/2, desenho aprovado, ponto de agregação e testes.
3. Executar o validador obrigatório:
   `node backend/validate-implantacao.mjs implantacoes/<empresa>`. Corrigir todos os erros;
   avisos devem ser avaliados e justificados no estado da implantação.
4. Persistir o essencial em `additionalInstructions` do projeto (IDs de SFs/perfis
   criados, decisões não óbvias, particularidades) — **sempre com aprovação do usuário**
5. Etapa final: seguir o **`IR-PARA-PRODUCAO.md`** para retirar o ambiente de
   demonstração e ir para produção.

   > **CHECAGEM OBRIGATÓRIA antes de instruir "Preparar para produção":** o passo de
   > limpeza do `IR-PARA-PRODUCAO.md` é **destrutivo e irreversível**. Antes de mandar
   > a pessoa clicar, **verifique se já foi rodado antes**, consultando a flag nos
   > **dois lugares** onde ela é gravada:
   > 1. tabela `APP_CONFIG`, via SF pública `publicLoginsDemoAtivos` (fonte da verdade);
   > 2. variável de projeto: `getVariableMitra({ projectId, key: 'LOGINS_DEMO_ATIVOS' })`.
   >
   > - **Qualquer uma das duas = `'false'`** → **já foi rodado**. NÃO repita a
   >   instrução de limpeza; se as duas fontes divergirem, iguale-as (SF
   >   `gravarLoginsDemoFlag` + variável) e vá direto para a validação do
   >   `IR-PARA-PRODUCAO.md`.
   > - Ambas ausentes/`'true'`/leitura falhou → ainda em modo demonstração. Aí sim
   >   conduza a limpeza (com o aviso de que é irreversível).
   >
   > Se a pessoa afirmar que já rodou, confirme pelas flags mesmo assim antes de
   > seguir — não instrua uma limpeza destrutiva por engano nem faça a pessoa
   > repetir um passo já concluído.

   > **POR QUE a retirada da chave mestra NÃO é embutida no clique "Preparar para
   > produção":** o clique é uma ação de **runtime** — roda SQL, limpa dados e grava
   > a flag. Retirar a chave mestra (`VITE_MITRA_TOKEN`) é uma propriedade de
   > **build**: um segredo só sai do app quando o app é **recompilado sem
   > referenciá-lo** (o Vite injeta `import.meta.env.VITE_*` no bundle apenas onde
   > há referência no código). Um botão em runtime **não recompila nem reescreve o
   > bundle já servido** — logo, não tem como o clique "remover o token" do app.
   > Isso é limitação de arquitetura, não de vontade.
   >
   > **Como o passo de build funciona neste template:** enquanto o projeto está em
   > modo demonstração, a chave mestra **está** no bundle (é o que faz as personas
   > demo funcionarem sem login). Toda leitura de `VITE_MITRA_TOKEN*` é centralizada
   > no `pickEnvToken()` de `frontend/src/mitra-config.ts`, controlado pela
   > constante **`DEMO_BUILD`**: mudá-la para `false` + `npm run build` elimina a
   > leitura, e a verificação obrigatória (buscar o valor do token em `dist/assets/`
   > → 0 ocorrências) confirma que o segredo saiu do bundle — roteiro completo no
   > passo 3 do `IR-PARA-PRODUCAO.md`. A tela de login continua funcionando sem
   > token porque a flag dos logins demo é lida pela SF **pública**
   > `publicLoginsDemoAtivos` (tabela `APP_CONFIG`; setup idempotente:
   > `backend/add-public-demo-flag.mjs`).
   >
   > **Invariante de segurança (não violar):** em produção, a chave mestra **nunca**
   > pode estar no bundle servido ao browser. Não reintroduza leitura de
   > `VITE_MITRA_TOKEN` fora do `pickEnvToken()`/`DEMO_BUILD`, nem "reative demo por
   > flag" em runtime — isso jogaria o segredo de volta no `dist/` e o exporia a
   > qualquer visitante. Se for preciso que o modo demo funcione em projetos
   > **duplicados** sem chave embutida, a saída correta é uma **SF pública de
   > "login demo"** que emita um token efêmero/escopado server-side (mantém o
   > segredo fora do bundle) — desenhar e alinhar antes de implementar.

**GATE §7:** validador verde e usuário aprova o conteúdo salvo em
`additionalInstructions`.

---

## Histórico de versões do protocolo

Regra de versionamento: mudança que **cria/altera regra ou reabre gate** sobe a versão
**minor** (1.x.0); correção de texto sem efeito prático sobe **patch** (1.1.x). Toda
mudança exige pedido claro do usuário e uma linha aqui. Implantações em andamento
registram no `estado-implantacao.md` contra qual versão cada gate foi aprovado — ao
subir a versão, avaliar se algum gate aprovado é afetado.

| Versão | Data | Mudança |
|---|---|---|
| 1.2.0 | 2026-07-22 | Runbook declarado intocável (edição só por pedido claro do usuário). Itens de auditoria extraídos para `AUDITORIA-IMPLANTACAO.md` (versionado à parte); §6 passa a apontar para ele e para `check-implantacao-dados.mjs`. Tratamento "Fora de escopo" adicionado à árvore do §3 e à taxonomia do §7. §7 reescrito para refletir o estado real do template (chave mestra sai do bundle via `DEMO_BUILD` + rebuild + verificação; flag demo com fonte da verdade em `APP_CONFIG` via SF pública, variável de projeto como fallback — checar as duas). Removidas descrições do ambiente onde o runbook foi redigido. Correção factual: status de ciclo aberto no motor é `INICIADA` (não `ABERTO`). |
| 1.1.1 | — | Versão importada da redação original do runbook. |
