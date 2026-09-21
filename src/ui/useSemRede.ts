"use client";

import { useSyncExternalStore } from "react";

function assinar(aoMudar: () => void): () => void {
  window.addEventListener("online", aoMudar);
  window.addEventListener("offline", aoMudar);
  return () => {
    window.removeEventListener("online", aoMudar);
    window.removeEventListener("offline", aoMudar);
  };
}

/**
 * O aparelho está sem rede agora (`navigator.onLine` falso). Para as telas
 * fora do painel, que não têm o provedor `Conexao` (o modo gravação:
 * `roteiros/[id]/gravar`), e precisam desabilitar o que chama o servidor com o
 * motivo escrito (V7, item 8 do PROXIMO.md). No servidor e na hidratação vale
 * "com rede", para o HTML inicial ser igual nos dois lados.
 */
export function useSemRede(): boolean {
  return useSyncExternalStore(
    assinar,
    () => !navigator.onLine,
    () => false,
  );
}
