import { config } from "@/lib/config";

import { envolverEmail, linkEmail } from "./casca-email";

/** O nome vem do admin e entra no HTML do e-mail. */
function escaparHtml(texto: string): string {
  return texto.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** V5, item 7: a casca (cor, fonte de sistema, logotipo) vem de `casca-email.ts`; o texto abaixo não muda. */
export const textosAuth = {
  assuntoLinkMagico: `Seu link para entrar em ${config.appName}`,
  corpoLinkMagico: (url: string) =>
    envolverEmail(`<p>Toque para entrar, vale por 15 minutos.</p><p>${linkEmail(url, url)}</p>`),
  /**
   * O convite do cliente novo (A6, 23/11/2026): o que o app faz, o primeiro passo, o botão e o caminho de "esqueci a senha" se o link vencer (vale 48 horas).
   * Os "cerca de 20 minutos" são os da tela do briefing (`textos/briefing.ts`).
   */
  assuntoConvite: `Seu acesso a ${config.appName} está pronto`,
  corpoConvite: (opcoes: { url: string; nome: string | null; entrarUrl: string }) =>
    envolverEmail(
      `<p>${opcoes.nome ? `Oi, ${escaparHtml(opcoes.nome)}. ` : ""}Seu acesso a ${config.appName} está pronto.</p>` +
        `<p>Todo dia você recebe o que está funcionando no seu ramo e um roteiro pronto: o que falar e como editar, para você gravar no seu próprio celular.</p>` +
        `<p>O primeiro passo é responder o briefing, umas perguntas sobre você e o seu negócio. Leva cerca de 20 minutos e dá para parar no meio.</p>` +
        `<p>${linkEmail(opcoes.url, "Entrar e começar")}</p>` +
        `<p>Este link vale por 48 horas e só funciona uma vez. Se ele vencer, é só abrir ${linkEmail(opcoes.entrarUrl, "a página de entrar")} e tocar em "esqueci a senha": mandamos um link novo para você escolher a sua senha.</p>`,
    ),
  /** E58, "esqueci a senha": o link vale 30 minutos e só uma vez; sem conta, nada chega (a tela responde igual nos dois casos). */
  assuntoRedefinirSenha: `Escolha uma senha nova em ${config.appName}`,
  corpoRedefinirSenha: (url: string) =>
    envolverEmail(
      `<p>Toque no link para escolher uma senha nova. Ele vale por 30 minutos e só funciona uma vez.</p><p>${linkEmail(url, "Escolher uma senha nova")}</p><p>Se não foi você que pediu, pode ignorar este e-mail: a sua senha continua a mesma.</p>`,
    ),
};
