"use client";

import { useEffect, useRef, useState } from "react";

export type EstadoDaCapsula = "cheia" | "encolhida";

/**
 * A regra da cápsula de baixo (passo 16 do Opus, `entregaveis/design-v2/entrega/telas/Movimento.dc.html`, função `regraDaCapsula`, aprovada em 03/10/2026).
 * Devolve uma função `(y, max)` que diz `cheia` ou `encolhida` a cada posição de rolagem, guardando a soma da descida ou da subida do gesto atual:
 * - encolhe quando passa de 60 px do topo e a descida somada chega a 12 px (12 px somados, não um quadro: não reage ao dedo que treme);
 * - fica como está ao soltar o dedo, na inércia e no quique (rolagem além do topo ou do fim não conta: o quique é a página, não a pessoa);
 * - abre quando a subida somada no mesmo gesto chega a 40 px (subir de propósito), a menos que esteja no fim da página (continua encolhida);
 * - abre sempre a menos de 20 px do topo; trocar de sentido zera a soma.
 * Pura (sem DOM), para o teste rodar a sequência de rolagem sem navegador.
 */
export function regraDaCapsula(estadoInicial: EstadoDaCapsula = "cheia", yInicial = 0): (y: number, max: number) => EstadoDaCapsula {
  let ultimo = yInicial;
  let soma = 0;
  let estado: EstadoDaCapsula = estadoInicial;
  return function (y, max) {
    if (y < 0 || y > max) return estado; // o quique não conta
    const delta = y - ultimo;
    ultimo = y;
    if (Math.sign(delta) !== Math.sign(soma)) soma = 0; // trocou de sentido: zera
    soma += delta;
    if (y < 20) estado = "cheia";
    else if (estado === "cheia" && y > 60 && soma >= 12) estado = "encolhida";
    else if (estado === "encolhida" && soma <= -40 && y < max - 2) estado = "cheia";
    return estado;
  };
}

/**
 * O estado da cápsula pela regra acima, ligado à rolagem da janela. `abrir` a deixa cheia na hora (trocou de aba, tocou num ícone) e recomeça a soma da posição
 * de agora, para a próxima rolagem não encolher de novo por causa do salto.
 */
export function useCapsulaEncolhida(): { encolhida: boolean; abrir: () => void } {
  const [estado, setEstado] = useState<EstadoDaCapsula>("cheia");
  const regraRef = useRef(regraDaCapsula());

  useEffect(() => {
    function aoRolar() {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setEstado(regraRef.current(window.scrollY, max));
    }
    window.addEventListener("scroll", aoRolar, { passive: true });
    return () => window.removeEventListener("scroll", aoRolar);
  }, []);

  function abrir() {
    regraRef.current = regraDaCapsula("cheia", typeof window === "undefined" ? 0 : window.scrollY);
    setEstado("cheia");
  }

  return { encolhida: estado === "encolhida", abrir };
}

/** Passo 17b (o cabeçalho de vidro): a tela já rolou além de 4 px do topo (`.rolada`: o vidro, o fio de baixo e o título curto entram). Ouvinte passivo; começa pelo que a tela já tem. */
export function useBarraRolada(): boolean {
  const [rolada, setRolada] = useState(false);
  useEffect(() => {
    function aoRolar() {
      setRolada(window.scrollY > 4);
    }
    aoRolar();
    window.addEventListener("scroll", aoRolar, { passive: true });
    return () => window.removeEventListener("scroll", aoRolar);
  }, []);
  return rolada;
}
