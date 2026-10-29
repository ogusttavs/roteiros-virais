/**
 * E47 PR 4: "Publicar no Instagram" a partir do vídeo editado que já está no servidor. Reaproveita a publicação da E56 inteira (as conferências de conta, tipo, tamanho e legenda, o limite do dia, o
 * envio para a Meta, a conferência e o "postei" automático): este arquivo só troca de onde vêm os bytes. Em vez de o navegador mandar o vídeo, o servidor lê o MP4 do volume de edição e o entrega à
 * mesma função que recebia o pedido do navegador (`receberVideo`), em fluxo.
 *
 * Regras: só o dono da marca (a publicação confere); só uma edição desta marca e `pronta`; o tamanho é o do arquivo, medido no disco.
 */
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";

import { and, eq } from "drizzle-orm";

import { LIMITES_DA_PUBLICACAO } from "@/config/publicacao";
import { db } from "@/db";
import { edicoes } from "@/db/schema";
import { caminhoNoVolume, tamanhoDoArquivoDaEdicao } from "@/edicao/arquivos";
import { iniciarPublicacao, receberVideo, type DepsDaPublicacao } from "@/servicos/publicar-instagram";
import { fraseDaEdicao } from "@/textos/edicao";
import { textosPublicar } from "@/textos/publicar";

export type ResultadoDePublicarEdicao = { ok: true; publicacaoId: number } | { ok: false; frase: string; publicacaoId?: number };

export async function publicarEdicao(
  entrada: { usuarioId: string; clienteId: number; edicaoId: number; tipo: string; legenda: string },
  deps: DepsDaPublicacao = {},
): Promise<ResultadoDePublicarEdicao> {
  const { usuarioId, clienteId, edicaoId } = entrada;
  const [edicao] = await db()
    .select()
    .from(edicoes)
    .where(and(eq(edicoes.id, edicaoId), eq(edicoes.clienteId, clienteId)));
  if (!edicao) return { ok: false, frase: fraseDaEdicao("nao-achou") };
  if (edicao.estado !== "pronta" || !edicao.caminhoEditado) return { ok: false, frase: fraseDaEdicao("nao-e-a-hora") };
  const tamanho = await tamanhoDoArquivoDaEdicao(edicao.caminhoEditado);
  if (tamanho === null) return { ok: false, frase: fraseDaEdicao("arquivo-saiu") };

  // O Story do Instagram só tem 60 segundos: o vídeo editado pode ter mais. A Meta recusaria depois do envio; aqui a frase vem antes.
  const duracao = edicao.resultado ? edicao.resultado.edl.duracao + edicao.resultado.edl.respiroFinal : null;
  if (entrada.tipo === "story" && duracao !== null && duracao > LIMITES_DA_PUBLICACAO.story.segundosMax) {
    return { ok: false, frase: textosPublicar.tela.duracaoLonga("story", `${LIMITES_DA_PUBLICACAO.story.segundosMax} segundos`) };
  }

  const inicio = await iniciarPublicacao(
    { usuarioId, clienteId, roteiroId: edicao.roteiroId, tipo: entrada.tipo, legenda: entrada.legenda, tamanhoBytes: tamanho, tipoDoArquivo: "video/mp4", nomeDoArquivo: "video-editado.mp4" },
    deps,
  );
  if (!inicio.ok) return { ok: false, frase: inicio.frase };

  const corpo = Readable.toWeb(createReadStream(caminhoNoVolume(edicao.caminhoEditado))) as ReadableStream<Uint8Array>;
  const envio = await receberVideo({ usuarioId, clienteId, publicacaoId: inicio.publicacaoId, corpo, tamanhoDoPedido: tamanho }, deps);
  if (!envio.ok) return { ok: false, frase: envio.frase, publicacaoId: inicio.publicacaoId };
  return { ok: true, publicacaoId: inicio.publicacaoId };
}
