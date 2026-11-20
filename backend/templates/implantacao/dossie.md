# Dossiê — implantação <EMPRESA>

> Registro da descoberta e das decisões de integração (§1 do `IMPLANTACAO.md`).
> É registro do que foi implementado/decidido — não é a entrega da rodada.

## Fonte de dados

- **Fonte direcionada:** <ex.: Sankhya via gateway / banco próprio / planilhas>
- **Resumo técnico:** <conexões, credenciais (onde estão — nunca aqui), volumes medidos>
- **Contratos por entrega:** <um parágrafo por entidade: modelo, cursor, deletes, janela>

## Matriz fonte × dono × canal

| Dado | Fonte | Dono (quem preenche/decide) | Canal no motor |
|---|---|---|---|
| Empresas | — | — | `EMPRESA` (carga) |
| Centros de resultado | — | — | `CENTRO_RESULTADO` (carga) |
| Plano de contas | — | — | `CONTA_CONTABIL` (carga) |
| Realizado contábil | — | — | pacote da base financeira + gatilho na tela |
| … | — | — | — |

## Blocos mapeados

### 1. Empresas
- O que foi encontrado na fonte (números reais): —
- O que foi implementado: —

### 2. Centros de custo/resultado
- Contagem, granularidade de decisão, ativos × inativos: —
- O que foi implementado: —

### 3. Plano de contas
- Estrutura (código/nome/tipo/natureza, hierarquia por prefixo): —
- Proposta de DRE (ordem, subtotais, sinais): —
- O que foi implementado: —

### 4. Realizado contábil
- Volume, período, cursor de atualização, taxa de alteração: —
- Periodicidade decidida (sob demanda / periódica) e por quem: —
- Pipeline implementado (ordem: empresas → CRs → contas → realizado): —

## Decisões de integração

| Data | Decisão | Quem decidiu | Motivo |
|---|---|---|---|
| — | — | — | — |
