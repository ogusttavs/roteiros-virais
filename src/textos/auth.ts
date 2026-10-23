import { config } from "@/lib/config";

import { envolverEmail, linkEmail } from "./casca-email";

/** V5, item 7: a casca (cor, fonte de sistema, logotipo) vem de `casca-email.ts`; o texto abaixo não muda. */
export const textosAuth = {
  assuntoLinkMagico: `Seu link para entrar em ${config.appName}`,
  corpoLinkMagico: (url: string) =>
    envolverEmail(`<p>Toque para entrar, vale por 15 minutos.</p><p>${linkEmail(url, url)}</p>`),
  /** E58, "esqueci a senha": o link vale 30 minutos e só uma vez; sem conta, nada chega (a tela responde igual nos dois casos). */
  assuntoRedefinirSenha: `Escolha uma senha nova em ${config.appName}`,
  corpoRedefinirSenha: (url: string) =>
    envolverEmail(
      `<p>Toque no link para escolher uma senha nova. Ele vale por 30 minutos e só funciona uma vez.</p><p>${linkEmail(url, "Escolher uma senha nova")}</p><p>Se não foi você que pediu, pode ignorar este e-mail: a sua senha continua a mesma.</p>`,
    ),
};
