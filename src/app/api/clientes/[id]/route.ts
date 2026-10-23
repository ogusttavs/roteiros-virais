import { NextResponse } from "next/server";

import { idDaRotaOuNulo } from "@/lib/id-rota";
import { recusaDaCobranca } from "@/lib/portao-cobranca";
import { sessaoAtual } from "@/lib/sessao";
import { ErroAcessoNegado, garantirClientePermitido } from "@/servicos/clientes";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const sessao = await sessaoAtual();
  if (!sessao) {
    return NextResponse.json({ erro: "nao autenticado" }, { status: 401 });
  }

  // E22 PR 2, item 0a: o painel do cliente inteiro vale só com assinatura; o JSON da marca também.
  const recusaCobranca = await recusaDaCobranca();
  if (recusaCobranca) return recusaCobranca;

  const { id } = await params;
  const clienteId = idDaRotaOuNulo(id);
  if (clienteId === null) {
    return NextResponse.json({ erro: "nao encontrado" }, { status: 404 });
  }

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
