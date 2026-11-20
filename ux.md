# UX - Modificacoes Planejamento Orcamentario

## Playground
- Chat lateral com cabeçalho compacto, composer fixo e largura ajustável por arraste.
- Chevron `>` na divisória recolhe o chat; chevron `<` reabre, ambos com tooltip.
- Chat recolhido não reserva coluna e libera toda a largura para o canvas.
- O botão roxo global fica acima do composer, com uma área livre correspondente no histórico do chat.

## Modo Preenchimento (rota /preenchimento)
- Tela fullscreen sem sidebar, menu ou navegacao
- Header minimo: logo + nome do gestor + botao "Sair"
- Lista de CRs em cards com status e progresso
- Ao clicar no CR: expande abas de drivers (mesma UX do OrcamentoPage)
- Fluxo: ver CRs -> selecionar CR -> lancar valores por driver -> confirmar driver -> confirmar CR
- Link direto compartilhavel

## Waterfall (DREPage)
- Tab "Waterfall" com subtabs: "Executiva" e "Detalhada"
- Visao Executiva: 4 barras (Receita, Custos, Despesas, Resultado)
- Visao Detalhada: todas as linhas do DRE como barras
- Tooltip: "R$ 1.234.567 | 45,2% da Receita"
- Clique em barra: drill-down mostrando contas da linha
- Botao direito ou segundo clique: drill por driver
- Breadcrumb de navegacao ao fazer drill

## Driver Pacote (DriversPage)
- No modal de criacao: campo "Tipo" com opcoes Normal/Pacote
- Se Pacote selecionado:
  - Campo para vincular gestor responsavel
  - Nao precisa selecionar CR especifico (orca para todos)
- Card do driver pacote com icone diferenciado e badge "Pacote"
- Ao clicar no driver pacote: tela de configuracao de rateio

## Configuracao de Rateio (DriversPage -> detalhe do pacote)
- Secao "Rateio" abaixo dos mapeamentos
- Select: tipo de rateio (Percentual Fixo, Proporcional, Igualitario, Manual)
- Se Percentual Fixo ou Manual: tabela com CRs + campo percentual
- Se Proporcional: select da base (Receita, Headcount) + preview calculado
- Se Igualitario: preview automatico (100% / N CRs)
- Barra de validacao: "Total: 100%" (verde) ou "Total: 85% - faltam 15%" (vermelho)
- Botao "Simular" mostra preview dos valores rateados
- Botao "Aplicar Rateio" aplica no orcamento

## Orcamento com Pacote (OrcamentoPage)
- Tab adicional para drivers tipo PACOTE
- Se gestor comum: valores rateados aparecem como read-only com badge "Rateio"
- Se gestor do pacote: tela consolidada mostrando total por conta por mes
- Indicador visual diferenciando valores diretos vs rateados

## Validacoes visuais
- Icone de alerta se conta ja vinculada a outro driver
- Toast de erro se rateio != 100%
- Modal de confirmacao antes de aplicar rateio
- Preview lado a lado: "Antes" vs "Depois" na simulacao
