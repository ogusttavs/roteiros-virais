import { NextResponse } from "next/server";

import { idDoBancoOuNulo } from "@/lib/id-rota";
import { logger } from "@/lib/log";
import { recusaDaCobranca } from "@/lib/portao-cobranca";
import { sessaoAtual } from "@/lib/sessao";
import { MENSAGEM_VER_COMO_DESLIGADO, modoVerComoLigado } from "@/lib/ver-como";
import { clienteAtivoDoUsuario } from "@/servicos/clientes";
import { receberVideo } from "@/servicos/publicar-instagram";
import { fraseDeRecusa } from "@/textos/publicar";

export const dynamic = "force-dynamic";

/**
 * E56 PR 1: o vídeo da publicação, do navegador para a Meta. `PUT /api/publicar/<id>/video` com o ARQUIVO como corpo do pedido (não um formulário), e o tamanho dele no `Content-Length`. O
 * aplicativo repassa os bytes à Meta em fluxo, sem guardar nada: não há arquivo em disco e o vídeo nunca está inteiro na memória. A marca vem da sessão, nunca do pedido; o "ver como" nunca
 * envia (403); marca que precisa assinar recebe 402; só o dono da marca envia (o serviço confere) e só uma publicação dela que esteja subindo. A resposta é pequena: `{ ok: true }` ou a frase
 * de erro. Rota, não Server Action: a Server Action carrega o corpo na memória e tem teto de tamanho, e um vídeo tem até 300 MB.
 */
export async function PUT(request: Request, contexto: { params: Promise<{ id: string }> }) {
  if (await modoVerComoLigado()) return NextResponse.json({ erro: MENSAGEM_VER_COMO_DESLIGADO }, { status: 403 });
  const sessao = await sessaoAtual();
  if (!sessao) return NextResponse.json({ erro: "nao autenticado" }, { status: 401 });
  const cliente = await clienteAtivoDoUsuario(sessao.user.id);
  if (!cliente) return NextResponse.json({ erro: "nao autenticado" }, { status: 401 });
  const recusaCobranca = await recusaDaCobranca();
  if (recusaCobranca) return recusaCobranca;

  const { id } = await contexto.params;
  const publicacaoId = idDoBancoOuNulo(id);
  if (publicacaoId === null) return NextResponse.json({ erro: fraseDeRecusa("nao-achou") }, { status: 404 });

  const bruto = request.headers.get("content-length");
  const tamanhoDoPedido = bruto !== null && /^\d+$/.test(bruto) ? Number(bruto) : null;

  try {
    const resultado = await receberVideo({ usuarioId: sessao.user.id, clienteId: cliente.id, publicacaoId, corpo: request.body, tamanhoDoPedido });
    if (!resultado.ok) return NextResponse.json({ erro: resultado.frase, codigo: resultado.codigo }, { status: resultado.status, headers: { "Cache-Control": "private, no-store" } });
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (erro) {
    logger.error({ err: erro, clienteId: cliente.id, publicacaoId }, "publicar: o envio do video quebrou");
    return NextResponse.json({ erro: fraseDeRecusa("nao-comecou") }, { status: 500 });
  }
}
