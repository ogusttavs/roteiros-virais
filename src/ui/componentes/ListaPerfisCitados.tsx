"use client";

import { useState } from "react";

import type { Plataforma } from "@/db/schema";
import { perfilPareceValido } from "@/lib/perfil-redes";

import { CampoPerfilRede } from "./CampoPerfilRede";
import styles from "./ListaPerfisCitados.module.css";

export type ItemPerfilCitado = { id: number; rede: Plataforma; handle: string };

const REDES: Plataforma[] = ["instagram", "tiktok", "youtube"];
const ROTULO_REDE: Record<Plataforma, string> = { instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube" };

/** Mostra o perfil como a pessoa escreveria o endereço, sem link (design v2, "Briefing.dc.html", ".perfil-citado"). */
function enderecoCompleto(item: ItemPerfilCitado): string {
  const prefixo = item.rede === "instagram" ? "instagram.com/" : item.rede === "tiktok" ? "tiktok.com/@" : "youtube.com/@";
  const semArroba = item.handle.replace(/^@/, "");
  return `${prefixo}${semArroba}`;
}

type Props = {
  titulo: string;
  ajuda?: string;
  itens: ItemPerfilCitado[];
  /** Devolve o id novo (ou lança, se a rede/handle não servir); a lista local reflete o que o servidor confirmou. */
  onAdicionar: (rede: Plataforma, handle: string) => Promise<void>;
  onRemover: (id: number) => void;
  textoAdicionar: string;
  textoTirar: (endereco: string) => string;
  avisoInvalido: string;
  limite: number;
};

/**
 * V12c, item 7, a E37b (design v2, `Briefing.dc.html`, ".perfis-citados"):
 * item salvo vira endereço fixo com "x" para tirar; "Adicionar outro" abre
 * um campo por rede, que salva ao sair do campo (sem botão "salvar" à
 * parte). Até `limite` por lista.
 */
export function ListaPerfisCitados({
  titulo,
  ajuda,
  itens,
  onAdicionar,
  onRemover,
  textoAdicionar,
  textoTirar,
  avisoInvalido,
  limite,
}: Props) {
  const [rascunho, setRascunho] = useState<{ rede: Plataforma; handle: string } | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function salvarRascunho() {
    if (!rascunho || !rascunho.handle.trim() || !perfilPareceValido(rascunho.handle)) {
      setRascunho(null);
      return;
    }
    setSalvando(true);
    try {
      await onAdicionar(rascunho.rede, rascunho.handle);
    } finally {
      setSalvando(false);
      setRascunho(null);
    }
  }

  return (
    <div className={styles.lista}>
      <h4 className={styles.titulo}>{titulo}</h4>
      {ajuda ? <p className={styles.ajuda}>{ajuda}</p> : null}

      {itens.map((item) => (
        <div key={item.id} className={styles.item}>
          <span className={styles.endereco}>{enderecoCompleto(item)}</span>
          <button
            type="button"
            className={styles.tirar}
            aria-label={textoTirar(enderecoCompleto(item))}
            onClick={() => onRemover(item.id)}
          >
            ×
          </button>
        </div>
      ))}

      {rascunho ? (
        <div className={styles.item}>
          <CampoPerfilRede
            plataforma={rascunho.rede}
            rotulo={`Perfil no ${ROTULO_REDE[rascunho.rede]}`}
            valor={rascunho.handle}
            onMudar={(valor) => setRascunho({ rede: rascunho.rede, handle: valor })}
            onSair={() => void salvarRascunho()}
            avisoInvalido={avisoInvalido}
          />
          <button
            type="button"
            className={styles.tirar}
            aria-label={textoTirar(enderecoCompleto({ id: -1, ...rascunho }))}
            disabled={salvando}
            // Tirar um rascunho descarta sem salvar; o campo ja salva sozinho ao perder o foco.
            onMouseDown={(evento) => evento.preventDefault()}
            onClick={() => setRascunho(null)}
          >
            ×
          </button>
        </div>
      ) : null}

      {itens.length + (rascunho ? 1 : 0) < limite ? (
        <div className={styles.adicionarPorRede}>
          <span>{textoAdicionar}</span>
          {REDES.map((rede) => (
            <button
              key={rede}
              type="button"
              className={styles.chip}
              onClick={async () => {
                // Trocar de rede sem ter saido do campo (raro, mas possivel): salva o rascunho
                // anterior antes de abrir o novo, para nunca perder o que a pessoa ja digitou.
                await salvarRascunho();
                setRascunho({ rede, handle: "" });
              }}
            >
              {ROTULO_REDE[rede]}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
