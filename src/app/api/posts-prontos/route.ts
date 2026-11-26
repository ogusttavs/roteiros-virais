import { NextResponse } from "next/server";

import { LIMITES_DO_POST_PRONTO } from "@/config/post-pronto";
import { lerFormularioComTeto } from "@/lib/formulario-com-teto";
import { logger } from "@/lib/log";
import { recusaDaCobranca } from "@/lib/portao-cobranca";
import { sessaoAtual } from "@/lib/sessao";
import { MENSAGEM_VER_COMO_DESLIGADO, modoVerComoLigado } from "@/lib/ver-como";
import { clienteAtivoDoUsuario } from "@/servicos/clientes";
import { criarPostPronto } from "@/servicos/post-pronto";
import { fraseDeRecusaDoPost } from "@/textos/post-pronto";

export const dynamic = "force-dynamic";

/**
 * E56 PR 2: monta um post pronto. `POST /api/posts-prontos` com um formulário (`multipart/form-data`): `imagens` (de 1 a 10 arquivos, na ordem), `legenda` e `modo` (`agora` ou `fila`). A marca vem da
 * sessão, nunca do pedido; o "ver como" nunca envia (403); marca que precisa assinar recebe 402; só o dono da marca publica (o serviço confere) e só com a chave aberta. Rota, não Server Action: são
 * até dez imagens, e a Server Action carrega o corpo na memória com teto de tamanho. A resposta é pequena: `{ ok: true, postId }` ou a frase de erro.
 */
export async function POST(request: Request) {
  if (await modoVerComoLigado()) return NextResponse.json({ erro: MENSAGEM_VER_COMO_DESLIGADO }, { status: 403 });
  const sessao = await sessaoAtual();
  if (!sessao) return NextResponse.json({ erro: "nao autenticado" }, { status: 401 });
  const cliente = await clienteAtivoDoUsuario(sessao.user.id);
  if (!cliente) return NextResponse.json({ erro: "nao autenticado" }, { status: 401 });
  const recusaCobranca = await recusaDaCobranca();
  if (recusaCobranca) return recusaCobranca;

  const bruto = request.headers.get("content-length");
  if (bruto !== null && /^\d+$/.test(bruto) && Number(bruto) > LIMITES_DO_POST_PRONTO.bytesDoPedidoMax + 1_000_000) {
    return NextResponse.json({ erro: fraseDeRecusaDoPost("pedido-grande"), codigo: "pedido-grande" }, { status: 413 });
  }

  try {
    // M5 (26/11/2026): sem Content-Length (ou mentindo), o corpo é lido em fluxo com teto, nunca inteiro na memória.
    const form = await lerFormularioComTeto(request, LIMITES_DO_POST_PRONTO.bytesDoPedidoMax + 1_000_000);
    if (form === "grande-demais") return NextResponse.json({ erro: fraseDeRecusaDoPost("pedido-grande"), codigo: "pedido-grande" }, { status: 413 });
    const arquivos: Uint8Array[] = [];
    for (const item of form.getAll("imagens")) {
      if (typeof item === "string") continue;
      arquivos.push(new Uint8Array(await item.arrayBuffer()));
    }
    const legenda = form.get("legenda");
    const modo = form.get("modo") === "agora" ? "agora" : "fila";
    const resultado = await criarPostPronto({ usuarioId: sessao.user.id, clienteId: cliente.id, legenda: typeof legenda === "string" ? legenda : "", arquivos, modo });
    const cabecalhos = { "Cache-Control": "private, no-store" };
    if (!resultado.ok) return NextResponse.json({ erro: resultado.frase, codigo: resultado.codigo }, { status: resultado.codigo === "so-dono" || resultado.codigo === "fechada" ? 403 : 400, headers: cabecalhos });
    return NextResponse.json({ ok: true, postId: resultado.postId }, { headers: cabecalhos });
  } catch (erro) {
    logger.error({ err: erro, clienteId: cliente.id }, "post pronto: o envio das imagens quebrou");
    return NextResponse.json({ erro: fraseDeRecusaDoPost("imagem-ilegivel") }, { status: 400 });
  }
}
