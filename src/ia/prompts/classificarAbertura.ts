import { z } from "zod";

import { TIPOS_ABERTURA, type AnaliseVideo } from "@/db/schema";

import type { EsforcoIA, NivelIA } from "../tipos";

import { definicoesTipoAbertura } from "./definicoesTipoAbertura";

/**
 * Backfill do tipo de abertura (V4, roteiro sem vício, escopo 5.12, item 2):
 * classifica o gancho e o formato de vídeo já extraído, sem ler a
 * transcrição de novo (`scripts/preencher-tipo-abertura.ts`, na API de lote,
 * modelo barato). Mesmo enum e mesmas definições de `extrairVideo.ts`
 * (`definicoesTipoAbertura.ts`), tarefa separada porque a entrada aqui é só
 * o gancho e o formato, nunca a transcrição inteira.
 */
export const versao = "1.0.0";
export const nivel: NivelIA = "barato";
export const esforco: EsforcoIA | undefined = undefined;

export const schema = z.object({ tipoAbertura: z.enum(TIPOS_ABERTURA) });

export type SaidaClassificarAbertura = z.infer<typeof schema>;

export function montarSistemaEstavel(): string {
  return `Você classifica só o tipo de abertura de um vídeo curto, a partir do gancho (a frase
ou cena dos primeiros segundos, já extraída) e do formato. Não invente nada além do tipo, um
destes oito:

${definicoesTipoAbertura()}`;
}

export function montarEntrada(dados: { gancho: string; formato: AnaliseVideo["formato"] }): string {
  return `Gancho: ${dados.gancho}\n\nFormato: ${dados.formato}`;
}
