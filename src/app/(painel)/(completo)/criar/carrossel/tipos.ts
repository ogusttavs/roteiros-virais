import type { SlideDoCarrossel } from "@/config/carrossel";

/** O que as rotas `/api/carrossel` devolvem (E65 PR 2), como a tela usa. */
export type CarrosselDaTela = { id: number; tema: string; quantidade: number; cor: string; avisos: string[]; slides: SlideDoCarrossel[]; legenda: string; hashtags: string[] };
export type FotoDaTela = { id: number; ordem: number };
export type DadosDoCarrossel = {
  carrossel: CarrosselDaTela;
  fotos: FotoDaTela[];
  /** Qual foto cai em qual slide (a mesma conta do render). */
  fotosDosSlides: { foto: number | null; fotoDepois: number | null }[];
  slidesComFoto: boolean[];
};
export type PreviaDoSlide = { n: number; imagem: string; precisaEncurtar: boolean; semFoto: boolean };

/** Uma resposta de erro das rotas: a frase já é para a pessoa. */
export class ErroDaRota extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function pedir<T>(url: string, init?: RequestInit, falha = "Não deu certo agora. Tente de novo em instantes."): Promise<T> {
  let resposta: Response;
  try {
    resposta = await fetch(url, init);
  } catch {
    throw new ErroDaRota(falha, 0);
  }
  if (!resposta.ok) {
    let frase = falha;
    try {
      const dados = (await resposta.json()) as { erro?: string };
      if (dados.erro) frase = dados.erro;
    } catch {
      // o corpo não era JSON: vale a frase padrão
    }
    throw new ErroDaRota(frase, resposta.status);
  }
  return (await resposta.json()) as T;
}
