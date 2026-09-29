import { horaMinutoAtualISO } from "@/lib/config";
import type { ResultadoTemasHoje } from "@/servicos/temas";
import { textosHoje } from "@/textos/hoje";

import type { AvisoSemTema } from "./HojeTela";

/** "06:30", o horário em que os temas do dia deviam ter saído (job `temas-do-dia`, de madrugada). */
const HORA_TEMAS_PRONTOS = "06:30";

/**
 * H3, item 1: o Hoje é sempre o Hoje das portas, mesmo sem tema ou com a busca de hoje falhando; o
 * que muda é só este aviso, mostrado na porta Reels no lugar dos três temas. Sem tema, o texto
 * depende da hora (`HORA_TEMAS_PRONTOS`, fuso do Brasil): antes, "os temas saem até as 6h30" (ainda
 * pode ser só cedo demais); depois, o tema de hoje já devia ter saído e não saiu.
 *
 * Fora de `page.tsx` de propósito: um arquivo de rota do App Router só pode exportar as poucas
 * chaves especiais do Next (`default`, `metadata`, etc.); qualquer export a mais reprova o build
 * (achado desta rodada, `next build`, "Type 'avisoSemTema' is incompatible with index signature").
 */
export function avisoSemTema(resultado: ResultadoTemasHoje | { status: "erro" }, agora: Date): AvisoSemTema | null {
  if (resultado.status === "ok") return null;
  if (resultado.status === "erro") {
    return { titulo: textosHoje.erroTitulo, texto: textosHoje.erro };
  }
  return horaMinutoAtualISO(agora) >= HORA_TEMAS_PRONTOS
    ? { titulo: textosHoje.semTemaDepoisTitulo, texto: textosHoje.semTemaDepois }
    : { titulo: textosHoje.vazioTitulo, texto: textosHoje.vazio };
}
