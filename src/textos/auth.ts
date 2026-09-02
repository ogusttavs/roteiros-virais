import { config } from "@/lib/config";

export const textosAuth = {
  assuntoLinkMagico: `Seu link para entrar em ${config.appName}`,
  corpoLinkMagico: (url: string) =>
    `<p>Toque para entrar, vale por 15 minutos.</p><p><a href="${url}">${url}</a></p>`,
};
