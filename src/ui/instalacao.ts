"use client";

import { useSyncExternalStore } from "react";

/**
 * O pedido de instalação do Chromium (Android): o navegador manda `beforeinstallprompt` uma vez, cedo, e quem o guardou pode chamar `prompt()`
 * mais tarde (quando a folha de convite abre). Por isso o ouvinte mora no layout do painel e guarda o evento aqui, num módulo, antes de qualquer
 * tela precisar dele. O iPhone não tem nada parecido: lá o convite só mostra os dois passos.
 */
export type EventoDeInstalacao = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let guardado: EventoDeInstalacao | null = null;
const ouvintes = new Set<() => void>();

function avisar() {
  for (const ouvinte of ouvintes) ouvinte();
}

/** Começa a guardar o pedido de instalação. Devolve quem desfaz. Chamar de novo (em desenvolvimento o React monta duas vezes) não duplica. */
export function comecarAOuvirInstalacao(): () => void {
  function aoChegar(evento: Event) {
    // Sem isto o Chrome mostra a barra dele sozinho; o convite é nosso, no momento certo.
    evento.preventDefault();
    guardado = evento as EventoDeInstalacao;
    avisar();
  }
  function aoInstalar() {
    guardado = null;
    avisar();
  }
  window.addEventListener("beforeinstallprompt", aoChegar);
  window.addEventListener("appinstalled", aoInstalar);
  return () => {
    window.removeEventListener("beforeinstallprompt", aoChegar);
    window.removeEventListener("appinstalled", aoInstalar);
  };
}

function assinar(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  return () => ouvintes.delete(ouvinte);
}

/** O aplicativo já está instalado na tela de início? (Android e desktop: `display-mode`; iPhone: `navigator.standalone`.) */
export function jaEstaInstalado(): boolean {
  if (window.matchMedia("(display-mode: standalone)").matches) return true;
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/**
 * O navegador deixa instalar por código agora? `instalar()` abre o pedido dele e diz se a pessoa aceitou. Falso no iPhone e em qualquer navegador
 * sem `beforeinstallprompt` (ou antes de ele chegar): aí valem as instruções escritas.
 */
export function usePedidoDeInstalacao(): { disponivel: boolean; instalar: () => Promise<boolean> } {
  const disponivel = useSyncExternalStore(
    assinar,
    () => guardado !== null,
    () => false,
  );
  async function instalar(): Promise<boolean> {
    const evento = guardado;
    if (!evento) return false;
    try {
      await evento.prompt();
      const escolha = await evento.userChoice;
      return escolha.outcome === "accepted";
    } finally {
      // O evento só vale uma vez (o navegador o consome ao chamar `prompt()`), mas só some depois da escolha: enquanto o pedido do navegador está aberto,
      // o botão e o texto da tela continuam como estavam.
      if (guardado === evento) guardado = null;
      avisar();
    }
  }
  return { disponivel, instalar };
}
