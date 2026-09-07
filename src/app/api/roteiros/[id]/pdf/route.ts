import { NextResponse } from "next/server";
import { chromium } from "playwright";

import { sessaoAtual } from "@/lib/sessao";
import { criarTokenImpressao } from "@/lib/tokenImpressao";
import { clienteDoUsuario } from "@/servicos/clientes";
import { roteiroPorId } from "@/servicos/roteiro";

/**
 * O roteiro em PDF (`PROXIMO.md`, acabamento do iPad, item 5): a mesma
 * checagem de sessão e posse das outras rotas de `/roteiros/[id]`, depois o
 * Playwright abre `/roteiros/[id]/imprimir` num navegador sem sessão de
 * verdade (o token de `tokenImpressao.ts` resolve isso) e vira a página em
 * PDF. Escolhido em vez de `@react-pdf/renderer` porque a página de
 * impressão reaproveita `RoteiroTexto` e `BlocoEdicao`, os mesmos
 * componentes e os mesmos tokens do painel: o react-pdf teria que
 * reescrever o layout inteiro com os próprios primitivos (Document, Page,
 * Text, View), sem nada em comum com o HTML existente. O custo registrado
 * em `TODO.md`: a imagem do app ganha o Chromium do Playwright.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const sessao = await sessaoAtual();
  if (!sessao) {
    return NextResponse.json({ erro: "nao autenticado" }, { status: 401 });
  }

  const cliente = await clienteDoUsuario(sessao.user.id);
  if (!cliente) {
    return NextResponse.json({ erro: "nao autenticado" }, { status: 401 });
  }

  const { id } = await params;
  const roteiroId = Number(id);
  if (!Number.isFinite(roteiroId)) {
    return NextResponse.json({ erro: "roteiro invalido" }, { status: 404 });
  }

  const roteiro = await roteiroPorId(roteiroId, cliente.id);
  if (!roteiro) {
    return NextResponse.json({ erro: "roteiro nao encontrado" }, { status: 404 });
  }

  const token = criarTokenImpressao(roteiro.id, cliente.id);
  /**
   * `127.0.0.1:PORT`, nunca `config.appUrl` (achado testando a imagem de
   * produção): o Playwright roda dentro do próprio processo do servidor, e
   * `APP_URL` é o endereço público, atrás do proxy. Navegar para ele faria
   * o container sair para a internet só para voltar nele mesmo, e falha
   * quando o endereço público não resolve de dentro da rede da VPS.
   */
  const url = `http://127.0.0.1:${process.env.PORT ?? 3000}/roteiros/${roteiro.id}/imprimir?token=${encodeURIComponent(token)}`;

  const navegador = await chromium.launch();
  try {
    const pagina = await navegador.newPage();
    await pagina.emulateMedia({ colorScheme: "light" });
    await pagina.goto(url, { waitUntil: "networkidle" });
    const pdf = await pagina.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "16mm", bottom: "16mm", left: "14mm", right: "14mm" },
    });

    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="roteiro-${roteiro.data}.pdf"`,
      },
    });
  } finally {
    await navegador.close();
  }
}
