import { useRef, useState } from 'react';
import { Upload, AlertCircle, CheckCircle2, FileSpreadsheet, X } from 'lucide-react';
import Modal from './ui/Modal';
import Button from './ui/Button';
import { decodificarCsv, baixarTemplateCsv } from '../lib/csv';
import { prepararImportacao } from '../lib/folha-importacao';
import { batchCreate } from '../hooks/useMitraData';

// Tipos declarados localmente de proposito: o tsconfig usa verbatimModuleSyntax,
// e interface importada de outro arquivo some no bundle e quebra em runtime.
type AbaCsv = 'colaboradores' | 'cargos' | 'beneficios' | 'encargos' | 'dissidio' | 'turnover';

interface ContextoCsv {
  crs: { ID: number | string; CODIGO?: string; NOME?: string }[];
  empresas: { ID: number | string; NOME?: string }[];
  cargos: { NOME?: string }[];
  cicloId: number;
  existentes: Record<string, unknown>[];
}

interface LinhaImportada {
  linha: number;
  valores: string[];
  registro: Record<string, unknown> | null;
  erro: string | null;
}

interface ResultadoImportacao {
  colunas: string[];
  validas: LinhaImportada[];
  invalidas: LinhaImportada[];
  erroArquivo: string | null;
  tabela: string;
}

interface Props {
  aberto: boolean;
  /** Chave da aba em TEMPLATES_FOLHA (colaboradores, cargos, beneficios...). */
  aba: AbaCsv;
  titulo: string;
  /** Referencias e linhas ja existentes — ver ContextoImportacao. */
  contexto: ContextoCsv;
  template: { arquivo: string; colunas: readonly string[]; exemplos: readonly (readonly string[])[] };
  /** Nome da versao em que os registros entram, quando a aba e por versao. */
  versao?: string;
  onFechar: () => void;
  onImportado: (quantidade: number) => void;
  /** Recebe quantas linhas ja tinham entrado quando a gravacao falhou. */
  onErro: (gravadas: number) => void;
}

// Gravar tudo numa tacada estoura o limite do endpoint em arquivo grande; 50 e o
// mesmo tamanho de bloco que o orcamento ja usa.
const TAMANHO_BLOCO = 50;
const LINHAS_NA_PREVIA = 8;

export default function ImportarCsvModal({
  aberto, aba, titulo, contexto, template, versao, onFechar, onImportado, onErro,
}: Props) {
  const [arquivo, setArquivo] = useState<string>('');
  const [resultado, setResultado] = useState<ResultadoImportacao | null>(null);
  const [gravando, setGravando] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const limpar = () => { setArquivo(''); setResultado(null); setGravando(false); };
  const fechar = () => { limpar(); onFechar(); };

  const escolherArquivo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Zera o input para que escolher o MESMO arquivo de novo (depois de corrigi-lo
    // na planilha) dispare o onChange outra vez.
    e.target.value = '';
    if (!file) return;
    setArquivo(file.name);
    try {
      const texto = decodificarCsv(await file.arrayBuffer());
      setResultado(prepararImportacao(aba, texto, contexto) as ResultadoImportacao);
    } catch {
      setResultado({
        colunas: [...template.colunas], validas: [], invalidas: [], tabela: '',
        erroArquivo: 'Nao foi possivel ler o arquivo. Confirme que e um CSV.',
      });
    }
  };

  const confirmar = async () => {
    if (!resultado || resultado.validas.length === 0) return;
    setGravando(true);
    const registros = resultado.validas.map((v) => v.registro as Record<string, unknown>);
    // A gravacao vai em blocos, entao uma falha no meio deixa os blocos
    // anteriores no banco. Contamos o que ja entrou para avisar o usuario com
    // precisao em vez de dizer que nada foi gravado.
    let gravadas = 0;
    try {
      for (let i = 0; i < registros.length; i += TAMANHO_BLOCO) {
        const bloco = registros.slice(i, i + TAMANHO_BLOCO);
        await batchCreate(resultado.tabela, bloco);
        gravadas += bloco.length;
      }
      onImportado(registros.length);
      limpar();
    } catch {
      // Sem limpar a previa: o usuario continua vendo o que tentou importar.
      setGravando(false);
      onErro(gravadas);
    }
  };

  const validas = resultado?.validas.length ?? 0;
  const invalidas = resultado?.invalidas.length ?? 0;

  return (
    <Modal isOpen={aberto} onClose={fechar} title={`Importar ${titulo}`} size="xl">
      <div className="space-y-4">
        {/* Passo 1 — arquivo */}
        <div
          className="rounded-lg border border-dashed px-5 py-6 flex items-center gap-4"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--bg-app)' }}
        >
          <div
            className="shrink-0 w-10 h-10 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: 'var(--color-primary-bg)', color: 'var(--color-primary)' }}
          >
            <FileSpreadsheet size={20} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
              {arquivo || 'Nenhum arquivo escolhido'}
            </div>
            <div className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
              Preencha o Template CSV e escolha o arquivo aqui. Nada e gravado até você confirmar.
            </div>
          </div>
          <Button variant="secondary" onClick={() => baixarTemplateCsv({
            arquivo: template.arquivo,
            colunas: [...template.colunas],
            exemplos: template.exemplos.map((linha) => [...linha]),
          })}>Template CSV</Button>
          <Button onClick={() => inputRef.current?.click()} disabled={gravando}>
            <Upload size={16} className="mr-1" /> Escolher arquivo
          </Button>
          <input ref={inputRef} type="file" accept=".csv,text/csv" onChange={escolherArquivo} style={{ display: 'none' }} />
        </div>

        {/* Arquivo inteiro recusado */}
        {resultado?.erroArquivo && (
          <div
            className="rounded-lg px-4 py-3 text-sm flex items-start gap-2.5"
            style={{ backgroundColor: 'var(--kpi-bg-red, #fef2f2)', color: '#b91c1c' }}
          >
            <AlertCircle size={16} className="shrink-0 mt-0.5" />
            <span>{resultado.erroArquivo}</span>
          </div>
        )}

        {/* Passo 2 — previa */}
        {resultado && !resultado.erroArquivo && (
          <>
            <div className="flex items-center gap-4 text-sm">
              <span className="inline-flex items-center gap-1.5 font-medium" style={{ color: validas > 0 ? '#15803d' : 'var(--color-text-secondary)' }}>
                <CheckCircle2 size={15} /> {validas} {validas === 1 ? 'linha pronta' : 'linhas prontas'} para importar
              </span>
              {invalidas > 0 && (
                <span className="inline-flex items-center gap-1.5 font-medium" style={{ color: '#b45309' }}>
                  <X size={15} /> {invalidas} {invalidas === 1 ? 'linha ignorada' : 'linhas ignoradas'}
                </span>
              )}
              {versao && (
                <span className="ml-auto text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                  Serao gravadas na versao <strong style={{ color: 'var(--color-text)' }}>{versao}</strong>
                </span>
              )}
            </div>

            {validas > 0 && (
              <div className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
                <div className="overflow-x-auto max-h-[260px]">
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ color: 'var(--color-text-secondary)', fontSize: '11px' }}>
                        {resultado.colunas.map((coluna) => (
                          <th key={coluna} className="text-left px-3 py-2 uppercase tracking-wide font-medium whitespace-nowrap">{coluna}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {resultado.validas.slice(0, LINHAS_NA_PREVIA).map((item) => (
                        <tr key={item.linha} style={{ borderTop: '1px solid var(--color-border)' }}>
                          {resultado.colunas.map((coluna, i) => (
                            <td key={coluna} className="px-3 py-1.5 whitespace-nowrap" style={{ color: 'var(--color-text)' }}>
                              {item.valores[i] ?? ''}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {validas > LINHAS_NA_PREVIA && (
                  <div className="px-3 py-2 text-xs" style={{ color: 'var(--color-text-secondary)', borderTop: '1px solid var(--color-border)' }}>
                    e mais {validas - LINHAS_NA_PREVIA} {validas - LINHAS_NA_PREVIA === 1 ? 'linha' : 'linhas'}
                  </div>
                )}
              </div>
            )}

            {invalidas > 0 && (
              <div className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
                <div className="px-3 py-2 text-xs font-medium" style={{ color: 'var(--color-text-secondary)', backgroundColor: 'var(--bg-app)' }}>
                  Linhas que nao serao importadas — corrija na planilha e escolha o arquivo de novo
                </div>
                <div className="max-h-[180px] overflow-y-auto">
                  {resultado.invalidas.map((item) => (
                    <div key={item.linha} className="px-3 py-1.5 text-sm flex gap-3" style={{ borderTop: '1px solid var(--color-border)' }}>
                      <span className="shrink-0 text-xs font-medium" style={{ color: 'var(--color-text-secondary)', width: 58 }}>
                        Linha {item.linha}
                      </span>
                      <span style={{ color: '#b45309' }}>{item.erro}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={fechar} disabled={gravando}>Cancelar</Button>
          <Button onClick={confirmar} disabled={gravando || validas === 0}>
            {gravando ? 'Importando...' : validas > 0 ? `Importar ${validas} ${validas === 1 ? 'linha' : 'linhas'}` : 'Importar'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
