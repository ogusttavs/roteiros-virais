"use client";

import { Check } from "lucide-react";
import { useEffect, useState } from "react";

import styles from "./EsperaEtapas.module.css";

type Props = {
  /** Ex.: "Costuma levar menos de 10 segundos.", já com o texto de quem chama. */
  titulo: string;
  /** Em ordem; o componente avança sozinho de uma para a próxima. */
  passos: string[];
  /** Frase de rodapé, ex.: "Pode esperar aqui. Isso é bem mais rápido que escrever o roteiro." */
  dica: string;
  /** A cada quantos ms avança para o próximo passo (fica parado no último). */
  intervaloMs?: number;
};

/**
 * A espera curta em etapas (design v2, `entrega/telas/base.css`, ".passos";
 * `TemaLivre.dc.html`, `PROXIMO.md` V5b item 3): visto para o que já passou,
 * ponto aceso para o que está acontecendo agora, anel vazio para o que vem
 * depois. Sem porcentagem, nada gira, nada pisca (só o passo "agora" ganha
 * peso maior). Como a chamada real é uma etapa só (não há progresso de
 * verdade vindo do servidor), o componente avança sozinho por tempo, e para
 * no último passo até quem chama desmontá-lo (sucesso ou erro).
 */
export function EsperaEtapas({ titulo, passos, dica, intervaloMs = 2500 }: Props) {
  const [atual, setAtual] = useState(0);

  useEffect(() => {
    if (atual >= passos.length - 1) return;
    const id = setTimeout(() => setAtual((i) => i + 1), intervaloMs);
    return () => clearTimeout(id);
  }, [atual, passos.length, intervaloMs]);

  return (
    <section className={styles.cartao} aria-live="polite" aria-busy="true">
      <p className={styles.titulo}>{titulo}</p>
      <ol className={styles.passos}>
        {passos.map((passo, indice) => {
          const estado = indice < atual ? "feito" : indice === atual ? "agora" : "pendente";
          return (
            <li
              key={passo}
              className={[styles.passo, estado === "feito" ? styles.feito : "", estado === "agora" ? styles.agora : ""]
                .filter(Boolean)
                .join(" ")}
            >
              <span className={styles.marca} aria-hidden="true">
                {estado === "feito" ? <Check size={13} strokeWidth={2.5} /> : null}
              </span>
              <span>{passo}</span>
            </li>
          );
        })}
      </ol>
      <p className={styles.dica}>{dica}</p>
    </section>
  );
}
