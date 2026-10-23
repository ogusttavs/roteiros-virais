/**
 * E59 (22/10/2026, ideia do Gustavo): o "como editar" do roteiro pode pedir uma prova visual com imagem de outro (tela dividida, foto ou print com a fonte na
 * tela, trecho curto de vídeo público de uma pessoa conhecida) quando o tema ganha com isso. Aqui só mora o critério de QUANDO sugerir, em código puro;
 * o texto que o prompt recebe fica em `ia/prompts/roteiro.ts` (`blocoDaProvaVisualDeOutro`) e os limites em `ia/verificar-copy-roteiro.ts` (`R-CONF-10`).
 *
 * Quando sugerir (regra `R-ROTEIRO-20`): a análise visual do banco mostra o recurso nos vídeos que performaram no ramo, OU o tema cita uma pessoa pública, uma
 * fala pública ou uma notícia. Só no Reels falado: sem fala não há quem comente (e tela dividida sem comentário é o que a plataforma tira do alcance), o
 * Story tem regras próprias, o momento é a cena que a pessoa está vendo e o longo tem outro esquema. A sugestão é sempre aberta e pelo papel, nunca pelo nome.
 */
import type { AnaliseVisual, EstiloRoteiro, FormatoRoteiro } from "@/db/schema";

export type MotivoProvaVisual = "banco" | "pessoa_publica" | "fala_publica" | "noticia";

function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** O recurso de imagem de OUTRO na análise visual (não a foto do próprio produto nem o "antes e depois" do próprio trabalho). */
const RECURSO_DE_IMAGEM_DE_OUTRO =
  /(tela dividida|split[ -]?screen|reacao|reagindo|reagiu|react(ion)?\b|stitch|dueto|duet\b|trechos? (curtos? )?(de|do|da) (video|entrevista|noticia|reportagem|discurso)|recortes? d[aeo]s? (noticia|reportagem|video|entrevista|post)|prints? d[aeo]s? (noticia|reportagem|post|tweet|comentario|materia)|manchetes?|fotos? d[aeo]s? (famos|celebr|politic|artista|jogador|deputad|candidat)|imagens? d[aeo]s? (noticia|reportagem|outra|terceir|famos)|video de outra pessoa)/;

/** Pessoa pública pelo papel ou pelo cargo; nenhum nome próprio na lista (o produto não nomeia ninguém). */
const PESSOA_PUBLICA_NO_TEMA =
  /(^|[^a-z])(deputad[oa]s?|senador(a|es)?|vereador(a|es)?|prefeit[oa]s?|governador(a|es)?|candidat[oa]s?|politic[oa]s?|eleic(ao|oes)|eleitor(es|al|ais)?|voto|votos|urna|celebridades?|famos[oa]s?|influenciador(a|es)?|youtuber|artistas?|cantor(a|es)?|jogador(a|es)?|atriz(es)?|atores|personalidades?|figuras? publicas?|autoridades?|ministr[oa]s?|stf|congresso)([^a-z]|$)/;
const FALA_PUBLICA_NO_TEMA = /(declarou|declaracao|declaracoes|discurso|entrevista|polemica|(disse|falou|afirmou) que|pronunciamento)/;
const NOTICIA_NO_TEMA = /(noticia|manchete|reportagem|saiu na|viralizou|lei nova|nova lei|decreto|julgamento|projeto de lei|anunciou|divulgou)/;

export type DadosDaProvaVisual = {
  formato: FormatoRoteiro;
  estilo: EstiloRoteiro;
  /** O roteiro nasce de um momento descrito pela pessoa: a cena é a única fonte, sem prova de outro. */
  ehMomento: boolean;
  tema: string;
  objetivoDoVideo?: string;
  /** O tema nasceu de "Criar vídeo com esta notícia" (E43). */
  temNoticia: boolean;
  /** Entram notícias de hoje dos assuntos que a marca acompanha e que o tema toca (E53). */
  temNoticiasDoAssunto: boolean;
  /** A análise visual dos vídeos de evidência (pode vir nula; só os dez melhores da semana têm). */
  analisesVisuais: (Pick<AnaliseVisual, "recursos" | "cenario" | "textoNaTela" | "momentoChave"> | null | undefined)[];
};

function textoDaAnalise(a: NonNullable<DadosDaProvaVisual["analisesVisuais"][number]>): string {
  return [...a.recursos, a.cenario, ...a.textoNaTela.map((t) => t.oQue), a.momentoChave?.oQue ?? ""].join(" . ");
}

/** Os motivos pelos quais a entrada liga a prova visual; lista vazia quer dizer "não sugira". */
export function motivosDaProvaVisualDeOutro(d: DadosDaProvaVisual): MotivoProvaVisual[] {
  if (d.formato !== "reels" || d.estilo !== "falado" || d.ehMomento) return [];
  const motivos: MotivoProvaVisual[] = [];
  const noBanco = d.analisesVisuais.some((a) => a != null && RECURSO_DE_IMAGEM_DE_OUTRO.test(normalizar(textoDaAnalise(a))));
  if (noBanco) motivos.push("banco");
  const tema = normalizar(`${d.tema} . ${d.objetivoDoVideo ?? ""}`);
  if (PESSOA_PUBLICA_NO_TEMA.test(tema)) motivos.push("pessoa_publica");
  if (FALA_PUBLICA_NO_TEMA.test(tema)) motivos.push("fala_publica");
  if (d.temNoticia || d.temNoticiasDoAssunto || NOTICIA_NO_TEMA.test(tema)) motivos.push("noticia");
  return motivos;
}

const FRASE_DO_MOTIVO: Record<MotivoProvaVisual, string> = {
  banco: "os vídeos que mais subiram neste ramo usam tela dividida, foto, print ou trecho de outro vídeo como prova",
  pessoa_publica: "o tema cita uma pessoa pública",
  fala_publica: "o tema comenta uma fala pública",
  noticia: "o tema vem de uma notícia",
};

/** Os motivos por extenso, para a entrada ("o tema cita uma pessoa pública e vem de uma notícia"). */
export function frasesDosMotivos(motivos: MotivoProvaVisual[]): string {
  const frases = motivos.map((m) => FRASE_DO_MOTIVO[m]);
  if (frases.length <= 1) return frases[0] ?? "";
  return `${frases.slice(0, -1).join("; ")}; e ${frases[frases.length - 1]}`;
}
