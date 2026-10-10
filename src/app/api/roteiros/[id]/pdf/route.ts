import * as Sentry from "@sentry/node";
import { NextResponse } from "next/server";
import { chromium } from "playwright";

import { comLimiteDeChromium, comTempoLimite, conferirPaginaDeImpressao, ErroFilaCheia, rodapeDoPdf, TEMPO_LIMITE_MS } from "@/lib/chromium-de-impressao";
import { pedidoComMarcas, roteiroDeQuemPediu, urlDeImpressao } from "@/lib/impressao-de-roteiro";
import { logger } from "@/lib/log";
import { dataPorExtenso } from "@/servicos/folha-do-roteiro";

/**
 * O roteiro em PDF (`PROXIMO.md`, acabamento do iPad, item 5; a folha nova é o passo 23 do Opus, E26): a mesma checagem de sessão e posse das outras rotas de `/roteiros/[id]`, depois o
 * Playwright abre `/roteiros/[id]/imprimir` num navegador sem sessão de verdade (o token de `tokenImpressao.ts` resolve isso) e vira a página em PDF. Escolhido em vez de
 * `@react-pdf/renderer` porque a página de impressão usa o mesmo HTML, os mesmos tokens e as mesmas fontes do painel: o react-pdf teria que reescrever o layout inteiro com os próprios
 * primitivos (Document, Page, Text, View), sem nada em comum com o HTML existente. O custo registrado em `TODO.md`: a imagem do app ganha o Chromium do Playwright.
 *
 * O pé de cada página ("Roteiro de <marca>, <data>" e "página 1 de 2") é o do próprio Chromium (`footerTemplate`): só ele sabe em que página está.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const doRoteiro = await roteiroDeQuemPediu(params);
  if (doRoteiro instanceof NextResponse) return doRoteiro;
  const { roteiro, cliente, somenteLeitura } = doRoteiro;

  try {
    // E41 2c: com `?marcas=1` as marcas de fala são escritas aqui, antes da vaga do Chromium (uma chamada de IA que demora não segura a fila do navegador).
    const comMarcas = await pedidoComMarcas(request, roteiro, cliente, somenteLeitura);
    const pdf = await comLimiteDeChromium(async () => {
      const navegador = await chromium.launch();
      try {
        const pagina = await navegador.newPage();
        await pagina.emulateMedia({ colorScheme: "light" });
        // O token nasce aqui, dentro da vaga: depois de esperar na fila ele já podia estar vencido (vale 60 s).
        const resposta = await pagina.goto(urlDeImpressao(roteiro, cliente, "a4", comMarcas), { waitUntil: "networkidle", timeout: TEMPO_LIMITE_MS });
        conferirPaginaDeImpressao(resposta);
        return await comTempoLimite(
          pagina.pdf({
            format: "A4",
            printBackground: true,
            displayHeaderFooter: true,
            headerTemplate: "<div></div>",
            footerTemplate: rodapeDoPdf(cliente.nome, dataPorExtenso(roteiro.data), comMarcas),
            // A legenda das marcas ocupa uma linha a mais no pé de cada página (o papel não abre a folha "Como ler as marcas").
            margin: { top: "14mm", bottom: comMarcas ? "24mm" : "18mm", left: "16mm", right: "16mm" },
          }),
          "tempo esgotado gerando o pdf",
        );
      } finally {
        await navegador.close();
      }
    });

    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="roteiro-${roteiro.data}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (erro) {
    if (erro instanceof ErroFilaCheia) {
      return NextResponse.json({ erro: "muitos pedidos agora, tente de novo em instantes" }, { status: 503 });
    }
    /**
     * Sem isso, um PDF que falha (timeout, container sem memória, o que for) some sem deixar rastro (achado da revisão do PR #33, item 0b): o cliente só via "tente de novo", e ninguém
     * saberia que aconteceu. `logger.error` primeiro (E6 parte 3, segunda rodada, item 0a): o Sentry ainda não está ligado em produção (sem DSN é silêncio), então sem isso o erro não
     * deixava rastro nenhum lugar que alguém olhasse.
     */
    logger.error({ err: erro, roteiroId: roteiro.id, clienteId: cliente.id }, "nao foi possivel gerar o pdf");
    Sentry.captureException(erro, {
      tags: { rota: "roteiros-pdf" },
      extra: { roteiroId: roteiro.id, clienteId: cliente.id },
    });
    return NextResponse.json({ erro: "nao foi possivel gerar o pdf agora, tente de novo" }, { status: 504 });
  }
}
