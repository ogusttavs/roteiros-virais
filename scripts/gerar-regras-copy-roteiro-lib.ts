/**
 * E50 parte 2, PR 1: a parte pura do gerador das regras de copy e de roteiro (sem disco, para
 * dar para testar). Lê a tabela da seção 11 de `estrategia/briefing-e-rubricas.md` e monta o
 * texto do arquivo `src/ia/prompts/regras-copy-roteiro.ts`.
 */
import type { RegraCopyRoteiro } from "../src/ia/prompts/regras-copy-roteiro";

const QUEBRA = String.fromCharCode(10);
const RETORNO = String.fromCharCode(13);
const PADRAO_LINHA = /^[|][ ]*(R-(?:COPY|ROTEIRO|CONF)-[0-9]{2})[ ]*[|]/;

/** A versão das regras (o `checar-versao-prompt` exige versão nova quando um arquivo de `src/ia/prompts/` muda). Subir junto com qualquer mudança da seção 11. 1.0.0: as 53 regras (PR 1); 1.1.0: R-COPY-21 como indício (PR 2). */
export const VERSAO_DAS_REGRAS = "1.1.0";

export const TOTAL_ESPERADO = { COPY: 25, ROTEIRO: 19, CONF: 9 } as const;

function forcaDe(celula: string): RegraCopyRoteiro["forca"] {
  const inicio = celula.trim().toLowerCase();
  if (inicio.startsWith("forte")) return "forte";
  if (inicio.startsWith("média") || inicio.startsWith("media")) return "media";
  if (inicio.startsWith("indício") || inicio.startsWith("indicio")) return "indicio";
  throw new Error(`força desconhecida: ${celula}`);
}

function conferePorCodigoDe(celula: string): RegraCopyRoteiro["conferePorCodigo"] {
  const inicio = celula.trim().toLowerCase();
  if (inicio.startsWith("sim")) return "sim";
  if (inicio.startsWith("só avisa") || inicio.startsWith("so avisa")) return "so_avisa";
  if (inicio.startsWith("parcial")) return "parcial";
  if (inicio.startsWith("não") || inicio.startsWith("nao")) return "nao";
  throw new Error(`coluna "confere por código" desconhecida: ${celula}`);
}

/** Lê as linhas `| R-XXXX-nn | ... |` da seção 11 (de "## 11." até a próxima seção de nível 2). */
export function lerTabelaDaSecao11(documento: string): RegraCopyRoteiro[] {
  const linhas = documento.split(QUEBRA).map((l) => l.split(RETORNO).join(""));
  const inicio = linhas.findIndex((l) => l.startsWith("## 11."));
  if (inicio === -1) throw new Error("a seção 11 não foi encontrada no documento");
  let fim = linhas.length;
  for (let i = inicio + 1; i < linhas.length; i++) {
    if (linhas[i].startsWith("## ")) {
      fim = i;
      break;
    }
  }
  const regras: RegraCopyRoteiro[] = [];
  for (const linha of linhas.slice(inicio, fim)) {
    const m = PADRAO_LINHA.exec(linha);
    if (!m) continue;
    const celulas = linha.trim().replace(/^[|]/, "").replace(/[|]$/, "").split("|").map((c) => c.trim());
    if (celulas.length !== 8) throw new Error(`${m[1]}: esperava 8 colunas, achou ${celulas.length}`);
    const [numero, texto, porQue, bloco, forca, confere, fonte] = celulas;
    const grupo = numero.split("-")[1] as RegraCopyRoteiro["grupo"];
    regras.push({
      numero,
      grupo,
      texto,
      porQue,
      bloco,
      forca: forcaDe(forca),
      forcaNoDocumento: forca,
      conferePorCodigo: conferePorCodigoDe(confere),
      confereNoDocumento: confere,
      fonte,
    });
  }
  const numeros = regras.map((r) => r.numero);
  if (new Set(numeros).size !== numeros.length) throw new Error("regra repetida na seção 11");
  for (const grupo of ["COPY", "ROTEIRO", "CONF"] as const) {
    const quantas = regras.filter((r) => r.grupo === grupo).length;
    if (quantas !== TOTAL_ESPERADO[grupo]) {
      throw new Error(`R-${grupo}: esperava ${TOTAL_ESPERADO[grupo]} regras, achou ${quantas}`);
    }
  }
  return regras;
}

/** O conteúdo do arquivo gerado: cabeçalho, o tipo e a lista em JSON (uma regra por bloco, estável para o diff). */
export function montarArquivoGerado(regras: RegraCopyRoteiro[]): string {
  const cabecalho = [
    "/**",
    " * GERADO por `npm run gerar:regras-copy-roteiro` a partir da seção 11 de",
    " * `estrategia/briefing-e-rubricas.md`. NÃO editar à mão: troque o documento e gere de novo",
    " * (o teste `regras-copy-roteiro.test.ts` reprova se os dois divergirem).",
    " *",
    " * E50 parte 2 (20/10/2026): as 53 regras de copy (R-COPY, 25), de estrutura de roteiro (R-ROTEIRO, 19)",
    " * e de conformidade (R-CONF, 9). `texto` é o que o prompt recebe; `porQue` é a frase para a pessoa,",
    " * que a tela mostrará por código (PR 3), nunca escrita pelo modelo.",
    " */",
    "",
    `export const versao = "${VERSAO_DAS_REGRAS}";`,
    "",
    'export type RegraCopyRoteiro = {',
    "  numero: string;",
    '  grupo: "COPY" | "ROTEIRO" | "CONF";',
    "  /** A coluna \"O que diz (como o prompt recebe)\". */",
    "  texto: string;",
    '  /** A coluna "Por quê (para a pessoa)". */',
    "  porQue: string;",
    "  /** A coluna \"Bloco\", como está no documento (\"gancho, corpo\", \"todos\"...). */",
    "  bloco: string;",
    '  forca: "forte" | "media" | "indicio";',
    "  forcaNoDocumento: string;",
    '  conferePorCodigo: "sim" | "so_avisa" | "parcial" | "nao";',
    "  confereNoDocumento: string;",
    "  /** A coluna \"Fonte\"; a prova no banco (coluna seguinte) fica só no documento, é número interno. */",
    "  fonte: string;",
    "};",
    "",
    "export const REGRAS_COPY_ROTEIRO: RegraCopyRoteiro[] = [",
  ];
  const corpo = regras.map((r) => "  " + JSON.stringify(r, null, 2).split(QUEBRA).join(QUEBRA + "  ") + ",");
  return [...cabecalho, ...corpo, "];", ""].join(QUEBRA);
}
