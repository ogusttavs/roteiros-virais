/**
 * E74 PR 2a (R-a, R-c): o que a tela de espera do objetivo faz com cada resposta de `GET /api/pedidos/estado?id=`. Sem React aqui, para o teste provar as regras uma a uma.
 *
 * A regra que importa (achado do Fable de 26/11): perder a resposta da escrita nunca vira "a conexão caiu" com "Tentar de novo". A tela segue o pedido pelo id, e só oferece tentar de novo
 * quando o servidor diz que o pedido falhou, ou quando o servidor nunca soube do pedido (e então o mesmo id vai de novo: o servidor não escreve duas vezes o mesmo pedido).
 */
import type { PedidoNaTela } from "@/servicos/pedidos-estado";
import { textosObjetivo } from "@/textos/objetivo";
import { textosPedidos } from "@/textos/pedidos";

import { ESPERA_COM_PEDIDO_MS, GRACA_DO_PEDIDO_MS } from "./espera-guardada";

/**
 * Por que a tela segue este pedido:
 * - `enviando`: a escrita foi pedida e a resposta ainda não voltou (o pedido pode ainda não ter chegado; um "não existe" é só o atraso);
 * - `rede`: a resposta se perdeu na rede (o iPhone bloqueou, trocou de app) ou a espera foi guardada nesta aba: o pedido pode ter chegado ou não;
 * - `outra`: a escrita respondeu com um erro que não é de rede (o servidor já respondeu: se o pedido não existe, ele nunca nasceu);
 * - `repetido`: o servidor disse que este mesmo id já está sendo escrito;
 * - `servidor`: a página disse que este tema tem um pedido andando (o app foi reaberto). Pode ser a página guardada pelo navegador (o voltar), então só abre as versões depois de ver o
 *   pedido andando: um pedido que já estava pronto quando a tela abriu não puxa a pessoa de volta para ele.
 */
export type PorQueSegue = "enviando" | "rede" | "outra" | "repetido" | "servidor";

export type PedidoSeguido = {
  pedidoId: string;
  /** Quando a espera começou, no relógio do aparelho (ms). */
  desde: number;
  porque: PorQueSegue;
  /** A tela já viu este pedido andando no servidor. */
  vistoAndando: boolean;
};

export type RespostaDoPedido = { status: number; pedido: (PedidoNaTela & { agora: string }) | null };

export type Decisao =
  | { acao: "abrir"; grupo: string }
  /** O servidor marcou o pedido como falho: a frase dele, e "Tentar de novo" faz um pedido novo que refaz este. */
  | { acao: "falhou"; frase: string; refeitoDe: string }
  /** O servidor nunca soube do pedido: "Tentar de novo" manda o MESMO id (é seguro, o servidor não escreve duas vezes). */
  | { acao: "nao-chegou"; frase: string; mesmoId: string }
  /** Continua esperando; a etapa e o começo (no relógio do aparelho, corrigido pelo do servidor) quando o servidor os disse. */
  | { acao: "esperar"; etapa: string | null; desdeMs: number | null; vistoAndando: boolean }
  /** Volta ao formulário sem erro (o pedido já tinha terminado antes de a tela abrir, ou não dá mais para saber dele). */
  | { acao: "desistir" };

export function decidirSobreOPedido(seguido: PedidoSeguido, resposta: RespostaDoPedido, agora = Date.now()): Decisao {
  const passou = agora - seguido.desde;
  const continuar: Decisao = { acao: "esperar", etapa: null, desdeMs: null, vistoAndando: seguido.vistoAndando };

  if (resposta.status === 404) {
    // Enquanto a escrita ainda não respondeu, o pedido pode estar chegando: nunca é "não chegou".
    if (seguido.porque === "enviando") return continuar;
    if (seguido.porque === "servidor") return { acao: "desistir" };
    if (seguido.porque === "outra") return { acao: "nao-chegou", frase: textosObjetivo.erro, mesmoId: seguido.pedidoId };
    if (passou < GRACA_DO_PEDIDO_MS) return continuar;
    return { acao: "nao-chegou", frase: textosPedidos.naoChegou, mesmoId: seguido.pedidoId };
  }

  const pedido = resposta.status >= 200 && resposta.status < 300 ? resposta.pedido : null;
  if (!pedido) {
    // Sem sessão, sem assinatura ou o servidor fora agora: tenta de novo, até a espera com pedido vencer.
    return passou > ESPERA_COM_PEDIDO_MS ? { acao: "desistir" } : continuar;
  }

  const antigo = seguido.porque === "servidor" && !seguido.vistoAndando;
  if (pedido.estado === "pronto") {
    if (antigo || pedido.resultadoTipo !== "versoes" || !pedido.resultadoId) return { acao: "desistir" };
    return { acao: "abrir", grupo: pedido.resultadoId };
  }
  if (pedido.estado === "falhou") {
    if (antigo) return { acao: "desistir" };
    return { acao: "falhou", frase: pedido.motivo || textosPedidos.falhou.roteiro, refeitoDe: pedido.id };
  }

  // Andando: o tempo que já passou vem do servidor (o relógio do aparelho pode estar adiantado ou atrasado).
  const decorrido = Date.parse(pedido.agora) - Date.parse(pedido.iniciadoEm);
  return { acao: "esperar", etapa: pedido.etapa, desdeMs: Number.isFinite(decorrido) ? agora - Math.max(0, decorrido) : null, vistoAndando: true };
}
