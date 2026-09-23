"use server";

import type { Objetivo } from "@/db/schema";
import { sessaoAtual } from "@/lib/sessao";
import { ErroAcessoNegado, clienteDaSessaoAtual, garantirMembroDaMarca } from "@/servicos/clientes";
import { lerMomentoDeTexto, type CamposMomento } from "@/servicos/momento";
import { ErroRoteiro, gerarRoteiro } from "@/servicos/roteiro";

/**
 * V9b, item 1: o caminho por áudio da folha agora passa por aqui depois de
 * `/api/momento/transcrever` devolver o texto (a rota deixou de separar em
 * campos, "mesma rota" reaproveitada pela agenda). Sessão só para não
 * gastar a tarefa barata sem ninguém logado; o resultado não depende de
 * marca nenhuma.
 */
export async function lerMomentoDeTextoAction(texto: string): Promise<CamposMomento> {
  const sessao = await sessaoAtual();
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
  /** V9a, item 4: "Falar de", só quando a pessoa é membro de mais de uma marca e escolheu uma diferente da ativa. */
  marcaId?: number;
  /** A fala inteira, só no caminho por áudio (o bloco "o que você disse"). */
  transcricao?: string;
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
 */
export async function gerarRoteiroMomentoAction(dados: DadosMomento): Promise<{ id: number }> {
  const sessao = await sessaoAtual();
  if (!sessao) {
    throw new ErroAcessoNegado("E preciso entrar de novo.");
  }

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
    },
    objetivo: dados.objetivo,
  });

  return { id: roteiro.id };
}
