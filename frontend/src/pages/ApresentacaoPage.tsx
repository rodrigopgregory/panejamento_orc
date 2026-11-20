import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useFiscalYear } from '../hooks/useFiscalYear';
import {
  LayoutDashboard, ClipboardCheck, BarChart3, Users, Settings, Database,
  ChevronLeft, ChevronRight, Maximize, Minimize, FileDown, ImagePlus,
  X, ArrowUp, ArrowDown, CheckCircle2, Layers, Calculator, GitBranch,
  UserCheck, TrendingUp, Shield, Zap, Target, FileBarChart, BookOpen
} from 'lucide-react';

/* ─────────── Constants ─────────── */

const ACCENT = '#75c95f';
const ACCENT_BG = 'rgba(117, 201, 95, 0.06)';
const ACCENT_BORDER = 'rgba(117, 201, 95, 0.15)';
const GREEN = '#10b981';
const GREEN_BG = 'rgba(16, 185, 129, 0.08)';
const GREEN_BORDER = 'rgba(16, 185, 129, 0.18)';

/* ─────────── Mitra Logo SVG ─────────── */

function MitraLogoFull({ size = 22 }: { size?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, opacity: 0.5 }}>
      <svg width={size} height={size} viewBox="0 0 141.73 141.73" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path fill="#75c95f" d="M132.16,47.7L94.04,9.58c-0.63-0.63-1.29-1.24-2.04-1.87L91.2,6.98c-0.37-0.3-0.77-0.57-1.26-0.87C84.38,2.11,77.78,0,70.87,0C62.11,0,53.88,3.4,47.7,9.58L9.57,47.7C3.4,53.87,0,62.1,0,70.87c0,8.77,3.4,16.99,9.57,23.17l20.69,20.69l-0.06,0.07l1.22,1.21c8.31,8.24,10.27,10.29,10.69,10.79c2.1,2.42,7.68,7.44,7.96,7.7l0.23,0.19c0.56,0.45,1.19,0.85,1.86,1.21c5.51,3.83,11.97,5.86,18.71,5.86c8.76,0,16.99-3.4,23.17-9.58l38.12-38.12c6.17-6.17,9.57-14.4,9.57-23.17C141.73,62.1,138.33,53.87,132.16,47.7z M70.87,7.64c1.31,0,2.62,0.1,3.91,0.3c-0.06,0.06-0.13,0.13-0.19,0.19l-14.3,14.01L22.15,60.28c-2.81,2.81-4.36,6.57-4.36,10.59c0,4.02,1.55,7.78,4.36,10.59l38.12,38.12c1.73,1.73,3.86,2.99,6.19,3.7l-4.95,4.88c-1.38,1.44-3.57,1.9-5.39,1.14c-1.17-0.84-2.16-1.68-3.03-2.55L14.98,88.63c-4.73-4.73-7.33-11.04-7.33-17.76c0-6.73,2.6-13.03,7.33-17.76L53.1,14.99C57.84,10.25,64.15,7.64,70.87,7.64z M65.07,113.48L49.55,98.04L27.56,76.05c-1.37-1.37-2.12-3.21-2.12-5.18c0-1.97,0.75-3.82,2.12-5.18l38.12-38.12c1.06-1.06,2.42-1.76,3.82-2c0.38-0.04,0.77-0.06,1.19-0.06c0.27,0,0.56,0.01,0.84,0.02c2.66,0.15,4.66,2.41,4.82,2.61l37.81,37.54c1.37,1.37,2.12,3.21,2.12,5.18c0,1.97-0.75,3.81-2.12,5.18l-38.12,38.12c-0.23,0.23-0.49,0.45-0.82,0.69c-0.02,0.01-2.04,1.38-5.17,1.2C67.21,115.9,65.08,113.49,65.07,113.48z M66.96,133.52l12.3-12.14c0.79-0.54,1.53-1.14,2.19-1.81l38.12-38.12c2.81-2.81,4.36-6.57,4.36-10.59c0-4.02-1.55-7.78-4.36-10.59L81.46,22.16c-1.76-1.75-3.92-3.03-6.28-3.72l4.88-4.95c1.47-1.53,3.77-1.93,5.65-0.97c0.39,0.29,0.79,0.57,1.17,0.88c1.47,1.45,5.15,5.08,6.8,6.74c1.14,1.15,6.18,6.17,10.91,10.87l1.16,1.08l21.03,21.02c4.73,4.73,7.33,11.04,7.33,17.76c0,6.72-2.6,13.03-7.33,17.76l-38.12,38.12c-5.8,5.8-13.92,8.33-21.88,6.99C66.82,133.66,66.89,133.59,66.96,133.52z"/>
      </svg>
      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', letterSpacing: '0.02em' }}>Powered by Mitra</span>
    </div>
  );
}

/* Client logo placeholder */
function ClientLogo({ size = 140 }: { size?: number }) {
  return (
    <div style={{
      width: size, height: size * 0.5, borderRadius: 12,
      border: `2px dashed ${ACCENT_BORDER}`, backgroundColor: ACCENT_BG,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 14, color: 'var(--color-text-muted)', fontWeight: 500, letterSpacing: '0.01em'
    }}>
      Logo do Cliente
    </div>
  );
}

/* ─────────── Slide Wrapper ─────────── */

function SlideWrapper({ children, isPdf }: { children: React.ReactNode; isPdf?: boolean }) {
  return (
    <div className={isPdf ? 'pdf-page' : ''} style={{
      width: '100%', height: isPdf ? 'auto' : '100vh',
      minHeight: isPdf ? '210mm' : undefined,
      backgroundColor: '#ffffff',
      padding: '32px 48px 40px',
      display: 'flex', flexDirection: 'column',
      position: 'relative', boxSizing: 'border-box',
      pageBreakAfter: isPdf ? 'always' : undefined,
      breakAfter: isPdf ? 'page' : undefined,
    }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {children}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'auto', paddingTop: 16 }}>
        <MitraLogoFull />
      </div>
    </div>
  );
}

/* ─────────── SLIDE 1 — Capa ─────────── */

function SlideCover({ isPdf }: { isPdf?: boolean }) {
  const pillarLabels = ['Planejamento', 'Controle', 'Visibilidade', 'Colaboracao'];
  return (
    <SlideWrapper isPdf={isPdf}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 32 }}>
        <ClientLogo size={160} />
        <div style={{ textAlign: 'center' }}>
          <h1 style={{ fontSize: 40, fontWeight: 700, color: 'var(--color-text)', margin: 0, letterSpacing: '-0.02em' }}>
            Mitra FP&A
          </h1>
          <p style={{ fontSize: 18, color: 'var(--color-text-secondary)', marginTop: 8, fontWeight: 400 }}>
            Planejamento Financeiro e Analise de Resultados
          </p>
        </div>
        <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
          {pillarLabels.map((p, i) => (
            <div key={i} style={{
              padding: '10px 24px', borderRadius: 50, fontSize: 14, fontWeight: 600,
              backgroundColor: ACCENT_BG, border: `1px solid ${ACCENT_BORDER}`, color: ACCENT
            }}>
              {p}
            </div>
          ))}
        </div>
      </div>
    </SlideWrapper>
  );
}

/* ─────────── SLIDE 2 — Visão Geral ─────────── */

const modules = [
  { icon: LayoutDashboard, title: 'Dashboard Executivo', color: '#75c95f', desc: 'Visão consolidada de receita, custos e resultado com indicadores de desempenho e acompanhamento do progresso orçamentário.' },
  { icon: ClipboardCheck, title: 'Fluxo de Aprovação', color: '#f59e0b', desc: 'Gestores preenchem e submetem seus orçamentos. Cada marca percorre etapas de aprovação até a consolidação final.' },
  { icon: BarChart3, title: 'DRE Consolidado', color: '#10b981', desc: 'Demonstrativo de resultados completo com visão orçada, comparativa e análise por conta contábil com abertura por detalhe.' },
  { icon: Users, title: 'Projeção de Pessoal', color: '#ec4899', desc: 'Projete quadro de funcionários, salários, benefícios e encargos mês a mês, com reflexo direto no orçamento.' },
  { icon: Layers, title: 'Modelos de Projeção', color: '#8b5cf6', desc: 'Configure drivers de receita, custo e despesa vinculados a contas contábeis. Cada modelo projeta uma dimensão do orçamento.' },
  { icon: Database, title: 'Dados e Cadastros', color: '#06b6d4', desc: 'Empresas, centros de resultado, contas contábeis, colaboradores, cargos e benefícios — base para todo o planejamento.' },
];

function SlideOverview({ isPdf }: { isPdf?: boolean }) {
  return (
    <SlideWrapper isPdf={isPdf}>
      <h2 style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-text)', marginBottom: 4 }}>Visão Geral do Sistema</h2>
      <p style={{ fontSize: 15, color: 'var(--color-text-secondary)', marginBottom: 28 }}>Módulos que compõem a plataforma de planejamento financeiro</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20, flex: 1 }}>
        {modules.map((m, i) => {
          const Icon = m.icon;
          return (
            <div key={i} style={{
              padding: 24, borderRadius: 16, border: `1px solid #e4e4e7`,
              backgroundColor: '#ffffff', display: 'flex', flexDirection: 'column', gap: 12
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  backgroundColor: `${m.color}15`
                }}>
                  <Icon size={20} color={m.color} />
                </div>
                <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-text)' }}>{m.title}</span>
              </div>
              <p style={{ fontSize: 13.5, color: 'var(--color-text-secondary)', lineHeight: 1.6, margin: 0 }}>{m.desc}</p>
            </div>
          );
        })}
      </div>
    </SlideWrapper>
  );
}

/* ─────────── SLIDE 3 — Dashboard ─────────── */

function SlideDashboard({ isPdf }: { isPdf?: boolean }) {
  const kpis = [
    { label: 'Receita Total', color: '#10b981' },
    { label: 'Custos e Despesas', color: '#ef4444' },
    { label: 'Resultado Líquido', color: '#75c95f' },
    { label: 'Margem', color: '#f59e0b' },
  ];
  const dreLines = ['Receita Bruta', 'Deduções', 'Receita Líquida', 'Custos Diretos', 'Lucro Bruto', 'Despesas Operacionais', 'Resultado Operacional'];
  return (
    <SlideWrapper isPdf={isPdf}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: '#75c95f15', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <LayoutDashboard size={22} color="#75c95f" />
        </div>
        <div>
          <h2 style={{ fontSize: 26, fontWeight: 700, color: 'var(--color-text)', margin: 0 }}>Dashboard Executivo</h2>
          <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', margin: 0, marginTop: 2 }}>Visão consolidada de resultados e progresso</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
        {kpis.map((k, i) => (
          <div key={i} style={{
            padding: '16px 20px', borderRadius: 12, border: `1px solid #e4e4e7`, backgroundColor: '#ffffff'
          }}>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', fontWeight: 500, marginBottom: 6 }}>{k.label}</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: k.color, fontFeatureSettings: '"tnum"' }}>—</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, flex: 1 }}>
        <div style={{ padding: 20, borderRadius: 14, border: `1px solid #e4e4e7`, display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', marginBottom: 12 }}>Resumo DRE</span>
          {dreLines.map((l, i) => (
            <div key={i} style={{
              display: 'flex', justifyContent: 'space-between', padding: '8px 0',
              borderBottom: i < dreLines.length - 1 ? '1px solid #f4f4f5' : 'none',
              fontSize: 13, color: 'var(--color-text-secondary)'
            }}>
              <span>{l}</span><span style={{ color: 'var(--color-text-muted)', fontFeatureSettings: '"tnum"' }}>—</span>
            </div>
          ))}
        </div>
        <div style={{ padding: 20, borderRadius: 14, border: `1px solid #e4e4e7`, display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)', marginBottom: 12 }}>Progresso por Área</span>
          {['Comercial', 'Marketing', 'Operações', 'Tecnologia', 'RH'].map((area, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: i < 4 ? '1px solid #f4f4f5' : 'none' }}>
              <span style={{ fontSize: 13, color: 'var(--color-text-secondary)', flex: 1 }}>{area}</span>
              <div style={{ width: 120, height: 6, borderRadius: 3, backgroundColor: '#f4f4f5' }}>
                <div style={{ width: `${[80, 60, 90, 45, 70][i]}%`, height: '100%', borderRadius: 3, backgroundColor: '#75c95f' }} />
              </div>
              <span style={{ fontSize: 12, color: 'var(--color-text-muted)', width: 32, textAlign: 'right' }}>{[80, 60, 90, 45, 70][i]}%</span>
            </div>
          ))}
        </div>
      </div>
    </SlideWrapper>
  );
}

/* ─────────── SLIDE 4 — Workflow ─────────── */

function SlideWorkflow({ isPdf }: { isPdf?: boolean }) {
  const stages = [
    { label: 'Pendente', color: 'var(--color-text-muted)', desc: 'Gestor ainda não iniciou o preenchimento do orçamento' },
    { label: 'Confirmado', color: '#f59e0b', desc: 'Gestor confirmou o recebimento e está trabalhando' },
    { label: 'Submetido', color: '#75c95f', desc: 'Orçamento preenchido e enviado para aprovação' },
    { label: 'Aprovado', color: '#10b981', desc: 'Aprovado pela controladoria e consolidado' },
  ];
  return (
    <SlideWrapper isPdf={isPdf}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: '#f59e0b15', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <ClipboardCheck size={22} color="#f59e0b" />
        </div>
        <div>
          <h2 style={{ fontSize: 26, fontWeight: 700, color: 'var(--color-text)', margin: 0 }}>Fluxo de Aprovação</h2>
          <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', margin: 0, marginTop: 2 }}>Cada área percorre etapas até a aprovação final</p>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'stretch', gap: 0, flex: 1 }}>
        {stages.map((s, i) => (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative' }}>
            {/* Connector */}
            {i < stages.length - 1 && (
              <div style={{
                position: 'absolute', top: 28, right: -12, width: 24, height: 2,
                backgroundColor: '#e4e4e7', zIndex: 1
              }} />
            )}
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
              padding: '24px 16px', borderRadius: 16, border: `1px solid #e4e4e7`,
              backgroundColor: '#ffffff', margin: '0 6px', flex: 1
            }}>
              <div style={{
                width: 56, height: 56, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                backgroundColor: `${s.color}12`, border: `2px solid ${s.color}30`
              }}>
                <span style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{i + 1}</span>
              </div>
              <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-text)' }}>{s.label}</span>
              <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', textAlign: 'center', lineHeight: 1.5, margin: 0 }}>{s.desc}</p>
            </div>
          </div>
        ))}
      </div>

      <div style={{
        marginTop: 24, padding: '16px 24px', borderRadius: 12,
        backgroundColor: ACCENT_BG, border: `1px solid ${ACCENT_BORDER}`,
        display: 'flex', alignItems: 'center', gap: 12
      }}>
        <Shield size={18} color={ACCENT} />
        <span style={{ fontSize: 13.5, color: 'var(--color-text-secondary)' }}>
          Cada gestor preenche apenas os centros de resultado sob sua responsabilidade. A controladoria acompanha o progresso de todas as áreas em tempo real.
        </span>
      </div>
    </SlideWrapper>
  );
}

/* ─────────── SLIDE 5 — DRE ─────────── */

function SlideDRE({ isPdf }: { isPdf?: boolean }) {
  const dreItems = [
    { label: 'Receita Bruta', indent: 0, bold: true },
    { label: 'Impostos sobre Receita', indent: 1, bold: false },
    { label: 'Receita Líquida', indent: 0, bold: true, highlight: true },
    { label: 'Custos Diretos', indent: 1, bold: false },
    { label: 'Lucro Bruto', indent: 0, bold: true, highlight: true },
    { label: 'Despesas Comerciais', indent: 1, bold: false },
    { label: 'Despesas Administrativas', indent: 1, bold: false },
    { label: 'Despesas com Pessoal', indent: 1, bold: false },
    { label: 'Resultado Operacional', indent: 0, bold: true, highlight: true },
  ];
  const { monthsShort: months } = useFiscalYear();
  return (
    <SlideWrapper isPdf={isPdf}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: '#10b98115', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <BarChart3 size={22} color="#10b981" />
        </div>
        <div>
          <h2 style={{ fontSize: 26, fontWeight: 700, color: 'var(--color-text)', margin: 0 }}>DRE Consolidado</h2>
          <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', margin: 0, marginTop: 2 }}>Demonstrativo completo com abertura mensal e análise comparativa</p>
        </div>
      </div>

      <div style={{ flex: 1, borderRadius: 14, border: '1px solid #e4e4e7', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{
          display: 'grid', gridTemplateColumns: '200px repeat(12, 1fr) 80px',
          backgroundColor: '#f8fafc', borderBottom: '1px solid #e4e4e7',
          fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em'
        }}>
          <div style={{ padding: '10px 16px' }}>Conta</div>
          {months.map(m => <div key={m} style={{ padding: '10px 4px', textAlign: 'right' }}>{m}</div>)}
          <div style={{ padding: '10px 16px', textAlign: 'right' }}>Total</div>
        </div>
        {/* Rows */}
        {dreItems.map((item, i) => (
          <div key={i} style={{
            display: 'grid', gridTemplateColumns: '200px repeat(12, 1fr) 80px',
            borderBottom: i < dreItems.length - 1 ? '1px solid #f4f4f5' : 'none',
            backgroundColor: item.highlight ? ACCENT_BG : 'transparent',
            fontSize: 13, color: item.bold ? 'var(--color-text)' : 'var(--color-text-secondary)',
            fontWeight: item.bold ? 600 : 400
          }}>
            <div style={{ padding: '9px 16px', paddingLeft: 16 + item.indent * 16 }}>{item.label}</div>
            {months.map(m => <div key={m} style={{ padding: '9px 4px', textAlign: 'right', color: 'var(--color-text-muted)', fontFeatureSettings: '"tnum"' }}>—</div>)}
            <div style={{ padding: '9px 16px', textAlign: 'right', color: 'var(--color-text-muted)', fontFeatureSettings: '"tnum"' }}>—</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 16, marginTop: 16 }}>
        {[
          { label: 'Visão Orçada', desc: 'Valores projetados pelos gestores' },
          { label: 'Visão Comparativa', desc: 'Orçado vs. realizado lado a lado' },
          { label: 'Abertura por Detalhe', desc: 'Aprofunde qualquer linha até o detalhe do driver' },
        ].map((f, i) => (
          <div key={i} style={{
            flex: 1, padding: '12px 16px', borderRadius: 10,
            backgroundColor: ACCENT_BG, border: `1px solid ${ACCENT_BORDER}`,
            display: 'flex', flexDirection: 'column', gap: 2
          }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: ACCENT }}>{f.label}</span>
            <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{f.desc}</span>
          </div>
        ))}
      </div>
    </SlideWrapper>
  );
}

/* ─────────── SLIDE 6 — Projeção e Modelos ─────────── */

function SlideModelos({ isPdf }: { isPdf?: boolean }) {
  const driverTypes = [
    { name: 'Receita', icon: TrendingUp, color: '#10b981', items: ['Volume de vendas por produto', 'Preço médio por categoria', 'Comissões sobre receita'] },
    { name: 'Custos', icon: Calculator, color: '#ef4444', items: ['Custo de mercadoria vendida', 'Frete e logística', 'Insumos de produção'] },
    { name: 'Despesas', icon: Settings, color: '#f59e0b', items: ['Aluguel e infraestrutura', 'Tecnologia e sistemas', 'Marketing e comunicação'] },
    { name: 'Pessoal', icon: Users, color: '#ec4899', items: ['Quadro de funcionários', 'Salários e reajustes', 'Benefícios e encargos'] },
  ];
  return (
    <SlideWrapper isPdf={isPdf}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: '#8b5cf615', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Layers size={22} color="#8b5cf6" />
        </div>
        <div>
          <h2 style={{ fontSize: 26, fontWeight: 700, color: 'var(--color-text)', margin: 0 }}>Modelos de Projeção</h2>
          <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', margin: 0, marginTop: 2 }}>Cada modelo projeta uma dimensão do orçamento, vinculado a contas contábeis</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 20, flex: 1 }}>
        {driverTypes.map((d, i) => {
          const Icon = d.icon;
          return (
            <div key={i} style={{
              padding: 24, borderRadius: 16, border: '1px solid #e4e4e7',
              backgroundColor: '#ffffff', display: 'flex', flexDirection: 'column', gap: 16
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  backgroundColor: `${d.color}15`
                }}>
                  <Icon size={18} color={d.color} />
                </div>
                <span style={{ fontSize: 17, fontWeight: 600, color: 'var(--color-text)' }}>{d.name}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {d.items.map((item, j) => (
                  <div key={j} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 5, height: 5, borderRadius: '50%', backgroundColor: d.color, flexShrink: 0 }} />
                    <span style={{ fontSize: 13.5, color: 'var(--color-text-secondary)' }}>{item}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{
        marginTop: 20, padding: '14px 20px', borderRadius: 12,
        backgroundColor: ACCENT_BG, border: `1px solid ${ACCENT_BORDER}`,
        fontSize: 13.5, color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', gap: 10
      }}>
        <Zap size={16} color={ACCENT} />
        Edição direta na planilha, como no Excel. Cada modelo se conecta a contas contábeis específicas e alimenta o DRE automaticamente.
      </div>
    </SlideWrapper>
  );
}

/* ─────────── SLIDE 7 — Configurações e Cadastros ─────────── */

function SlideCadastros({ isPdf }: { isPdf?: boolean }) {
  const cadastros = [
    { icon: GitBranch, label: 'Versões Orçamentárias', color: '#75c95f', desc: 'Crie diferentes versões do orçamento para comparar cenários e manter histórico' },
    { icon: UserCheck, label: 'Gestores e Permissões', color: '#f59e0b', desc: 'Atribua gestores a centros de resultado e controle quem preenche cada área' },
    { icon: BookOpen, label: 'Regras de Consolidação', color: '#8b5cf6', desc: 'Configure como os dados de cada pacote se consolidam no resultado final' },
    { icon: Calculator, label: 'Estrutura DRE', color: '#10b981', desc: 'Defina as linhas do demonstrativo, subtotais, destaques e a ordem de apresentação' },
    { icon: FileBarChart, label: 'Resultado Contábil', color: '#06b6d4', desc: 'Consulte os dados realizados por conta e centro de resultado, mês a mês' },
    { icon: Database, label: 'Dados Mestres', color: '#ec4899', desc: 'Empresas, centros de resultado, contas contábeis, colaboradores, cargos e benefícios' },
  ];
  return (
    <SlideWrapper isPdf={isPdf}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: '#06b6d415', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Settings size={22} color="#06b6d4" />
        </div>
        <div>
          <h2 style={{ fontSize: 26, fontWeight: 700, color: 'var(--color-text)', margin: 0 }}>Configurações e Cadastros</h2>
          <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', margin: 0, marginTop: 2 }}>Base de dados e parametrizações do sistema</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, flex: 1 }}>
        {cadastros.map((c, i) => {
          const Icon = c.icon;
          return (
            <div key={i} style={{
              padding: 20, borderRadius: 14, border: '1px solid #e4e4e7',
              backgroundColor: '#ffffff', display: 'flex', flexDirection: 'column', gap: 10
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 34, height: 34, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  backgroundColor: `${c.color}15`
                }}>
                  <Icon size={17} color={c.color} />
                </div>
                <span style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--color-text)' }}>{c.label}</span>
              </div>
              <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.55, margin: 0 }}>{c.desc}</p>
            </div>
          );
        })}
      </div>
    </SlideWrapper>
  );
}

/* ─────────── SLIDE 8 — Demo / Escopo ─────────── */

function SlideDemo({ isPdf }: { isPdf?: boolean }) {
  const ready = [
    'Dashboard executivo com KPIs e progresso',
    'Fluxo de aprovação com 4 etapas',
    'DRE consolidado com abertura por detalhe',
    'Preenchimento por gestores com permissões',
    'Modelos de projeção vinculados a contas',
    'Projeção de pessoal (quadro, salários, encargos)',
    'Versionamento orçamentário completo',
    'Cadastros e dados mestres integrados',
  ];
  const planned = [
    'Integração com ERP para dados de realizado',
    'Cenários de simulação (otimista, pessimista)',
    'Relatórios exportáveis em PDF e Excel',
    'Alertas e notificações por e-mail',
    'Painel de auditoria e rastreabilidade',
    'Customização avançada de regras contábeis',
  ];
  return (
    <SlideWrapper isPdf={isPdf}>
      <h2 style={{ fontSize: 26, fontWeight: 700, color: 'var(--color-text)', marginBottom: 4 }}>Demonstração e Escopo</h2>
      <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', marginBottom: 28 }}>O que já está pronto e o que vem no projeto completo</p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, flex: 1 }}>
        {/* Ready */}
        <div style={{
          padding: 24, borderRadius: 16,
          backgroundColor: GREEN_BG, border: `1px solid ${GREEN_BORDER}`,
          display: 'flex', flexDirection: 'column', gap: 16
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <CheckCircle2 size={20} color={GREEN} />
            <span style={{ fontSize: 17, fontWeight: 600, color: 'var(--color-text)' }}>O que já está na demo</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {ready.map((r, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <CheckCircle2 size={16} color={GREEN} style={{ marginTop: 2, flexShrink: 0 }} />
                <span style={{ fontSize: 13.5, color: 'var(--color-text)', lineHeight: 1.4 }}>{r}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Planned */}
        <div style={{
          padding: 24, borderRadius: 16,
          backgroundColor: ACCENT_BG, border: `1px solid ${ACCENT_BORDER}`,
          display: 'flex', flexDirection: 'column', gap: 16
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Settings size={20} color={ACCENT} />
            <span style={{ fontSize: 17, fontWeight: 600, color: 'var(--color-text)' }}>No projeto completo</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {planned.map((p, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <Settings size={16} color={ACCENT} style={{ marginTop: 2, flexShrink: 0 }} />
                <span style={{ fontSize: 13.5, color: 'var(--color-text)', lineHeight: 1.4 }}>{p}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{
        marginTop: 20, padding: '14px 24px', borderRadius: 12,
        backgroundColor: '#f8fafc', border: '1px solid #e4e4e7',
        textAlign: 'center', fontSize: 14, color: 'var(--color-text-secondary)', fontStyle: 'italic'
      }}>
        Cada funcionalidade é desenhada sob medida — não é uma solução genérica.
      </div>
    </SlideWrapper>
  );
}

/* ─────────── SLIDE 9 — Encerramento ─────────── */

function SlideClosing({ isPdf }: { isPdf?: boolean }) {
  const benefits = [
    { icon: Target, label: 'Precisão', desc: 'Projeções vinculadas a contas contábeis, sem planilhas soltas' },
    { icon: Zap, label: 'Agilidade', desc: 'Consolidação automática, sem retrabalho manual entre áreas' },
    { icon: Shield, label: 'Controle', desc: 'Cada gestor preenche seu escopo, com rastreabilidade completa' },
    { icon: TrendingUp, label: 'Visibilidade', desc: 'DRE atualizado em tempo real, com comparativo orçado vs. realizado' },
  ];
  return (
    <SlideWrapper isPdf={isPdf}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 28 }}>
        <ClientLogo size={140} />
        <div style={{ textAlign: 'center' }}>
          <h2 style={{ fontSize: 32, fontWeight: 700, color: 'var(--color-text)', margin: 0, letterSpacing: '-0.015em' }}>
            Planejamento financeiro com clareza e controle
          </h2>
          <p style={{ fontSize: 16, color: 'var(--color-text-secondary)', marginTop: 8 }}>
            Da projeção ao resultado, tudo em um só lugar
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, maxWidth: 800, width: '100%' }}>
          {benefits.map((b, i) => {
            const Icon = b.icon;
            return (
              <div key={i} style={{
                padding: '20px 16px', borderRadius: 14, border: '1px solid #e4e4e7',
                backgroundColor: '#ffffff', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center'
              }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  backgroundColor: ACCENT_BG
                }}>
                  <Icon size={20} color={ACCENT} />
                </div>
                <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text)' }}>{b.label}</span>
                <span style={{ fontSize: 12.5, color: 'var(--color-text-secondary)', lineHeight: 1.4 }}>{b.desc}</span>
              </div>
            );
          })}
        </div>
      </div>
    </SlideWrapper>
  );
}

/* ─────────── Slide Registry ─────────── */

const SLIDES = [
  { id: 'capa', label: 'Capa', Component: SlideCover },
  { id: 'visao', label: 'Visão Geral', Component: SlideOverview },
  { id: 'dashboard', label: 'Dashboard', Component: SlideDashboard },
  { id: 'workflow', label: 'Workflow', Component: SlideWorkflow },
  { id: 'dre', label: 'DRE', Component: SlideDRE },
  { id: 'modelos', label: 'Modelos', Component: SlideModelos },
  { id: 'cadastros', label: 'Cadastros', Component: SlideCadastros },
  { id: 'demo', label: 'Demo', Component: SlideDemo },
  { id: 'encerramento', label: 'Encerramento', Component: SlideClosing },
];

/* ─────────── Interactive Presentation Mode ─────────── */

function InteractivePresentationMode() {
  const [current, setCurrent] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const next = useCallback(() => setCurrent(c => Math.min(c + 1, SLIDES.length - 1)), []);
  const prev = useCallback(() => setCurrent(c => Math.max(c - 1, 0)), []);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen();
      setIsFullscreen(false);
    }
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); next(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
      else if (e.key === 'f' || e.key === 'F') toggleFullscreen();
      else if (e.key === 'Escape' && isFullscreen) { document.exitFullscreen(); setIsFullscreen(false); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, prev, toggleFullscreen, isFullscreen]);

  useEffect(() => {
    function onChange() { setIsFullscreen(!!document.fullscreenElement); }
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const CurrentSlide = SLIDES[current].Component;

  return (
    <div ref={containerRef} style={{ width: '100vw', height: '100vh', backgroundColor: '#f1f5f9', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Top tabs */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 0, padding: '0 16px',
        height: 44, backgroundColor: '#ffffff', borderBottom: '1px solid #e4e4e7',
        flexShrink: 0, overflow: 'auto'
      }}>
        {SLIDES.map((s, i) => (
          <button key={s.id} onClick={() => setCurrent(i)} style={{
            padding: '8px 16px', fontSize: 13, fontWeight: i === current ? 600 : 400,
            color: i === current ? ACCENT : 'var(--color-text-secondary)',
            borderBottom: i === current ? `2px solid ${ACCENT}` : '2px solid transparent',
            background: 'none', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
            transition: 'all 0.15s'
          }}>
            {s.label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button onClick={toggleFullscreen} style={{
          background: 'none', border: 'none', cursor: 'pointer', padding: 6, color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center'
        }}>
          {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
        </button>
        <a href="?modo=pdf" style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px',
          borderRadius: 8, backgroundColor: ACCENT, color: '#ffffff',
          fontSize: 13, fontWeight: 500, textDecoration: 'none', marginLeft: 8
        }}>
          <FileDown size={14} /> Exportar PDF
        </a>
      </div>

      {/* Slide container */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, overflow: 'hidden' }}>
        <div style={{
          width: '100%', maxWidth: 1200, aspectRatio: '16/9',
          maxHeight: 'calc(100vh - 112px)',
          borderRadius: 12, overflow: 'hidden',
          boxShadow: '0 4px 24px rgba(0,0,0,0.08)', backgroundColor: '#ffffff'
        }}>
          <div style={{ width: '100%', height: '100%', overflow: 'auto' }}>
            <CurrentSlide />
          </div>
        </div>
      </div>

      {/* Bottom controls */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16,
        height: 44, backgroundColor: '#ffffff', borderTop: '1px solid #e4e4e7', flexShrink: 0
      }}>
        <button onClick={prev} disabled={current === 0} style={{
          background: 'none', border: 'none', cursor: current === 0 ? 'default' : 'pointer',
          opacity: current === 0 ? 0.3 : 1, padding: 4, display: 'flex', color: 'var(--color-text-secondary)'
        }}>
          <ChevronLeft size={20} />
        </button>
        <div style={{ display: 'flex', gap: 6 }}>
          {SLIDES.map((_, i) => (
            <button key={i} onClick={() => setCurrent(i)} style={{
              width: i === current ? 20 : 8, height: 8, borderRadius: 4,
              backgroundColor: i === current ? ACCENT : '#cbd5e1',
              border: 'none', cursor: 'pointer', transition: 'all 0.2s', padding: 0
            }} />
          ))}
        </div>
        <button onClick={next} disabled={current === SLIDES.length - 1} style={{
          background: 'none', border: 'none', cursor: current === SLIDES.length - 1 ? 'default' : 'pointer',
          opacity: current === SLIDES.length - 1 ? 0.3 : 1, padding: 4, display: 'flex', color: 'var(--color-text-secondary)'
        }}>
          <ChevronRight size={20} />
        </button>
        <span style={{ fontSize: 12, color: 'var(--color-text-muted)', marginLeft: 8 }}>{current + 1} / {SLIDES.length}</span>
      </div>
    </div>
  );
}

/* ─────────── PDF Export Mode ─────────── */

function PDFExportMode() {
  const [screenshots, setScreenshots] = useState<{ id: string; url: string; name: string }[]>([]);

  function handleAddScreenshots(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;
    const newShots = Array.from(files).map(f => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      url: URL.createObjectURL(f),
      name: f.name
    }));
    setScreenshots(prev => [...prev, ...newShots]);
    e.target.value = '';
  }

  function removeScreenshot(id: string) {
    setScreenshots(prev => {
      const item = prev.find(s => s.id === id);
      if (item) URL.revokeObjectURL(item.url);
      return prev.filter(s => s.id !== id);
    });
  }

  function moveScreenshot(id: string, dir: -1 | 1) {
    setScreenshots(prev => {
      const idx = prev.findIndex(s => s.id === id);
      if (idx < 0) return prev;
      const newIdx = idx + dir;
      if (newIdx < 0 || newIdx >= prev.length) return prev;
      const arr = [...prev];
      [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
      return arr;
    });
  }

  return (
    <div style={{ backgroundColor: '#f1f5f9', minHeight: '100vh' }}>
      {/* Toolbar */}
      <div className="pdf-toolbar" style={{
        position: 'sticky', top: 0, zIndex: 50,
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 24px', backgroundColor: '#ffffff', borderBottom: '1px solid #e4e4e7'
      }}>
        <a href="/apresentacao" style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px',
          borderRadius: 8, border: '1px solid #e4e4e7', backgroundColor: '#ffffff',
          fontSize: 13, fontWeight: 500, color: 'var(--color-text-secondary)', textDecoration: 'none'
        }}>
          <ChevronLeft size={14} /> Voltar
        </a>
        <div style={{ flex: 1 }} />
        <label style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px',
          borderRadius: 8, border: '1px solid #e4e4e7', backgroundColor: '#ffffff',
          fontSize: 13, fontWeight: 500, color: 'var(--color-text-secondary)', cursor: 'pointer'
        }}>
          <ImagePlus size={14} /> Adicionar Prints
          <input type="file" multiple accept="image/*" onChange={handleAddScreenshots} style={{ display: 'none' }} />
        </label>
        <button onClick={() => window.print()} style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px',
          borderRadius: 8, backgroundColor: ACCENT, color: '#ffffff',
          fontSize: 13, fontWeight: 500, border: 'none', cursor: 'pointer'
        }}>
          <FileDown size={14} /> Exportar PDF (Ctrl+P)
        </button>
      </div>

      {/* Screenshots bar */}
      {screenshots.length > 0 && (
        <div className="pdf-screenshots-bar" style={{
          position: 'sticky', top: 52, zIndex: 49,
          padding: '8px 24px', backgroundColor: '#ffffff', borderBottom: '1px solid #e4e4e7',
          display: 'flex', gap: 8, overflowX: 'auto'
        }}>
          {screenshots.map((s, i) => (
            <div key={s.id} style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px',
              borderRadius: 6, backgroundColor: '#f8fafc', border: '1px solid #e4e4e7',
              fontSize: 12, color: 'var(--color-text-secondary)', flexShrink: 0
            }}>
              <span style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
              <button onClick={() => moveScreenshot(s.id, -1)} disabled={i === 0} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, opacity: i === 0 ? 0.3 : 1, display: 'flex' }}>
                <ArrowUp size={12} />
              </button>
              <button onClick={() => moveScreenshot(s.id, 1)} disabled={i === screenshots.length - 1} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, opacity: i === screenshots.length - 1 ? 0.3 : 1, display: 'flex' }}>
                <ArrowDown size={12} />
              </button>
              <button onClick={() => removeScreenshot(s.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: '#ef4444', display: 'flex' }}>
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Slides */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '24px 0', gap: 24 }}>
        {SLIDES.map(s => (
          <div key={s.id} className="pdf-page" style={{
            width: '297mm', minHeight: '210mm', backgroundColor: '#ffffff',
            boxShadow: '0 2px 12px rgba(0,0,0,0.06)', overflow: 'hidden'
          }}>
            <s.Component isPdf />
          </div>
        ))}

        {/* Screenshots separator & pages */}
        {screenshots.length > 0 && (
          <>
            <div className="pdf-page" style={{
              width: '297mm', minHeight: '210mm', backgroundColor: '#ffffff',
              boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
              padding: '32px 48px 40px', boxSizing: 'border-box',
              pageBreakAfter: 'always', breakAfter: 'page'
            }}>
              <div style={{
                width: 64, height: 64, borderRadius: 16, backgroundColor: ACCENT_BG,
                display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 24
              }}>
                <ImagePlus size={28} color={ACCENT} />
              </div>
              <h2 style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-text)', margin: 0, marginBottom: 8 }}>Telas do Sistema</h2>
              <p style={{ fontSize: 16, color: 'var(--color-text-secondary)', textAlign: 'center', maxWidth: 500 }}>
                As proximas paginas apresentam capturas reais da plataforma em funcionamento.
              </p>
            </div>

            {screenshots.map(s => (
              <div key={s.id} className="pdf-page" style={{
                width: '297mm', minHeight: '210mm', backgroundColor: '#ffffff',
                boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: 24, boxSizing: 'border-box',
                pageBreakAfter: 'always', breakAfter: 'page'
              }}>
                <img src={s.url} alt={s.name} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 8 }} />
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

/* ─────────── Main Component ─────────── */

export default function ApresentacaoPage() {
  const [searchParams] = useSearchParams();
  const isPdf = searchParams.get('modo') === 'pdf';

  return (
    <>
      <style>{`
        @page {
          size: A4 landscape;
          margin: 0;
        }
        @media print {
          body { margin: 0 !important; }
          .pdf-toolbar { display: none !important; }
          .pdf-screenshots-bar { display: none !important; }
          .pdf-page {
            width: 100% !important;
            height: 100vh !important;
            page-break-after: always;
            break-after: page;
          }
        }
      `}</style>
      {isPdf ? <PDFExportMode /> : <InteractivePresentationMode />}
    </>
  );
}
