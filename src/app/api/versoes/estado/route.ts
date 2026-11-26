import { NextResponse } from "next/server";

import { rotuloParaQue } from "@/config/fichas";
import { sessaoAtual } from "@/lib/sessao";
import { clienteAtivoDoUsuario } from "@/servicos/clientes";
import { grupoEmAberto } from "@/servicos/versoes";

export const dynamic = "force-dynamic";
const SEM_CACHE = { "Cache-Control": "private, no-store" };

export type EstadoDasVersoes = { estado: "nenhum" | "escrevendo" } | { estado: "prontas"; grupo: string; tema: string; quantidade: number; paraQue: string };

/**
 * E74 PR 1: o Hoje pergunta aqui, de 5 em 5 segundos, se as versões que a pessoa pediu já ficaram prontas. É uma rota comum (GET), não `router.refresh` nem Server Action: os dois entram
 * na fila de ações do roteador do Next, e um `router.refresh` com a escrita ainda pendente fez o navegador pedir a escrita de novo (versões duplicadas, e o gasto da IA em dobro).
 * Só lê: o grupo mais novo da marca da sessão, ainda não escolhido.
 */
export async function GET() {
  const sessao = await sessaoAtual();
  const cliente = sessao ? await clienteAtivoDoUsuario(sessao.user.id) : null;
  if (!cliente) return NextResponse.json({ erro: "nao autenticado" }, { status: 401, headers: SEM_CACHE });
  const grupo = await grupoEmAberto(cliente.id);
  let corpo: EstadoDasVersoes = { estado: "nenhum" };
  if (grupo?.emEscrita) corpo = { estado: "escrevendo" };
  else if (grupo) {
    corpo = {
      estado: "prontas",
      grupo: grupo.grupo,
      tema: grupo.tema,
      quantidade: grupo.quantidade,
      paraQue: rotuloParaQue({ ficha: grupo.ficha, objetivo: grupo.objetivo, formato: grupo.formato === "story" ? "story" : "reels" }),
    };
  }
  return NextResponse.json(corpo, { headers: SEM_CACHE });
}
