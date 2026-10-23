import { redirect } from "next/navigation";

import { sessaoAtual } from "@/lib/sessao";
import { senhaEhProvisoria } from "@/servicos/senha";
import { textosSenha } from "@/textos/senha";
import { Logo } from "@/ui/Logo";

import { FormularioPrimeiroAcesso } from "./FormularioPrimeiroAcesso";
import styles from "./page.module.css";

/**
 * O primeiro acesso de quem entrou por convite (E58): antes do resto do painel, a pessoa escolhe a senha dela no lugar da provisória. Os layouts do painel, do Começar e do admin
 * mandam para cá enquanto a conta tem a marca de senha provisória (`senhaEhProvisoria`); quem não tem a marca, ou já escolheu a senha, volta ao painel.
 */
export default async function TrocarSenha() {
  const sessao = await sessaoAtual();
  if (!sessao) redirect("/entrar");
  const destino = sessao.user.role === "admin" ? "/admin" : "/hoje";
  if (!(await senhaEhProvisoria(sessao.user.id))) redirect(destino);

  return (
    <div className={styles.pagina}>
      <div className={styles.envoltorio}>
        <Logo altura={44} />
        <h1 className={styles.titulo}>{textosSenha.primeiroAcesso.titulo}</h1>
        <p className={styles.explica}>{textosSenha.primeiroAcesso.explica}</p>
        <FormularioPrimeiroAcesso />
      </div>
    </div>
  );
}
