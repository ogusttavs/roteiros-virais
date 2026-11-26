/**
 * E76 PR 3 (avaliação externa do cadastro da Skyline, 26/11/2026): a estratégia de idioma da marca que fala com mais de um país. Este arquivo é
 * puro (sem banco), para servir à tela do Começar ("use client"), ao servidor que grava (`servicos/clientes.ts`) e a quem monta o prompt.
 *
 * Contraponto do plano: a maioria das marcas é de um país só. Por isso o campo só existe com `alcance = "mais_de_um_pais"`, e
 * `estrategiaDaMarca` devolve nulo em qualquer outro caso, mesmo que a coluna tenha sobrado preenchida: marca de um país só nunca recebe
 * instrução de idioma no prompt.
 */
import { z } from "zod";

import type { Alcance, EstrategiaIdioma, IdiomaDoConteudo, ModoDeIdioma } from "@/db/schema";

export const IDIOMAS_DO_CONTEUDO = ["portugues", "ingles", "espanhol"] as const satisfies readonly IdiomaDoConteudo[];
export const MODOS_DE_IDIOMA = ["so_portugues", "so_ingles", "linha_no_outro", "metade", "outro"] as const satisfies readonly ModoDeIdioma[];

/** "Outro jeito" é uma frase curta, não um parágrafo: o que passar disto é cortado na tela e recusado no servidor. */
export const TAMANHO_MAXIMO_DO_COMO_OUTRO = 120;

/** O nome do idioma como entra no prompt e na tela ("em português", "em inglês"). */
export const NOME_DO_IDIOMA: Record<IdiomaDoConteudo, string> = {
  portugues: "português",
  ingles: "inglês",
  espanhol: "espanhol",
};

/** Os modos que pedem o segundo idioma escolhido (e diferente do principal). */
export function modoPedeSegundoIdioma(modo: ModoDeIdioma): boolean {
  return modo === "linha_no_outro" || modo === "metade";
}

/** Os modos em que a pessoa escolhe o idioma principal; nos de um idioma só, ele é o próprio. */
export function modoPedePrincipal(modo: ModoDeIdioma): boolean {
  return modo === "linha_no_outro" || modo === "metade" || modo === "outro";
}

/**
 * O que a tela manda e o servidor aceita. Os modos de um idioma só fixam o principal; os outros exigem o principal, e a mistura exige o
 * segundo idioma diferente dele; "outro" exige a frase. O que não vale para o modo é ignorado aqui e zerado por `normalizarEstrategiaIdioma`.
 */
export const estrategiaIdiomaSchema = z
  .object({
    modo: z.enum(MODOS_DE_IDIOMA),
    principal: z.enum(IDIOMAS_DO_CONTEUDO).nullish(),
    segundo: z.enum(IDIOMAS_DO_CONTEUDO).nullish(),
    comoOutro: z.string().trim().max(TAMANHO_MAXIMO_DO_COMO_OUTRO).nullish(),
  })
  .refine((dados) => !modoPedePrincipal(dados.modo) || Boolean(dados.principal), {
    message: "escolha o idioma principal",
    path: ["principal"],
  })
  .refine((dados) => !modoPedeSegundoIdioma(dados.modo) || (Boolean(dados.segundo) && dados.segundo !== dados.principal), {
    message: "escolha o outro idioma, diferente do principal",
    path: ["segundo"],
  })
  .refine((dados) => dados.modo !== "outro" || Boolean(dados.comoOutro?.trim()), {
    message: "diga em poucas palavras como você mistura os idiomas",
    path: ["comoOutro"],
  });

export type EstrategiaIdiomaBruta = z.input<typeof estrategiaIdiomaSchema>;

/** A forma guardada: só os campos que o modo usa, o resto nulo. Recebe o que já passou por `estrategiaIdiomaSchema`. */
export function normalizarEstrategiaIdioma(dados: z.output<typeof estrategiaIdiomaSchema>): EstrategiaIdioma {
  if (dados.modo === "so_portugues") return { modo: "so_portugues", principal: "portugues", segundo: null, comoOutro: null };
  if (dados.modo === "so_ingles") return { modo: "so_ingles", principal: "ingles", segundo: null, comoOutro: null };
  const principal = dados.principal ?? "portugues";
  if (dados.modo === "outro") {
    return { modo: "outro", principal, segundo: null, comoOutro: dados.comoOutro?.trim() || null };
  }
  return { modo: dados.modo, principal, segundo: dados.segundo ?? null, comoOutro: null };
}

/** O que a tela do Começar tem em mãos: cada campo pode estar vazio ainda. */
export type EscolhaDeIdiomaNaTela = {
  modo: ModoDeIdioma | "";
  principal: IdiomaDoConteudo | "";
  segundo: IdiomaDoConteudo | "";
  comoOutro: string;
};

/**
 * O que falta para a escolha da tela estar completa, na ordem em que a pessoa responde, ou nulo quando está. A tela mostra a frase do que
 * falta; as regras são as mesmas de `estrategiaIdiomaSchema` (o teste confere as duas juntas).
 */
export function faltaNaEstrategia(escolha: EscolhaDeIdiomaNaTela): "modo" | "principal" | "segundo" | "comoOutro" | null {
  if (!escolha.modo) return "modo";
  if (modoPedePrincipal(escolha.modo) && !escolha.principal) return "principal";
  if (modoPedeSegundoIdioma(escolha.modo) && (!escolha.segundo || escolha.segundo === escolha.principal)) return "segundo";
  if (escolha.modo === "outro" && !escolha.comoOutro.trim()) return "comoOutro";
  return null;
}

/** O que a tela manda ao servidor: só os campos que o modo usa. Chamada só com a escolha completa (`faltaNaEstrategia` nulo). */
export function estrategiaDoFormulario(escolha: EscolhaDeIdiomaNaTela): EstrategiaIdiomaBruta | undefined {
  if (!escolha.modo) return undefined;
  return {
    modo: escolha.modo,
    principal: modoPedePrincipal(escolha.modo) && escolha.principal ? escolha.principal : null,
    segundo: modoPedeSegundoIdioma(escolha.modo) && escolha.segundo ? escolha.segundo : null,
    comoOutro: escolha.modo === "outro" ? escolha.comoOutro.trim().slice(0, TAMANHO_MAXIMO_DO_COMO_OUTRO) : null,
  };
}

/**
 * A estratégia que vale para esta marca agora: só com `alcance = "mais_de_um_pais"` e uma estratégia guardada que ainda passa na validação.
 * Qualquer outro caso devolve nulo, e nulo quer dizer "nada muda": o prompt sai igual ao de antes do campo existir.
 */
export function estrategiaDaMarca(cliente: { alcance: Alcance | null; estrategiaIdioma?: EstrategiaIdioma | null }): EstrategiaIdioma | null {
  if (cliente.alcance !== "mais_de_um_pais" || !cliente.estrategiaIdioma) return null;
  const lida = estrategiaIdiomaSchema.safeParse(cliente.estrategiaIdioma);
  return lida.success ? normalizarEstrategiaIdioma(lida.data) : null;
}

/**
 * Verdadeiro quando a estratégia põe texto fora do português no que a IA escreve. É o que liga a instrução de idioma no prompt e desliga, no
 * verificador, a reprovação de "texto longo sem nenhum acento" (um parágrafo em inglês não tem acento e não é erro). "Só português" não muda
 * nada: o prompt e o verificador ficam como eram.
 */
export function estrategiaTemOutroIdioma(estrategia: EstrategiaIdioma | null | undefined): estrategia is EstrategiaIdioma {
  if (!estrategia) return false;
  if (estrategia.modo === "so_portugues") return false;
  return true;
}
