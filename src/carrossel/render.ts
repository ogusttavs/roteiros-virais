/**
 * E65 PR 1 e 2: o render do carrossel, HTML para PNG, um por slide, 1080 por 1350, no mesmo Chromium e na mesma vaga do PDF e da imagem do roteiro (`comLimiteDeChromium`: no máximo
 * dois navegadores, fila de seis, 15 s por passo). Um navegador por pedido, uma página, todos os slides em sequência. Antes de cada foto, `CONFERIR_TEXTO` mede o corpo no próprio navegador: desce UM passo
 * de letra e, se ainda passar, NUNCA corta o texto: o slide sai marcado como "precisa encurtar" e a tela diz isso para a pessoa.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { LARGURA_DO_SLIDE, ALTURA_DO_SLIDE, type SlideDoCarrossel } from "@/config/carrossel";
import { comLimiteDeChromium, comTempoLimite } from "@/lib/chromium-de-impressao";
import { abrirChromiumSemRede, paginaSemRede } from "@/lib/chromium-sem-rede";
import { logger } from "@/lib/log";

import { distribuirFotos, fotoDeFundoDoSlide } from "./fotos";
import { PASSOS_DE_REFORCO, TIPOS_ILUSTRADOS_COMO_FOTO, TIPOS_ILUSTRADOS_COMO_FUNDO, aceitaIlustracao, estilosDaMistura, textosReprovados, type EstiloDaIlustracao, type TextoMedido } from "./ilustracao";
import { CONFERIR_TEXTO, faltaFoto, htmlDoSlide, modosDosSlides, type FotoParaOModelo } from "./modelos";

export { distribuirFotos } from "./fotos";

export type FotoDoCarrossel = { id: number; tipo: string; bytes: Buffer; dePaciente?: boolean };
/** E69: a ilustracao de um slide (indice a partir de 0), ja em JPEG 1080 por 1350. `generica` pede o estilo forte. */
export type IlustracaoDoCarrossel = { indice: number; tipo: string; bytes: Buffer; generica?: boolean };

/**
 * Le, no navegador, cada texto do slide: a cor da letra (o canvas converte qualquer cor do CSS para RGB), o tamanho e a caixa de cada linha. Roda dentro da pagina.
 */
const COLETAR_TEXTOS = `(() => {
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const rgb = (css) => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = css; ctx.fillRect(0, 0, 1, 1); const d = ctx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2]]; };
  const saida = [];
  const andar = (el) => {
    const temTexto = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim());
    if (temTexto) {
      const estilo = getComputedStyle(el);
      const caixas = [];
      for (const n of el.childNodes) {
        if (n.nodeType !== 3 || !n.textContent.trim()) continue;
        const r = document.createRange(); r.selectNodeContents(n);
        for (const c of r.getClientRects()) if (c.width > 1 && c.height > 1) caixas.push([c.x, c.y, c.width, c.height]);
      }
      if (caixas.length) saida.push({ cor: rgb(estilo.color), tamanho: parseFloat(estilo.fontSize), caixas, trecho: el.textContent.trim().slice(0, 24) });
    }
    for (const f of el.children) andar(f);
  };
  andar(document.querySelector('.slide'));
  return saida;
})()`;

/** Le os pixels de uma imagem nas caixas dos textos (a imagem pode estar em escala menor que o slide). Roda dentro da pagina. */
const AMOSTRAR_PIXELS = `(async ({ png, textos, largura }) => {
  const img = await createImageBitmap(await (await fetch('data:image/png;base64,' + png)).blob());
  const tela = document.createElement('canvas'); tela.width = img.width; tela.height = img.height;
  const ctx = tela.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, 0, 0);
  const k = img.width / largura;
  return textos.map((t) => {
    const pixels = [];
    for (const [x, y, w, h] of t.caixas) {
      const passo = Math.max(1, Math.round(Math.sqrt((w * h * k * k) / 120)));
      for (let py = Math.max(0, Math.floor(y * k)); py < Math.min(img.height, Math.ceil((y + h) * k)); py += passo)
        for (let px = Math.max(0, Math.floor(x * k)); px < Math.min(img.width, Math.ceil((x + w) * k)); px += passo) {
          const d = ctx.getImageData(px, py, 1, 1).data; pixels.push([d[0], d[1], d[2]]);
        }
    }
    return { cor: t.cor, tamanho: t.tamanho, pixels, trecho: t.trecho };
  });
})`;

/** O contraste do texto no pixel de verdade: com a letra escondida, fotografa o slide e le o que fica atras de cada linha de texto. Reprovado, o render reforca o veu e tenta de novo. */
export async function contrasteDaPaginaPassa(pagina: import("playwright").Page): Promise<boolean> {
  const textos = (await comTempoLimite(pagina.evaluate(COLETAR_TEXTOS), "tempo esgotado lendo os textos")) as { cor: [number, number, number]; tamanho: number; caixas: number[][]; trecho: string }[];
  const estilo = await pagina.addStyleTag({ content: ".slide, .slide * { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; }" });
  try {
    const vazio = await comTempoLimite(pagina.screenshot({ type: "png", clip: { x: 0, y: 0, width: LARGURA_DO_SLIDE, height: ALTURA_DO_SLIDE } }), "tempo esgotado fotografando o fundo");
    const amostras = (await comTempoLimite(
      pagina.evaluate(`${AMOSTRAR_PIXELS}(${JSON.stringify({ png: vazio.toString("base64"), textos, largura: LARGURA_DO_SLIDE })})`),
      "tempo esgotado medindo o fundo",
    )) as TextoMedido[];
    const reprovados = textosReprovados(amostras);
    if (reprovados.length > 0) logger.debug({ reprovados }, "carrossel: contraste da ilustracao abaixo do piso, o veu sera reforcado");
    return reprovados.length === 0;
  } finally {
    await estilo.evaluate((e) => (e as Element).remove());
  }
}

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

export type SlideRenderizado = {
  png: Buffer;
  /** O texto não coube nem um passo abaixo: a pessoa precisa encurtar. */
  precisaEncurtar: boolean;
  /** O tipo pede uma foto e o slide não tem. */
  semFoto: boolean;
  /** E69: como a imagem entrou (foto, ou fundo no estilo leve ou forte), de quem era e quantos reforços de véu o contraste pediu; nulo sem imagem de ilustração. */
  imagem: { como: "foto" | "fundo"; origem: "ilustracao" | "pessoa"; estilo: EstiloDaIlustracao | null; reforco: number } | null;
};
export type ResultadoDoRender = { png: Buffer[]; slides: SlideRenderizado[]; avisos: string[] };

export async function renderizarSlides(entrada: {
  slides: SlideDoCarrossel[];
  fotos: FotoDoCarrossel[];
  /** Marca de saúde: foto de paciente só em antes e depois e resultado, foto comum nunca neles (E65 PR 5). */
  separarFotoDePaciente?: boolean;
  cor: string;
  arroba?: string;
  /** E69: as ilustrações por slide (quem chama já filtra pela chave `ILUSTRACAO_ATIVA`). Ausente, os slides saem como antes. */
  ilustracoes?: IlustracaoDoCarrossel[];
  /** E69: marca de saúde, o slide com ilustração leva a linha fixa "Imagem ilustrativa". */
  marcarIlustrativa?: boolean;
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
  const escolhidas = distribuirFotos(entrada.slides, entrada.fotos, entrada.separarFotoDePaciente === true);
  const ilustracaoDe = new Map((entrada.ilustracoes ?? []).map((i) => [i.indice, i] as const));
  const modeloDeBytes = (tipo: string, bytes: Buffer): FotoParaOModelo => ({ tipo, base64: bytes.toString("base64") });
  type Imagem = { como: "foto" | "fundo"; origem: "ilustracao" | "pessoa"; modelo: FotoParaOModelo; generica: boolean };
  // E69: a imagem de cada slide. A foto da pessoa SEMPRE vence a ilustração; antes e depois e resultado nunca recebem ilustração. Nos tipos de foto (capa com foto, notícia) a ilustração entra como foto; nos de texto,
  // como fundo do slide inteiro (a foto da pessoa que o slide aponta entra do mesmo jeito, no lugar dela).
  const imagens: (Imagem | null)[] = entrada.slides.map((s, i) => {
    if (!aceitaIlustracao(s.tipo)) return null;
    const ilus = ilustracaoDe.get(i);
    if (TIPOS_ILUSTRADOS_COMO_FOTO.has(s.tipo)) return escolhidas[i].foto === null && ilus ? { como: "foto", origem: "ilustracao", modelo: modeloDeBytes(ilus.tipo, ilus.bytes), generica: false } : null;
    if (!TIPOS_ILUSTRADOS_COMO_FUNDO.has(s.tipo) || (s.tipo === "passo" && escolhidas[i].foto !== null)) return null;
    const idDaPessoa = fotoDeFundoDoSlide(s, entrada.fotos, entrada.separarFotoDePaciente === true);
    const daPessoa = idDaPessoa === null ? null : paraModelo(idDaPessoa);
    if (daPessoa) return { como: "fundo", origem: "pessoa", modelo: daPessoa, generica: false };
    return ilus ? { como: "fundo", origem: "ilustracao", modelo: modeloDeBytes(ilus.tipo, ilus.bytes), generica: ilus.generica === true } : null;
  });
  const modos = modosDosSlides(entrada.slides.map((s, i) => ({ tipo: s.tipo, comFoto: escolhidas[i].foto !== null || imagens[i]?.como === "foto" })));
  const estilos = estilosDaMistura(entrada.slides.map((s, i) => ({ tipo: s.tipo, comFundo: imagens[i]?.como === "fundo", generica: imagens[i]?.generica })));
  const fontes = { mona: letraDoProjeto("monasans-latin.woff2"), mono: letraDoProjeto("jetbrainsmono-latin.woff2") };
  const fundos = fundosDoProjeto();
  const escala = Math.min(1, Math.max(0.1, entrada.escala ?? 1));

  const slides = await comLimiteDeChromium(async () => {
    // M4 (auditoria de 26/11/2026): sem rede e sem o JavaScript da página; só o que vem embutido no HTML do slide (`data:`) carrega.
    const navegador = await abrirChromiumSemRede();
    try {
      const pagina = await paginaSemRede(navegador, { viewport: { width: LARGURA_DO_SLIDE, height: ALTURA_DO_SLIDE }, deviceScaleFactor: escala });
      await pagina.emulateMedia({ colorScheme: "light" });
      const feitos: SlideRenderizado[] = [];
      for (let i = 0; i < entrada.slides.length; i += 1) {
        if (entrada.somente !== undefined && entrada.somente !== i) continue;
        const imagem = imagens[i];
        const foto = imagem?.como === "foto" ? imagem.modelo : paraModelo(escolhidas[i].foto);
        let reforco = 0;
        let conferencia: { estourou: boolean };
        for (;;) {
          const html = htmlDoSlide({
            slide: entrada.slides[i],
            numero: i + 1,
            total: entrada.slides.length,
            cor: entrada.cor,
            arroba: entrada.arroba ?? "",
            modo: modos[i],
            foto,
            fotoDepois: paraModelo(escolhidas[i].fotoDepois),
            ilustracao: imagem?.como === "fundo" && estilos[i] ? { ...imagem.modelo, estilo: estilos[i]!, reforco } : null,
            reforcoDaProtecao: imagem?.como === "foto" ? reforco : 0,
            ilustrativa: entrada.marcarIlustrativa === true && imagem?.origem === "ilustracao",
            fundos,
            fontes,
          });
          await comTempoLimite(pagina.setContent(html, { waitUntil: "load" }), "tempo esgotado montando o slide");
          await comTempoLimite(pagina.evaluate("document.fonts.ready.then(() => true)"), "tempo esgotado esperando a letra");
          conferencia = JSON.parse(String(await comTempoLimite(pagina.evaluate(CONFERIR_TEXTO), "tempo esgotado medindo o texto"))) as { estourou: boolean };
          // E69: com a ilustração atrás do texto, o contraste é medido no pixel de verdade; não passou, reforça o véu e refaz.
          if (!imagem || imagem.origem !== "ilustracao" || reforco >= PASSOS_DE_REFORCO || (await contrasteDaPaginaPassa(pagina))) break;
          reforco += 1;
        }
        if (conferencia.estourou) avisos.push(`slide ${i + 1}: o texto nao coube, precisa encurtar`);
        const png = await comTempoLimite(pagina.screenshot({ type: "png", clip: { x: 0, y: 0, width: LARGURA_DO_SLIDE, height: ALTURA_DO_SLIDE } }), "tempo esgotado gerando a imagem");
        feitos.push({
          png,
          precisaEncurtar: conferencia.estourou,
          semFoto: faltaFoto(entrada.slides[i], foto !== null),
          imagem: imagem ? { como: imagem.como, origem: imagem.origem, estilo: imagem.como === "fundo" ? estilos[i] : null, reforco } : null,
        });
      }
      return feitos;
    } finally {
      await navegador.close();
    }
  });
  return { png: slides.map((s) => s.png), slides, avisos };
}
