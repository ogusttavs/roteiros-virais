import { NextResponse } from "next/server";

import { db } from "@/db";

export const dynamic = "force-dynamic";

/**
 * Saude do app (etapa 13): o healthcheck do Compose, o deploy.sh e o monitor
 * externo batem aqui. Confere que o banco responde; sem detalhe interno na
 * resposta.
 */
export async function GET() {
  try {
    await db().execute("select 1");
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
