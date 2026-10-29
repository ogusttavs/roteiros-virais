import { NextResponse } from "next/server";

import { idDoBancoOuNulo } from "@/lib/id-rota";
import { recusaDaCobranca } from "@/lib/portao-cobranca";
import { sessaoDoPainel } from "@/lib/ver-como";
import { clienteAtivoDoUsuario } from "@/servicos/clientes";
import { usoDoMes, vistaDaEdicao } from "@/servicos/edicao";
import { vistaCompletaDaEdicao } from "@/servicos/edicao-tela";
import { fraseDaEdicao } from "@/textos/edicao";

export const dynamic = "force-dynamic";

/**
 * E47 PR 2: como está a edição. `GET /api/edicao/<id>` devolve o estado, a frase de falha, a duração e quantas palavras foram ouvidas, mais (E47 PR 4) o andamento do render, a posição na fila, os avisos e o que já pode ser visto ou baixado, e o uso do mês. Só lê: o "ver como" do admin pode
 * olhar (a vista é a da pessoa). Edição de outra marca responde como se não existisse (404).
 */
export async function GET(_request: Request, contexto: { params: Promise<{ id: string }> }) {
  const sessao = await sessaoDoPainel();
  if (!sessao) return NextResponse.json({ erro: "nao autenticado" }, { status: 401 });
  const cliente = await clienteAtivoDoUsuario(sessao.user.id);
  if (!cliente) return NextResponse.json({ erro: "nao autenticado" }, { status: 401 });
  const recusaCobranca = await recusaDaCobranca();
  if (recusaCobranca) return recusaCobranca;

  const { id } = await contexto.params;
  const edicaoId = idDoBancoOuNulo(id);
  const vista = edicaoId === null ? null : await vistaDaEdicao(cliente.id, edicaoId);
  const completa = edicaoId === null ? null : await vistaCompletaDaEdicao(cliente.id, edicaoId);
  if (!vista || !completa) return NextResponse.json({ erro: fraseDaEdicao("nao-achou"), codigo: "nao-achou" }, { status: 404, headers: { "Cache-Control": "private, no-store" } });
  return NextResponse.json({ ...vista, ...completa, uso: await usoDoMes(cliente.id) }, { headers: { "Cache-Control": "private, no-store" } });
}
