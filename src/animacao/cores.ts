/**
 * E68: as cores do vídeo de animação a partir de UMA cor, a da marca (a mesma do carrossel, `clientes.cor_marca`). O vídeo é escuro de propósito (texto claro sobre fundo escuro é o que se lê
 * melhor no celular, e a cor chapada escura comprime bem):
 * - fundo: a marca afundada no quase preto, a mesma conta do modo escuro do carrossel (`coresDoModo`);
 * - texto: quase branco, com pelo menos 7 para 1 sobre o fundo (leitura de vídeo, que não volta);
 * - destaque: a própria cor da marca, se ela já passa de 4,5 para 1 sobre o fundo (um laranja, um dourado, um rosa); senão, a mesma cor clareada SEM perder a saturação (sobe a luminosidade em
 *   oklab e mantém o tom e a força da cor), até passar de 4,5 para 1. A mistura com branco do carrossel deixava um azul-petróleo cinzento, apagado demais para ser o único acento do vídeo.
 * - marca sem cor (preto, branco, cinza): não há tom para clarear, então o destaque é o dourado do produto (`MARCA_PADRAO`), que lê bem sobre o fundo escuro.
 * Tudo conferido aqui, por código; o molde só recebe `#rrggbb`.
 */
import { contraste, coresDoModo, misturarOklab } from "@/carrossel/modelos";

import { MARCA_PADRAO } from "./montador";

export const CONTRASTE_DO_DESTAQUE = 4.5;
export const CONTRASTE_DO_TEXTO = 7;
/** Abaixo desta força de cor (croma em oklab), a marca é tratada como sem cor. */
export const CROMA_MINIMO = 0.03;

export type CoresDaAnimacao = {
  fundo: string;
  texto: string;
  destaque: string;
  /** A tinta sobre o destaque cheio (a pílula do @): o próprio fundo, que já passa do contraste do destaque. */
  sobreDestaque: string;
};

const COR = /^#[0-9a-f]{6}$/;

// As contas de oklab (as mesmas fórmulas de `carrossel/modelos.ts`, que não as exporta).
const linear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gama = (c: number): number => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.max(c, 0) ** (1 / 2.4) - 0.055);
const paraHex = (canais: number[]): string => `#${canais.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;

/** "#rrggbb" em [r, g, b], para o script do molde misturar as cores quadro a quadro (só números vão para a página). */
export function canais(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

function paraOklab(hex: string): [number, number, number] {
  const [r, g, b] = canais(hex).map((v) => linear(v / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

function deOklab([L, a, b]: [number, number, number]): string {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return paraHex([
    gama(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s) * 255,
    gama(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s) * 255,
    gama(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s) * 255,
  ]);
}

/** A força da cor (croma em oklab): 0 no cinza, perto de 0,3 numa cor bem viva. */
export function cromaDe(hex: string): number {
  const [, a, b] = paraOklab(hex);
  return Math.hypot(a, b);
}

/** A cor clareada mantendo o tom e a força: sobe a luminosidade em oklab de 0,01 em 0,01 até passar do contraste pedido sobre o fundo. */
function clarearMantendoACor(hex: string, fundo: string, alvo: number): string {
  const [L, a, b] = paraOklab(hex);
  for (let l = L; l <= 1; l += 0.01) {
    const cor = deOklab([l, a, b]);
    if (contraste(cor, fundo) >= alvo) return cor;
  }
  // Nunca deveria chegar aqui (o branco passa de 4,5 sobre qualquer fundo deste molde), mas por garantia: a mistura com branco do carrossel.
  let cor = hex;
  for (let i = 0; i < 40 && contraste(cor, fundo) < alvo; i += 1) cor = misturarOklab(cor, 85, "#ffffff");
  return cor;
}

export function coresDaAnimacao(corDaMarca: string): CoresDaAnimacao {
  const marca = corDaMarca.toLowerCase();
  const fundo = coresDoModo(marca, "escuro").fundo;
  let texto = coresDoModo(marca, "escuro").titulo;
  for (let i = 0; i < 20 && contraste(texto, fundo) < CONTRASTE_DO_TEXTO; i += 1) texto = misturarOklab(texto, 85, "#ffffff");
  const tom = cromaDe(marca) >= CROMA_MINIMO ? marca : MARCA_PADRAO.corDestaque;
  const destaque = contraste(tom, fundo) >= CONTRASTE_DO_DESTAQUE ? tom : clarearMantendoACor(tom, fundo, CONTRASTE_DO_DESTAQUE);
  const cores = { fundo, texto, destaque, sobreDestaque: fundo };
  // As contas devolvem sempre "#rrggbb" minúsculo; a conferência fica para nada fora do formato chegar ao CSS do molde.
  for (const valor of Object.values(cores)) if (!COR.test(valor)) throw new Error("cor fora do formato");
  return cores;
}
