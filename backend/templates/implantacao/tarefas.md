# Tarefas — implantação <EMPRESA>

> Checklist executável do runbook `IMPLANTACAO.md` (protocolo 1.1.1).
> Atualizar antes e depois de cada atividade. Cada item concluído deve
> apontar a entrega conferível (tela/SF/carga), não só "documento atualizado".

## §1 — Direcionamento da fonte e mapeamento inicial
- [ ] Ler conexões/integrações/loaders existentes e afirmar a fonte
- [ ] Mapear Empresas na fonte → carga em `EMPRESA` (fatia aprovada)
- [ ] Mapear CRs na fonte (granularidade de decisão!) → carga em `CENTRO_RESULTADO`
- [ ] Mapear plano de contas → carga em `CONTA_CONTABIL` + proposta `DRE_CONFIG`
- [ ] Medir volume do realizado + propor periodicidade → pipeline da base financeira + gatilho na tela

## §2 — Cadastros base (ordem obrigatória)
- [ ] Ciclo (exatamente 1 INICIADA — status de ciclo aberto no motor)
- [ ] Centros de resultado (FKs resolvem, sem CODIGO duplicado)
- [ ] Contas contábeis (prefixos cobertos pela DRE)
- [ ] Gestores (e-mail válido)
- [ ] Vínculos Gestor × CR (1 gestor por CR; todo CR ativo com dono)
- [ ] Vínculos CR × conta (sem duplicados)
- [ ] Configuração da DRE (ordem, sinais, subtotais)
- [ ] Regras contábeis
- [ ] Tipos de rateio (catálogo, se aplicável)

## §3 — Mapeamento conta a conta (por lotes, implementação imediata)
- [ ] Rascunhar mapa com 100% das contas listadas (Tratamento em branco)
- [ ] Lote 1: … (proposto → aprovado → configurado → conferido na tela)
- [ ] 100% das contas classificadas E configuradas

## §4 — Extensões (se houver)
- [ ] Degraus 1 e 2 esgotados e documentados por extensão
- [ ] Desenho em 3 partes aprovado antes de qualquer código
- [ ] Script `add-*.mjs` idempotente + testes de aceite do §4.1

## §5 — Workflow, acessos e links públicos
- [ ] Gestores × CRs e responsáveis × pacotes vinculados
- [ ] Fluxo de aprovação e motivos de reprovação conferidos
- [ ] Tokens gerados; teste de cada perfil (gestor CR, gestor pacote, aprovador, token inválido)

## §6 — Validação da implantação
- [ ] Checklist geral do §6 completo (DRE, rateios, escopos, links, waterfall, playground, gatilhos)
- [ ] Auditoria de segurança por leitura das SFs públicas
- [ ] Casos de teste por tratamento configurado

## §7 — Registro e handoff
- [ ] Mapa de implantação finalizado (100% das contas, status ✅)
- [ ] `extensoes.md` finalizado (ou `NENHUMA`)
- [ ] `node backend/validate-implantacao.mjs implantacoes/<empresa>` verde
- [ ] `additionalInstructions` atualizado com aprovação do usuário
- [ ] `IR-PARA-PRODUCAO.md` seguido (com a checagem da flag `LOGINS_DEMO_ATIVOS`)
