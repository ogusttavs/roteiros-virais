import type { MetadataRoute } from "next";

import { config } from "@/lib/config";

/**
 * Só os ícones e o nome (V5, item 3 do `PROXIMO.md`): o manifesto completo,
 * com modo instalável e sem rede, é a V7. Convenção do App Router (não
 * `public/manifest.json` estático) para o nome continuar vindo só de
 * `config.appName`, nunca escrito à mão num arquivo à parte.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: config.appName,
    short_name: config.appName,
    icons: [
      { src: "/icone-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icone-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icone-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
