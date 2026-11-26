/**
 * E68 A2: das palavras do roteiro às cenas do vídeo, sem IA nova (custo zero). O texto vem do roteiro que já passou pelo verificador, na ordem de sempre (gancho, corpo, fechamento, chamada):
 * cada frase vira um bloco curto, frases muito curtas se juntam, frase longa é cortada no limite de palavras, e se ainda passar dos limites do motor (24 cenas, 60 segundos, 140 caracteres por
 * bloco) o miolo perde cenas, nunca o começo (o gancho) nem o fim (a chamada).
 */
import { LIMITES_DA_ANIMACAO } from "@/config/animacao";

import { limparTexto, montarLinhaDoTempo } from "./montador";
import type { CenaDeEntrada } from "./tipos";

/** Frase curta demais para ficar sozinha na tela: junta com a seguinte se couber no bloco. */
const CURTA_DEMAIS = 40;

/** Corta uma frase longa em pedaços de até `max` caracteres, de preferência depois de uma vírgula ou ponto e vírgula, senão no último espaço. */
function cortarFrase(frase: string, max: number): string[] {
  const pedacos: string[] = [];
  let resto = frase;
  while (resto.length > max) {
    const janela = resto.slice(0, max + 1);
    const virgula = Math.max(janela.lastIndexOf(", "), janela.lastIndexOf("; "));
    const espaco = janela.lastIndexOf(" ");
    const corte = virgula >= max * 0.4 ? virgula + 1 : espaco > 0 ? espaco : max;
    pedacos.push(resto.slice(0, corte).trim());
    resto = resto.slice(corte).trim();
  }
  if (resto) pedacos.push(resto);
  return pedacos;
}

function frasesDe(paragrafo: string): string[] {
  const limpo = limparTexto(paragrafo);
  if (!limpo) return [];
  return limpo.split(/(?<=[.!?…])\s+/).filter(Boolean);
}

function duracaoDe(cenas: CenaDeEntrada[]): number | null {
  try {
    return montarLinhaDoTempo(cenas).duracaoS;
  } catch {
    return null;
  }
}

/** As cenas de um roteiro e o texto das cenas que ficaram de fora por passar dos limites (para a tela dizer, nunca em silêncio). */
export type CenasMontadas = { cenas: CenaDeEntrada[]; deFora: string[] };

/** As cenas de um roteiro, a partir dos parágrafos na ordem de leitura. Devolve lista vazia se não há texto. */
export function cenasDosParagrafos(paragrafos: string[]): CenaDeEntrada[] {
  return montarCenasDosParagrafos(paragrafos).cenas;
}

/** O mesmo que `cenasDosParagrafos`, e também o que o miolo perdeu: cada texto tirado, na ordem do roteiro. */
export function montarCenasDosParagrafos(paragrafos: string[]): CenasMontadas {
  const L = LIMITES_DA_ANIMACAO;
  const cenas: string[] = [];
  for (const paragrafo of paragrafos) {
    let atual = "";
    for (const frase of frasesDe(paragrafo)) {
      for (const pedaco of cortarFrase(frase, L.maxCaracteresPorCena)) {
        if (atual && atual.length < CURTA_DEMAIS && atual.length + 1 + pedaco.length <= L.maxCaracteresPorCena) {
          atual = `${atual} ${pedaco}`;
        } else {
          if (atual) cenas.push(atual);
          atual = pedaco;
        }
      }
    }
    if (atual) cenas.push(atual);
  }
  // Cada cena guarda a posição de origem, para listar o que sair na ordem do roteiro.
  const lista = cenas.map((texto, origem) => ({ texto, origem }));
  const tiradas: { texto: string; origem: number }[] = [];
  // Passou dos limites: tira cenas do miolo (o gancho e a chamada ficam), uma por vez, de trás do meio para a frente.
  while (lista.length > 2) {
    const duracao = duracaoDe(lista);
    if (lista.length <= L.maxCenas && duracao !== null) break;
    const [tirada] = lista.splice(Math.max(1, Math.floor(lista.length * 0.6)), 1);
    tiradas.push(tirada);
  }
  return { cenas: lista.map(({ texto }) => ({ texto })), deFora: tiradas.sort((a, b) => a.origem - b.origem).map((t) => t.texto) };
}
