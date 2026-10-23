import { NextResponse } from "next/server";

import { idDaRotaOuNulo } from "@/lib/id-rota";
import { sessaoAtual } from "@/lib/sessao";
import { fotoGuardadaDaNoticia } from "@/servicos/foto-da-noticia";

/**
 * A foto da matéria guardada do nosso lado (fix de 22/10/2026, Notícias). Só quem está logado e é do setor da notícia (ou o admin). O tipo vem do que foi conferido pelos bytes ao guardar (JPEG, PNG
 * ou WebP), nunca do endereço de origem; `nosniff` e uma política que não deixa nada rodar, por garantia. A foto de uma notícia não muda: o navegador guarda por um dia, só para a pessoa.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const sessao = await sessaoAtual();
  if (!sessao) return NextResponse.json({ erro: "nao autenticado" }, { status: 401, headers: { "Cache-Control": "private, no-store" } });

  const noticiaId = idDaRotaOuNulo((await params).id);
  if (noticiaId === null) return NextResponse.json({ erro: "nao encontrado" }, { status: 404, headers: { "Cache-Control": "private, no-store" } });

  const foto = await fotoGuardadaDaNoticia(noticiaId, { id: sessao.user.id, role: sessao.user.role });
  if (foto === "negado") return NextResponse.json({ erro: "sem acesso" }, { status: 403, headers: { "Cache-Control": "private, no-store" } });
  if (!foto) return NextResponse.json({ erro: "nao encontrado" }, { status: 404, headers: { "Cache-Control": "private, no-store" } });

  return new NextResponse(new Uint8Array(foto.bytes), {
    status: 200,
    headers: {
      "Content-Type": foto.tipo,
      "Content-Length": String(foto.bytes.length),
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
