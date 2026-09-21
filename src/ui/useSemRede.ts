"use client";

import { useSyncExternalStore } from "react";

import { assinarEstadoDeRede, lerSemRede } from "@/lib/estado-de-rede";

/**
 * O aparelho está sem rede agora (V7, item 8 do PROXIMO.md): `navigator.onLine`
 * falso, ou a página na tela foi servida do guardado (`estado-de-rede.ts`).
 * Serve às telas fora do painel, que não têm o provedor `Conexao` (o modo
 * gravação, `roteiros/[id]/gravar`), e precisam desabilitar o que chama o
 * servidor com o motivo escrito. No servidor e na hidratação vale "com rede",
 * para o HTML inicial ser igual nos dois lados; o valor certo entra logo depois.
 */
export function useSemRede(): boolean {
  return useSyncExternalStore(assinarEstadoDeRede, lerSemRede, () => false);
}
