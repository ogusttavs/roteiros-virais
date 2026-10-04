"use client";

import { FICHAS_EM_ORDEM, NOME_CURTO_DA_FICHA } from "@/config/fichas";
import type { Ficha } from "@/db/schema";
import { textosReferencias } from "@/textos/referencias";

import styles from "./PilulaDeRamo.module.css";
import { ItemMenuRadio, PilulaFiltro } from "./PilulaFiltro";

type Props = {
  /** A ficha escolhida; `undefined` é "Todos". */
  feitoPara: Ficha | undefined;
  /** Quantos vídeos cada ficha traria, mantendo os outros filtros. */
  contagens: Record<Ficha, number>;
  pilulaAberta: string | null;
  onAbrir: (id: string) => void;
  onFechar: () => void;
  onEscolher: (ficha: Ficha | undefined) => void;
};

/**
 * E49 PR 2: a pílula "Parece feito para" de Referências, no mesmo padrão das outras: "Todos" mais as cinco fichas com os nomes curtos do desenho, cada uma com a contagem.
 * É uma leitura da extração (o que o vídeo parece pedir), nunca um número da rede. Visível em qualquer largura, como a do Ramo.
 */
export function PilulaFeitoPara({ feitoPara, contagens, pilulaAberta, onAbrir, onFechar, onEscolher }: Props) {
  return (
    <div className={styles.envoltorio} data-pilula-feito-para>
      <PilulaFiltro
        id="feito-para"
        rotulo={feitoPara ? NOME_CURTO_DA_FICHA[feitoPara] : textosReferencias.feitoPara}
        ativa={feitoPara !== undefined}
        menuRotulo={textosReferencias.feitoPara}
        pilulaAberta={pilulaAberta}
        onAbrir={onAbrir}
        onFechar={onFechar}
      >
        <ItemMenuRadio rotulo={textosReferencias.todosOsFeitoPara} marcado={feitoPara === undefined} onClick={() => onEscolher(undefined)} />
        {FICHAS_EM_ORDEM.map((f) => (
          <ItemMenuRadio key={f} rotulo={`${NOME_CURTO_DA_FICHA[f]} (${contagens[f]})`} marcado={feitoPara === f} onClick={() => onEscolher(f)} />
        ))}
      </PilulaFiltro>
    </div>
  );
}
