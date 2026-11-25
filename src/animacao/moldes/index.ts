import type { Molde } from "../tipos";

import { moldeTipografico1 } from "./tipografico-1";

/** Os moldes que existem, pelo nome. O nome vem do pedido (nosso dado), nunca de texto do cliente. */
export const MOLDES: Record<string, Molde> = {
  [moldeTipografico1.nome]: moldeTipografico1,
};

export const MOLDE_PADRAO = moldeTipografico1.nome;
