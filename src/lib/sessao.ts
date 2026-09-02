import { headers } from "next/headers";

import { auth } from "./auth";

/** Sessao com dado de verdade (banco), para usar em Server Components e rotas. */
export async function sessaoAtual() {
  return auth.api.getSession({ headers: await headers() });
}
