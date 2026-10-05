import { NextResponse } from "next/server";

import { config } from "@/lib/config";

/**
 * A chave pública do aviso por push (a que o servidor usa hoje). Chave pública não é segredo, mas a rota fica atrás do cookie de sessão como o resto do painel.
 * Quem pergunta é o service worker (`public/sw.js`), que não tem a chave: quando o navegador troca a inscrição (`pushsubscriptionchange`), ele precisa dela
 * para se inscrever de novo.
 */
export async function GET() {
  return NextResponse.json({ chave: config.push.publicKey }, { headers: { "cache-control": "no-store" } });
}
