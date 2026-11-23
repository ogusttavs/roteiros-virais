import { Check } from "lucide-react";
import type { ReactNode } from "react";

import type { textosCadastro } from "@/textos/cadastro";
import { Logo } from "@/ui/Logo";

import styles from "./pecas.module.css";

/**
 * As peças das telas do cadastro (E63 PR 2). Sem estado e sem navegador: servem às páginas de servidor e aos componentes de cliente. O desenho manda nos nomes: o cartão de vidro, o
 * rodapé, o caminho do teste.
 */

/** A tela inteira: a luz atrás e o arranjo (uma coluna; com o caminho, do tablet largo para cima, o caminho à esquerda do cartão). */
export function TelaDeConta({ comCaminho = false, children }: { comCaminho?: boolean; children: ReactNode }) {
  return (
    <main className={styles.tela}>
      <div className={[styles.arranjo, comCaminho ? styles.arranjoComCaminho : ""].filter(Boolean).join(" ")}>{children}</div>
    </main>
  );
}

/** O cartão de vidro com o logotipo no alto. `largo`: do tablet para cima alarga para 36 rem e põe dois campos por linha. */
export function CartaoDeConta({ largo = false, children }: { largo?: boolean; children: ReactNode }) {
  return (
    <div className={[styles.cartao, largo ? styles.largo : ""].filter(Boolean).join(" ")}>
      <Logo altura={44} />
      {children}
    </div>
  );
}

export function CabecaDoCartao({ titulo, subtitulo, confirmado }: { titulo: string; subtitulo?: string; confirmado?: string }) {
  return (
    <div className={styles.cabeca}>
      {confirmado ? (
        <p className={styles.confirmado}>
          <Check aria-hidden="true" strokeWidth={1.5} />
          <span>{confirmado}</span>
        </p>
      ) : null}
      <h1>{titulo}</h1>
      {subtitulo ? <p>{subtitulo}</p> : null}
    </div>
  );
}

/** O caminho do teste, em quatro passos; `passo` é o de agora (1 a 3). Os que já foram levam o visto. */
export function CaminhoDoTeste({ passo, textos: t }: { passo: 1 | 2 | 3; textos: typeof textosCadastro.caminho }) {
  return (
    <aside className={styles.caminho} aria-label={t.rotulo}>
      <span className={styles.rotuloCaminho}>{t.rotulo}</span>
      <ol className={styles.passosCaminho}>
        {t.passos.map((p, i) => {
          const n = i + 1;
          const estado = n < passo ? styles.feito : n === passo ? styles.agora : "";
          return (
            <li key={p.titulo} className={[styles.passoCaminho, estado].filter(Boolean).join(" ")} aria-current={n === passo ? "step" : undefined}>
              <span className={styles.numero}>
                {n < passo ? (
                  <>
                    <Check aria-hidden="true" strokeWidth={1.5} />
                    <span className={styles.soLeitor}>{t.feito}</span>
                  </>
                ) : (
                  n
                )}
              </span>
              <div className={styles.textoDoPasso}>
                <strong>
                  {p.titulo}
                  {n === passo ? <span className={styles.marcaAgora}>{t.agora}</span> : null}
                </strong>
                <p>{p.texto}</p>
              </div>
            </li>
          );
        })}
      </ol>
      <p className={styles.precoCaminho}>
        {t.preco.antes}
        <b>{t.preco.valor}</b>
        {t.preco.depois}
      </p>
    </aside>
  );
}
