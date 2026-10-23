import { NextResponse } from "next/server";

import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

/**
 * A versao do servidor que esta rodando agora (o sha curto do commit, `GIT_SHA` da imagem). Publica
 * de proposito (o sha ja e publico, o repositorio e aberto): o navegador pergunta aqui, sem depender
 * de sessao, se a pagina que ele tem aberta e de uma versao anterior (`src/lib/versao.ts`). Nunca
 * fica em cache: a resposta so serve se for a de agora.
 */
export function GET() {
  return NextResponse.json({ versao: config.gitSha }, { headers: { "Cache-Control": "no-store" } });
}
