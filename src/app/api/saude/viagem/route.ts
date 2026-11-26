import { NextResponse } from "next/server";

import { respostaDoAdmin } from "@/lib/porta-do-admin-da-rota";
import { sessaoAtual } from "@/lib/sessao";
import { saudeDaViagem } from "@/servicos/admin-acompanhamento";

export const dynamic = "force-dynamic";

/**
 * Saúde ampliada do acompanhamento da viagem (V10, item 3). Desde o T100 (achado M2 da auditoria de 26/11/2026) so o admin logado le: o middleware pede o cookie e esta rota confere o papel no banco, 401 sem
 * sessao e 403 para quem nao e admin. Mostra marcas ativas, roteiros de hoje, consumo por fonte e ultimo erro de job, dado de operacao que nao deve ficar aberto. O monitor externo e o deploy usam
 * `/api/saude`, que continua publica. Nao usa `adminDaRota` porque essa porta tem o desligamento da E69 embutido.
 */
export async function GET() {
  const sessao = await sessaoAtual();
  if (!sessao) return respostaDoAdmin("nao autenticado", 401);
  if (sessao.user.role !== "admin") return respostaDoAdmin("sem permissao", 403);
  try {
    const saude = await saudeDaViagem();
    return NextResponse.json(saude);
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
