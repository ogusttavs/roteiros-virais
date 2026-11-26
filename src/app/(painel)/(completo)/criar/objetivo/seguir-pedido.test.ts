/**
 * E74 PR 2a (R-a, R-c): o que a tela de espera do objetivo faz com cada resposta do pedido. A regra do achado do Fable de 26/11: perder a resposta da escrita nunca vira "a conexão caiu" com
 * "Tentar de novo"; só o servidor diz que falhou, e o pedido que o servidor nunca viu vai de novo com o MESMO id.
 */
import { describe, expect, it } from "vitest";

import type { PedidoNaTela } from "@/servicos/pedidos-estado";
import { textosObjetivo } from "@/textos/objetivo";
import { textosPedidos } from "@/textos/pedidos";

import { ESPERA_COM_PEDIDO_MS, GRACA_DO_PEDIDO_MS } from "./espera-guardada";
import { decidirSobreOPedido, type PedidoSeguido, type PorQueSegue } from "./seguir-pedido";

const ID = "6f1c2a8e-3b4d-4e5f-9a6b-7c8d9e0f1a2b";
const DESDE = 1_000_000;

function seguido(porque: PorQueSegue, vistoAndando = false): PedidoSeguido {
  return { pedidoId: ID, desde: DESDE, porque, vistoAndando };
}

function pedido(campos: Partial<PedidoNaTela> & { agora?: string }): PedidoNaTela & { agora: string } {
  return {
    id: ID,
    tipo: "roteiro",
    titulo: "mancha de vinho no sofa",
    estado: "escrevendo",
    etapa: "Etapa 2 de 3: escrevendo a versão 1 de 3",
    etapaN: 2,
    etapaTotal: 3,
    iniciadoEm: "2026-11-26T12:00:00.000Z",
    tipicoDeS: 30,
    tipicoAteS: 120,
    progresso: null,
    resultadoTipo: "versoes",
    resultadoId: "grupo-1",
    motivo: null,
    agora: "2026-11-26T12:00:40.000Z",
    ...campos,
  };
}

const naoExiste = { status: 404, pedido: null };
const TODOS: PorQueSegue[] = ["enviando", "rede", "outra", "repetido", "servidor"];

describe("seguir o pedido pelo id (E74 PR 2a)", () => {
  it("enquanto a escrita não respondeu, o pedido que ainda não existe é só atraso: nunca 'não chegou'", () => {
    for (const passou of [0, GRACA_DO_PEDIDO_MS + 1, ESPERA_COM_PEDIDO_MS + 1]) {
      expect(decidirSobreOPedido(seguido("enviando"), naoExiste, DESDE + passou).acao).toBe("esperar");
    }
  });

  it("depois de a rede cair, o pedido que o servidor não conhece ainda pode estar chegando; passada a graça, nunca chegou e vai de novo com o mesmo id", () => {
    expect(decidirSobreOPedido(seguido("rede"), naoExiste, DESDE + GRACA_DO_PEDIDO_MS - 1).acao).toBe("esperar");
    expect(decidirSobreOPedido(seguido("rede"), naoExiste, DESDE + GRACA_DO_PEDIDO_MS)).toEqual({ acao: "nao-chegou", frase: textosPedidos.naoChegou, mesmoId: ID });
  });

  it("um erro que não é de rede já foi a resposta do servidor: pedido que não existe nunca nasceu (a frase de sempre, e o mesmo id, que é seguro)", () => {
    expect(decidirSobreOPedido(seguido("outra"), naoExiste, DESDE)).toEqual({ acao: "nao-chegou", frase: textosObjetivo.erro, mesmoId: ID });
  });

  it("o pedido que a página disse andar e que não existe mais: volta ao formulário, sem erro", () => {
    expect(decidirSobreOPedido(seguido("servidor"), naoExiste, DESDE)).toEqual({ acao: "desistir" });
  });

  it("andando: continua na espera, com a etapa do servidor e o tempo contado pelo relógio dele", () => {
    const d = decidirSobreOPedido(seguido("rede"), { status: 200, pedido: pedido({}) }, DESDE + 5_000);
    // O servidor diz que começou há 40 s; o aparelho conta a partir de 40 s antes de agora, não do que ele guardou.
    expect(d).toEqual({ acao: "esperar", etapa: "Etapa 2 de 3: escrevendo a versão 1 de 3", desdeMs: DESDE + 5_000 - 40_000, vistoAndando: true });
  });

  it("pronto: abre as versões do PRÓPRIO pedido", () => {
    for (const porque of ["enviando", "rede", "outra", "repetido"] as const) {
      expect(decidirSobreOPedido(seguido(porque), { status: 200, pedido: pedido({ estado: "pronto", resultadoId: "grupo-do-pedido" }) }, DESDE)).toEqual({ acao: "abrir", grupo: "grupo-do-pedido" });
    }
  });

  it("o pedido que a página disse andar, já pronto ou falho na primeira olhada (a página guardada pelo voltar): não puxa a pessoa de volta", () => {
    expect(decidirSobreOPedido(seguido("servidor"), { status: 200, pedido: pedido({ estado: "pronto" }) }, DESDE)).toEqual({ acao: "desistir" });
    expect(decidirSobreOPedido(seguido("servidor"), { status: 200, pedido: pedido({ estado: "falhou", motivo: "x" }) }, DESDE)).toEqual({ acao: "desistir" });
    // visto andando nesta tela, depois pronto: abre
    expect(decidirSobreOPedido(seguido("servidor", true), { status: 200, pedido: pedido({ estado: "pronto" }) }, DESDE)).toEqual({ acao: "abrir", grupo: "grupo-1" });
  });

  it("só o servidor diz que falhou: a frase dele, e o próximo pedido refaz este", () => {
    const motivo = textosPedidos.falhou.roteiro;
    expect(decidirSobreOPedido(seguido("rede"), { status: 200, pedido: pedido({ estado: "falhou", motivo }) }, DESDE)).toEqual({ acao: "falhou", frase: motivo, refeitoDe: ID });
    expect(decidirSobreOPedido(seguido("enviando"), { status: 200, pedido: pedido({ estado: "falhou", motivo: null }) }, DESDE)).toEqual({ acao: "falhou", frase: motivo, refeitoDe: ID });
  });

  it("sem sessão, sem assinatura ou o servidor fora agora: segue esperando, e só desiste depois da espera com pedido", () => {
    for (const status of [401, 402, 500, 502]) {
      expect(decidirSobreOPedido(seguido("rede"), { status, pedido: null }, DESDE + ESPERA_COM_PEDIDO_MS).acao).toBe("esperar");
      expect(decidirSobreOPedido(seguido("rede"), { status, pedido: null }, DESDE + ESPERA_COM_PEDIDO_MS + 1)).toEqual({ acao: "desistir" });
    }
  });

  it("nenhuma resposta vira 'a conexão caiu no meio' (a frase que oferecia pagar de novo)", () => {
    const respostas = [naoExiste, { status: 500, pedido: null }, ...["escrevendo", "pronto", "falhou", "conferindo"].map((estado) => ({ status: 200, pedido: pedido({ estado }) }))];
    for (const porque of TODOS) {
      for (const resposta of respostas) {
        for (const passou of [0, GRACA_DO_PEDIDO_MS, ESPERA_COM_PEDIDO_MS + 1]) {
          const d = decidirSobreOPedido(seguido(porque), resposta, DESDE + passou);
          if ("frase" in d) expect(d.frase).not.toBe(textosObjetivo.conexaoCaiuNoMeio);
        }
      }
    }
  });
});
