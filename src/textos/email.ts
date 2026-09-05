import { config } from "@/lib/config";

/** Lembrete diário do tema pronto (etapa 12, decisão 5 do `PROXIMO.md`). */
export const textosEmail = {
  assuntoLembrete: "Seu tema de hoje está pronto",
  corpoLembrete: () =>
    `<p>Seu tema de hoje está pronto.</p><p><a href="${config.appUrl}/hoje">abrir o painel</a></p>`,
};
