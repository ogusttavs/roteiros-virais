"use server";

import { ehFicha } from "@/config/fichas";
import type { Objetivo } from "@/db/schema";
import { ErroIA } from "@/ia/erro";
import { hojeISO } from "@/lib/config";
import { type ResultadoAcao } from "@/lib/resultado-acao";
import { exigirForaDoVerComo, recusaDoVerComo, sessaoDoPainel } from "@/lib/ver-como";
import { ErroAcessoNegado, clienteDaSessaoAtual, garantirMembroDaMarca } from "@/servicos/clientes";
import {
  aceitar,
  criarPlano,
  lerAgendaDeTexto,
  pular,
  removerPlano,
  type DiaAgenda,
  type ItemPlano,
  type ResultadoLerAgenda,
} from "@/servicos/plano";
import { ErroRoteiro, validarEstilo, validarFormato, validarMomentoDoDia, validarObjetivo, validarQuemAparece } from "@/servicos/roteiro";

/**
 * "Colar a agenda" (V9b, item 1): separa o texto (digitado ou transcrito
 * pela mesma rota do momento) em dias, com a data de cada um já resolvida
 * por código. A pessoa confere a lista antes de confirmar (`criarPlanoAction`).
 * V9d, item 4: `diasNaoEntendidos` vai junto, para a folha mostrar "não
 * entendi este dia" em vez de descartar em silêncio.
 */
export async function lerAgendaAction(texto: string): Promise<ResultadoLerAgenda> {
  await exigirForaDoVerComo();
  const sessao = await sessaoDoPainel();
  if (!sessao) {
    throw new ErroAcessoNegado("E preciso entrar de novo.");
  }
  return lerAgendaDeTexto(texto);
}

/**
 * Confirma a lista revisada e cria o plano (item 2): a marca sempre vem da
 * sessão, nunca de um parâmetro, mesmo padrão do resto do painel.
 */
export async function criarPlanoAction(dias: DiaAgenda[]): Promise<ItemPlano[]> {
  await exigirForaDoVerComo();
  const sessao = await sessaoDoPainel();
  if (!sessao) {
    throw new ErroAcessoNegado("E preciso entrar de novo.");
  }
  const cliente = await clienteDaSessaoAtual();
  return criarPlano(cliente, dias);
}

export type DadosAceitarPlano = {
  onde: string;
  oQueEstaAcontecendo: string;
  oQueDaParaMostrar: string;
  objetivo: Objetivo;
  /** E49 PR 1: a ficha das cinco (só Reels), texto livre do navegador conferido por `ehFicha`. */
  ficha?: string;
  /**
   * V9c, item 1: o que a pessoa escolheu no controle segmentado da folha; reels se ausente. Chega
   * como texto livre do navegador (V9d, item 2): `validarFormato` confere antes de chegar ao banco.
   */
  formato?: string;
  /** M4, item 2: o que a pessoa escolheu no segundo controle segmentado da folha; falado se ausente. */
  estilo?: string;
  marcaId?: number;
  /** E40, item 2: "o que este vídeo precisa comunicar?", campo opcional e curto da folha. */
  objetivoDoVideo?: string;
  /** V12c, item 3, a E37b: troca só deste vídeo; chega como texto livre, `validarQuemAparece` confere. */
  quemAparece?: string;
  /** E39a: "em que momento do dia?", só quando o formato é Story; o dia em si já vem do item do plano. */
  momentoDoDia?: string;
};

/**
 * "Escrever o roteiro" num item do plano (item 3): a folha "Gravar agora"
 * pré-preenchida pode ter sido editada, então os campos vêm da folha, não
 * direto do que `planejarDia` sugeriu. Confere `garantirMembroDaMarca`
 * antes de gerar, mesmo isolamento do momento (V9a, item 4).
 *
 * R1, item 0c: `ErroIA.mensagemCliente` e `ErroRoteiro.message` vêm como resultado, não
 * lançados; sessão ausente continua lançando `ErroAcessoNegado` (raro, pede entrar de novo).
 */
export async function aceitarPlanoAction(
  itemId: number,
  dados: DadosAceitarPlano,
): Promise<ResultadoAcao<{ id: number }>> {
  const recusaVerComo = await recusaDoVerComo();
  if (recusaVerComo) return { ok: false, erro: recusaVerComo };
  const sessao = await sessaoDoPainel();
  if (!sessao) {
    throw new ErroAcessoNegado("E preciso entrar de novo.");
  }

  try {
    const onde = dados.onde.trim();
    const oQueEstaAcontecendo = dados.oQueEstaAcontecendo.trim();
    const oQueDaParaMostrar = dados.oQueDaParaMostrar.trim();
    if (!onde || !oQueEstaAcontecendo || !oQueDaParaMostrar) {
      throw new ErroRoteiro("conte onde voce esta, o que esta acontecendo e o que da para mostrar.");
    }

    if (dados.marcaId !== undefined) {
      await garantirMembroDaMarca(sessao.user.id, dados.marcaId);
    }

    const cliente = await clienteDaSessaoAtual();
    const roteiro = await aceitar(itemId, cliente, {
      onde,
      oQueEstaAcontecendo,
      oQueDaParaMostrar,
      // Texto livre do navegador: um dos três, ou recusa antes de gastar uma geração (`validarObjetivo`).
      objetivo: validarObjetivo(dados.objetivo),
      ficha: ehFicha(dados.ficha) ? dados.ficha : undefined,
      formato: validarFormato(dados.formato),
      estilo: validarEstilo(dados.estilo),
      marcaId: dados.marcaId,
      objetivoDoVideo: dados.objetivoDoVideo,
      quemAparece: validarQuemAparece(dados.quemAparece),
      momentoDoDia: validarMomentoDoDia(dados.momentoDoDia),
    });
    return { ok: true, dado: { id: roteiro.id } };
  } catch (falha) {
    if (falha instanceof ErroIA) return { ok: false, erro: falha.mensagemCliente };
    if (falha instanceof ErroRoteiro) return { ok: false, erro: falha.message };
    throw falha;
  }
}

/** "Pular" um item do plano (item 3): some do bloco, sem gerar roteiro. */
export async function pularPlanoAction(itemId: number): Promise<void> {
  await exigirForaDoVerComo();
  const sessao = await sessaoDoPainel();
  if (!sessao) {
    throw new ErroAcessoNegado("E preciso entrar de novo.");
  }
  const cliente = await clienteDaSessaoAtual();
  await pular(itemId, cliente.id);
}

/** "Tirar este plano" (V12, item 4b): apaga os próximos dias ainda não aceitos; os já aceitos continuam. */
export async function removerPlanoAction(): Promise<void> {
  await exigirForaDoVerComo();
  const sessao = await sessaoDoPainel();
  if (!sessao) {
    throw new ErroAcessoNegado("E preciso entrar de novo.");
  }
  const cliente = await clienteDaSessaoAtual();
  await removerPlano(cliente.id, hojeISO());
}
