import { envolverEmail } from "./casca-email";

/**
 * Os e-mails curtos ao admin quando a cobrança de uma marca muda (revisão de 23/11/2026, M5): o teste começou, a assinatura nova foi paga, a pessoa cancelou, o cartão foi recusado. Só o
 * nome do negócio e o que aconteceu, nunca dado de cartão. Texto interno (só o admin lê), mas as regras do projeto valem do mesmo jeito: sem travessão, sem emoji.
 */

export type EventoDeCobranca = {
  tipo: "teste-comecou" | "assinatura-paga" | "cancelamento" | "cancelamento-agendado" | "cartao-recusado";
  /** O nome do negócio vem da pessoa: nunca entra no HTML sem escapar. */
  nomeDaMarca: string;
};

function escaparHtml(texto: string): string {
  return texto.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const FRASE: Record<EventoDeCobranca["tipo"], { assunto: string; corpo: string }> = {
  "teste-comecou": { assunto: "Teste grátis começou", corpo: "começou o teste grátis." },
  "assinatura-paga": { assunto: "Assinatura nova paga", corpo: "pagou a assinatura." },
  cancelamento: { assunto: "Assinatura cancelada", corpo: "teve a assinatura cancelada." },
  "cancelamento-agendado": { assunto: "Pediu para cancelar", corpo: "pediu para cancelar: a assinatura vale até o fim do período já pago e não renova." },
  "cartao-recusado": { assunto: "Cartão recusado", corpo: "teve o cartão recusado. O Stripe tenta de novo, e a pessoa pode atualizar o cartão." },
};

export const textosAvisoDeCobranca = {
  assunto: (e: EventoDeCobranca) => `${FRASE[e.tipo].assunto}: ${e.nomeDaMarca}`,
  corpo: (e: EventoDeCobranca, enderecoDoAdmin: string) =>
    envolverEmail(`<p><strong>${escaparHtml(e.nomeDaMarca)}</strong> ${FRASE[e.tipo].corpo}</p><p><a href="${enderecoDoAdmin}">Abrir o admin</a></p>`),
};
