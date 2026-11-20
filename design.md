# Design - Modificacoes Planejamento Orcamentario

## Canvas do Playground
- Fundo principal obrigatório: #FFFFFF em todo dashboard novo ou regenerado.
- Margem externa mínima de 24px e gaps de 20px a 24px.
- Até quatro KPIs na primeira linha, cards alinhados e discretos, gráficos mais altos e tabelas em seções inferiores próprias.
- Números dos cards em 22px por padrão, limitados a 24px para preservar a hierarquia sem dominar a tela.
- Título curto e subtítulo discreto com no máximo uma ou duas linhas; explicações maiores ficam no chat do analista.
- Violeta é a cor principal; vermelho fica restrito a situações críticas.
- A leitura segue: contexto → indicadores → gráficos → diagnóstico → tabelas, com rolagem vertical e densidade moderada.
- A interface do estudo não expõe controle de versões; mantém apenas as ações essenciais do canvas.

## Tela de Mapeamento
- Explicações operacionais ficam no botão Ajuda contextual de cada aba, sem caixas instrucionais ocupando a visão principal.
- Insights funciona como notificação roxa com contador quando houver conta sem driver ou sem setor.
- Estados pendentes usam roxo, nunca amarelo; vermelho fica reservado a erros críticos.
- Dropdowns de Rota, Driver e Personalização por CR são compactos, arredondados e usam menus elevados com opções bem delimitadas.
- Modelos nativos não exibem atalhos rápidos; a explicação do driver fica no ícone de ajuda.
- Tags de contas, setores e exceções usam o roxo principal, e as listas de contas têm linhas compactas de aparência tabular.

## Referencia
Manter consistencia com o design existente do sistema (light mode, indigo como primary, Inter font)

## Paleta de Cores
Sem alteracao - manter as CSS variables existentes:
- Primary: #4f46e5 / #6366f1 (indigo)
- Light mode como padrao com suporte dark
- Todas as novas telas seguem as mesmas variaveis

## Modo Preenchimento
- Background: var(--bg-app) fullscreen
- Header: altura 56px, borda inferior, logo a esquerda, nome do gestor ao centro, "Sair" a direita
- Cards de CR: mesma aparencia dos cards do WorkflowPage (borda colorida por status)
- Ao expandir CR: mesma UX das tabs de drivers do OrcamentoPage
- Sem sidebar, sem header de navegacao superior

## Waterfall
- Barras horizontais (layout vertical como existente)
- Verde: #10b981 (positivo/receita)
- Vermelho: #ef4444 (negativo/custos/despesas)
- Roxo: #6366f1 (resultado)
- Tooltip: fundo var(--bg-surface), borda var(--border), rounded-lg
- Tabs Executiva/Detalhada: mesma aparencia das tabs DRE/Waterfall existentes
- Drill breadcrumb: mesma aparencia do breadcrumb de drill existente

## Driver Pacote
- Badge "Pacote" com variant "warning" (amarelo) para destaque
- Icone do card: Package (lucide-react) em vez de Settings
- Card do driver pacote: borda-left 3px com cor warning
- Secao de rateio: Card com header e tabela interna
- Barra de validacao de rateio: faixa no rodape do card
  - 100%: bg-emerald-50, text-emerald-600, borda emerald
  - < 100%: bg-red-50, text-red-600, borda red

## Simulacao de Rateio
- Modal fullwidth com tabela mostrando:
  - Coluna CR | Percentual | Valor por Mes (Jan-Dez) | Total
- Linha de total no rodape com font-bold bg-slate-100
- Botoes: "Cancelar" (secondary) + "Aplicar Rateio" (primary)

## Detalhes por Tela
- Preenchimento: fullscreen, cards + tabs, sem decoracao extra
- Waterfall: 2 subtabs acima do grafico, legenda abaixo
- Driver Pacote: badge destacada no card, secao rateio colapsavel
- Rateio: tabela com inputs inline, barra de progresso visual do percentual
