/**
 * Serve um arquivo em disco com `Range` simples (um intervalo `bytes=<início>-<fim>`), do jeito que o Safari do iPhone exige para tocar vídeo, e que a Meta usa para baixar. O arquivo nunca
 * vai inteiro para a memória: é lido em fluxo, só o pedaço pedido. Quem chama já conferiu quem pode ver o arquivo.
 */
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";

import { NextResponse } from "next/server";

/** `bytes=<início>-<fim>`; devolve o intervalo (fim incluído) ou `null` se não pediu intervalo, ou `"invalido"` se o pedido não for um intervalo simples que caiba no arquivo. */
export function lerIntervalo(cabecalho: string | null, tamanho: number): { inicio: number; fim: number } | "invalido" | null {
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

export type OpcoesDoArquivo = {
  caminho: string;
  tamanho: number;
  tipo: string;
  /** Se vier, o navegador baixa em vez de tocar, com este nome. */
  baixarComo?: string;
  /** Só os cabeçalhos (HEAD). */
  soCabecalhos?: boolean;
  /** `private` para arquivo da pessoa; a Meta e outros que não têm sessão usam `no-store`. */
  cache?: string;
};

export function responderArquivo(request: Request, opcoes: OpcoesDoArquivo): NextResponse {
  const { caminho, tamanho, tipo } = opcoes;
  const base: Record<string, string> = { "Content-Type": tipo, "Accept-Ranges": "bytes", "Cache-Control": opcoes.cache ?? "private, no-store", "X-Content-Type-Options": "nosniff" };
  if (opcoes.baixarComo) base["Content-Disposition"] = `attachment; filename="${opcoes.baixarComo}"`;

  const intervalo = lerIntervalo(request.headers.get("range"), tamanho);
  if (intervalo === "invalido") return new NextResponse(null, { status: 416, headers: { ...base, "Content-Range": `bytes */${tamanho}` } });

  const inicio = intervalo ? intervalo.inicio : 0;
  const fim = intervalo ? intervalo.fim : tamanho - 1;
  const cabecalhos: Record<string, string> = { ...base, "Content-Length": String(fim - inicio + 1) };
  if (intervalo) cabecalhos["Content-Range"] = `bytes ${inicio}-${fim}/${tamanho}`;
  const status = intervalo ? 206 : 200;
  if (opcoes.soCabecalhos) return new NextResponse(null, { status, headers: cabecalhos });
  const fluxo = Readable.toWeb(createReadStream(caminho, { start: inicio, end: fim })) as ReadableStream<Uint8Array>;
  return new NextResponse(fluxo, { status, headers: cabecalhos });
}
