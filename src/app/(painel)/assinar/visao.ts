/**
 * E22 PR 2: o que cada tela de `/assinar` mostra, decidido em funções puras (sem banco, sem relógio, sem React) para dar para testar com a situação da marca na mão. A página só
 * monta o que estas funções devolvem.
 */
import type { SituacaoDaAssinatura } from "@/servicos/assinatura-tela";
import { textosAssinatura } from "@/textos/assinatura";

import type { BotaoDaAssinatura } from "./BotoesDaAssinatura";

export type Visao = "pitch" | "encerrada" | "testeTerminou" | "cartao" | "atrasada" | "aguardando" | "confirmada" | "ativa" | "teste" | "cortesia";

/**
 * O teste grátis como a tela precisa dele (E22): `dias` e `exigeCartao` vêm da configuração; `oferecer` é verdade só para a marca que ainda pode ganhar o teste (nunca teve assinatura),
 * e só então o convite fala do teste. O padrão é o do produto, sem convite, para quem chama sem se importar com o teste.
 */
export type TesteDaTela = { dias: number; exigeCartao: boolean; oferecer: boolean };
export const TESTE_PADRAO: TesteDaTela = { dias: 7, exigeCartao: false, oferecer: false };

/** A frase do teste em andamento: a data do fim (e da primeira cobrança), ou a do cancelamento, ou a do cartão que falta. */
export function fraseDoTeste(s: Pick<SituacaoDaAssinatura, "periodoFim" | "cancelaNoFim" | "temCartao">, exigeCartao: boolean): string {
  const t = textosAssinatura.teste;
  if (!s.periodoFim) return t.fraseSemData;
  if (s.cancelaNoFim) return t.fraseCancelada(s.periodoFim);
  if (exigeCartao) return t.frase(s.periodoFim);
  return s.temCartao ? t.fraseComCartao(s.periodoFim) : t.fraseSemCartao(s.periodoFim);
}

/** No teste em andamento, já há cartão? Pedido no começo (`exigeCartao`), ou cadastrado depois, no teste sem cartão (o aviso da assinatura diz). */
export function testeTemCartao(s: Pick<SituacaoDaAssinatura, "temCartao">, exigeCartao: boolean): boolean {
  return exigeCartao || s.temCartao;
}

/** Qual das telas mostrar: a situação da marca, mais o fato de a pessoa ter acabado de voltar do pagamento (`?assinou=1`). */
export function visaoDaTela(situacao: SituacaoDaAssinatura, voltouDoPagamento: boolean, assinouAgora: boolean = false): Visao {
  if (situacao.tipo === "cortesia") return "cortesia";
  // Assinou no meio do teste: enquanto o aviso do pagamento não chega, a marca ainda aparece como teste, e a tela não pode dizer que o teste "começou".
  if (voltouDoPagamento && assinouAgora && situacao.tipo === "teste") return "aguardando";
  if (voltouDoPagamento) return situacao.tipo === "ativa" || situacao.tipo === "teste" ? "confirmada" : "aguardando";
  if (situacao.tipo === "ativa") return "ativa";
  if (situacao.tipo === "teste") return "teste";
  if (situacao.tipo === "atrasada") return "atrasada";
  if (situacao.tipo === "cartao") return "cartao";
  if (situacao.tipo === "encerrada") return "encerrada";
  if (situacao.tipo === "testeTerminou") return "testeTerminou";
  // `nunca`, e `incomplete` sem ter voltado do pagamento (abandonou no meio): volta ao convite, e a sessão aberta do Stripe é reaproveitada.
  return "pitch";
}

/** Os botões de cada tela, na ordem em que aparecem (antes de tirar os que a pessoa não pode usar). */
export function botoesDaTela(visao: Visao, teste: TesteDaTela = TESTE_PADRAO, temCartao: boolean = false): BotaoDaAssinatura[] {
  const b = textosAssinatura.botoes;
  switch (visao) {
    case "pitch":
      return [{ acao: "assinar", rotulo: teste.oferecer ? textosAssinatura.teste.botao(teste.dias) : b.assinar, variante: "primario" }];
    case "encerrada":
      return [{ acao: "assinar", rotulo: b.assinarDeNovo, variante: "primario" }];
    case "testeTerminou":
      // O preço e o período do botão vêm da configuração do plano.
      return [{ acao: "assinar", rotulo: b.assinar, variante: "primario" }];
    case "cartao":
      return [{ acao: "portal", rotulo: b.atualizarCartao, variante: "primario" }];
    case "atrasada":
      return [
        { acao: "portal", rotulo: b.atualizarCartao, variante: "primario" },
        { acao: "hoje", rotulo: b.irParaHoje, variante: "secundario" },
      ];
    case "confirmada":
      return [{ acao: "hoje", rotulo: b.irParaHoje, variante: "primario" }];
    case "teste":
      // Sem cartão, o que a pessoa precisa fazer antes do fim é cadastrá-lo: o botão principal abre o portal para isso. Com cartão (pedido no começo ou já cadastrado), está tudo certo.
      // O botão de assinar agora vem primeiro: encerra o teste e cobra hoje (sem cartão, leva a cadastrá-lo antes).
      return testeTemCartao({ temCartao }, teste.exigeCartao)
        ? [
            { acao: "assinarAgora", rotulo: b.assinarAgora, variante: "primario" },
            { acao: "hoje", rotulo: b.irParaHoje, variante: "secundario" },
            { acao: "portal", rotulo: b.gerenciar, variante: "secundario" },
          ]
        : [
            { acao: "assinarAgora", rotulo: b.assinarAgora, variante: "primario" },
            { acao: "portal", rotulo: b.cadastrarCartao, variante: "secundario" },
            { acao: "hoje", rotulo: b.irParaHoje, variante: "secundario" },
          ];
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
  return b.acao === "assinar" || b.acao === "portal" || b.acao === "assinarAgora";
}

/** O título e as frases embaixo dele. */
export function textosDaTela(visao: Visao, s: SituacaoDaAssinatura, teste: TesteDaTela = TESTE_PADRAO): { titulo: string; frases: string[] } {
  const t = textosAssinatura.situacoes;
  const d = textosAssinatura.datas;
  const dataDoPeriodo = s.periodoFim ? (s.cancelaNoFim ? d.terminaEm(s.periodoFim) : d.renova(s.periodoFim)) : null;
  switch (visao) {
    case "pitch":
      return teste.oferecer
        ? { titulo: textosAssinatura.teste.convite.titulo(teste.dias), frases: [textosAssinatura.teste.convite.frase(teste.dias)] }
        : { titulo: t.nunca.titulo, frases: [t.nunca.frase] };
    case "encerrada":
      return { titulo: t.encerrada.titulo, frases: [s.periodoFim ? t.encerrada.fraseComData(s.periodoFim) : t.encerrada.frase] };
    case "testeTerminou":
      return { titulo: t.testeTerminou.titulo, frases: [t.testeTerminou.frase] };
    case "cartao":
      return { titulo: t.cartao.titulo, frases: [t.cartao.frase] };
    case "atrasada":
      return { titulo: t.atrasada.titulo, frases: [t.atrasada.frase, ...(dataDoPeriodo ? [dataDoPeriodo] : [])] };
    case "aguardando":
      return { titulo: t.aguardando.titulo, frases: [] };
    case "confirmada":
      return s.tipo === "teste"
        ? { titulo: textosAssinatura.teste.confirmada.titulo, frases: [fraseDoTeste(s, teste.exigeCartao)] }
        : { titulo: t.confirmada.titulo, frases: [t.confirmada.frase(s.periodoFim)] };
    case "teste":
      return { titulo: textosAssinatura.teste.titulo, frases: [fraseDoTeste(s, teste.exigeCartao)] };
    case "ativa":
      return { titulo: t.ativa.titulo, frases: dataDoPeriodo ? [dataDoPeriodo] : [] };
    case "cortesia":
      return { titulo: t.cortesia.titulo, frases: [t.cortesia.frase] };
  }
}

/** O cartão "Sua assinatura" em Conta: a linha de situação, a data e os botões (antes de tirar os que a pessoa não pode usar). */
export function cartaoDaConta(s: SituacaoDaAssinatura, exigeCartao: boolean = TESTE_PADRAO.exigeCartao): { situacao: string; data: string | null; botoes: BotaoDaAssinatura[] } {
  const t = textosAssinatura;
  const d = t.datas;
  const dataDoPeriodo = s.periodoFim ? (s.cancelaNoFim ? d.terminaEm(s.periodoFim) : d.renova(s.periodoFim)) : null;
  const plano: BotaoDaAssinatura = { acao: "plano", rotulo: t.conta.verPlano, variante: "primario" };
  const cartao: BotaoDaAssinatura = { acao: "portal", rotulo: t.botoes.atualizarCartao, variante: "primario" };
  const gerenciar: BotaoDaAssinatura = { acao: "portal", rotulo: t.botoes.gerenciar, variante: "secundario" };
  const cadastrar: BotaoDaAssinatura = { acao: "portal", rotulo: t.botoes.cadastrarCartao, variante: "primario" };
  const rotuloDoStatus = s.status ? t.status[s.status] : null;
  switch (s.tipo) {
    case "cortesia":
      return { situacao: t.situacoes.cortesia.titulo, data: null, botoes: [] };
    case "ativa":
      return { situacao: rotuloDoStatus ?? t.status.active, data: dataDoPeriodo, botoes: [gerenciar] };
    case "teste":
      return { situacao: rotuloDoStatus ?? t.status.trialing, data: fraseDoTeste(s, exigeCartao), botoes: [testeTemCartao(s, exigeCartao) ? gerenciar : cadastrar] };
    case "atrasada":
      return { situacao: rotuloDoStatus ?? t.status.past_due, data: dataDoPeriodo, botoes: [cartao] };
    case "cartao":
      return { situacao: rotuloDoStatus ?? t.status.unpaid, data: null, botoes: [cartao] };
    case "aguardando":
      return { situacao: t.situacoes.aguardando.titulo, data: null, botoes: [plano] };
    case "encerrada":
      return { situacao: rotuloDoStatus ?? t.status.canceled, data: s.periodoFim ? d.paga(s.periodoFim) : null, botoes: [plano] };
    case "testeTerminou":
      // Quem nunca pagou não lê "Cancelada" nem "Pago até".
      return { situacao: t.conta.testeTerminou, data: null, botoes: [plano] };
    case "nunca":
      return { situacao: t.conta.semAssinatura, data: null, botoes: [plano] };
  }
}
