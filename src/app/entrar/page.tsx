import { redirect } from "next/navigation";

import { sessaoAtual } from "@/lib/sessao";
import { textosEntrar } from "@/textos/entrar";
import { Logo } from "@/ui/Logo";

import { FormularioEntrar } from "./FormularioEntrar";
import styles from "./page.module.css";

export default async function Entrar() {
  const sessao = await sessaoAtual();
  if (sessao) {
    redirect(sessao.user.role === "admin" ? "/admin/clientes" : "/hoje");
  }

  return (
    <div className={styles.pagina}>
      <div className={styles.envoltorio}>
        <Logo />
        <h1 className={styles.titulo}>{textosEntrar.titulo}</h1>
        <FormularioEntrar />
      </div>
    </div>
  );
}
