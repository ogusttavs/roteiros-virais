import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { publicacoes } from "@/db/schema";
import { responderArquivo } from "@/lib/intervalo-http";
import { lerCodigoDoVideo, caminhoDoVideo, tamanhoDoVideoGuardado } from "@/lib/video-temporario";

export const dynamic = "force-dynamic";

/** Só serve enquanto a publicação ainda precisa do arquivo: a Meta baixa durante a criação do contêiner e o preparo (`enviando`, `processando`, `publicando`). */
const ESTADOS_QUE_PRECISAM_DO_ARQUIVO = ["enviando", "processando", "publicando"] as const;

function recusa(status: number): NextResponse {
  // Sem corpo explicativo: quem chama é a Meta (ou alguém tentando adivinhar o endereço); nenhuma resposta diz o que existe.
  return new NextResponse(null, { status, headers: { "Cache-Control": "no-store" } });
}

/**
 * E19b: o vídeo de uma publicação pela via do Instagram, servido à Meta (`pesquisa/plataformas/docs/meta/publicacao-de-conteudo.md`: a mídia precisa estar num servidor publicamente acessível
 * no momento da tentativa). Fica FORA do cookie de sessão de propósito (quem baixa é a Meta, sem sessão): a autenticação é o código assinado do endereço (`lib/video-temporario.ts`), com prazo,
 * mais a publicação ainda estar viva no banco. Aceita `GET` e `HEAD`, com `Range` simples (quem baixa vídeo costuma pedir pedaços).
 */
async function servir(request: Request, contexto: { params: Promise<{ codigo: string; nome: string }> }, soCabecalhos: boolean): Promise<Response> {
  const { codigo } = await contexto.params;
  const lido = lerCodigoDoVideo(codigo);
  if (!lido) return recusa(404);

  const [linha] = await db()
    .select({ tipoDoArquivo: publicacoes.tipoDoArquivo })
    .from(publicacoes)
    .where(and(eq(publicacoes.id, lido.publicacaoId), inArray(publicacoes.estado, [...ESTADOS_QUE_PRECISAM_DO_ARQUIVO])));
  if (!linha) return recusa(404);

  const tamanho = await tamanhoDoVideoGuardado(lido.publicacaoId);
  if (tamanho === null) return recusa(404);

  const tipo = linha.tipoDoArquivo.startsWith("video/") ? linha.tipoDoArquivo : "video/mp4";
  // `Range` simples, em fluxo: o mesmo serviço de arquivo que a prévia da edição usa (`lib/intervalo-http.ts`). A Meta não tem sessão: nada de cache.
  return responderArquivo(request, { caminho: caminhoDoVideo(lido.publicacaoId), tamanho, tipo, soCabecalhos, cache: "no-store" });
}

export async function GET(request: Request, contexto: { params: Promise<{ codigo: string; nome: string }> }) {
  return servir(request, contexto, false);
}

export async function HEAD(request: Request, contexto: { params: Promise<{ codigo: string; nome: string }> }) {
  return servir(request, contexto, true);
}
