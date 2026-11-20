# Features e Arquitetura - Modificacoes Planejamento Orcamentario

## Playground - padrão permanente
- O estudo usa canvas flexível e chat lateral redimensionável; ao recolher o chat, o canvas ocupa toda a largura.
- Um único chevron na divisória controla recolher e reabrir o painel.
- O botão roxo do chat global permanece disponível e ocupa uma zona reservada, sem sobrepor o composer do analista.
- Todo dashboard novo ou regenerado recebe as mesmas regras permanentes de fundo branco, hierarquia, espaçamento e densidade moderada pelo prompt-base do Playground.

## Requisitos Funcionais

### RF01 - Modo Preenchimento (restrito)
- Rota dedicada `/preenchimento` que exibe tela fullscreen sem menu/sidebar/navegacao
- Gestor acessa via link direto, ve apenas CRs sob sua responsabilidade
- Mostra drivers vinculados e inputs de orcamento para cada CR
- Flag `modo_execucao = preenchimento` controla o modo
- Sem acesso a outras areas do sistema

### RF02 - Ajuste do Waterfall
- Estrutura: Receita -> (-) Custos -> (-) Despesas -> Resultado
- Cores: positivo verde, negativo vermelho, resultado roxo
- Tooltip: valor + % da receita
- Drill-down por conta e por driver
- 2 visoes: Executiva (simples, 4 barras) e Detalhada (todas as linhas DRE)

### RF03 - Novo Tipo de Driver: PACOTE
- Campo TIPO_DRIVER na tabela DRIVERS com valor 'PACOTE'
- 1 responsavel (gestor pacote)
- Orca para todos os CRs de uma vez
- Vinculado a multiplas contas
- Valor preenchido uma unica vez (tela consolidada)

### RF04 - Rateio do Pacote
- Apos preenchimento do pacote, distribuir valor para CRs
- 4 tipos: percentual_fixo, proporcional, igualitario, manual
- Soma dos percentuais = 100%
- Cada CR recebe apenas sua parte
- Nao duplicar valores no DRE

### RF05 - Coexistencia de Drivers
- Drivers pacote coexistem com drivers normais
- Gestor comum: preenche apenas seu CR + recebe valores rateados (somente leitura)
- Gestor do pacote: tela unica consolidada

### RF06 - Validacoes
- Evitar conflito de drivers na mesma conta
- Validar rateio = 100%
- Permitir simulacao antes de aplicar rateio

---

## Arquitetura de Dados

### Alteracoes em tabelas existentes

**DRIVERS** - Adicionar coluna:
```sql
ALTER TABLE DRIVERS ADD COLUMN TIPO_DRIVER VARCHAR(20) DEFAULT 'NORMAL';
-- Valores: 'NORMAL' (default para existentes), 'PACOTE'
```

**DRIVER_CONFIG** - Sem alteracao (ja suporta vinculo driver<->conta<->CR)

### Novas tabelas

**RATEIO_CONFIG** - Configuracao de rateio por driver pacote:
```sql
CREATE TABLE RATEIO_CONFIG (
  ID INT AUTO_INCREMENT PRIMARY KEY,
  DRIVER_ID INT NOT NULL,
  TIPO_RATEIO VARCHAR(20) NOT NULL,
  BASE_PROPORCIONAL VARCHAR(50),
  CRIADO_EM VARCHAR(19),
  FOREIGN KEY (DRIVER_ID) REFERENCES DRIVERS(ID)
);
-- TIPO_RATEIO: 'PERCENTUAL_FIXO', 'PROPORCIONAL', 'IGUALITARIO', 'MANUAL'
-- BASE_PROPORCIONAL: 'RECEITA', 'HEADCOUNT' (so para tipo PROPORCIONAL)
```

**RATEIO_CR** - Percentuais por CR no rateio:
```sql
CREATE TABLE RATEIO_CR (
  ID INT AUTO_INCREMENT PRIMARY KEY,
  RATEIO_CONFIG_ID INT NOT NULL,
  CR_ID INT NOT NULL,
  PERCENTUAL DECIMAL(10,4) DEFAULT 0,
  FOREIGN KEY (RATEIO_CONFIG_ID) REFERENCES RATEIO_CONFIG(ID),
  FOREIGN KEY (CR_ID) REFERENCES CENTRO_RESULTADO(ID)
);
```

**ORCAMENTO_PACOTE** - Valores orcados pelo gestor do pacote:
```sql
CREATE TABLE ORCAMENTO_PACOTE (
  ID INT AUTO_INCREMENT PRIMARY KEY,
  CICLO_ID INT NOT NULL,
  DRIVER_ID INT NOT NULL,
  CONTA_ID INT NOT NULL,
  MES INT NOT NULL,
  VALOR DECIMAL(15,2) DEFAULT 0,
  FOREIGN KEY (CICLO_ID) REFERENCES CICLO(ID),
  FOREIGN KEY (DRIVER_ID) REFERENCES DRIVERS(ID),
  FOREIGN KEY (CONTA_ID) REFERENCES CONTA_CONTABIL(ID)
);
```

**GESTOR_PACOTE** - Vinculo gestor<->driver pacote:
```sql
CREATE TABLE GESTOR_PACOTE (
  ID INT AUTO_INCREMENT PRIMARY KEY,
  GESTOR_ID INT NOT NULL,
  DRIVER_ID INT NOT NULL,
  FOREIGN KEY (GESTOR_ID) REFERENCES GESTOR(ID),
  FOREIGN KEY (DRIVER_ID) REFERENCES DRIVERS(ID)
);
```

---

## Arquitetura Frontend

### Nova rota: /preenchimento
- Componente `PreenchimentoPage.tsx`
- Fullscreen (sem Layout wrapper)
- Recebe params: `?gestor=X` ou token de sessao
- Mostra lista de CRs do gestor com drivers e inputs
- Fluxo: selecionar CR -> lancar por driver -> confirmar

### Alteracoes em paginas existentes

**DriversPage.tsx**
- Adicionar opcao TIPO_DRIVER no modal de criacao/edicao
- Se tipo=PACOTE: mostrar configuracao de rateio e gestor responsavel
- Secao de configuracao de rateio (tipo, percentuais por CR)

**OrcamentoPage.tsx**
- Detectar se driver e PACOTE
- Se PACOTE: mostrar valores rateados como read-only
- Gestor do pacote: tela consolidada com todos CRs

**DREPage.tsx / Dashboard.tsx**
- Waterfall refatorado com 2 visoes
- Tooltip com % receita
- Drill por conta e por driver

**Layout.tsx**
- Adicionar link para "Modo Preenchimento" no menu

**App.tsx**
- Adicionar rota `/preenchimento` FORA do Layout

---

## Plano de Implementacao

### Etapa 1: Backend
1. Executar ALTER TABLE e CREATE TABLE no setup-backend.mjs
2. Criar SFs para waterfall drill (por conta e por driver)
3. Criar SFs para rateio (calcular e aplicar)

### Etapa 2: Frontend - Modo Preenchimento
1. Criar PreenchimentoPage.tsx (fullscreen)
2. Rota em App.tsx fora do Layout

### Etapa 3: Frontend - Driver Pacote
1. Alterar DriversPage para suportar tipo PACOTE
2. Tela de configuracao de rateio
3. Simulacao de rateio antes de aplicar

### Etapa 4: Frontend - Waterfall
1. Refazer componente Waterfall com 2 visoes
2. Drill por conta e driver
3. Tooltip com % receita

### Etapa 5: Integracao
1. Integrar pacote no OrcamentoPage
2. Valores rateados no DRE
3. Validacoes de conflito

---

## Criterios de Aceite

| # | Criterio | Como validar |
|---|----------|--------------|
| 1 | Modo preenchimento acessivel sem menu | Acessar /preenchimento, confirmar fullscreen |
| 2 | Gestor ve apenas seus CRs | Filtrar por gestor logado |
| 3 | Waterfall com 2 visoes | Alternar entre Executiva e Detalhada |
| 4 | Tooltip waterfall mostra % receita | Hover em barra do waterfall |
| 5 | Drill waterfall por conta | Clicar em barra -> detalhar contas |
| 6 | Driver PACOTE criavel | Criar driver com tipo PACOTE |
| 7 | Rateio soma 100% | Validar ao salvar configuracao |
| 8 | Simulacao antes de aplicar | Preview dos valores rateados |
| 9 | Valores rateados no DRE | Conferir na tela DRE |
| 10 | Coexistencia pacote+normal | Ambos funcionam no mesmo CR |

---

## Riscos e Mitigacao

| Risco | Mitigacao |
|-------|----------|
| Conflito de drivers na mesma conta | Validacao no backend ao vincular driver pacote |
| Rateio inconsistente | Forcar soma = 100% na UI e no backend |
| Performance com muitos CRs no pacote | Paginacao e carregamento lazy |
| Duplicacao de valores no DRE | Valores do pacote sao distribuidos via ORCAMENTO, nao somados separadamente |
