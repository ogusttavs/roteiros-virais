/**
 * E47 PR 4: a porta comum das rotas que entregam um arquivo da edição (a prévia, o vídeo pronto, a legenda). A marca vem da sessão, nunca do pedido (o portão da cobrança, 402, é chamado por cada rota); o "ver como" do admin nunca baixa (o vídeo
 * tem o rosto e a voz da pessoa); edição de outra marca responde como se não existisse (404).
 */
import { NextResponse } from "next/server";

import { idDoBancoOuNulo } from "@/lib/id-rota";
import { MENSAGEM_VER_COMO_DESLIGADO, modoVerComoLigado, sessaoDoPainel } from "@/lib/ver-como";
import { clienteAtivoDoUsuario } from "@/servicos/clientes";
import { fraseDaEdicao } from "@/textos/edicao";

export type DonoDaEdicao = { clienteId: number; edicaoId: number };

const SEM_CACHE = { "Cache-Control": "private, no-store" };

export async function quemPodeVerOArquivo(contexto: { params: Promise<{ id: string }> }): Promise<DonoDaEdicao | NextResponse> {
  if (await modoVerComoLigado()) return NextResponse.json({ erro: MENSAGEM_VER_COMO_DESLIGADO }, { status: 403, headers: SEM_CACHE });
  const sessao = await sessaoDoPainel();
  if (!sessao) return NextResponse.json({ erro: "nao autenticado" }, { status: 401 });
  const cliente = await clienteAtivoDoUsuario(sessao.user.id);
  if (!cliente) return NextResponse.json({ erro: "nao autenticado" }, { status: 401 });
  const { id } = await contexto.params;
  const edicaoId = idDoBancoOuNulo(id);
  if (edicaoId === null) return NextResponse.json({ erro: fraseDaEdicao("nao-achou"), codigo: "nao-achou" }, { status: 404, headers: SEM_CACHE });
  return { clienteId: cliente.id, edicaoId };
}

export function naoAchou(): NextResponse {
  return NextResponse.json({ erro: fraseDaEdicao("nao-achou"), codigo: "nao-achou" }, { status: 404, headers: SEM_CACHE });
}
