"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/** Lê "rgb(r, g, b)" ou "rgba(r, g, b, a)" (o que `getComputedStyle` devolve) em [r, g, b, a]; nulo para qualquer outra coisa. */
function lerCor(texto: string): [number, number, number, number] | null {
  const partes = texto.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)/);
  if (!partes) return null;
  const alfa = partes[4] === undefined ? 1 : partes[4].endsWith("%") ? Number(partes[4].slice(0, -1)) / 100 : Number(partes[4]);
  return [Number(partes[1]), Number(partes[2]), Number(partes[3]), alfa];
}

function paraHex([r, g, b]: [number, number, number, number]): string {
  return `#${[r, g, b].map((c) => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * A cor que o olho vê de uma barra translúcida (o vidro do cabeçalho) sobre o fundo da tela: a mistura do `topo` (com a transparência dele) sobre o `fundo`.
 * Devolve `#rrggbb`, ou nulo se alguma das duas não for uma cor que se saiba ler.
 */
export function misturarCores(topo: string, fundo: string): string | null {
  const t = lerCor(topo);
  const f = lerCor(fundo);
  if (!t || !f) return null;
  const a = t[3];
  return paraHex([t[0] * a + f[0] * (1 - a), t[1] * a + f[1] * (1 - a), t[2] * a + f[2] * (1 - a), 1]);
}

/** A cor de hoje da faixa de cima do sistema: a do cabeçalho do painel (misturada com o fundo), ou a do fundo da tela quando não há cabeçalho fixo. */
function corDaFaixa(): string | null {
  const fundo = getComputedStyle(document.body).backgroundColor;
  const cabecalho = document.querySelector("[data-barra-topo]");
  if (!cabecalho) return misturarCores(fundo, "rgb(255, 255, 255)");
  return misturarCores(getComputedStyle(cabecalho).backgroundColor, fundo);
}

/**
 * A faixa de cima do sistema, atrás do relógio e da bateria (achado do Gustavo no iPhone instalado, 04/10, tema escuro: "devia ser contínuo para parecer mais um
 * app"): o iPhone pinta essa faixa com a cor de `theme-color`, e ela ficava na cor do fundo enquanto o cabeçalho do painel é o vidro, um cinza mais claro. Este efeito
 * mede a cor de verdade do cabeçalho (`[data-barra-topo]`) sobre o fundo, em cada tema, e põe a cor nas metas `theme-color` (tirando o `media` das do servidor, que só
 * seguem o tema do aparelho e não a escolha da Conta). Refaz quando o tema muda (`data-tema` no `<html>`), quando o aparelho troca de claro para escuro e a cada tela.
 * Sem cabeçalho fixo (modo gravação, Começar, Entrar) a cor é a do fundo daquela tela. O texto do relógio o próprio iOS escolhe (`statusBarStyle: "default"`).
 */
export function CorDaBarraDoSistema() {
  const caminho = usePathname();

  useEffect(() => {
    function aplicar() {
      const cor = corDaFaixa();
      if (!cor) return;
      // Nunca remove nem troca as metas que o Next gerencia (viewport `themeColor`): o React as desmonta na navegação e quebrava com "removeChild" de nulo. Só muda
      // o atributo delas, tirando o `media` para a cor valer em qualquer tema; sem nenhuma, cria uma.
      const existentes = document.querySelectorAll('meta[name="theme-color"]');
      if (existentes.length === 0) {
        const meta = document.createElement("meta");
        meta.name = "theme-color";
        meta.content = cor;
        document.head.appendChild(meta);
        return;
      }
      existentes.forEach((meta) => {
        meta.removeAttribute("media");
        meta.setAttribute("content", cor);
      });
    }
    aplicar();
    // A tela nova pode demorar um quadro para trazer o cabeçalho: mede de novo logo depois.
    const depois = setTimeout(aplicar, 400);
    const observador = new MutationObserver(aplicar);
    observador.observe(document.documentElement, { attributes: true, attributeFilter: ["data-tema"] });
    const escuro = window.matchMedia?.("(prefers-color-scheme: dark)");
    escuro?.addEventListener?.("change", aplicar);
    return () => {
      clearTimeout(depois);
      observador.disconnect();
      escuro?.removeEventListener?.("change", aplicar);
    };
  }, [caminho]);

  return null;
}
