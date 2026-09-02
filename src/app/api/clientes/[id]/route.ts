import { NextResponse } from "next/server";

import { sessaoAtual } from "@/lib/sessao";
import { ErroAcessoNegado, garantirClientePermitido } from "@/servicos/clientes";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const sessao = await sessaoAtual();
  if (!sessao) {
    return NextResponse.json({ erro: "nao autenticado" }, { status: 401 });
  }

  const { id } = await params;
  const clienteId = Number(id);

  try {
    const cliente = await garantirClientePermitido(clienteId, sessao.user.id);
    return NextResponse.json({ cliente });
  } catch (erro) {
    if (erro instanceof ErroAcessoNegado) {
      return NextResponse.json({ erro: erro.message }, { status: 403 });
    }
    throw erro;
  }
}
