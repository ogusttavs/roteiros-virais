/**
 * E22 PR 2: o que cada tela de `/assinar` mostra, decidido em funções puras (sem banco, sem relógio, sem React) para dar para testar com a situação da marca na mão. A página só
 * monta o que estas funções devolvem.
 */
import type { SituacaoDaAssinatura } from "@/servicos/assinatura-tela";
import { textosAssinatura } from "@/textos/assinatura";

import type { BotaoDaAssinatura } from "./BotoesDaAssinatura";

export type Visao = "pitch" | "encerrada" | "cartao" | "atrasada" | "aguardando" | "confirmada" | "ativa" | "cortesia";

/** Qual das telas mostrar: a situação da marca, mais o fato de a pessoa ter acabado de voltar do pagamento (`?assinou=1`). */
export function visaoDaTela(situacao: SituacaoDaAssinatura, voltouDoPagamento: boolean): Visao {
  if (situacao.tipo === "cortesia") return "cortesia";
  if (voltouDoPagamento) return situacao.tipo === "ativa" ? "confirmada" : "aguardando";
  if (situacao.tipo === "ativa") return "ativa";
  if (situacao.tipo === "atrasada") return "atrasada";
  if (situacao.tipo === "cartao") return "cartao";
  if (situacao.tipo === "encerrada") return "encerrada";
  // `nunca`, e `incomplete` sem ter voltado do pagamento (abandonou no meio): volta ao convite, e a sessão aberta do Stripe é reaproveitada.
  return "pitch";
}

/** Os botões de cada tela, na ordem em que aparecem (antes de tirar os que a pessoa não pode usar). */
export function botoesDaTela(visao: Visao): BotaoDaAssinatura[] {
  const b = textosAssinatura.botoes;
  switch (visao) {
    case "pitch":
      return [{ acao: "assinar", rotulo: b.assinar, variante: "primario" }];
    case "encerrada":
      return [{ acao: "assinar", rotulo: b.assinarDeNovo, variante: "primario" }];
    case "cartao":
      return [{ acao: "portal", rotulo: b.atualizarCartao, variante: "primario" }];
    case "atrasada":
      return [
        { acao: "portal", rotulo: b.atualizarCartao, variante: "primario" },
        { acao: "hoje", rotulo: b.irParaHoje, variante: "secundario" },
      ];
    case "confirmada":
      return [{ acao: "hoje", rotulo: b.irParaHoje, variante: "primario" }];
    case "ativa":
      return [
        { acao: "hoje", rotulo: b.irParaHoje, variante: "primario" },
        { acao: "portal", rotulo: b.gerenciar, variante: "secundario" },
      ];
    case "cortesia":
      return [{ acao: "hoje", rotulo: b.irParaHoje, variante: "primario" }];
    case "aguardando":
      return [];
  }
}

/** O botão mexe em dinheiro ou em dado do Stripe? Só o dono da marca (e nunca o "ver como") os vê. */
export function botaoEhDoDono(b: BotaoDaAssinatura): boolean {
  return b.acao === "assinar" || b.acao === "portal";
}

/** O título e as frases embaixo dele. */
export function textosDaTela(visao: Visao, s: SituacaoDaAssinatura): { titulo: string; frases: string[] } {
  const t = textosAssinatura.situacoes;
  const d = textosAssinatura.datas;
  const dataDoPeriodo = s.periodoFim ? (s.cancelaNoFim ? d.terminaEm(s.periodoFim) : d.renova(s.periodoFim)) : null;
  switch (visao) {
    case "pitch":
      return { titulo: t.nunca.titulo, frases: [t.nunca.frase] };
    case "encerrada":
      return { titulo: t.encerrada.titulo, frases: [s.periodoFim ? t.encerrada.fraseComData(s.periodoFim) : t.encerrada.frase] };
    case "cartao":
      return { titulo: t.cartao.titulo, frases: [t.cartao.frase] };
    case "atrasada":
      return { titulo: t.atrasada.titulo, frases: [t.atrasada.frase, ...(dataDoPeriodo ? [dataDoPeriodo] : [])] };
    case "aguardando":
      return { titulo: t.aguardando.titulo, frases: [] };
    case "confirmada":
      return { titulo: t.confirmada.titulo, frases: [t.confirmada.frase(s.periodoFim)] };
    case "ativa":
      return { titulo: t.ativa.titulo, frases: dataDoPeriodo ? [dataDoPeriodo] : [] };
    case "cortesia":
      return { titulo: t.cortesia.titulo, frases: [t.cortesia.frase] };
  }
}

/** O cartão "Sua assinatura" em Conta: a linha de situação, a data e os botões (antes de tirar os que a pessoa não pode usar). */
export function cartaoDaConta(s: SituacaoDaAssinatura): { situacao: string; data: string | null; botoes: BotaoDaAssinatura[] } {
  const t = textosAssinatura;
  const d = t.datas;
  const dataDoPeriodo = s.periodoFim ? (s.cancelaNoFim ? d.terminaEm(s.periodoFim) : d.renova(s.periodoFim)) : null;
  const plano: BotaoDaAssinatura = { acao: "plano", rotulo: t.conta.verPlano, variante: "primario" };
  const cartao: BotaoDaAssinatura = { acao: "portal", rotulo: t.botoes.atualizarCartao, variante: "primario" };
  const gerenciar: BotaoDaAssinatura = { acao: "portal", rotulo: t.botoes.gerenciar, variante: "secundario" };
  const rotuloDoStatus = s.status ? t.status[s.status] : null;
  switch (s.tipo) {
    case "cortesia":
      return { situacao: t.situacoes.cortesia.titulo, data: null, botoes: [] };
    case "ativa":
      return { situacao: rotuloDoStatus ?? t.status.active, data: dataDoPeriodo, botoes: [gerenciar] };
    case "atrasada":
      return { situacao: rotuloDoStatus ?? t.status.past_due, data: dataDoPeriodo, botoes: [cartao] };
    case "cartao":
      return { situacao: rotuloDoStatus ?? t.status.unpaid, data: null, botoes: [cartao] };
    case "aguardando":
      return { situacao: t.situacoes.aguardando.titulo, data: null, botoes: [plano] };
    case "encerrada":
      return { situacao: rotuloDoStatus ?? t.status.canceled, data: s.periodoFim ? d.paga(s.periodoFim) : null, botoes: [plano] };
    case "nunca":
      return { situacao: t.conta.semAssinatura, data: null, botoes: [plano] };
  }
}
