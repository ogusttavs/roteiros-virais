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

/** Um carrossel da lista "Os seus carrosséis". */
export type CarrosselRecente = { id: number; tema: string; quantidade: number; criadoEm: string };

/** O lado maior de uma foto antes de ir ao servidor, e a qualidade do JPEG (foto de iPhone de 12 MB cabe no teto de 6 MB depois disto). */
export const LADO_MAXIMO_DA_FOTO = 2160;
export const QUALIDADE_DO_JPEG = 0.85;

/**
 * Reduz a foto no navegador antes de enviar: no máximo 2160 px no lado maior, JPEG de qualidade 0,85, respeitando a rotação do aparelho. Foto que já cabe nos dois (lado e peso) segue como está. Se o
 * navegador não consegue ler ou desenhar, devolve a foto original e o teto do servidor responde por ela.
 */
export async function reduzirFoto(arquivo: File, tetoDeBytes: number): Promise<File> {
  try {
    const imagem = await createImageBitmap(arquivo, { imageOrientation: "from-image" });
    const maior = Math.max(imagem.width, imagem.height);
    if (maior <= LADO_MAXIMO_DA_FOTO && arquivo.size <= tetoDeBytes) {
      imagem.close();
      return arquivo;
    }
    const escala = Math.min(1, LADO_MAXIMO_DA_FOTO / maior);
    const tela = document.createElement("canvas");
    tela.width = Math.max(1, Math.round(imagem.width * escala));
    tela.height = Math.max(1, Math.round(imagem.height * escala));
    const contexto = tela.getContext("2d");
    if (!contexto) {
      imagem.close();
      return arquivo;
    }
    contexto.drawImage(imagem, 0, 0, tela.width, tela.height);
    imagem.close();
    const blob = await new Promise<Blob | null>((ok) => tela.toBlob(ok, "image/jpeg", QUALIDADE_DO_JPEG));
    if (!blob) return arquivo;
    return new File([blob], arquivo.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return arquivo;
  }
}
