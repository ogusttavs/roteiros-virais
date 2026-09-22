import type { MetadataRoute } from "next";

import { config } from "@/lib/config";
import { COR_FUNDO_CLARO } from "@/lib/cores-do-aparelho";

/**
 * O manifesto completo (V7, item 5 do `PROXIMO.md`): o painel instala na tela
 * de início como aplicativo (`standalone`, sem a barra do navegador) e abre no
 * Hoje. Convenção do App Router (não `public/manifest.json` estático) para o
 * nome continuar vindo só de `config.appName`, nunca escrito à mão num arquivo
 * à parte. Cores do tema claro (`cores-do-aparelho.ts`, conferido contra os
 * tokens); o escuro segue a metatag do `viewport` em `layout.tsx`.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: config.appName,
    short_name: config.appName,
    lang: "pt-BR",
    display: "standalone",
    start_url: "/hoje",
    scope: "/",
    background_color: COR_FUNDO_CLARO,
    theme_color: COR_FUNDO_CLARO,
    icons: [
      { src: "/icone-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icone-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icone-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
