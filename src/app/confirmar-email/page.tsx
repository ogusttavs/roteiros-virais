import { redirect } from "next/navigation";

import { barreiraDoCadastroNaSessao } from "@/lib/portao-cadastro";
import { sessaoAtual } from "@/lib/sessao";
import { textosCadastro } from "@/textos/cadastro";
import { Logo } from "@/ui/Logo";

import { BotaoReenviar } from "./BotaoReenviar";
import styles from "./page.module.css";

/**
 * "Confirme o seu e-mail" (E63 PR 1, página simples; a tela desenhada vem no PR 2). É tudo o que o painel mostra a quem criou a conta sozinho e ainda não confirmou o e-mail. Quem não
 * está nessa situação (já confirmou, ou a conta é de convite) volta ao painel. O `?link=invalido` é o que o link vencido ou já usado traz.
 */
export default async function ConfirmarEmail({ searchParams }: { searchParams: Promise<{ link?: string }> }) {
  const { link } = await searchParams;
  const sessao = await sessaoAtual();
  if (!sessao) redirect("/entrar");
  const barreira = await barreiraDoCadastroNaSessao();
  if (barreira?.tipo !== "email") redirect(sessao.user.role === "admin" ? "/admin" : "/hoje");

  const t = textosCadastro.confirmeSeuEmail;
  return (
    <div className={styles.pagina}>
      <div className={styles.envoltorio}>
        <Logo altura={44} />
        <h1 className={styles.titulo}>{t.titulo}</h1>
        {link === "invalido" ? <p className={styles.aviso}>{t.linkInvalido}</p> : null}
        <p className={styles.texto}>{t.texto(sessao.user.email)}</p>
        <BotaoReenviar rotulo={t.reenviar} />
      </div>
    </div>
  );
}
