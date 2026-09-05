import { config } from "@/lib/config";

/**
 * Lembrete diário do tema pronto (etapa 12, decisão 5 do `PROXIMO.md`). Sem
 * "de hoje" (ajuste da revisão da etapa 13, parte 2): o lembrete usa a
 * mesma regra de estabilidade de `/hoje`, então o tema mostrado pode ser de
 * ontem, e o texto não pode prometer algo que não é sempre verdade.
 */
export const textosEmail = {
  assuntoLembrete: "O seu tema está pronto para gravar",
  corpoLembrete: () =>
    `<p>O seu tema está pronto para gravar.</p><p><a href="${config.appUrl}/hoje">abrir o painel</a></p>`,
};
