import type { Metadata } from "next";
import { Hanken_Grotesk, Space_Mono } from "next/font/google";
import type { ReactNode } from "react";

import { config } from "@/lib/config";
import { sessaoAtual } from "@/lib/sessao";
import { clienteDoUsuario } from "@/servicos/clientes";

import "../ui/tokens.css";
import "../ui/base.css";

const hanken = Hanken_Grotesk({ subsets: ["latin"], variable: "--fonte-hanken" });
const spaceMono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--fonte-space-mono",
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

export default async function RootLayout({ children }: { children: ReactNode }) {
  const sessao = await sessaoAtual();
  const cliente = sessao ? await clienteDoUsuario(sessao.user.id) : null;
  const tema = cliente?.tema === "claro" || cliente?.tema === "escuro" ? cliente.tema : undefined;

  return (
    <html lang="pt-BR" data-tema={tema} className={`${hanken.variable} ${spaceMono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
