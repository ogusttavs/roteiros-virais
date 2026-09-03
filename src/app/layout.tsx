import type { Metadata } from "next";
import { Hanken_Grotesk, Space_Mono } from "next/font/google";
import type { ReactNode } from "react";

import { config } from "@/lib/config";

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
 * Le o tema salvo antes da primeira pintura, para nao piscar entre o tema do
 * sistema e o tema escolhido (etapa D, parte 1). A preferencia por cliente
 * ainda nao e gravada nesta parte (isso e a parte 2); o script fica pronto
 * para quando `localStorage` passar a ter o valor.
 */
const SCRIPT_TEMA = `(function(){try{var t=localStorage.getItem("tema");if(t==="claro"||t==="escuro"){document.documentElement.setAttribute("data-tema",t);}}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className={`${hanken.variable} ${spaceMono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
