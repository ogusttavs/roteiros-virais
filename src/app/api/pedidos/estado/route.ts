import { NextResponse, type NextRequest } from "next/server";

import { recusaDaCobranca } from "@/lib/portao-cobranca";
import { sessaoDoPainel } from "@/lib/ver-como";
import { clienteAtivoDoUsuario } from "@/servicos/clientes";
import { estadoDosPedidos, umPedidoParaTela } from "@/servicos/pedidos-estado";

export const dynamic = "force-dynamic";
const SEM_CACHE = { "Cache-Control": "private, no-store" };

/**
 * E74 PR 2a: a tela pergunta aqui pelo pedido que está sendo escrito (`?id=`, a tela de espera) ou por tudo o que a marca tem andando (sem `id`: o Hoje e, no PR 3, a aba). É uma rota comum
 * (GET), não Server Action nem `router.refresh`: não entra na fila de ações do roteador nem disputa a transição com a escrita pendente (seção 3.5.1 do desenho). Só lê, sempre a marca da
 * sessão (R-l): sem sessão, 401; sem assinatura válida, 402 (o portão de sempre); um id que não é desta marca, 404, igual a um id que não existe. No "ver como" (`sessaoDoPainel`), lê a marca vista, sem mudar nada.
 */
export async function GET(pedido: NextRequest) {
  const sessao = await sessaoDoPainel();
  const cliente = sessao ? await clienteAtivoDoUsuario(sessao.user.id) : null;
  if (!cliente) return NextResponse.json({ erro: "nao autenticado" }, { status: 401, headers: SEM_CACHE });
  const recusa = await recusaDaCobranca();
  if (recusa) return recusa;

  const id = pedido.nextUrl.searchParams.get("id");
  if (id !== null) {
    const um = await umPedidoParaTela(cliente.id, id);
    if (!um) return NextResponse.json({ erro: "nao encontrado" }, { status: 404, headers: SEM_CACHE });
    return NextResponse.json({ ...um, agora: new Date().toISOString() }, { headers: SEM_CACHE });
  }
  return NextResponse.json(await estadoDosPedidos(cliente.id), { headers: SEM_CACHE });
}
