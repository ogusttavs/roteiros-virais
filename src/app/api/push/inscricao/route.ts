import { NextResponse } from "next/server";

import { sessaoDoPainel } from "@/lib/ver-como";
import { apagarInscricaoDaPessoa, ErroInscricaoPush, registrarInscricaoPush } from "@/servicos/push";

/**
 * O service worker manda a inscrição nova ao servidor quando o navegador a troca sozinho (`pushsubscriptionchange`), sem a página aberta: por isso uma rota, e não uma
 * Server Action (que só a página chama). Vale a sessão do cookie (o service worker o leva, mesma origem); sem ela, 401. Só aceita JSON (um formulário de outro
 * site não consegue mandar este tipo sem pedir licença antes), e o modo "ver como" nunca grava inscrição. O que se grava é o que `registrarInscricaoPush` já confere
 * (endereço de um serviço de push conhecido, chaves). O sistema (iphone, android) vem do service worker, que o lê do navegador; e a inscrição
 * antiga (`endpointAntigo`) só é apagada se for da própria pessoa.
 */
export async function POST(request: Request) {
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ erro: "so JSON" }, { status: 415 });
  }
  const sessao = await sessaoDoPainel();
  if (!sessao) return NextResponse.json({ erro: "entre de novo" }, { status: 401 });
  if (sessao.verComo !== null) return NextResponse.json({ erro: "modo ver como" }, { status: 403 });

  let corpo: { endpoint?: unknown; p256dh?: unknown; auth?: unknown; sistema?: unknown; endpointAntigo?: unknown };
  try {
    corpo = (await request.json()) as typeof corpo;
  } catch {
    return NextResponse.json({ erro: "corpo invalido" }, { status: 400 });
  }
  const texto = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
  if (!texto(corpo.endpoint) || !texto(corpo.p256dh) || !texto(corpo.auth)) return NextResponse.json({ erro: "inscricao invalida" }, { status: 400 });
  const sistema = corpo.sistema === "iphone" || corpo.sistema === "android" ? corpo.sistema : "computador";
  try {
    await registrarInscricaoPush(sessao.user.id, { endpoint: corpo.endpoint, p256dh: corpo.p256dh, auth: corpo.auth }, sistema);
  } catch (erro) {
    if (erro instanceof ErroInscricaoPush) return NextResponse.json({ erro: "inscricao recusada" }, { status: 400 });
    throw erro;
  }
  if (texto(corpo.endpointAntigo) && corpo.endpointAntigo !== corpo.endpoint) {
    // O servidor grava o endereço normalizado; o antigo vem como o navegador o deu.
    const antigo = (() => {
      try {
        return new URL(corpo.endpointAntigo as string).href;
      } catch {
        return null;
      }
    })();
    if (antigo) await apagarInscricaoDaPessoa(sessao.user.id, antigo);
  }
  return NextResponse.json({ ok: true });
}
