import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { textosTermos } from "@/textos/termos";
import { Logo } from "@/ui/Logo";

import styles from "./PaginaLegal.module.css";

type Secao = { titulo: string; paragrafos: string[] };

/**
 * `/termos` e `/privacidade` (etapa 12, decisão 7 do `PROXIMO.md`,
 * `EntrarContaTela.dc.html`, quadro "texto"): página pública, sem sessão.
 * O aviso de revisão jurídica pendente só aparece fora de produção.
 */
export function PaginaLegal({ titulo, secoes }: { titulo: string; secoes: Secao[] }) {
  const emDesenvolvimento = process.env.NODE_ENV !== "production";

  return (
    <main className={styles.pagina}>
      <div className={styles.envoltorio}>
        <div className={styles.cabecalho}>
          <Logo />
          <Link href="/" className={styles.voltar}>
            <ArrowLeft size={18} strokeWidth={1.5} aria-hidden="true" />
            {textosTermos.voltar}
          </Link>
        </div>
        <h1 className={styles.titulo}>{titulo}</h1>
        <p className={styles.atualizado}>
          {textosTermos.atualizadoEm}
          {emDesenvolvimento ? ` · ${textosTermos.avisoRevisaoPendente}` : ""}
        </p>
        {secoes.map((secao) => (
          <section key={secao.titulo}>
            <h2 className={styles.subtitulo}>{secao.titulo}</h2>
            {secao.paragrafos.map((paragrafo, i) => (
              <p key={i} className={styles.paragrafo}>
                {paragrafo}
              </p>
            ))}
          </section>
        ))}
      </div>
    </main>
  );
}
