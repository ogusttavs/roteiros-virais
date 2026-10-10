import * as Sentry from "@sentry/node";
import { NextResponse } from "next/server";
import { chromium } from "playwright";

import { comLimiteDeChromium, comTempoLimite, conferirPaginaDeImpressao, ErroFilaCheia, TEMPO_LIMITE_MS } from "@/lib/chromium-de-impressao";
import { pedidoComMarcas, roteiroDeQuemPediu, urlDeImpressao } from "@/lib/impressao-de-roteiro";
import { logger } from "@/lib/log";
import { MAXIMO_DE_QUADROS, PAGINAR_QUADROS } from "@/lib/paginar-quadros";

/**
 * O roteiro em imagem para o celular (E26, passo 23 do Opus: "Guardar como imagem no celular"): a mesma checagem de sessão e posse do PDF, o mesmo Chromium e a mesma página de impressão, só
 * que no formato 9:16 (`formato=celular`, 360 por 640, fotografado a três vezes: 1080 por 1920, o tamanho de um vídeo vertical). É a fala e o que aparece na tela (o texto na tela, a cena), em
 * letra menor, com o tempo de cada bloco; o "Como editar" e o "De onde veio" ficam no PDF. O que não cabe num quadro vai para o seguinte (`PAGINAR_QUADROS` mede o espaço no próprio
 * navegador), até `MAXIMO_DE_QUADROS`. Devolve JSON com as imagens em base64, na ordem: o aparelho da pessoa decide se divide ("Guardar") ou baixa uma a uma; uma imagem só por pedido
 * obrigaria a abrir o Chromium de novo para cada quadro. `cortados` diz quantos quadros saíram com texto cortado mesmo depois de encolher a letra (não deve acontecer).
 */
const LARGURA = 360;
const ALTURA = 640;
const ESCALA = 3;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const doRoteiro = await roteiroDeQuemPediu(params);
  if (doRoteiro instanceof NextResponse) return doRoteiro;
  const { roteiro, cliente, somenteLeitura } = doRoteiro;

  try {
    // E41 2c: com `?marcas=1` as marcas de fala são escritas aqui, antes da vaga do Chromium.
    const comMarcas = await pedidoComMarcas(request, roteiro, cliente, somenteLeitura);
    const resultado = await comLimiteDeChromium(async () => {
      const navegador = await chromium.launch();
      try {
        const pagina = await navegador.newPage({ viewport: { width: LARGURA + 48, height: ALTURA + 48 }, deviceScaleFactor: ESCALA });
        await pagina.emulateMedia({ colorScheme: "light" });
        // O token nasce aqui, dentro da vaga: depois de esperar na fila ele já podia estar vencido (vale 60 s).
        const resposta = await pagina.goto(urlDeImpressao(roteiro, cliente, "celular", comMarcas), { waitUntil: "networkidle", timeout: TEMPO_LIMITE_MS });
        conferirPaginaDeImpressao(resposta);
        // As fontes do painel têm de estar carregadas antes de medir o que cabe.
        await comTempoLimite(pagina.evaluate("document.fonts.ready.then(() => true)"), "tempo esgotado esperando as fontes");
        const medida = JSON.parse(String(await comTempoLimite(pagina.evaluate(PAGINAR_QUADROS), "tempo esgotado dividindo a imagem"))) as { quadros: number; cortados: number };
        if (medida.quadros < 1 || medida.quadros > MAXIMO_DE_QUADROS) throw new Error(`a imagem teria ${medida.quadros} quadros (o maximo e ${MAXIMO_DE_QUADROS})`);
        const fotos: string[] = [];
        for (let i = 0; i < medida.quadros; i += 1) {
          const foto = await comTempoLimite(pagina.locator("[data-quadro]").nth(i).screenshot({ type: "png" }), "tempo esgotado gerando a imagem");
          fotos.push(foto.toString("base64"));
        }
        return { imagens: fotos, cortados: medida.cortados };
      } finally {
        await navegador.close();
      }
    });
    if (resultado.cortados > 0) logger.warn({ roteiroId: roteiro.id, clienteId: cliente.id, cortados: resultado.cortados }, "imagem do roteiro com quadro cortado");

    return NextResponse.json({ nome: `roteiro-${roteiro.data}`, imagens: resultado.imagens, cortados: resultado.cortados }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (erro) {
    if (erro instanceof ErroFilaCheia) {
      return NextResponse.json({ erro: "muitos pedidos agora, tente de novo em instantes" }, { status: 503 });
    }
    logger.error({ err: erro, roteiroId: roteiro.id, clienteId: cliente.id }, "nao foi possivel gerar a imagem do roteiro");
    Sentry.captureException(erro, {
      tags: { rota: "roteiros-imagem" },
      extra: { roteiroId: roteiro.id, clienteId: cliente.id },
    });
    return NextResponse.json({ erro: "nao foi possivel gerar a imagem agora, tente de novo" }, { status: 504 });
  }
}
