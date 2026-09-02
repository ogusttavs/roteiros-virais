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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className={`${hanken.variable} ${spaceMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
