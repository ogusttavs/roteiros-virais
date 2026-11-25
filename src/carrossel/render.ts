/**
 * E65 PR 1 e 2: o render do carrossel, HTML para PNG, um por slide, 1080 por 1350, no mesmo Chromium e na mesma vaga do PDF e da imagem do roteiro (`comLimiteDeChromium`: no máximo
 * dois navegadores, fila de seis, 15 s por passo). Um navegador por pedido, uma página, todos os slides em sequência. Antes de cada foto, `CONFERIR_TEXTO` mede o corpo no próprio navegador: desce UM passo
 * de letra e, se ainda passar, NUNCA corta o texto: o slide sai marcado como "precisa encurtar" e a tela diz isso para a pessoa.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { chromium } from "playwright";

import { LARGURA_DO_SLIDE, ALTURA_DO_SLIDE, type SlideDoCarrossel } from "@/config/carrossel";
import { comLimiteDeChromium, comTempoLimite } from "@/lib/chromium-de-impressao";
import { logger } from "@/lib/log";

import { distribuirFotos } from "./fotos";
import { CONFERIR_TEXTO, faltaFoto, htmlDoSlide, modosDosSlides, type FotoParaOModelo } from "./modelos";

export { distribuirFotos } from "./fotos";

export type FotoDoCarrossel = { id: number; tipo: string; bytes: Buffer };

let fundosEmBase64: string[] | undefined;

/** Os seis fundos abstratos, lidos uma vez de `src/carrossel/fundos` (a imagem de produção os copia); se faltam, os slides saem com o fundo liso. */
function fundosDoProjeto(): string[] | null {
  if (fundosEmBase64 === undefined) {
    try {
      fundosEmBase64 = Array.from({ length: 6 }, (_, i) => readFileSync(path.join(process.cwd(), "src", "carrossel", "fundos", `fundo-0${i + 1}.jpg`)).toString("base64"));
    } catch {
      logger.warn("carrossel: os fundos abstratos nao foram achados, os slides saem com o fundo liso");
      fundosEmBase64 = [];
    }
  }
  return fundosEmBase64.length === 6 ? fundosEmBase64 : null;
}

const fontesEmBase64: Record<string, string | null> = {};

/** Uma letra do projeto, lida uma vez; se o arquivo não está onde se espera (a imagem de produção copia `src/ui/fontes`), o render segue com a letra do sistema. */
function letraDoProjeto(arquivo: string): string | null {
  if (arquivo in fontesEmBase64) return fontesEmBase64[arquivo];
  try {
    fontesEmBase64[arquivo] = readFileSync(path.join(process.cwd(), "src", "ui", "fontes", arquivo)).toString("base64");
  } catch {
    logger.warn(`carrossel: a fonte ${arquivo} nao foi achada, o render usa a letra do sistema`);
    fontesEmBase64[arquivo] = null;
  }
  return fontesEmBase64[arquivo];
}

export type SlideRenderizado = { png: Buffer; /** O texto não coube nem um passo abaixo: a pessoa precisa encurtar. */ precisaEncurtar: boolean; /** O tipo pede uma foto e o slide não tem. */ semFoto: boolean };
export type ResultadoDoRender = { png: Buffer[]; slides: SlideRenderizado[]; avisos: string[] };

export async function renderizarSlides(entrada: {
  slides: SlideDoCarrossel[];
  fotos: FotoDoCarrossel[];
  cor: string;
  arroba?: string;
  /** Só este slide (índice a partir de 0); ausente, todos. */
  somente?: number;
  /** 1 é o PNG final de 1080 por 1350; menor, a prévia da tela (0,4 dá 432 por 540). */
  escala?: number;
}): Promise<ResultadoDoRender> {
  const avisos: string[] = [];
  const porId = new Map(entrada.fotos.map((f) => [f.id, f] as const));
  const paraModelo = (id: number | null): FotoParaOModelo | null => {
    const f = id ? porId.get(id) : undefined;
    return f ? { tipo: f.tipo, base64: f.bytes.toString("base64") } : null;
  };
  const escolhidas = distribuirFotos(entrada.slides, entrada.fotos);
  const modos = modosDosSlides(entrada.slides.map((s, i) => ({ tipo: s.tipo, comFoto: escolhidas[i].foto !== null })));
  const fontes = { mona: letraDoProjeto("monasans-latin.woff2"), mono: letraDoProjeto("jetbrainsmono-latin.woff2") };
  const fundos = fundosDoProjeto();
  const escala = Math.min(1, Math.max(0.1, entrada.escala ?? 1));

  const slides = await comLimiteDeChromium(async () => {
    const navegador = await chromium.launch();
    try {
      const pagina = await navegador.newPage({ viewport: { width: LARGURA_DO_SLIDE, height: ALTURA_DO_SLIDE }, deviceScaleFactor: escala });
      await pagina.emulateMedia({ colorScheme: "light" });
      const feitos: SlideRenderizado[] = [];
      for (let i = 0; i < entrada.slides.length; i += 1) {
        if (entrada.somente !== undefined && entrada.somente !== i) continue;
        const foto = paraModelo(escolhidas[i].foto);
        const html = htmlDoSlide({
          slide: entrada.slides[i],
          numero: i + 1,
          total: entrada.slides.length,
          cor: entrada.cor,
          arroba: entrada.arroba ?? "",
          modo: modos[i],
          foto,
          fotoDepois: paraModelo(escolhidas[i].fotoDepois),
          fundos,
          fontes,
        });
        await comTempoLimite(pagina.setContent(html, { waitUntil: "load" }), "tempo esgotado montando o slide");
        await comTempoLimite(pagina.evaluate("document.fonts.ready.then(() => true)"), "tempo esgotado esperando a letra");
        const conferencia = JSON.parse(String(await comTempoLimite(pagina.evaluate(CONFERIR_TEXTO), "tempo esgotado medindo o texto"))) as { estourou: boolean };
        if (conferencia.estourou) avisos.push(`slide ${i + 1}: o texto nao coube, precisa encurtar`);
        const png = await comTempoLimite(pagina.screenshot({ type: "png", clip: { x: 0, y: 0, width: LARGURA_DO_SLIDE, height: ALTURA_DO_SLIDE } }), "tempo esgotado gerando a imagem");
        feitos.push({ png, precisaEncurtar: conferencia.estourou, semFoto: faltaFoto(entrada.slides[i], foto !== null) });
      }
      return feitos;
    } finally {
      await navegador.close();
    }
  });
  return { png: slides.map((s) => s.png), slides, avisos };
}
