import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { postsProntos } from "@/db/schema";
import { caminhoDaImagem, lerCodigoDaImagem, tamanhoDaImagemGuardada } from "@/lib/imagens-do-post";
import { responderArquivo } from "@/lib/intervalo-http";

export const dynamic = "force-dynamic";

function recusa(status: number): NextResponse {
  // Sem corpo explicativo: quem chama é a Meta (ou alguém tentando adivinhar o endereço); nenhuma resposta diz o que existe.
  return new NextResponse(null, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * E56 PR 2: a imagem de um post pronto, servida à Meta (a mídia precisa estar num servidor publicamente acessível: `publicacao-de-conteudo.md`). Fica FORA do cookie de sessão de propósito (a Meta não tem
 * sessão; `/api/publicar-arquivo` é rota de autenticação própria no middleware): a autenticação é o código assinado do endereço (`lib/imagens-do-post.ts`), com prazo, mais o post estar sendo
 * publicado agora (`publicando`) no banco. `GET` e `HEAD`.
 */
async function servir(request: Request, contexto: { params: Promise<{ codigo: string; nome: string }> }, soCabecalhos: boolean): Promise<Response> {
  const { codigo } = await contexto.params;
  const lido = lerCodigoDaImagem(codigo);
  if (!lido) return recusa(404);
  const [linha] = await db()
    .select({ imagens: postsProntos.imagens })
    .from(postsProntos)
    .where(and(eq(postsProntos.id, lido.postId), eq(postsProntos.estado, "publicando")));
  if (!linha || lido.indice >= linha.imagens.length) return recusa(404);
  const tamanho = await tamanhoDaImagemGuardada(lido.postId, lido.indice);
  if (tamanho === null) return recusa(404);
  return responderArquivo(request, { caminho: caminhoDaImagem(lido.postId, lido.indice), tamanho, tipo: "image/jpeg", soCabecalhos, cache: "no-store" });
}

export async function GET(request: Request, contexto: { params: Promise<{ codigo: string; nome: string }> }) {
  return servir(request, contexto, false);
}

export async function HEAD(request: Request, contexto: { params: Promise<{ codigo: string; nome: string }> }) {
  return servir(request, contexto, true);
}
