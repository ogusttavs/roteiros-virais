/**
 * E22 PR 2: o que as telas da assinatura (`/assinar` e o cartão "Sua assinatura" em Conta) mostram, decidido num lugar só e puro (sem banco, sem relógio de fora) para as duas telas
 * dizerem sempre a mesma coisa. Quem precisa do banco (`assinaturasDaMarca`) lê e passa a lista; aqui só se decide o estado.
 *
 * O acesso em si continua sendo decidido por `assinaturaVale` / `precisaAssinarCom` (`assinatura.ts`): esta função só ESCREVE o estado para a pessoa, nunca libera nem barra nada.
 */
import type { Assinatura, StatusAssinatura } from "@/db/schema";
import { assinaturaPrincipal, assinaturaVale } from "@/servicos/assinatura";

export type TipoDeSituacao =
  /** A marca usa sem cobrança (o admin marcou a cortesia). */
  | "cortesia"
  /** Assinatura que vale e está em dia. */
  | "ativa"
  /** Vale ainda, mas o último pagamento falhou: o Stripe está tentando de novo, e a pessoa pode trocar o cartão. */
  | "atrasada"
  /** Não vale mais por causa do cartão: pagamento que não passou (ou aviso de renovação que não veio). Pede para atualizar o cartão. */
  | "cartao"
  /** Acabou (cancelada pela pessoa ou pelo Stripe). Pede para assinar de novo. */
  | "encerrada"
  /** A pessoa começou o pagamento e o Stripe ainda não confirmou. */
  | "aguardando"
  /** Nunca assinou. */
  | "nunca";

export type SituacaoDaAssinatura = {
  tipo: TipoDeSituacao;
  /** O acesso vale agora (assinatura que vale, ou cortesia). */
  temAcesso: boolean;
  /** O status que o Stripe guarda, para a pessoa ler em português (`null` sem assinatura nenhuma). */
  status: StatusAssinatura | null;
  /** Fim do período já pago (a próxima cobrança, ou o último dia se vai terminar). */
  periodoFim: Date | null;
  /** A pessoa cancelou e a assinatura vale até `periodoFim`, sem renovar. */
  cancelaNoFim: boolean;
  /** Já existe cliente no Stripe (então o portal abre: trocar o cartão, ver as faturas, cancelar). */
  podeAbrirOPortal: boolean;
};

export function situacaoDaAssinatura(cortesia: boolean, lista: Assinatura[], agora: Date = new Date()): SituacaoDaAssinatura {
  const principal = assinaturaPrincipal(lista, agora);
  const base = {
    status: principal?.status ?? null,
    periodoFim: principal?.periodoFim ?? null,
    cancelaNoFim: principal?.cancelaNoFimDoPeriodo ?? false,
    podeAbrirOPortal: lista.length > 0,
  };
  if (cortesia) return { ...base, tipo: "cortesia", temAcesso: true };
  if (!principal) return { ...base, tipo: "nunca", temAcesso: false };

  if (assinaturaVale(principal, agora)) {
    return { ...base, tipo: principal.status === "past_due" ? "atrasada" : "ativa", temAcesso: true };
  }
  switch (principal.status) {
    case "incomplete":
      return { ...base, tipo: "aguardando", temAcesso: false };
    case "past_due":
    case "unpaid":
    case "active":
    case "trialing":
      // Os dois últimos só caem aqui com o período vencido (o aviso de renovação não chegou): do ponto de vista da pessoa, é o cartão que precisa de atenção.
      return { ...base, tipo: "cartao", temAcesso: false };
    default:
      return { ...base, tipo: "encerrada", temAcesso: false };
  }
}
