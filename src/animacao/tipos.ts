import type { QualidadeDaAnimacao } from "@/config/animacao";

/** Uma cena como o roteiro entrega: um bloco curto de texto, com a duração opcional (sem ela, vem do tempo de leitura). */
export type CenaDeEntrada = { texto: string; duracaoS?: number };

/** Uma cena já pronta para desenhar: texto limpo, tempos em segundos desde o início do vídeo. */
export type CenaMontada = { texto: string; palavras: string[]; inicioS: number; fimS: number };

export type LinhaDoTempo = { cenas: CenaMontada[]; duracaoS: number };

/** As cores e a letra da marca. Tudo opcional: o que falta cai nos tokens do projeto (`resolverMarca`). Cores só em `#rrggbb`; a letra vai embutida (`fonteBase64`, woff2) para o Chromium não precisar de rede. */
export type MarcaDaAnimacao = {
  corFundo?: string;
  corTexto?: string;
  /** No molde definitivo (`tipografico-2`) é a cor da marca, de onde saem o fundo, o texto e o destaque (as contas do carrossel); no provisório, só o destaque. */
  corDestaque?: string;
  fonteBase64?: string;
  /** O @ do Instagram da marca, com o arroba ("@clinica.exemplo"); fora do formato do Instagram, cai fora. */
  arroba?: string;
};

export type MarcaResolvida = {
  corFundo: string;
  corTexto: string;
  corDestaque: string;
  fonteBase64: string | null;
  arroba: string | null;
};

export type EntradaDoMolde = {
  linha: LinhaDoTempo;
  marca: MarcaResolvida;
  largura: number;
  altura: number;
};

/**
 * Um molde é só uma função de dados para HTML: trocar o visual é trocar o arquivo do molde. `seguraDoFinalS` é quanto a última cena (a chamada) fica a mais na tela depois do tempo de leitura; o
 * montador soma esse tempo sem passar do teto do vídeo.
 */
export type Molde = { nome: string; html: (entrada: EntradaDoMolde) => string; seguraDoFinalS?: number };

export type EntradaDaAnimacao = {
  cenas: CenaDeEntrada[];
  /** Nome do molde (`MOLDES`); sem ele vale o tipográfico. */
  molde?: string;
  marca?: MarcaDaAnimacao;
  qualidade: QualidadeDaAnimacao;
  /** Onde o MP4 é escrito. O chamador (A2) passa um arquivo `.parte` e renomeia quando termina bem; em qualquer falha o arquivo parcial é apagado aqui. */
  saida: string;
  /** 0 a 100, no máximo a cada 2 segundos. */
  aoProgredir?: (porcento: number) => void;
  /** Só para os testes encurtarem o limite. */
  limiteMs?: number;
};

export type ResultadoDaAnimacao = {
  saida: string;
  duracaoS: number;
  quadros: number;
  bytes: number;
};

export class ErroDaAnimacao extends Error {
  constructor(
    mensagem: string,
    /** Um código curto para o chamador decidir (nunca texto do cliente). */
    readonly codigo: "entrada" | "tempo" | "navegador" | "ffmpeg" = "navegador",
  ) {
    super(mensagem);
    this.name = "ErroDaAnimacao";
  }
}
