import { NextResponse } from "next/server";

import { config } from "@/lib/config";
import { confirmarEmail } from "@/servicos/cadastro";

/**
 * O link do e-mail de confirmar (E63 PR 1): `GET /api/cadastro/confirmar?codigo=...`. Sem cookie de sessão de propósito (a pessoa pode abrir o e-mail em outro aparelho): o código,
 * de uso único e com prazo, é a prova. Confirmou, vai à tela "E-mail confirmado" (E63 PR 2), que leva ao briefing (quem não tem sessão passa pelo `/entrar`); não valeu, vai à página de confirmar, que explica e deixa pedir outro.
 */
export async function GET(request: Request) {
  const codigo = new URL(request.url).searchParams.get("codigo") ?? "";
  const resultado = await confirmarEmail(codigo);
  const destino = resultado.ok ? "/email-confirmado" : "/confirmar-email?link=invalido";
  return NextResponse.redirect(new URL(destino, config.appUrl), { headers: { "Cache-Control": "no-store" } });
}
