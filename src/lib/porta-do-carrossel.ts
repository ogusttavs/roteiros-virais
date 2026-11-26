/**
 * E65 PR 1: a porta comum das rotas do carrossel. Com `CARROSSEL_ATIVO` desligada, toda rota responde 404 como se não existisse. Depois: o "ver como" nunca entra (as fotos são da pessoa), sem
 * sessão é 401, e a marca vem SEMPRE da sessão, nunca do pedido. O portão da cobrança (`recusaDaCobranca`) é chamado por cada rota, onde o `checar-portao-cobranca` o enxerga.
 */
import { NextResponse } from "next/server";

import { carrosselAtivo } from "@/config/carrossel";
import { idDoBancoOuNulo } from "@/lib/id-rota";
import { sessaoAtual } from "@/lib/sessao";
import { MENSAGEM_VER_COMO_DESLIGADO, modoVerComoLigado } from "@/lib/ver-como";
import { ErroCarrossel } from "@/servicos/carrossel";
import { clienteAtivoDoUsuario } from "@/servicos/clientes";

export const SEM_CACHE = { "Cache-Control": "private, no-store" };

export function respostaDeErro(mensagem: string, status: number): NextResponse {
  return NextResponse.json({ erro: mensagem }, { status, headers: SEM_CACHE });
}

const STATUS_DO_ERRO: Record<ErroCarrossel["codigo"], number> = { "pedido-invalido": 400, "nao-achou": 404, "sem-briefing": 409, "limite-de-fotos": 409, "foto-invalida": 400, "em-andamento": 409, indisponivel: 503, "sem-autorizacao": 400 };

export function respostaDoErroDoCarrossel(erro: unknown): NextResponse | null {
  return erro instanceof ErroCarrossel ? respostaDeErro(erro.message, STATUS_DO_ERRO[erro.codigo]) : null;
}

/** A marca da sessão e quem está nela (o usuário, para gravar quem confirmou a autorização da foto de paciente, M6), ou a resposta que a rota devolve sem fazer mais nada. */
export async function marcaDoCarrossel(): Promise<{ clienteId: number; usuarioId: string } | NextResponse> {
  if (!carrosselAtivo()) return NextResponse.json({ erro: "nao encontrado" }, { status: 404, headers: SEM_CACHE });
  if (await modoVerComoLigado()) return respostaDeErro(MENSAGEM_VER_COMO_DESLIGADO, 403);
  const sessao = await sessaoAtual();
  if (!sessao) return respostaDeErro("nao autenticado", 401);
  const cliente = await clienteAtivoDoUsuario(sessao.user.id);
  if (!cliente) return respostaDeErro("nao autenticado", 401);
  return { clienteId: cliente.id, usuarioId: sessao.user.id };
}

/** O id de um parâmetro de rota, ou nulo. */
export function idDoParametro(valor: string): number | null {
  return idDoBancoOuNulo(valor);
}

/** Lê o corpo do pedido contando os bytes; passou do teto, cancela a leitura e devolve "grande-demais". */
export async function lerCorpoComTeto(request: Request, teto: number): Promise<Uint8Array<ArrayBuffer> | "grande-demais"> {
  if (!request.body) return new Uint8Array(0);
  const leitor = request.body.getReader();
  const pedacos: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > teto) {
      await leitor.cancel().catch(() => undefined);
      return "grande-demais";
    }
    pedacos.push(value);
  }
  const inteiro = new Uint8Array(total);
  let posicao = 0;
  for (const p of pedacos) {
    inteiro.set(p, posicao);
    posicao += p.byteLength;
  }
  return inteiro;
}
