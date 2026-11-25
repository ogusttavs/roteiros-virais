/**
 * E65 PR 1: as regras do carrossel que o código confere depois da IA (o prompt só pede). Funções puras, sem banco nem IA, para o teste unitário provar cada uma.
 * Cada motivo é uma frase que a segunda tentativa recebe para corrigir.
 */
import {
  HASHTAGS,
  LIMITE_DA_LEGENDA_PALAVRAS,
  LIMITE_DE_PALAVRAS,
  MAXIMO_DE_SLIDES_SEGUIDOS_DO_MESMO_TIPO,
  type SlideDoCarrossel,
  type TipoDeSlide,
} from "@/config/carrossel";

export function contarPalavras(texto: string): number {
  return texto.trim() === "" ? 0 : texto.trim().split(/\s+/).length;
}

/** Corta um texto nas primeiras `limite` palavras (o render usa quando o texto passaria do limite do tipo). */
export function cortarPalavras(texto: string, limite: number): string {
  const palavras = texto.trim().split(/\s+/);
  return palavras.length <= limite ? texto.trim() : palavras.slice(0, limite).join(" ");
}

const TEM_ANO = /(?:^|\D)(?:19|20)\d{2}(?:\D|$)/;

export type SlideDaIA = { tipo: TipoDeSlide; titulo: string; corpo: string; fonte: string | null };

/** A ordem e a forma da lista: quantidade, capa primeiro, chamada por último, nunca três do mesmo tipo seguidos. */
export function verificarOrdemDosSlides(slides: SlideDaIA[], quantidade: number): string[] {
  const motivos: string[] = [];
  if (slides.length !== quantidade) motivos.push(`carrossel: ${slides.length} slides, o pedido era de exatamente ${quantidade}`);
  if (slides.length > 0 && slides[0].tipo !== "capa") motivos.push('carrossel: o primeiro slide precisa ser do tipo "capa"');
  if (slides.length > 0 && slides[slides.length - 1].tipo !== "chamada") motivos.push('carrossel: o último slide precisa ser do tipo "chamada"');
  slides.forEach((s, i) => {
    if (i > 0 && s.tipo === "capa") motivos.push(`slide ${i + 1}: o tipo "capa" só pode ser o primeiro`);
    if (i < slides.length - 1 && s.tipo === "chamada") motivos.push(`slide ${i + 1}: o tipo "chamada" só pode ser o último`);
  });
  let seguidos = 1;
  for (let i = 1; i < slides.length; i += 1) {
    seguidos = slides[i].tipo === slides[i - 1].tipo ? seguidos + 1 : 1;
    if (seguidos > MAXIMO_DE_SLIDES_SEGUIDOS_DO_MESMO_TIPO) {
      motivos.push(`slides ${i - seguidos + 2} a ${i + 1}: ${seguidos} slides seguidos do tipo "${slides[i].tipo}", misture os tipos`);
      break;
    }
  }
  return motivos;
}

/** O limite de palavras de cada tipo, a fonte do `dado` e o título que não pode ficar vazio. */
export function verificarLimitesDosSlides(slides: SlideDaIA[], opcoes: { ramoSaude: boolean }): string[] {
  const motivos: string[] = [];
  slides.forEach((s, i) => {
    const n = i + 1;
    const limite = LIMITE_DE_PALAVRAS[s.tipo];
    if (!limite) return;
    if (contarPalavras(s.titulo) === 0) motivos.push(`slide ${n}: sem título`);
    if (contarPalavras(s.titulo) > limite.titulo) motivos.push(`slide ${n} (${s.tipo}): título com ${contarPalavras(s.titulo)} palavras, o limite é ${limite.titulo}`);
    if (contarPalavras(s.corpo) > limite.corpo) motivos.push(`slide ${n} (${s.tipo}): texto com ${contarPalavras(s.corpo)} palavras, o limite é ${limite.corpo}`);
    if (s.tipo !== "capa" && s.tipo !== "chamada" && contarPalavras(s.corpo) === 0) motivos.push(`slide ${n} (${s.tipo}): sem texto`);
    if (s.tipo === "dado") {
      if (!s.fonte || !s.fonte.trim()) motivos.push(`slide ${n} (dado): sem a fonte`);
      else if (!TEM_ANO.test(s.fonte)) motivos.push(`slide ${n} (dado): a fonte precisa ter o ano ("Nome da fonte, 2026")`);
      if (!/\d/.test(`${s.titulo} ${s.corpo}`)) motivos.push(`slide ${n} (dado): um dado tem número, e este não tem`);
    } else if (s.fonte && s.fonte.trim()) {
      motivos.push(`slide ${n} (${s.tipo}): só o tipo "dado" leva fonte`);
    }
    if (s.tipo === "antes_depois" && opcoes.ramoSaude) motivos.push(`slide ${n}: antes e depois não vale num ramo de saúde`);
  });
  return motivos;
}

/** A legenda e as hashtags. */
export function verificarLegenda(legenda: string, hashtags: string[]): string[] {
  const motivos: string[] = [];
  const palavras = contarPalavras(legenda);
  if (palavras === 0) motivos.push("legenda: vazia");
  if (palavras > LIMITE_DA_LEGENDA_PALAVRAS) motivos.push(`legenda: ${palavras} palavras, o limite é ${LIMITE_DA_LEGENDA_PALAVRAS}`);
  const limpas = normalizarHashtags(hashtags);
  if (limpas.length < HASHTAGS.min || limpas.length > HASHTAGS.max) motivos.push(`hashtags: ${limpas.length}, o pedido é de ${HASHTAGS.min} a ${HASHTAGS.max}`);
  return motivos;
}

/** Põe o # na frente, tira espaço e repetição. */
export function normalizarHashtags(hashtags: string[]): string[] {
  const vistas = new Set<string>();
  const saida: string[] = [];
  for (const h of hashtags) {
    const miolo = h.trim().replace(/^#+/, "").replace(/\s+/g, "");
    if (!miolo || vistas.has(miolo.toLowerCase())) continue;
    vistas.add(miolo.toLowerCase());
    saida.push(`#${miolo}`);
  }
  return saida;
}

/** O que o render faz com um texto que passaria do limite do tipo: corta e diz o que cortou. */
export function ajustarAosLimites(slide: SlideDoCarrossel): { slide: SlideDoCarrossel; cortou: string[] } {
  const limite = LIMITE_DE_PALAVRAS[slide.tipo];
  const cortou: string[] = [];
  let { titulo, corpo } = slide;
  if (contarPalavras(titulo) > limite.titulo) {
    cortou.push(`título de "${slide.tipo}" cortado em ${limite.titulo} palavras`);
    titulo = cortarPalavras(titulo, limite.titulo);
  }
  if (contarPalavras(corpo) > limite.corpo) {
    cortou.push(`texto de "${slide.tipo}" cortado em ${limite.corpo} palavras`);
    corpo = cortarPalavras(corpo, limite.corpo);
  }
  return { slide: { ...slide, titulo, corpo }, cortou };
}
