import Link from "next/link";
import { redirect } from "next/navigation";

import { sessaoAtual } from "@/lib/sessao";
import { textosCadastro } from "@/textos/cadastro";
import { Logo } from "@/ui/Logo";

import styles from "./page.module.css";

/**
 * "Você chegou ao limite do teste" (E63 PR 1, página simples; a tela desenhada vem no PR 2): para onde a ação que bateu no teto leva, com a frase de qual limite foi e o caminho para
 * assinar. `?o=` só escolhe a frase (roteiros, edicoes ou uso); qualquer outro valor cai na frase geral.
 */
export default async function LimiteDoTeste({ searchParams }: { searchParams: Promise<{ o?: string }> }) {
  const { o } = await searchParams;
  const sessao = await sessaoAtual();
  if (!sessao) redirect("/entrar");
  const t = textosCadastro.limiteDoTeste;
  const frase = o === "roteiros" ? t.roteiros : o === "edicoes" ? t.edicoes : t.uso;
  return (
    <div className={styles.pagina}>
      <div className={styles.envoltorio}>
        <Logo altura={44} />
        <h1 className={styles.titulo}>{t.titulo}</h1>
        <p className={styles.texto}>{frase}</p>
        <p className={styles.texto}>{t.assinar}</p>
        <Link href="/assinar" className={styles.botao}>
          {t.botao}
        </Link>
      </div>
    </div>
  );
}
