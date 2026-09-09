import * as Sentry from "@sentry/node";
import { NextResponse } from "next/server";
import { chromium } from "playwright";

import { logger } from "@/lib/log";
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
 *
 * Guarda no Chromium (ajuste da revisão do PR #33, item 4): sem limite, dois
 * cliques seguidos (ou dois clientes ao mesmo tempo) abrem dois navegadores
 * num container que já divide a memória com o Next. `comLimiteDeChromium`
 * deixa no máximo `MAX_CHROMIUM_SIMULTANEO` rodando; o resto espera a vez,
 * no próprio processo (uma instância do servidor, sem fila externa). Os dois
 * `timeout` (`goto` e `pdf`) existem porque o padrão do Playwright (30 s)
 * seguraria a requisição, e quem clicou "baixar" o tempo todo, demais.
 */
const MAX_CHROMIUM_SIMULTANEO = 2;
const TEMPO_LIMITE_MS = 15_000;

let chromiumEmUso = 0;
const filaDeEspera: (() => void)[] = [];

async function comLimiteDeChromium<T>(tarefa: () => Promise<T>): Promise<T> {
  if (chromiumEmUso >= MAX_CHROMIUM_SIMULTANEO) {
    await new Promise<void>((resolve) => filaDeEspera.push(resolve));
  }
  chromiumEmUso += 1;
  try {
    return await tarefa();
  } finally {
    chromiumEmUso -= 1;
    filaDeEspera.shift()?.();
  }
}

function comTempoLimite<T>(promessa: Promise<T>, mensagem: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const temporizador = setTimeout(() => reject(new Error(mensagem)), TEMPO_LIMITE_MS);
    promessa.then(
      (valor) => {
        clearTimeout(temporizador);
        resolve(valor);
      },
      (erro) => {
        clearTimeout(temporizador);
        reject(erro);
      },
    );
  });
}

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

  try {
    const pdf = await comLimiteDeChromium(async () => {
      const navegador = await chromium.launch();
      try {
        const pagina = await navegador.newPage();
        await pagina.emulateMedia({ colorScheme: "light" });
        await pagina.goto(url, { waitUntil: "networkidle", timeout: TEMPO_LIMITE_MS });
        return await comTempoLimite(
          pagina.pdf({
            format: "A4",
            printBackground: true,
            margin: { top: "12mm", bottom: "12mm", left: "12mm", right: "12mm" },
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
    /**
     * Sem isso, um PDF que falha (timeout, container sem memória, o que
     * for) some sem deixar rastro (achado da revisão do PR #33, item 0b):
     * o cliente só via "tente de novo", e ninguém saberia que aconteceu.
     * `logger.error` primeiro (E6 parte 3, segunda rodada, item 0a): o
     * Sentry ainda não está ligado em produção (sem DSN é silêncio), então
     * sem isso o erro não deixava rastro nenhum lugar que alguém olhasse.
     */
    logger.error({ err: erro, roteiroId: roteiro.id, clienteId: cliente.id }, "nao foi possivel gerar o pdf");
    Sentry.captureException(erro, {
      tags: { rota: "roteiros-pdf" },
      extra: { roteiroId: roteiro.id, clienteId: cliente.id },
    });
    return NextResponse.json({ erro: "nao foi possivel gerar o pdf agora, tente de novo" }, { status: 504 });
  }
}
