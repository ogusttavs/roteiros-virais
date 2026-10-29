import { NextResponse } from "next/server";

import { idDoBancoOuNulo } from "@/lib/id-rota";
import { logger } from "@/lib/log";
import { recusaDaCobranca } from "@/lib/portao-cobranca";
import { sessaoAtual } from "@/lib/sessao";
import { MENSAGEM_VER_COMO_DESLIGADO, modoVerComoLigado } from "@/lib/ver-como";
import { clienteAtivoDoUsuario } from "@/servicos/clientes";
import { iniciarEdicao } from "@/servicos/edicao";
import { fraseDaEdicao } from "@/textos/edicao";

export const dynamic = "force-dynamic";

const SEM_CACHE = { "Cache-Control": "private, no-store" };

/** O status HTTP de cada recusa; as que não estão aqui são 400. */
const STATUS_DA_RECUSA: Record<string, number> = { "sem-roteiro": 404, "limite-do-mes": 429, "em-andamento": 409 };

/**
 * E47 PR 2: abre uma edição de vídeo. `POST /api/edicao` com `{ roteiroId, tamanhoBytes, tipoDoArquivo, nomeDoArquivo? }` (o que o navegador já sabe do arquivo escolhido) e responde `{ id, usadas, limite }`.
 * Depois o navegador manda o vídeo em `PUT /api/edicao/<id>/video`. A marca vem da sessão, nunca do pedido; o "ver como" nunca abre (403); marca que precisa assinar recebe 402; passou das 30 do mês, 429
 * com a frase. Rota, não Server Action: o vídeo que vem depois é grande demais para uma Server Action, e as duas chamadas ficam do mesmo jeito.
 */
export async function POST(request: Request) {
  if (await modoVerComoLigado()) return NextResponse.json({ erro: MENSAGEM_VER_COMO_DESLIGADO }, { status: 403 });
  const sessao = await sessaoAtual();
  if (!sessao) return NextResponse.json({ erro: "nao autenticado" }, { status: 401 });
  const cliente = await clienteAtivoDoUsuario(sessao.user.id);
  if (!cliente) return NextResponse.json({ erro: "nao autenticado" }, { status: 401 });
  const recusaCobranca = await recusaDaCobranca();
  if (recusaCobranca) return recusaCobranca;

  let corpo: { roteiroId?: unknown; tamanhoBytes?: unknown; tipoDoArquivo?: unknown; nomeDoArquivo?: unknown };
  try {
    corpo = (await request.json()) as typeof corpo;
  } catch {
    return NextResponse.json({ erro: "corpo do pedido invalido" }, { status: 400 });
  }
  const roteiroId = idDoBancoOuNulo(typeof corpo.roteiroId === "number" || typeof corpo.roteiroId === "string" ? corpo.roteiroId : null);
  if (roteiroId === null) return NextResponse.json({ erro: fraseDaEdicao("sem-roteiro"), codigo: "sem-roteiro" }, { status: 404, headers: SEM_CACHE });

  try {
    const resultado = await iniciarEdicao({
      usuarioId: sessao.user.id,
      clienteId: cliente.id,
      roteiroId,
      tamanhoBytes: typeof corpo.tamanhoBytes === "number" ? corpo.tamanhoBytes : Number.NaN,
      tipoDoArquivo: typeof corpo.tipoDoArquivo === "string" ? corpo.tipoDoArquivo : "",
      nomeDoArquivo: typeof corpo.nomeDoArquivo === "string" ? corpo.nomeDoArquivo : undefined,
    });
    if (!resultado.ok) return NextResponse.json({ erro: resultado.frase, codigo: resultado.codigo }, { status: STATUS_DA_RECUSA[resultado.codigo] ?? 400, headers: SEM_CACHE });
    return NextResponse.json({ id: resultado.edicaoId, usadas: resultado.usadas, limite: resultado.limite }, { headers: SEM_CACHE });
  } catch (erro) {
    logger.error({ err: erro, clienteId: cliente.id, roteiroId }, "edicao: nao foi possivel abrir a edicao");
    return NextResponse.json({ erro: fraseDaEdicao("nao-comecou") }, { status: 500, headers: SEM_CACHE });
  }
}
