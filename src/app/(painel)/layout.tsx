import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { sessaoAtual } from "@/lib/sessao";
import { Nav } from "@/ui/componentes/Nav";

import styles from "./layout.module.css";

export default async function LayoutPainel({ children }: { children: ReactNode }) {
  const sessao = await sessaoAtual();
  if (!sessao) {
    redirect("/entrar");
  }

  return (
    <div className={styles.pagina}>
      <Nav />
      <main className={styles.corpo}>{children}</main>
    </div>
  );
}
