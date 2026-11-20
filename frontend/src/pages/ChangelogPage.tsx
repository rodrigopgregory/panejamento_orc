import { CheckCircle2, Wrench, Sparkles, Bug, ArrowUpCircle } from 'lucide-react';

const CHANGELOG = [
  {
    date: '15/04/2026',
    title: 'Resultado Contábil e Ajustes de Interface',
    items: [
      {
        type: 'feature' as const,
        title: 'Tela de Resultado Contábil',
        description: 'Nova tela na seção Dados do menu para visualizar os dados de realizado contábil. Inclui filtros por ano e centro de resultado, busca por conta, e tabela mensal com totais.',
      },
      {
        type: 'improvement' as const,
        title: 'Modelos orçamentários: nomes simplificados',
        description: 'Nomes dos modelos na lista agora aparecem em texto simples com ícone discreto, sem labels coloridas em capslock.',
      },
      {
        type: 'improvement' as const,
        title: 'Gestores: proteção de vínculo de CRs',
        description: 'Ao vincular um CR que já pertence a outro gestor, o sistema exibe um aviso e solicita confirmação antes de transferir o vínculo.',
      },
      {
        type: 'fix' as const,
        title: 'Criação de modelos desbloqueada',
        description: 'O botão "Novo Modelo" não fica mais desabilitado quando o ciclo está em modo somente leitura, já que a criação de modelos é independente do ciclo.',
      },
    ],
  },
  {
    date: '15/04/2026',
    title: 'Melhorias de UX e Impostos sobre Receita',
    items: [
      {
        type: 'feature' as const,
        title: 'Impostos sobre Receita com cálculo automático',
        description: 'Nova seção expansível na aba Receita do orçamento. Impostos (ISS, PIS/COFINS, ICMS) agora são calculados automaticamente com base no percentual informado sobre a receita total de cada mês.',
      },
      {
        type: 'improvement' as const,
        title: 'Pacotes: excluir direto do card',
        description: 'Botão de excluir adicionado diretamente no card de cada pacote, sem precisar abrir a tela de detalhes.',
      },
      {
        type: 'improvement' as const,
        title: 'Pacotes: gestor responsável no card',
        description: 'O card de cada pacote agora mostra o nome do gestor responsável no lugar da descrição.',
      },
      {
        type: 'improvement' as const,
        title: 'Modelos orçamentários: visão de lista',
        description: 'A tela de mapeamento de peças orçamentárias agora usa uma lista/tabela no lugar de cards, facilitando a visualização quando há muitos modelos.',
      },
      {
        type: 'improvement' as const,
        title: 'Gestores: vincular CRs no modal de edição',
        description: 'A opção de vincular CRs foi integrada ao modal de editar gestor. Não é mais necessário abrir um modal separado para gerenciar os vínculos.',
      },
    ],
  },
  {
    date: '15/04/2026',
    title: 'Versionamento e Correções',
    items: [
      {
        type: 'feature' as const,
        title: 'Versionamento completo (CICLO_ID)',
        description: 'Todas as telas do sistema agora filtram dados pela versão selecionada. Benefícios, encargos, mapeamentos de drivers e premissas são isolados por versão orçamentária.',
      },
      {
        type: 'feature' as const,
        title: 'Duplicação de versão com cópia de dados',
        description: 'Ao criar ou duplicar uma versão, os mapeamentos de drivers, benefícios e encargos são copiados automaticamente da versão de origem.',
      },
      {
        type: 'feature' as const,
        title: 'Multi-seleção de contas contábeis',
        description: 'Na configuração dos modelos orçamentários, agora é possível selecionar várias contas contábeis de uma vez para vincular a um CR ou a todos os CRs simultaneamente.',
      },
      {
        type: 'fix' as const,
        title: 'Correção de mapeamentos de contas',
        description: 'Impostos sobre receita movidos para o modelo RECEITA. Viagens, aluguel, seguros e depreciação movidos para BASE_ZERO. Subcontas de pessoal adicionadas ao modelo PESSOAL.',
      },
      {
        type: 'fix' as const,
        title: 'Exclusão de gestores',
        description: 'Corrigido bug que impedia excluir gestores devido a restrições de chave estrangeira. O sistema agora remove automaticamente todos os vínculos dependentes antes da exclusão.',
      },
    ],
  },
];

const TYPE_CONFIG = {
  feature: { icon: Sparkles, label: 'Novo', bg: '#f5f3ff', color: '#8b5cf6', border: '#c4b5fd' },
  improvement: { icon: ArrowUpCircle, label: 'Melhoria', bg: '#eef9e9', color: '#9ad889', border: '#d8b4fe' },
  fix: { icon: Bug, label: 'Correção', bg: '#fef3c7', color: '#d97706', border: '#fde68a' },
};

export default function ChangelogPage() {
  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#f8fafc' }}>
      {/* Header */}
      <div style={{ backgroundColor: '#75c95f', color: 'white', padding: '48px 24px' }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <div className="flex items-center gap-3 mb-3">
            <Wrench size={28} />
            <h1 className="font-semibold" style={{ fontSize: '20px', color: 'white' }}>Changelog</h1>
          </div>
          <p className="text-sm mt-1" style={{ color: 'rgba(255,255,255,0.85)' }}>
            Acompanhe as mudanças e melhorias implementadas no sistema de orçamento.
          </p>
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '32px 24px 64px' }}>
        {CHANGELOG.map((release, ri) => (
          <div key={ri} style={{ marginBottom: 40 }}>
            {/* Date + title */}
            <div className="flex items-center gap-3" style={{ marginBottom: 16 }}>
              <span
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  backgroundColor: '#75c95f', color: 'white',
                  fontSize: 12, fontWeight: 600, padding: '4px 12px', borderRadius: 20,
                }}
              >
                <CheckCircle2 size={13} />
                {release.date}
              </span>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-text)' }}>{release.title}</h2>
            </div>

            {/* Items */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {release.items.map((item, ii) => {
                const cfg = TYPE_CONFIG[item.type];
                const Icon = cfg.icon;
                return (
                  <div
                    key={ii}
                    style={{
                      backgroundColor: 'var(--color-surface)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 12,
                      padding: '16px 20px',
                      boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
                    }}
                  >
                    <div className="flex items-start gap-3">
                      <span
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 5,
                          backgroundColor: cfg.bg, color: cfg.color,
                          fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 6,
                          border: `1px solid ${cfg.border}`, flexShrink: 0, marginTop: 1,
                        }}
                      >
                        <Icon size={12} />
                        {cfg.label}
                      </span>
                      <div>
                        <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', marginBottom: 4 }}>
                          {item.title}
                        </p>
                        <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                          {item.description}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        <div style={{ textAlign: 'center', marginTop: 48, color: 'var(--color-text-muted)', fontSize: 13 }}>
          Plataforma Mitra
        </div>
      </div>
    </div>
  );
}
