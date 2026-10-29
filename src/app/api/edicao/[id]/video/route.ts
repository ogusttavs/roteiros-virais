import { NextResponse } from "next/server";

import { idDoBancoOuNulo } from "@/lib/id-rota";
import { logger } from "@/lib/log";
import { recusaDaCobranca } from "@/lib/portao-cobranca";
import { sessaoAtual } from "@/lib/sessao";
import { MENSAGEM_VER_COMO_DESLIGADO, modoVerComoLigado } from "@/lib/ver-como";
import { clienteAtivoDoUsuario } from "@/servicos/clientes";
import { receberVideoDaEdicao } from "@/servicos/edicao";
import { fraseDaEdicao } from "@/textos/edicao";

export const dynamic = "force-dynamic";

/**
 * E47 PR 2: o vídeo bruto da edição, do navegador para o volume de edição. `PUT /api/edicao/<id>/video` com o ARQUIVO como corpo do pedido (não um formulário), e o tamanho dele no
 * `Content-Length`. Mesmas travas de `PUT /api/publicar/<id>/video` (E56): a marca vem da sessão, nunca do pedido; o "ver como" nunca envia (403); marca que precisa assinar recebe 402; só uma
 * edição desta marca que esteja subindo, com o tamanho igual ao declarado ao abrir. Diferente da publicação, o vídeo FICA guardado (até 48 horas) para a edição. O vídeo é conferido na hora
 * (duração, qualidade, som): o que não serve volta com 422 e a frase, e o arquivo é apagado. A resposta é pequena: `{ ok: true }` ou a frase. Rota, não Server Action: a Server Action
 * carrega o corpo na memória e tem teto de tamanho, e um vídeo tem até 300 MB.
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
  const edicaoId = idDoBancoOuNulo(id);
  if (edicaoId === null) return NextResponse.json({ erro: fraseDaEdicao("nao-achou"), codigo: "nao-achou" }, { status: 404 });

  const bruto = request.headers.get("content-length");
  const tamanhoDoPedido = bruto !== null && /^\d+$/.test(bruto) ? Number(bruto) : null;

  try {
    const resultado = await receberVideoDaEdicao({ clienteId: cliente.id, edicaoId, corpo: request.body, tamanhoDoPedido });
    if (!resultado.ok) return NextResponse.json({ erro: resultado.frase, codigo: resultado.codigo }, { status: resultado.status, headers: { "Cache-Control": "private, no-store" } });
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (erro) {
    logger.error({ err: erro, clienteId: cliente.id, edicaoId }, "edicao: o envio do video quebrou");
    return NextResponse.json({ erro: fraseDaEdicao("nao-comecou") }, { status: 500 });
  }
}
