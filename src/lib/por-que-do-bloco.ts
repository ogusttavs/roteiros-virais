/**
 * E50 parte 2, PR 3: o "por quê" de cada bloco do roteiro. O modelo só devolve NÚMEROS de regra (e o
 * id de um vídeo da evidência, e um "para quê" de uma lista fechada); o texto que a pessoa lê sai
 * da coluna "Por quê (para a pessoa)" da tabela da seção 11 (`prompts/regras-copy-roteiro.ts`),
 * por código, nunca escrito pelo modelo. Tudo aqui é função pura.
 *
 * Chaves de bloco (a pessoa nunca as vê):
 * - Reels falado: `gancho`, `corpo`, `fechamento`, `chamada`, `tela:N` (a N-ésima frase na tela, de 0).
 * - Story e sem fala: `cartao:N` (o N-ésimo cartão, de 0); o primeiro vale como gancho e o último como chamada.
 * - Roteiro longo: `gancho`, `capitulo:N` (de 0), `chamada`, `tela:N`.
 */
import { REGRAS_COPY_ROTEIRO, type RegraCopyRoteiro } from "@/ia/prompts/regras-copy-roteiro";
import { regrasQueEntramNoPrompt } from "@/ia/prompts/regras-copy-roteiro-uso";

export const PARA_QUE = ["fiquem", "confiem", "guardem", "chamem"] as const;
export type ParaQue = (typeof PARA_QUE)[number];

/** O texto do "Para" (a lista é fixa, o modelo só escolhe uma): que fiquem, confiem, guardem, chamem. */
export const TEXTO_DO_PARA: Record<ParaQue, string> = {
  fiquem: "Para a pessoa ficar até o fim.",
  confiem: "Para a pessoa confiar em você.",
  guardem: "Para a pessoa guardar e usar depois.",
  chamem: "Para a pessoa te chamar.",
};

/** O que o modelo devolve por bloco (o schema do prompt). */
export type PorQueBruto = { bloco: string; regras: string[]; videoId: number | null; para: ParaQue | null };

/** O que o roteiro guarda em `conteudo`: códigos, não texto (o texto vem da tabela na hora de mostrar). */
export type PorQueDoBloco = {
  bloco: string;
  regras: string[];
  video?: { videoId: number; segundo: number };
  para?: ParaQue;
};

export type EscopoDasRegras = "curto" | "longo";

/** Os números que o modelo pode citar: as que o prompt mostra. O roteiro longo recebe só as de conformidade e de texto, não as de estrutura do vídeo curto. */
export function numerosCitaveis(escopo: EscopoDasRegras): Set<string> {
  return new Set(
    regrasQueEntramNoPrompt()
      .filter((r) => escopo === "curto" || r.grupo !== "ROTEIRO")
      .map((r) => r.numero),
  );
}

export type FormaDoRoteiro =
  | { tipo: "reels"; telas: number }
  | { tipo: "cartoes"; cartoes: number }
  | { tipo: "longo"; capitulos: number; telas: number };

/** As chaves de bloco que existem neste roteiro. */
export function chavesDeBlocos(forma: FormaDoRoteiro): Set<string> {
  const chaves = new Set<string>();
  const sequencia = (prefixo: string, n: number) => {
    for (let i = 0; i < n; i++) chaves.add(`${prefixo}:${i}`);
  };
  if (forma.tipo === "reels") {
    for (const c of ["gancho", "corpo", "fechamento", "chamada"]) chaves.add(c);
    sequencia("tela", forma.telas);
  } else if (forma.tipo === "cartoes") {
    sequencia("cartao", forma.cartoes);
  } else {
    chaves.add("gancho");
    chaves.add("chamada");
    sequencia("capitulo", forma.capitulos);
    sequencia("tela", forma.telas);
  }
  return chaves;
}

/** Em que blocos da coluna "Bloco" da tabela cai uma chave (o primeiro cartão vale como gancho, o último como chamada, os do meio como corpo). */
function categoriasDaChave(chave: string, totalDeCartoes: number): string[] {
  const [tipo, n] = chave.split(":");
  if (tipo === "gancho" || tipo === "corpo" || tipo === "fechamento") return [tipo];
  if (tipo === "chamada") return ["chamada"];
  if (tipo === "tela") return ["frases na tela"];
  if (tipo === "capitulo") return ["corpo"];
  if (tipo === "cartao") {
    const i = Number(n);
    const cats = ["corpo"];
    if (i === 0) cats.push("gancho");
    if (i === totalDeCartoes - 1) cats.push("chamada", "fechamento");
    return cats;
  }
  return [];
}

/** A regra vale para o bloco? "todos" vale para qualquer um; senão, a coluna "Bloco" da tabela tem de citar a categoria do bloco. */
export function regraValeParaOBloco(regra: RegraCopyRoteiro, chave: string, totalDeCartoes: number): boolean {
  const coluna = regra.bloco.trim().toLowerCase();
  if (coluna === "todos") return true;
  return categoriasDaChave(chave, totalDeCartoes).some((c) => coluna.includes(c));
}

export const MAXIMO_DE_REGRAS_POR_BLOCO = 3;

export type ContextoDaLimpeza = {
  forma: FormaDoRoteiro;
  escopo: EscopoDasRegras;
  /** O segundo de cada vídeo da evidência que o roteiro pode citar (id → segundo do momento-chave, ou 0). O modelo nunca escolhe o segundo. */
  segundoDosVideos: Map<number, number>;
};

/**
 * Da resposta do modelo para o que se guarda: bloco que não existe, número que o prompt não mostrou,
 * regra que não vale para aquele bloco, vídeo fora da evidência e "para" fora da lista são
 * descartados (nunca derrubam a geração); um bloco repetido fica com a primeira entrada; um bloco
 * sem regra nem vídeo válidos não entra.
 */
export function limparPorQueDosBlocos(brutos: PorQueBruto[], contexto: ContextoDaLimpeza): PorQueDoBloco[] {
  const chaves = chavesDeBlocos(contexto.forma);
  const citaveis = numerosCitaveis(contexto.escopo);
  const porNumero = new Map(REGRAS_COPY_ROTEIRO.map((r) => [r.numero, r]));
  const totalDeCartoes = contexto.forma.tipo === "cartoes" ? contexto.forma.cartoes : 0;
  const vistos = new Set<string>();
  const saida: PorQueDoBloco[] = [];
  for (const bruto of brutos) {
    const bloco = bruto.bloco.trim();
    if (!chaves.has(bloco) || vistos.has(bloco)) continue;
    const regras: string[] = [];
    for (const numero of bruto.regras.map((n) => n.trim())) {
      const regra = porNumero.get(numero);
      if (!regra || !citaveis.has(numero) || regras.includes(numero)) continue;
      if (!regraValeParaOBloco(regra, bloco, totalDeCartoes)) continue;
      regras.push(numero);
      if (regras.length >= MAXIMO_DE_REGRAS_POR_BLOCO) break;
    }
    const segundo = bruto.videoId === null ? undefined : contexto.segundoDosVideos.get(bruto.videoId);
    if (regras.length === 0 && segundo === undefined) continue;
    vistos.add(bloco);
    const item: PorQueDoBloco = { bloco, regras };
    if (bruto.videoId !== null && segundo !== undefined) item.video = { videoId: bruto.videoId, segundo };
    if (bruto.para && (PARA_QUE as readonly string[]).includes(bruto.para)) item.para = bruto.para;
    saida.push(item);
  }
  return saida;
}

const RAIZ_DA_REGRA: Record<RegraCopyRoteiro["grupo"], string> = {
  COPY: "uma regra de escrita para vídeo curto",
  ROTEIRO: "uma regra de como montar o roteiro",
  CONF: "uma regra de publicidade honesta",
};

export type TextosDoPorQue = {
  /** "O que faz": a frase da tabela da primeira regra, mais a das outras separadas por espaço. */
  oQueFaz: string;
  /** "Com base em": o vídeo do banco (com o segundo) ou, sem vídeo, o tipo de regra pelo nome que a pessoa entende (nunca o código). */
  comBaseEm: { tipo: "video"; videoId: number; segundo: number } | { tipo: "regra"; texto: string } | null;
  /** "Para": o texto fixo do `para` escolhido. */
  para: string | null;
};

/** O que a tela mostra de um bloco: tudo vem da tabela e das listas fixas, por código. */
export function textosDoPorQue(item: PorQueDoBloco): TextosDoPorQue {
  const porNumero = new Map(REGRAS_COPY_ROTEIRO.map((r) => [r.numero, r]));
  const regras = item.regras.map((n) => porNumero.get(n)).filter((r): r is RegraCopyRoteiro => Boolean(r));
  const oQueFaz = regras.map((r) => r.porQue).join(" ");
  let comBaseEm: TextosDoPorQue["comBaseEm"] = null;
  if (item.video) comBaseEm = { tipo: "video", videoId: item.video.videoId, segundo: item.video.segundo };
  else if (regras.length > 0) comBaseEm = { tipo: "regra", texto: [...new Set(regras.map((r) => RAIZ_DA_REGRA[r.grupo]))].join("; ") };
  return { oQueFaz, comBaseEm, para: item.para ? TEXTO_DO_PARA[item.para] : null };
}

/** O que a tela precisa para decidir se mostra "Por quê" em um bloco: tem o que dizer (regra ou vídeo)? */
export function temPorQue(item: PorQueDoBloco | undefined): boolean {
  return Boolean(item && (item.regras.length > 0 || item.video));
}
