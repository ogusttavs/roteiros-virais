"use client";

import { sistemaDeInstalacao } from "@/lib/convite-instalar";
import { reinscreverAvisoSeFaltar } from "@/ui/push";

import { apagarInscricaoPushAction, inscricaoRegistradaAction, registrarFalhaDePushAction, registrarInscricaoPushAction } from "./push-acoes";

/** Uma conferência por vez: o painel e o cartão da Conta pedem a mesma coisa ao abrir, e duas inscrições novas ao mesmo tempo se pisariam. */
let emAndamento: Promise<void> | null = null;
let terminouEm = 0;
const INTERVALO_MINIMO_MS = 60_000;

/**
 * A inscrição de push que morria em silêncio: o aparelho que tem permissão e inscrição confere se a inscrição é da chave de hoje e se o servidor ainda a guarda; se
 * não, reinscreve sozinho, sem perguntar. Nunca lança. Se não conseguir, o motivo vai ao log (o admin vê, com o passo) e a Conta passa a dizer que o aviso parou de chegar.
 */
export function conferirAviso(chavePublica: string): Promise<void> {
  if (emAndamento) return emAndamento;
  if (Date.now() - terminouEm < INTERVALO_MINIMO_MS) return Promise.resolve();
  emAndamento = (async () => {
    const resultado = await reinscreverAvisoSeFaltar(chavePublica, (endpoint) => inscricaoRegistradaAction(endpoint).catch(() => true));
    if (resultado.tipo === "nada" || resultado.tipo === "negado") return;
    const sistema = sistemaDeInstalacao(navigator.userAgent);
    if (resultado.tipo === "erro") {
      void registrarFalhaDePushAction(resultado.motivo, `reinscrever:${resultado.etapa}`, sistema).catch(() => undefined);
      return;
    }
    const guardou = await registrarInscricaoPushAction(resultado.inscricao, sistema).catch(() => false);
    if (!guardou) {
      void registrarFalhaDePushAction("o servidor recusou a nova inscrição", "reinscrever:servidor", sistema).catch(() => undefined);
      return;
    }
    if (resultado.endpointAntigo && resultado.endpointAntigo !== resultado.inscricao.endpoint) void apagarInscricaoPushAction(resultado.endpointAntigo).catch(() => undefined);
  })()
    .catch(() => undefined)
    .finally(() => {
      emAndamento = null;
      terminouEm = Date.now();
    });
  return emAndamento;
}
