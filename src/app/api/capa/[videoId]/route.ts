import { NextResponse } from "next/server";

import { sessaoAtual } from "@/lib/sessao";
import { lerCapaGuardada } from "@/servicos/capas";

export const dynamic = "force-dynamic";

/**
 * A capa guardada de um vídeo (hotfix de 22/10/2026, `servicos/capas.ts`): o `<img>` das Referências, do roteiro e dos exemplos do Criar aponta aqui quando o job guardou a imagem, em vez do link
 * assinado do CDN da Meta, que vence em dias. Só para quem está logado (a mesma sessão do painel; o middleware já barra quem não tem cookie e a rota confere a sessão de verdade). Capa de
 * vídeo é dado público da plataforma, igual para todas as marcas, então não há posse a conferir; mesmo assim a resposta é `private`, para nenhum cache compartilhado servir o arquivo
 * a quem não entrou. O cache do navegador é longo: a imagem guardada nunca muda.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ videoId: string }> }) {
  const sessao = await sessaoAtual();
  if (!sessao) return NextResponse.json({ erro: "nao autenticado" }, { status: 401, headers: { "Cache-Control": "private, no-store" } });

  const { videoId: bruto } = await params;
  const videoId = /^\d{1,9}$/.test(bruto) ? Number(bruto) : null;
  if (videoId === null) return NextResponse.json({ erro: "capa nao encontrada" }, { status: 404, headers: { "Cache-Control": "private, no-store" } });

  const capa = await lerCapaGuardada(videoId);
  if (!capa) return NextResponse.json({ erro: "capa nao encontrada" }, { status: 404, headers: { "Cache-Control": "private, max-age=300" } });

  return new NextResponse(new Uint8Array(capa.bytes), {
    status: 200,
    headers: {
      "Content-Type": capa.tipo,
      "Content-Length": String(capa.bytes.length),
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
