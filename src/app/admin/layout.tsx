import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { sessaoAtual } from "@/lib/sessao";

import styles from "./layout.module.css";

/** Area da equipe, sem a barra do cliente (brief-frontend.md, 6.10). */
export default async function LayoutAdmin({ children }: { children: ReactNode }) {
  const sessao = await sessaoAtual();
  if (!sessao) {
    redirect("/entrar");
  }
  if (sessao.user.role !== "admin") {
    redirect("/hoje");
  }

  return <div className={styles.pagina}>{children}</div>;
}
