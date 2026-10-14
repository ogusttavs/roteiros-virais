/** E52 (PR 4c): a pílula "Duração" das Referências. "curtos" é a lista de sempre (até 3 minutos); "longos" é a dos vídeos longos do ramo (só YouTube), na URL como `duracao=longos`. */
export type DuracaoReferencias = "curtos" | "longos";

export function duracaoDaUrl(valor: string | undefined): DuracaoReferencias {
  return valor === "longos" ? "longos" : "curtos";
}
