/**
 * E66, a capa de notícia: as regras puras (sem banco nem IA) que o servidor confere nos títulos que a IA propõe e na notícia que vira capa. O veículo e a data saem SEMPRE da notícia, nunca do modelo;
 * só notícia com data conhecida, de até 7 dias (`lib/janela-de-noticias.ts`, a mesma conta da tela de Notícias), vira capa.
 */
import { CAMPOS_DO_TIPO, TITULOS_DA_CAPA } from "@/config/carrossel";
import { noticiaEhCandidata } from "@/lib/janela-de-noticias";

import { contarPalavras, promessaEmSaude } from "./regras";

const FUSO = "America/Sao_Paulo";

/** A data da notícia como vai na capa ("25/11/2026"), no dia de São Paulo. */
export function dataDaCapa(publicadoEm: Date): string {
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: FUSO }).format(publicadoEm);
}

/** O veículo como vai na capa: sem quebra de linha nem `<` `>`, no limite do campo; vazio se a notícia não traz. */
export function veiculoDaCapa(fonte: string | null | undefined): string {
  const limpo = (fonte ?? "").replace(/[<>]/g, " ").replace(/\s+/g, " ").trim();
  return limpo.slice(0, CAMPOS_DO_TIPO.noticia.veiculo?.caracteres ?? 60).trimEnd();
}

export const FRASE_NOTICIA_VELHA = "Só notícia dos últimos 7 dias vira capa. Escolha uma mais nova.";
export const FRASE_NOTICIA_SEM_VEICULO = "Esta notícia não diz de onde veio, então não dá para fazer a capa.";

/** Por que a notícia não serve para capa (frase para a pessoa), ou nulo quando serve: precisa de data conhecida, de até 7 dias, e do nome do veículo. */
export function motivoDeNaoServirParaCapa(noticia: { publicadoEm: Date | null; fonte: string | null }, agora: Date = new Date()): string | null {
  if (!noticiaEhCandidata(noticia.publicadoEm, agora)) return FRASE_NOTICIA_VELHA;
  if (!veiculoDaCapa(noticia.fonte)) return FRASE_NOTICIA_SEM_VEICULO;
  return null;
}

export const noticiaServeParaCapa = (noticia: { publicadoEm: Date | null; fonte: string | null }, agora: Date = new Date()): boolean => motivoDeNaoServirParaCapa(noticia, agora) === null;

const sem = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Os números escritos num texto, só com os dígitos ("1.200" e "1200" são o mesmo; "87%" é "87"). */
export function numerosDoTexto(texto: string): string[] {
  return (texto.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/[.,]/g, ""));
}

/** Os números do título que a notícia não tem (título, resumo e ângulo dela): número inventado nunca vai na capa. */
export function numerosForaDaNoticia(titulo: string, textoDaNoticia: string): string[] {
  const dela = new Set(numerosDoTexto(textoDaNoticia));
  return numerosDoTexto(titulo).filter((n) => !dela.has(n));
}

/** O título como a capa o guarda: espaços únicos, sem ponto final nem aspas soltas. */
export function limparTituloDaCapa(titulo: string): string {
  return titulo.replace(/\s+/g, " ").trim().replace(/[.\s]+$/, "").trim();
}

/** Cabe no campo `titulo` do tipo `noticia`? Devolve o motivo (frase para a pessoa) ou nulo. */
export function motivoDoTitulo(titulo: string): string | null {
  const limite = CAMPOS_DO_TIPO.noticia.titulo!;
  const limpo = limparTituloDaCapa(titulo);
  if (!limpo) return "O título não pode ficar vazio.";
  if (contarPalavras(limpo) > limite.palavras) return `O título passa de ${limite.palavras} palavras.`;
  if (limpo.length > limite.caracteres) return `O título passa de ${limite.caracteres} caracteres.`;
  return null;
}

/**
 * O que o servidor confere nos títulos que a IA devolveu: a quantidade (de 3 a 5), o limite de cada um, nenhum igual à manchete (a manchete é do veículo), nenhum repetido, nenhum número fora da notícia
 * e, em ramo de saúde, nenhuma promessa de resultado. Cada motivo é uma frase que a segunda tentativa recebe para corrigir.
 */
export function verificarTitulosDaCapa(titulos: string[], noticia: { titulo: string; resumo: string | null; angulo: string | null }, opcoes: { ramoSaude: boolean }): string[] {
  const motivos: string[] = [];
  if (titulos.length < TITULOS_DA_CAPA.min || titulos.length > TITULOS_DA_CAPA.max) motivos.push(`capa: ${titulos.length} títulos, o pedido é de ${TITULOS_DA_CAPA.min} a ${TITULOS_DA_CAPA.max}`);
  const textoDaNoticia = [noticia.titulo, noticia.resumo, noticia.angulo].filter(Boolean).join(" ");
  const vistos = new Set<string>();
  titulos.forEach((bruto, i) => {
    const titulo = limparTituloDaCapa(bruto);
    const motivo = motivoDoTitulo(titulo);
    if (motivo) motivos.push(`título ${i + 1}: ${motivo}`);
    if (sem(titulo) === sem(noticia.titulo)) motivos.push(`título ${i + 1}: é igual à manchete do veículo, escreva o seu`);
    if (vistos.has(sem(titulo))) motivos.push(`título ${i + 1}: repete outro título`);
    vistos.add(sem(titulo));
    const soltos = numerosForaDaNoticia(titulo, textoDaNoticia);
    if (soltos.length > 0) motivos.push(`título ${i + 1}: o número ${soltos.join(", ")} não está na notícia`);
    if (opcoes.ramoSaude) {
      const promessa = promessaEmSaude(titulo);
      if (promessa) motivos.push(`título ${i + 1}: promessa de resultado em saúde ("${promessa}")`);
    }
  });
  return motivos;
}

/** Os títulos prontos para a tela: limpos e sem repetir. */
export function titulosParaATela(titulos: string[]): string[] {
  const vistos = new Set<string>();
  return titulos.map(limparTituloDaCapa).filter((t) => {
    const chave = sem(t);
    if (!t || vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  });
}
