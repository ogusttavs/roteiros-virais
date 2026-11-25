/**
 * E65 PR 1: o render do carrossel, HTML para PNG, um por slide, 1080 por 1350, no mesmo Chromium e na mesma vaga do PDF e da imagem do roteiro (`comLimiteDeChromium`: no máximo
 * dois navegadores, fila de seis, 15 s por passo). Um navegador por pedido, uma página, todos os slides em sequência. Antes de cada foto, `AJUSTAR_CAIXAS` mede as caixas no próprio navegador
 * (letra menor, e só em último caso corta o fim do texto); o que foi cortado volta em `avisos`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { chromium } from "playwright";

import { ALTURA_DO_SLIDE, LARGURA_DO_SLIDE, TIPOS_COM_FOTO, type SlideDoCarrossel } from "@/config/carrossel";
import { comLimiteDeChromium, comTempoLimite } from "@/lib/chromium-de-impressao";
import { logger } from "@/lib/log";

import { AJUSTAR_CAIXAS, htmlDoSlide, type FotoParaOModelo } from "./modelos";
import { ajustarAosLimites } from "./regras";

export type FotoDoCarrossel = { id: number; tipo: string; bytes: Buffer };

let fonteEmBase64: string | null | undefined;

/** A letra do projeto (Mona Sans), lida uma vez; se o arquivo não está onde se espera (a imagem de produção copia `src/ui/fontes`), o render segue com a letra do sistema. */
function fonteDoProjeto(): string | null {
  if (fonteEmBase64 !== undefined) return fonteEmBase64;
  try {
    fonteEmBase64 = readFileSync(path.join(process.cwd(), "src", "ui", "fontes", "monasans-latin.woff2")).toString("base64");
  } catch {
    logger.warn("carrossel: a fonte monasans-latin.woff2 nao foi achada, o render usa a letra do sistema");
    fonteEmBase64 = null;
  }
  return fonteEmBase64;
}

/**
 * Qual foto vai em qual slide: a que o slide aponta (`fotoId`), e, sem apontar, as fotos que sobraram na ordem em que foram enviadas, só nos tipos que aceitam foto (o antes e depois leva duas).
 * Pura: o teste prova a distribuição sem navegador.
 */
export function distribuirFotos(slides: SlideDoCarrossel[], fotosEmOrdem: { id: number }[]): { foto: number | null; fotoDepois: number | null }[] {
  const existentes = new Set(fotosEmOrdem.map((f) => f.id));
  const apontadas = new Set<number>();
  for (const s of slides) {
    if (s.fotoId && existentes.has(s.fotoId)) apontadas.add(s.fotoId);
    if (s.fotoDepoisId && existentes.has(s.fotoDepoisId)) apontadas.add(s.fotoDepoisId);
  }
  const livres = fotosEmOrdem.filter((f) => !apontadas.has(f.id)).map((f) => f.id);
  return slides.map((s) => {
    if (!TIPOS_COM_FOTO.has(s.tipo)) return { foto: null, fotoDepois: null };
    const foto = s.fotoId && existentes.has(s.fotoId) ? s.fotoId : (livres.shift() ?? null);
    const fotoDepois = s.tipo === "antes_depois" ? (s.fotoDepoisId && existentes.has(s.fotoDepoisId) ? s.fotoDepoisId : (livres.shift() ?? null)) : null;
    return { foto, fotoDepois };
  });
}

export type ResultadoDoRender = { png: Buffer[]; avisos: string[] };

export async function renderizarSlides(entrada: { slides: SlideDoCarrossel[]; fotos: FotoDoCarrossel[]; cor: string; /** Só este slide (índice a partir de 0); ausente, todos. */ somente?: number }): Promise<ResultadoDoRender> {
  const avisos: string[] = [];
  const ajustados = entrada.slides.map((s) => {
    const r = ajustarAosLimites(s);
    avisos.push(...r.cortou.map((c) => `slide ${entrada.slides.indexOf(s) + 1}: ${c}`));
    return r.slide;
  });
  const porId = new Map(entrada.fotos.map((f) => [f.id, f] as const));
  const paraModelo = (id: number | null): FotoParaOModelo | null => {
    const f = id ? porId.get(id) : undefined;
    return f ? { tipo: f.tipo, base64: f.bytes.toString("base64") } : null;
  };
  const escolhidas = distribuirFotos(ajustados, entrada.fotos);
  const fonte = fonteDoProjeto();

  const png = await comLimiteDeChromium(async () => {
    const navegador = await chromium.launch();
    try {
      const pagina = await navegador.newPage({ viewport: { width: LARGURA_DO_SLIDE, height: ALTURA_DO_SLIDE }, deviceScaleFactor: 1 });
      await pagina.emulateMedia({ colorScheme: "light" });
      const fotos: Buffer[] = [];
      for (let i = 0; i < ajustados.length; i += 1) {
        if (entrada.somente !== undefined && entrada.somente !== i) continue;
        const html = htmlDoSlide({
          slide: ajustados[i],
          numero: i + 1,
          total: ajustados.length,
          cor: entrada.cor,
          foto: paraModelo(escolhidas[i].foto),
          fotoDepois: paraModelo(escolhidas[i].fotoDepois),
          fonteBase64: fonte,
        });
        await comTempoLimite(pagina.setContent(html, { waitUntil: "load" }), "tempo esgotado montando o slide");
        await comTempoLimite(pagina.evaluate("document.fonts.ready.then(() => true)"), "tempo esgotado esperando a letra");
        const cortados = JSON.parse(String(await comTempoLimite(pagina.evaluate(AJUSTAR_CAIXAS), "tempo esgotado medindo o texto"))) as string[];
        if (cortados.length > 0) avisos.push(`slide ${i + 1}: texto cortado para caber na caixa (${cortados.join(", ")})`);
        fotos.push(await comTempoLimite(pagina.screenshot({ type: "png", clip: { x: 0, y: 0, width: LARGURA_DO_SLIDE, height: ALTURA_DO_SLIDE } }), "tempo esgotado gerando a imagem"));
      }
      return fotos;
    } finally {
      await navegador.close();
    }
  });
  return { png, avisos };
}
