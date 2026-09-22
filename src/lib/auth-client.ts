import { adminClient, magicLinkClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  plugins: [adminClient(), magicLinkClient()],
  /**
   * Tempo limite de todo pedido de autenticacao (V7, item 4 do PROXIMO.md):
   * sem ele, uma conexao que so trava (sem cair) deixava o "entrando" na tela
   * para sempre. Ao estourar, o fetch e abortado e o pedido REJEITA com
   * AbortError (o cliente do better-auth nao captura), entao quem chama
   * precisa de try/catch (`FormularioEntrar.tsx`).
   */
  fetchOptions: { timeout: 15000 },
});

export const { signIn, signOut, useSession } = authClient;
