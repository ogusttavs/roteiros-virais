/**
 * E68: as cores do vídeo de animação a partir de UMA cor, a da marca, com as mesmas contas do carrossel (`carrossel/modelos.ts`): a cor passa por `garantirLeitura` (escurece a que é clara demais)
 * e o vídeo usa o modo escuro do carrossel: o fundo é a marca afundada no quase preto, o texto é quase branco e o destaque é a marca clareada. O contraste é conferido aqui, por código: o destaque
 * clareia mais até passar de 4,5 para 1 sobre o fundo (a régua do texto normal, mesmo sendo letra grande), e o texto passa de 7 para 1 (leitura de vídeo, que não volta).
 */
import { contraste, coresDoModo, garantirLeitura, misturarOklab } from "@/carrossel/modelos";

export const CONTRASTE_DO_DESTAQUE = 4.5;
export const CONTRASTE_DO_TEXTO = 7;

export type CoresDaAnimacao = {
  /** A cor da marca já com a leitura garantida (a do carrossel). */
  marca: string;
  fundo: string;
  texto: string;
  destaque: string;
  /** A tinta sobre o destaque cheio (a pílula do @): o próprio fundo, que já passa do contraste do destaque. */
  sobreDestaque: string;
};

const COR = /^#[0-9a-f]{6}$/;

export function coresDaAnimacao(corDaMarca: string): CoresDaAnimacao {
  const marca = garantirLeitura(corDaMarca.toLowerCase()).cor;
  const escuro = coresDoModo(marca, "escuro");
  const fundo = escuro.fundo;
  let destaque = escuro.acento;
  for (let i = 0; i < 20 && contraste(destaque, fundo) < CONTRASTE_DO_DESTAQUE; i += 1) destaque = misturarOklab(destaque, 85, "#ffffff");
  let texto = escuro.titulo;
  for (let i = 0; i < 20 && contraste(texto, fundo) < CONTRASTE_DO_TEXTO; i += 1) texto = misturarOklab(texto, 85, "#ffffff");
  const cores = { marca, fundo, texto, destaque, sobreDestaque: fundo };
  // As contas devolvem sempre "#rrggbb" minúsculo; a conferência fica para nada fora do formato chegar ao CSS do molde.
  for (const valor of Object.values(cores)) if (!COR.test(valor)) throw new Error("cor fora do formato");
  return cores;
}

/** "#rrggbb" em [r, g, b], para o script do molde misturar as cores quadro a quadro (só números vão para a página). */
export function canais(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}
