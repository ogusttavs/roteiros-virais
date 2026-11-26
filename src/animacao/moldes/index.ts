import type { Molde } from "../tipos";

import { moldeTipografico1 } from "./tipografico-1";
import { moldeTipografico2 } from "./tipografico-2";

/** Os moldes que existem, pelo nome. O nome vem do pedido (nosso dado), nunca de texto do cliente. O provisório fica para os pedidos gravados com ele (a prévia e o final saem iguais). */
export const MOLDES: Record<string, Molde> = {
  [moldeTipografico1.nome]: moldeTipografico1,
  [moldeTipografico2.nome]: moldeTipografico2,
};

/** O definitivo (26/11/2026): área segura do Reels, a cor da marca, a palavra de destaque e a chamada final com o @. */
export const MOLDE_PADRAO = moldeTipografico2.nome;
