import { NextResponse } from "next/server";

import { adminDaRota, respostaDoAdmin } from "@/lib/porta-do-admin-da-rota";
import { idDoParametro } from "@/lib/porta-do-carrossel";
import { slidesParaIlustrar } from "@/servicos/ilustracoes-do-carrossel";

export const dynamic = "force-dynamic";

/**
 * E69 PR A, so admin: os slides de um carrossel (tipo e texto) para o script do Codex pedir uma ilustracao por slide. Qualquer marca. Desligada a chave `ILUSTRACAO_ATIVA`, 404; sem ser admin, 401 ou 403.
 */
export async function GET(_request: Request, contexto: { params: Promise<{ id: string }> }) {
  const admin = await adminDaRota();
  if (admin instanceof NextResponse) return admin;
  const id = idDoParametro((await contexto.params).id);
  const dados = id === null ? null : await slidesParaIlustrar(id);
  if (!dados) return respostaDoAdmin("nao encontrado", 404);
  return NextResponse.json(dados, { headers: { "Cache-Control": "private, no-store" } });
}
