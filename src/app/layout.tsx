import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import type { ReactNode } from "react";

import { config } from "@/lib/config";
import { sessaoAtual } from "@/lib/sessao";
import { clienteDoUsuario } from "@/servicos/clientes";

import "../ui/tokens.css";
import "../ui/base.css";

/**
 * Reserva de fonte do design v2 (BRIEF.md, secao 3; entrega/telas/README.md,
 * "tres coisas que dependem de codigo"): a fonte do sistema (SF Pro/Segoe UI)
 * e a primeira opcao em `--fonte-texto`/`--fonte-titulo` (tokens.css); Inter
 * so entra quando o aparelho nao tem fonte de sistema propria (a maioria dos
 * celulares deste publico, que e Android, sem isto cairia no Roboto). Mono
 * segue o mesmo padrao com JetBrains Mono. `next/font/google` hospeda os
 * arquivos junto do proprio aplicativo, sem chamada externa em tempo de
 * execucao (etapa D2 parte 1, item 2 do `PROXIMO.md`).
 */
const inter = Inter({ subsets: ["latin"], variable: "--fonte-inter", display: "swap" });
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "600"],
  variable: "--fonte-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: config.appName,
  description: config.appName,
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
 * (recolhida no iPad, 768 a 1099px; aberta a partir de 1100px,
 * `layout.module.css`). Só grava o atributo quando ha uma escolha
 * explicita salva; sem ela, o atributo fica ausente e o `@media` cuida do
 * resto (`o estado guardado continua valendo`, `PROXIMO.md`).
 */
const SCRIPT_BARRA_LATERAL = `(function(){try{var v=localStorage.getItem("barra-lateral");if(v==="recolhida"||v==="aberta"){document.documentElement.setAttribute("data-barra-lateral",v);}}catch(e){}})();`;

export default async function RootLayout({ children }: { children: ReactNode }) {
  const sessao = await sessaoAtual();
  const cliente = sessao ? await clienteDoUsuario(sessao.user.id) : null;
  const tema = cliente?.tema === "claro" || cliente?.tema === "escuro" ? cliente.tema : undefined;

  return (
    <html
      lang="pt-BR"
      data-tema={tema}
      className={`${inter.variable} ${jetbrainsMono.variable}`}
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
