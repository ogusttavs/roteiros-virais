import { redirect } from "next/navigation";

import { sessaoAtual } from "@/lib/sessao";
import { textosEntrar } from "@/textos/entrar";
import { Cartao } from "@/ui/componentes/Cartao";
import { Logo } from "@/ui/Logo";

import { FormularioEntrar } from "./FormularioEntrar";
import styles from "./page.module.css";

export default async function Entrar() {
  const sessao = await sessaoAtual();
  if (sessao) {
    redirect("/hoje");
  }

  return (
    <div className={styles.pagina}>
      <Logo tamanho={32} />
      <Cartao className={styles.cartao}>
        <h1 className={styles.titulo}>{textosEntrar.titulo}</h1>
        <FormularioEntrar />
      </Cartao>
    </div>
  );
}
