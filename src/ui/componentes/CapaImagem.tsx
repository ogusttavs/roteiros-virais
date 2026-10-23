"use client";

import { useCallback } from "react";

type Props = {
  src: string;
  className?: string;
  /** Chamado quando a imagem não abre (link vencido, rede, 403 do CDN). Quem usa troca a capa pelo reserva, nunca deixa o ícone de imagem quebrada. */
  aoFalhar: () => void;
};

/**
 * A capa de um vídeo (hotfix de 22/10/2026). Só o `onError` não basta: se a imagem falhar antes do React ligar o evento (a página vem renderizada do servidor e o navegador já pediu a
 * capa), o erro passa sem ninguém ouvir e o quadro fica preto ou quebrado. O `ref` confere no momento de ligar: imagem que já terminou e não tem largura é imagem que falhou.
 */
export function CapaImagem({ src, className, aoFalhar }: Props) {
  const conferir = useCallback(
    (imagem: HTMLImageElement | null) => {
      if (imagem && imagem.complete && imagem.naturalWidth === 0) aoFalhar();
    },
    [aoFalhar],
  );
  return (
    // eslint-disable-next-line @next/next/no-img-element -- url externa (CDN da plataforma) ou a rota de capa guardada, sem otimizacao do Next
    <img ref={conferir} src={src} alt="" className={className} onError={aoFalhar} />
  );
}
