import Link from "next/link";

import { textosSenha } from "@/textos/senha";
import { Logo } from "@/ui/Logo";

import { FormularioRedefinir } from "./FormularioRedefinir";
import styles from "./page.module.css";

/**
 * Para onde o link do e-mail de "esqueci a senha" leva (E58). O endereço do e-mail passa antes pelo `/api/auth/reset-password/<código>` do better-auth, que confere o
 * código e volta para cá com `?token=` (vale) ou `?error=INVALID_TOKEN` (não existe, já foi usado ou passou de 30 minutos). Pública: quem esqueceu a senha não tem sessão.
 * Sem código, a tela diz que o link não vale, igual ao link vencido.
 */
export default async function RedefinirSenha({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const { token, error } = await searchParams;
  const vale = Boolean(token) && !error;
  const t = textosSenha.redefinir;

  return (
    <div className={styles.pagina}>
      <div className={styles.envoltorio}>
        <Logo altura={44} />
        {vale && token ? (
          <>
            <h1 className={styles.titulo}>{t.titulo}</h1>
            <p className={styles.explica}>{t.explica}</p>
            <FormularioRedefinir token={token} />
          </>
        ) : (
          <>
            <h1 className={styles.titulo}>{t.linkInvalidoTitulo}</h1>
            <p className={styles.explica}>{t.linkInvalidoTexto}</p>
            <Link className={styles.linkAcao} href="/entrar?esqueci=1">
              {t.pedirOutro}
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
