"use server";

import { ehFicha } from "@/config/fichas";
import type { Objetivo } from "@/db/schema";
import { ErroIA } from "@/ia/erro";
import { type ResultadoAcao } from "@/lib/resultado-acao";
import { exigirForaDoVerComo, recusaDoVerComo, sessaoDoPainel } from "@/lib/ver-como";
import { ErroAcessoNegado, clienteDaSessaoAtual, garantirMembroDaMarca } from "@/servicos/clientes";
import { lerMomentoDeTexto, type CamposMomento } from "@/servicos/momento";
import {
  ErroRoteiro,
  gerarRoteiro,
  validarData,
  validarEstilo,
  validarFormato,
  validarMomentoDoDia,
  validarObjetivo,
  validarQuemAparece,
} from "@/servicos/roteiro";

/**
 * V9b, item 1: o caminho por áudio da folha agora passa por aqui depois de
 * `/api/momento/transcrever` devolver o texto (a rota deixou de separar em
 * campos, "mesma rota" reaproveitada pela agenda). Sessão só para não
 * gastar a tarefa barata sem ninguém logado; o resultado não depende de
 * marca nenhuma.
 */
export async function lerMomentoDeTextoAction(texto: string): Promise<CamposMomento> {
  await exigirForaDoVerComo();
  const sessao = await sessaoDoPainel();
  if (!sessao) {
    throw new ErroAcessoNegado("E preciso entrar de novo.");
  }
  return lerMomentoDeTexto(texto);
}

export type DadosMomento = {
  onde: string;
  oQueEstaAcontecendo: string;
  oQueDaParaMostrar: string;
  objetivo: Objetivo;
  /** E49 PR 1: a ficha das cinco (só Reels); decide o objetivo que se grava. Texto livre do navegador, conferido por `ehFicha`. */
  ficha?: string;
  /** V9a, item 4: "Falar de", só quando a pessoa é membro de mais de uma marca e escolheu uma diferente da ativa. */
  marcaId?: number;
  /** A fala inteira, só no caminho por áudio (o bloco "o que você disse"). */
  transcricao?: string;
  /**
   * V9c, item 1: o que a pessoa escolheu no controle segmentado da folha; reels se ausente. Chega
   * como texto livre do navegador (V9d, item 2): `validarFormato` confere antes de chegar ao banco.
   */
  formato?: string;
  /** M4, item 2: o segundo controle segmentado da folha (Falando/Sem fala); falado se ausente. */
  estilo?: string;
  /** E40, item 2: "o que este vídeo precisa comunicar?", campo opcional e curto da folha. */
  objetivoDoVideo?: string;
  /** V12c, item 3, a E37b: troca só deste vídeo; chega como texto livre, `validarQuemAparece` confere. */
  quemAparece?: string;
  /** E39a: "para quando é?", ISO; sem valor, hoje. */
  data?: string;
  /** E39a: "em que momento do dia?", só quando o formato é Story. */
  momentoDoDia?: string;
};

function textoObrigatorio(valor: string): string {
  return valor.trim();
}

/**
 * "Escrever o roteiro" da folha "Gravar agora" (V9a, item 1 e item 4): a
 * marca sempre vem da sessão (`clienteDaSessaoAtual`, nunca de um parâmetro,
 * mesmo padrão do resto do painel); a marca citada é conferida antes de
 * gastar uma geração com ela (`garantirMembroDaMarca`, isolamento entre
 * marcas). `origem: "momento"` faz `gerarRoteiro` pular a busca de
 * evidência (`servicos/roteiro.ts`).
 *
 * R1, item 0c: `ErroIA.mensagemCliente` e `ErroRoteiro.message` vêm como resultado, não
 * lançados; sessão ausente continua lançando `ErroAcessoNegado` (raro, pede entrar de novo).
 */
export async function gerarRoteiroMomentoAction(dados: DadosMomento): Promise<ResultadoAcao<{ id: number }>> {
  const recusaVerComo = await recusaDoVerComo();
  if (recusaVerComo) return { ok: false, erro: recusaVerComo };
  const sessao = await sessaoDoPainel();
  if (!sessao) {
    throw new ErroAcessoNegado("E preciso entrar de novo.");
  }

  try {
    const onde = textoObrigatorio(dados.onde);
    const oQueEstaAcontecendo = textoObrigatorio(dados.oQueEstaAcontecendo);
    const oQueDaParaMostrar = textoObrigatorio(dados.oQueDaParaMostrar);
    if (!onde || !oQueEstaAcontecendo || !oQueDaParaMostrar) {
      throw new ErroRoteiro("conte onde voce esta, o que esta acontecendo e o que da para mostrar.");
    }

    if (dados.marcaId !== undefined) {
      await garantirMembroDaMarca(sessao.user.id, dados.marcaId);
    }

    const cliente = await clienteDaSessaoAtual();
    const roteiro = await gerarRoteiro(cliente.id, {
      origem: "momento",
      momento: {
        onde,
        oQueEstaAcontecendo,
        oQueDaParaMostrar,
        marcaId: dados.marcaId,
        transcricao: dados.transcricao?.trim() || undefined,
        objetivoDoVideo: dados.objetivoDoVideo?.trim() || undefined,
      },
      // Texto livre do navegador: um dos três, ou recusa antes de gastar uma geração (`validarObjetivo`).
      objetivo: validarObjetivo(dados.objetivo),
      ficha: ehFicha(dados.ficha) ? dados.ficha : undefined,
      formato: validarFormato(dados.formato),
      estilo: validarEstilo(dados.estilo),
      quemAparece: validarQuemAparece(dados.quemAparece),
      data: validarData(dados.data),
      momentoDoDia: validarMomentoDoDia(dados.momentoDoDia),
    });

    return { ok: true, dado: { id: roteiro.id } };
  } catch (falha) {
    if (falha instanceof ErroIA) return { ok: false, erro: falha.mensagemCliente };
    if (falha instanceof ErroRoteiro) return { ok: false, erro: falha.message };
    throw falha;
  }
}
