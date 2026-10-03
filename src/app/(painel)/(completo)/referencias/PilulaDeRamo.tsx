"use client";

import { textosReferencias } from "@/textos/referencias";

import styles from "./PilulaDeRamo.module.css";
import { ItemMenuRadio, PilulaFiltro } from "./PilulaFiltro";

type Props = {
  /** Os ramos da conta, o principal primeiro. */
  ramos: { id: number; nome: string; principal: boolean }[];
  /** O ramo escolhido; `undefined` é "todos os ramos". */
  ramoAtivo: number | undefined;
  pilulaAberta: string | null;
  onAbrir: (id: string) => void;
  onFechar: () => void;
  onEscolher: (ramo: number | undefined) => void;
};

/**
 * E45 PR 3: a pílula "Ramo" de Referências (o mesmo padrão das pílulas de filtro do PR #106). Só aparece quando o admin ligou um ramo
 * alternativo à marca: "Todos os ramos" (o padrão) ou um dos ramos da conta. Visível em qualquer largura, ao contrário das outras seis,
 * que no celular moram na folha "Filtrar": é a única pílula que muda de onde vêm os vídeos, e uma marca com dois ramos precisa dela à mão.
 */
export function PilulaDeRamo({ ramos, ramoAtivo, pilulaAberta, onAbrir, onFechar, onEscolher }: Props) {
  const ativo = ramos.find((r) => r.id === ramoAtivo);
  return (
    <div className={styles.envoltorio} data-pilula-ramo>
      <PilulaFiltro
        id="ramo"
        rotulo={ativo ? ativo.nome : textosReferencias.ramo}
        ativa={ativo !== undefined}
        menuRotulo={textosReferencias.ramo}
        pilulaAberta={pilulaAberta}
        onAbrir={onAbrir}
        onFechar={onFechar}
      >
        <ItemMenuRadio rotulo={textosReferencias.todosOsRamos} marcado={ativo === undefined} onClick={() => onEscolher(undefined)} />
        {ramos.map((ramo) => (
          <ItemMenuRadio
            key={ramo.id}
            rotulo={ramo.principal ? `${ramo.nome} ${textosReferencias.ramoPrincipalSufixo}` : ramo.nome}
            marcado={ramoAtivo === ramo.id}
            onClick={() => onEscolher(ramo.id)}
          />
        ))}
      </PilulaFiltro>
    </div>
  );
}
