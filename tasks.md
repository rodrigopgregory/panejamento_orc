# Tasks — Mitra FP&A · remocao de perfis fake + design system

| # | Task | Status | Output |
|---|------|--------|--------|
| 1 | Mapear reverberacoes dos perfis fake (front + estrutura) | ✅ done | inventario levantado |
| 2 | Remover personas/perfis do codigo (auth, demo-tokens, mitra-config) | ✅ done | lib/demo-tokens.ts deletado; auth.ts so identidade real |
| 3 | LoginPage com login padrao apenas | ✅ done | SSO + e-mail/senha, sem botoes de persona |
| 4 | Menu: logo removido, "Sair" e "Trocar perfil" removidos | ✅ done | Layout.tsx |
| 5 | Limpar reverberacoes nas telas (DRE, Workflow, Orcamento, Playground, Governanca IA, Painel IA) | ✅ done | sem PERFIL em nenhuma tela |
| 6 | Aplicar design system (tokens, Geist Sans, forma, base, tema data-theme) | ✅ done | index.css + index.html + useTheme |
| 7 | Componentes no design system (Button, Badge, Card, Input, Select, Modal, Toast, ConfirmDialog) | ✅ done | components/ui |
| 8 | Paleta de graficos e design system do analista (Playground) no novo padrao | ✅ done | Chart.tsx + lib/playground.ts |
| 9 | Testes (482) + typecheck + build | ✅ done | tudo verde |
| 10 | Pendente de decisao do usuario: remover SFs 226/227/228 e a flag LOGINS_DEMO_ATIVOS no backend | ⏳ pending | aguardando autorizacao (producao) |

## Aberto / decisao do usuario

- **Backend ainda tem o aparato da demo** (nao removido: producao, exige autorizacao explicita):
  - SF 226 `prepararImplantacaoLimpar` (SQL) — **APAGA dados de demonstracao** quando chamada com `confirmacao='LIMPAR_DADOS_DEMO'`. Nao e' mais chamada pelo app, mas continua executavel.
  - SF 227 `publicLoginsDemoAtivos` (SQL, **publica**) e SF 228 `gravarLoginsDemoFlag` (SQL).
  - Variavel de projeto `LOGINS_DEMO_ATIVOS` e a linha correspondente em `APP_CONFIG`.
  - Scripts de origem: `backend/add-preparar-implantacao.mjs`, `backend/add-public-demo-flag.mjs`.
- **Cor da marca:** o design system define `--brand: #4b5563` (cinza — marca oficial Mitra). Para usar outra cor basta trocar esse unico token em `frontend/src/index.css` (ou em runtime com `document.documentElement.style.setProperty('--brand', '#RRGGBB')`).
- **Hex fora de token:** varias telas (Apresentacao, Preenchimento, Versoes, OrcamentoContent) ainda tem cores literais herdadas da base anterior. O design system pede cor so por token — sweep nao feito neste turno.
