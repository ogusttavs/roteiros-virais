import { config } from "@/lib/config";

import { envolverEmail, linkEmail } from "./casca-email";

/** V5, item 7: a casca (cor, fonte de sistema, logotipo) vem de `casca-email.ts`; o texto abaixo não muda. */
export const textosAuth = {
  assuntoLinkMagico: `Seu link para entrar em ${config.appName}`,
  corpoLinkMagico: (url: string) =>
    envolverEmail(`<p>Toque para entrar, vale por 15 minutos.</p><p>${linkEmail(url, url)}</p>`),
};
