import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";

import { config } from "@/lib/config";
import { COR_FUNDO_CLARO, COR_FUNDO_ESCURO } from "@/lib/cores-do-aparelho";
import { sessaoAtual } from "@/lib/sessao";
import { clienteAtivoDoUsuario } from "@/servicos/clientes";

import "../ui/tokens.css";
import "../ui/base.css";

/**
 * As três fontes da identidade (V5, entregaveis/design-v2/IDENTIDADE.md,
 * 19/09/2026), em arquivo junto do aplicativo, sem chamada externa em tempo
 * de execução: Mona Sans (título e texto), JetBrains Mono (números e
 * rótulos), Caveat (letra de mão, só no bilhete "Mais indicado para hoje").
 * `next/font/local` faz a pré-carga; só a Mona Sans precisa dela de
 * verdade (é a fonte que aparece em toda tela desde o primeiro pixel), por
 * isso as outras duas têm `preload: false` (item 2 do `PROXIMO.md`).
 */
const monaSans = localFont({
  src: "../ui/fontes/monasans-latin.woff2",
  weight: "200 900",
  style: "normal",
  variable: "--fonte-mona-sans",
  display: "swap",
});
const jetbrainsMono = localFont({
  src: "../ui/fontes/jetbrainsmono-latin.woff2",
  weight: "400 800",
  style: "normal",
  variable: "--fonte-jetbrains-mono",
  display: "swap",
  preload: false,
});
const caveat = localFont({
  src: "../ui/fontes/caveat-latin.woff2",
  weight: "400 700",
  style: "normal",
  variable: "--fonte-caveat",
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  title: config.appName,
  description: config.appName,
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-48.png", sizes: "48x48", type: "image/png" },
    ],
    shortcut: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
  /**
   * O iPhone instalado (V7, item 5): abre sem a barra do Safari, com o nome
   * do produto sob o ícone. `apple-mobile-web-app-capable` vai à mão porque o
   * Next 15 só emite a versão sem o prefixo (`mobile-web-app-capable`) e o
   * Safari mais antigo só lê a com prefixo. Barra de status "default": letra
   * escura sobre fundo claro; o iOS não deixa a barra seguir o tema escuro, e
   * a escolha fica registrada em "Decisões pendentes" (TODO.md).
   */
  appleWebApp: { capable: true, title: config.appName, statusBarStyle: "default" },
  other: { "apple-mobile-web-app-capable": "yes" },
};

/**
 * `viewport-fit=cover` (V7, item 2 do PROXIMO.md): o aplicativo ocupa a tela
 * toda, inclusive atrás da ilha e da barra de gesto do iPhone; cada barra fixa
 * se afasta com `env(safe-area-inset-*)` (CSS). Nada de `maximum-scale` nem
 * `user-scalable=no` (tira o zoom de acessibilidade): o zoom automático do
 * iPhone em campo pequeno se resolve com fonte de 16 px ou mais. A cor da barra
 * do navegador acompanha o fundo do tema do aparelho.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: COR_FUNDO_CLARO },
    { media: "(prefers-color-scheme: dark)", color: COR_FUNDO_ESCURO },
  ],
};

/**
 * Le o tema salvo antes da primeira pintura, para nao piscar (etapa D, parte
 * 1). So entra em acao quando o servidor nao ja decidiu (abaixo): cliente
 * logado com "claro" ou "escuro" tem o `data-tema` no HTML de verdade, sem
 * script nenhum. Quem sobra (admin, sem registro em `clientes`; visitante
 * antes de entrar; cliente em "sistema") usa so o `localStorage` do
 * navegador, como antes (etapa D, parte 2, decisao 3).
 */
const SCRIPT_TEMA = `(function(){try{if(document.documentElement.hasAttribute("data-tema"))return;var t=localStorage.getItem("tema");if(t==="claro"||t==="escuro"){document.documentElement.setAttribute("data-tema",t);}}catch(e){}})();`;

/**
 * Le o estado da barra lateral do painel antes da primeira pintura, mesma
 * ideia do SCRIPT_TEMA acima (etapa "acabamento visual 2", achado do
 * Gustavo usando o painel no iPad): sem isto, a barra nasceria sempre
 * aberta e recolheria de repente depois da hidratacao. Inocuo fora do
 * painel (nenhuma tela fora dele tem `.colunaDesktop`).
 *
 * Etapa D2, parte 1 (design v2, item 3 do `PROXIMO.md`): a barra passou a
 * ter um terceiro estado, "sem escolha do cliente" (nem "aberta" nem
 * "recolhida" salvos), em que o CSS decide sozinho pela largura da tela
 * (recolhida no iPad, 768 a 1179px; aberta a partir de 1180px,
 * `layout.module.css`). Só grava o atributo quando ha uma escolha
 * explicita salva; sem ela, o atributo fica ausente e o `@media` cuida do
 * resto (`o estado guardado continua valendo`, `PROXIMO.md`).
 */
const SCRIPT_BARRA_LATERAL = `(function(){try{var v=localStorage.getItem("barra-lateral");if(v==="recolhida"||v==="aberta"){document.documentElement.setAttribute("data-barra-lateral",v);}}catch(e){}})();`;

export default async function RootLayout({ children }: { children: ReactNode }) {
  const sessao = await sessaoAtual();
  const cliente = sessao ? await clienteAtivoDoUsuario(sessao.user.id) : null;
  const tema = cliente?.tema === "claro" || cliente?.tema === "escuro" ? cliente.tema : undefined;

  return (
    <html
      lang="pt-BR"
      data-tema={tema}
      className={`${monaSans.variable} ${jetbrainsMono.variable} ${caveat.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA }} />
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_BARRA_LATERAL }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
