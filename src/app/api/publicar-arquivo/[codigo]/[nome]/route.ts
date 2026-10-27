import { createReadStream } from "node:fs";
import { Readable } from "node:stream";

import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/db";
import { publicacoes } from "@/db/schema";
import { lerCodigoDoVideo, caminhoDoVideo, tamanhoDoVideoGuardado } from "@/lib/video-temporario";

export const dynamic = "force-dynamic";

/** Só serve enquanto a publicação ainda precisa do arquivo: a Meta baixa durante a criação do contêiner e o preparo (`enviando`, `processando`, `publicando`). */
const ESTADOS_QUE_PRECISAM_DO_ARQUIVO = ["enviando", "processando", "publicando"] as const;

function recusa(status: number): NextResponse {
  // Sem corpo explicativo: quem chama é a Meta (ou alguém tentando adivinhar o endereço); nenhuma resposta diz o que existe.
  return new NextResponse(null, { status, headers: { "Cache-Control": "no-store" } });
}

/** `bytes=<início>-<fim>`; devolve o intervalo (fim incluído) ou `null` se o pedido não for um intervalo simples que caiba no arquivo. */
function lerIntervalo(cabecalho: string | null, tamanho: number): { inicio: number; fim: number } | "invalido" | null {
  if (!cabecalho) return null;
  const achado = /^bytes=(\d*)-(\d*)$/.exec(cabecalho.trim());
  if (!achado || (achado[1] === "" && achado[2] === "")) return "invalido";
  let inicio: number;
  let fim: number;
  if (achado[1] === "") {
    const sufixo = Number(achado[2]);
    if (sufixo === 0) return "invalido";
    inicio = Math.max(0, tamanho - sufixo);
    fim = tamanho - 1;
  } else {
    inicio = Number(achado[1]);
    fim = achado[2] === "" ? tamanho - 1 : Math.min(Number(achado[2]), tamanho - 1);
  }
  return inicio > fim || inicio >= tamanho ? "invalido" : { inicio, fim };
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
  const base = { "Content-Type": tipo, "Accept-Ranges": "bytes", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

  const intervalo = lerIntervalo(request.headers.get("range"), tamanho);
  if (intervalo === "invalido") return new NextResponse(null, { status: 416, headers: { ...base, "Content-Range": `bytes */${tamanho}` } });

  const inicio = intervalo ? intervalo.inicio : 0;
  const fim = intervalo ? intervalo.fim : tamanho - 1;
  const comprimento = fim - inicio + 1;
  const cabecalhos: Record<string, string> = { ...base, "Content-Length": String(comprimento) };
  if (intervalo) cabecalhos["Content-Range"] = `bytes ${inicio}-${fim}/${tamanho}`;
  const status = intervalo ? 206 : 200;

  if (soCabecalhos) return new NextResponse(null, { status, headers: cabecalhos });
  const fluxo = Readable.toWeb(createReadStream(caminhoDoVideo(lido.publicacaoId), { start: inicio, end: fim })) as ReadableStream<Uint8Array>;
  return new NextResponse(fluxo, { status, headers: cabecalhos });
}

export async function GET(request: Request, contexto: { params: Promise<{ codigo: string; nome: string }> }) {
  return servir(request, contexto, false);
}

export async function HEAD(request: Request, contexto: { params: Promise<{ codigo: string; nome: string }> }) {
  return servir(request, contexto, true);
}
