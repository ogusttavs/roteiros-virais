/**
 * E47 PR 2: o que o `ffprobe` diz do vídeo bruto que a pessoa mandou, e se a edição o aceita. `interpretarSondagem` e `recusaDaSondagem` são puras (testadas sem processo); `sondarVideo`
 * chama o `ffprobe` com tempo limite. Nada daqui lê a imagem ou o som: só o cabeçalho do arquivo.
 *
 * O iPhone grava em pé como 1920x1080 com uma rotação de 90 graus gravada no arquivo (ou 1080x1920 sem rotação, conforme a versão). A imagem que a pessoa vê é a girada; é dela que sai o
 * "1080p" (lado menor) conferido aqui, e é ela que o render vai usar.
 */
import { LIMITES_DA_EDICAO } from "@/config/edicao";
import { executarComLimite, type ExecutorDeProcesso } from "@/jobs/processo";
import type { CodigoDaEdicao } from "@/textos/edicao";

export class ErroDeSondagem extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroDeSondagem";
  }
}

export type Sondagem = {
  duracaoS: number;
  /** Como a pessoa vê (depois de girar). */
  largura: number;
  altura: number;
  /** A rotação gravada no arquivo: 0, 90, 180 ou 270. */
  rotacao: number;
  temVideo: boolean;
  temAudio: boolean;
};

type Fluxo = { codec_type?: string; width?: number; height?: number; duration?: string; tags?: { rotate?: string }; side_data_list?: { rotation?: number }[] };
type SaidaDoFfprobe = { streams?: Fluxo[]; format?: { duration?: string } };

function rotacaoDoFluxo(fluxo: Fluxo): number {
  const lado = fluxo.side_data_list?.find((d) => typeof d.rotation === "number")?.rotation;
  const bruto = lado ?? (fluxo.tags?.rotate !== undefined ? Number(fluxo.tags.rotate) : 0);
  if (!Number.isFinite(bruto)) return 0;
  // O ffprobe novo dá -90 para "gire 90 no sentido horário"; o antigo dava 90 em tags.rotate. Para o tamanho da imagem só importa se é de lado.
  return ((Math.round(bruto / 90) * 90) % 360 + 360) % 360;
}

/** Lê o JSON do `ffprobe -print_format json -show_format -show_streams`. Lança `ErroDeSondagem` se não é um JSON que o ffprobe devolveria. */
export function interpretarSondagem(saida: string): Sondagem {
  let dados: SaidaDoFfprobe;
  try {
    dados = JSON.parse(saida) as SaidaDoFfprobe;
  } catch {
    throw new ErroDeSondagem("o ffprobe nao devolveu um JSON");
  }
  const fluxos = Array.isArray(dados.streams) ? dados.streams : [];
  const video = fluxos.find((f) => f.codec_type === "video" && Number.isFinite(f.width) && Number.isFinite(f.height));
  const temAudio = fluxos.some((f) => f.codec_type === "audio");
  const duracao = Number(dados.format?.duration ?? video?.duration);
  if (!Number.isFinite(duracao) || duracao <= 0) {
    if (!video) return { duracaoS: 0, largura: 0, altura: 0, rotacao: 0, temVideo: false, temAudio };
    throw new ErroDeSondagem("o ffprobe nao devolveu uma duracao valida");
  }
  if (!video) return { duracaoS: duracao, largura: 0, altura: 0, rotacao: 0, temVideo: false, temAudio };
  const rotacao = rotacaoDoFluxo(video);
  const deLado = rotacao === 90 || rotacao === 270;
  const largura = deLado ? (video.height as number) : (video.width as number);
  const altura = deLado ? (video.width as number) : (video.height as number);
  return { duracaoS: duracao, largura, altura, rotacao, temVideo: true, temAudio };
}

/** O motivo (a frase está em `textos/edicao.ts`) de a edição não aceitar este vídeo, ou `null` se ele serve. */
export function recusaDaSondagem(s: Sondagem): CodigoDaEdicao | null {
  if (!s.temVideo) return "sem-video";
  if (s.duracaoS > LIMITES_DA_EDICAO.duracaoMaxS + LIMITES_DA_EDICAO.duracaoToleranciaS) return "longo";
  if (s.duracaoS < LIMITES_DA_EDICAO.duracaoMinS) return "curto";
  const ladoMenor = Math.min(s.largura, s.altura);
  const ladoMaior = Math.max(s.largura, s.altura);
  if (ladoMenor > LIMITES_DA_EDICAO.ladoMenorMax || ladoMaior > LIMITES_DA_EDICAO.ladoMaiorMax) return "qualidade-alta";
  if (!s.temAudio) return "sem-som";
  return null;
}

export function argumentosDoFfprobe(caminho: string): string[] {
  return ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", caminho];
}

const LIMITE_DO_FFPROBE_MS = 30_000;

/** Roda o `ffprobe` no arquivo. `executar` só existe para o teste trocar o processo. Qualquer falha do processo vira `ErroDeSondagem` (a mensagem nunca leva o caminho do arquivo). */
export async function sondarVideo(caminho: string, executar?: ExecutorDeProcesso): Promise<Sondagem> {
  let saida: string;
  try {
    ({ stdout: saida } = await executarComLimite("ffprobe", argumentosDoFfprobe(caminho), LIMITE_DO_FFPROBE_MS, executar));
  } catch (erro) {
    throw new ErroDeSondagem(erro instanceof Error && erro.name === "ErroTempoLimite" ? "o ffprobe demorou demais" : "o ffprobe nao conseguiu abrir o arquivo");
  }
  return interpretarSondagem(saida);
}
