import { NextResponse } from "next/server";

import { rotuloParaQue } from "@/config/fichas";
import { recusaDaCobranca } from "@/lib/portao-cobranca";
import { sessaoAtual } from "@/lib/sessao";
import { clienteAtivoDoUsuario } from "@/servicos/clientes";
import { versoesNoHoje } from "@/servicos/pedidos-estado";

export const dynamic = "force-dynamic";
const SEM_CACHE = { "Cache-Control": "private, no-store" };

export type EstadoDasVersoes = { estado: "nenhum" | "escrevendo" } | { estado: "prontas"; grupo: string; tema: string; quantidade: number; paraQue: string };

/**
 * E74 PR 1: o Hoje perguntava aqui se as versões já tinham ficado prontas. Desde o PR 2a o Hoje segue o pedido (`/api/pedidos/estado`); esta rota fica como invólucro fino, com a mesma
 * regra nova (o pedido andando é "escrevendo", e um grupo antigo que falta escolher não o esconde, R-b), só para a aba que ficou aberta de antes da subida. Sai no PR 3.
 */
export async function GET() {
  const sessao = await sessaoAtual();
  const cliente = sessao ? await clienteAtivoDoUsuario(sessao.user.id) : null;
  if (!cliente) return NextResponse.json({ erro: "nao autenticado" }, { status: 401, headers: SEM_CACHE });
  const recusa = await recusaDaCobranca();
  if (recusa) return recusa;
  const { escrevendo, aberto } = await versoesNoHoje(cliente.id);
  let corpo: EstadoDasVersoes = { estado: "nenhum" };
  if (escrevendo) corpo = { estado: "escrevendo" };
  else if (aberto) {
    corpo = {
      estado: "prontas",
      grupo: aberto.grupo,
      tema: aberto.tema,
      quantidade: aberto.quantidade,
      paraQue: rotuloParaQue({ ficha: aberto.ficha, objetivo: aberto.objetivo, formato: aberto.formato === "story" ? "story" : "reels" }),
    };
  }
  return NextResponse.json(corpo, { headers: SEM_CACHE });
}
