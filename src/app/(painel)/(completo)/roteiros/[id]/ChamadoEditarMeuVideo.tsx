"use client";

import { Clapperboard } from "lucide-react";

import type { EstadoDaEdicao } from "@/db/schema";
import { linhaDoEstadoDaEdicao, textosEdicao } from "@/textos/edicao";
import { Botao } from "@/ui/componentes/Botao";
import { Cartao } from "@/ui/componentes/Cartao";

import styles from "./ChamadoEditarMeuVideo.module.css";

const t = textosEdicao.chamado;

type Props = {
  /** Em que ponto está a edição mais recente deste roteiro, ou `null` quando não há nenhuma. */
  estado: EstadoDaEdicao | null;
  /** Abre a folha "Editar o meu vídeo", no ponto em que a edição está. */
  aoAbrir: () => void;
};

/**
 * O chamado à vista no corpo do roteiro: quem gravou manda o vídeo daqui, sem procurar no menu "Mais opções" (que continua com o mesmo item). Com edição já começada, o cartão diz em que
 * ponto ela está e o botão abre a folha nesse ponto.
 */
export function ChamadoEditarMeuVideo({ estado, aoAbrir }: Props) {
  const linha = linhaDoEstadoDaEdicao(estado);
  return (
    <Cartao variante="recuado" className={styles.chamado} data-chamado-editar-video>
      <div className={styles.texto}>
        <Clapperboard size={20} strokeWidth={1.5} className={styles.icone} aria-hidden="true" />
        <div className={styles.frases}>
          {linha ? (
            <p className={styles.estado} role="status" data-estado-da-edicao={estado ?? undefined}>
              {linha}
            </p>
          ) : (
            <p className={styles.titulo}>{t.titulo}</p>
          )}
        </div>
      </div>
      <Botao type="button" variante="secundario" onClick={aoAbrir}>
        {linha ? t.botaoAbrir : t.botao}
      </Botao>
    </Cartao>
  );
}
