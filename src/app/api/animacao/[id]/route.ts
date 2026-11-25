import { NextResponse } from "next/server";

import { idDoBancoOuNulo } from "@/lib/id-rota";
import { recusaDaCobranca } from "@/lib/portao-cobranca";
import { sessaoDoPainel } from "@/lib/ver-como";
import { animacaoDaMarca } from "@/servicos/animacao";
import { clienteAtivoDoUsuario } from "@/servicos/clientes";
import { fraseDaAnimacao } from "@/textos/animacao";

export const dynamic = "force-dynamic";

/**
 * E68 A2: como está o vídeo de animação. `GET /api/animacao/<id>` devolve a vista (estado, andamento, frase de falha, tempos esperados). Só lê: o "ver como" do admin pode olhar. Marca fora da lista
 * `ANIMACAO_CONTAS`, animação de outra marca e animação que não existe respondem igual (404).
 */
export async function GET(_request: Request, contexto: { params: Promise<{ id: string }> }) {
  const sessao = await sessaoDoPainel();
  if (!sessao) return NextResponse.json({ erro: "nao autenticado" }, { status: 401 });
  const cliente = await clienteAtivoDoUsuario(sessao.user.id);
  if (!cliente) return NextResponse.json({ erro: "nao autenticado" }, { status: 401 });
  const recusaCobranca = await recusaDaCobranca();
  if (recusaCobranca) return recusaCobranca;

  const { id } = await contexto.params;
  const animacaoId = idDoBancoOuNulo(id);
  const vista = animacaoId === null ? null : await animacaoDaMarca(cliente.id, animacaoId);
  if (!vista) return NextResponse.json({ erro: fraseDaAnimacao("nao-achou"), codigo: "nao-achou" }, { status: 404, headers: { "Cache-Control": "private, no-store" } });
  return NextResponse.json(vista, { headers: { "Cache-Control": "private, no-store" } });
}
