/**
 * E47 PR 4: o grafo de filtros do ffmpeg que monta o vídeo editado a partir do plano de corte (`Edl`). Tudo puro, sem processo e sem arquivo: recebe o plano e devolve os argumentos do ffmpeg
 * e a duração esperada da saída, que os testes conferem e o render roda. A semente é a prévia que o editor do Gustavo já fazia (cortes por quadro exato, "combinar" nas trocas de assunto,
 * legenda queimada), reescrita em TypeScript.
 *
 * Como o vídeo é montado:
 *  - Cada trecho que fica é uma entrada do ffmpeg (`-ss` e `-t` no arquivo bruto: só o que fica é decodificado), a 30 quadros por segundo, na tela vertical, em cor normal (o HDR do iPhone é
 *    convertido: sem isso as cores saem lavadas).
 *  - A linha do tempo é a do plano (`destino`): o tempo de cada trecho vem do quadro certo, então a legenda e o áudio nunca saem do lugar. Na troca de assunto a transição "combinar"
 *    começa no corte e dura 14 quadros; para isso o trecho que sai continua por baixo (mais 14 quadros do bruto) enquanto o seguinte entra, e o áudio não participa (ele só corta, com um
 *    fade de 30 ms em cada ponta para não estalar).
 *  - O áudio é a fala dos trechos, na mesma ordem, sem música (decisão do Gustavo em 29/10/2026), com passa-alta de 70 Hz e volume normalizado para -14 LUFS.
 *  - O final: a imagem segura o último quadro pelo respiro que o plano calculou e escurece junto com o texto; o áudio sai em fade curto.
 */
import { AJUSTES_DO_RENDER } from "@/config/edicao";

import type { Edl, TransicaoCorte, Trecho } from "./tipos";

export type PerfilDeRender = "previa" | "final";
/** O HDR que o `ffprobe` achou no bruto: HLG (o do iPhone) ou PQ. `null` é cor normal. */
export type HdrDoBruto = "hlg" | "pq" | null;

export type EntradaDoGrafo = {
  perfil: PerfilDeRender;
  bruto: string;
  saida: string;
  edl: Edl;
  hdr: HdrDoBruto;
  /** Nome do arquivo ASS e da pasta de fontes, relativos à pasta onde o ffmpeg roda (nada de caminho com `:` dentro do filtro). */
  assRelativo: string;
  fontesRelativo: string;
};

export type GrafoDoRender = {
  argumentos: string[];
  /** O `-filter_complex`, separado para os testes. */
  filtro: string;
  /** A duração esperada do vídeo pronto, em segundos (múltiplo de 1/30). */
  duracaoDaSaidaS: number;
  quadros: number;
};

const FPS = AJUSTES_DO_RENDER.quadrosPorSegundo;

/** O nome do tipo de transição do ffmpeg (`xfade`) para cada transição que a decisão escolhe. */
export const TRANSICAO_DO_FFMPEG: Record<TransicaoCorte, string> = { combinar: "fade", direita: "slideright", desfocar: "hblur" };

/** A cadeia que leva o HDR do iPhone (já na tela do tamanho final) para cor normal (BT.709, 8 bits). */
export function cadeiaDeHdr(hdr: Exclude<HdrDoBruto, null>): string {
  const entrada = hdr === "hlg" ? "tin=arib-std-b67:pin=bt2020:min=bt2020nc:rin=limited" : "tin=smpte2084:pin=bt2020:min=bt2020nc:rin=limited";
  return `zscale=${entrada}:t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=limited`;
}

const numero = (n: number): string => n.toFixed(6).replace(/\.?0+$/, "") || "0";

function par(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2);
}

type Quadros = { inicio: number; fim: number; n: number };

/** Os quadros de cada trecho na linha do tempo, com o arredondamento absoluto (a soma sempre bate com o total). */
function quadrosDoTrecho(t: Trecho): Quadros {
  const inicio = Math.round(t.destino[0] * FPS);
  const fim = Math.max(inicio + 1, Math.round(t.destino[1] * FPS));
  return { inicio, fim, n: fim - inicio };
}

export function montarGrafoDoRender(entrada: EntradaDoGrafo): GrafoDoRender {
  const { perfil, edl } = entrada;
  const tela = AJUSTES_DO_RENDER[perfil];
  const { largura: W, altura: H } = tela;
  const trechos = edl.trechos;
  if (trechos.length === 0) throw new Error("o plano de corte nao tem trechos");
  const quadros = trechos.map(quadrosDoTrecho);
  const totalDaFala = quadros[quadros.length - 1].fim;
  const respiro = Math.max(0, Math.round(edl.respiroFinal * FPS));
  const total = totalDaFala + respiro;
  const duracaoDaSaidaS = total / FPS;

  // A transição de cada trecho (em quadros); 0 é corte seco. Nunca passa de metade do trecho que entra.
  const transicao = trechos.map((t, k) => {
    if (k === 0 || !t.transicaoEntrada) return 0;
    const q = Math.min(Math.round(AJUSTES_DO_RENDER.transicaoS * FPS), Math.floor(quadros[k].n / 2));
    return q >= 3 ? q : 0;
  });
  // O trecho que sai continua por baixo durante a transição do seguinte.
  const extensao = trechos.map((_, k) => (k + 1 < trechos.length ? transicao[k + 1] : 0));

  const entradas: string[] = [];
  const filtros: string[] = [];
  const limiteDoBruto = edl.duracaoOrigem;

  trechos.forEach((t, k) => {
    const nVideo = quadros[k].n + extensao[k];
    const duracaoLida = Math.min(nVideo / FPS + 0.5, Math.max(0.5, limiteDoBruto - t.origem[0] + 0.5));
    entradas.push("-ss", numero(t.origem[0]), "-t", numero(duracaoLida), "-i", entrada.bruto);

    const partes = [`fps=${FPS}`, `scale=${W}:${H}:force_original_aspect_ratio=decrease`, `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black`];
    if (entrada.hdr) partes.push(cadeiaDeHdr(entrada.hdr));
    partes.push("setsar=1", "format=yuv420p");
    if (t.escala > 1.0001) partes.push(`scale=${par(W * t.escala)}:${par(H * t.escala)}`, `crop=${W}:${H}`);
    // Se o bruto acaba antes do que a transição precisa, o último quadro segura.
    partes.push("tpad=stop_mode=clone:stop_duration=1", `trim=end_frame=${nVideo}`, "setpts=PTS-STARTPTS", `settb=1/${FPS}`);
    filtros.push(`[${k}:v]${partes.join(",")}[v${k}]`);

    const d = quadros[k].n / FPS;
    const fade = Math.min(AJUSTES_DO_RENDER.fadeDoCorteS, d / 4);
    filtros.push(
      `[${k}:a]aresample=48000,asetpts=PTS-STARTPTS,atrim=duration=${numero(d)},apad=whole_dur=${numero(d)},afade=t=in:st=0:d=${numero(fade)},afade=t=out:st=${numero(d - fade)}:d=${numero(fade)}[a${k}]`,
    );
  });

  // Os grupos de trechos ligados por corte seco; entre um grupo e outro, a transição.
  const grupos: number[][] = [];
  trechos.forEach((_, k) => {
    if (k === 0 || transicao[k] > 0) grupos.push([k]);
    else grupos[grupos.length - 1].push(k);
  });
  grupos.forEach((g, j) => {
    const entradasDoGrupo = g.map((k) => `[v${k}]`).join("");
    if (g.length === 1) filtros.push(`${entradasDoGrupo}settb=1/${FPS},fps=${FPS}[g${j}]`);
    else filtros.push(`${entradasDoGrupo}concat=n=${g.length}:v=1:a=0,settb=1/${FPS},fps=${FPS}[g${j}]`);
  });
  let atual = "g0";
  for (let j = 1; j < grupos.length; j++) {
    const primeiro = grupos[j][0];
    const tipo = TRANSICAO_DO_FFMPEG[trechos[primeiro].transicaoEntrada as TransicaoCorte];
    filtros.push(`[${atual}][g${j}]xfade=transition=${tipo}:duration=${numero(transicao[primeiro] / FPS)}:offset=${numero(quadros[primeiro].inicio / FPS)}[x${j}]`);
    atual = `x${j}`;
  }

  // O fim: o último quadro segura pelo respiro, a legenda e o título entram, e a imagem escurece.
  const fadeFinal = Math.min(AJUSTES_DO_RENDER.fadeFinalS, duracaoDaSaidaS / 2);
  const fimDoVideo = [
    ...(respiro > 0 ? [`tpad=stop_mode=clone:stop_duration=${numero(respiro / FPS)}`] : []),
    `subtitles=${entrada.assRelativo}:fontsdir=${entrada.fontesRelativo}`,
    `fade=t=out:st=${numero(duracaoDaSaidaS - fadeFinal)}:d=${numero(fadeFinal)}`,
    "format=yuv420p",
    `trim=end_frame=${total}`,
    "setpts=PTS-STARTPTS",
  ];
  filtros.push(`[${atual}]${fimDoVideo.join(",")}[vout]`);

  // O áudio: a fala dos trechos, passa-alta e volume, e o fade de saída no fim (depois do respiro).
  const audios = trechos.map((_, k) => `[a${k}]`).join("");
  const fadeDoAudio = Math.min(0.4, duracaoDaSaidaS / 2);
  filtros.push(
    `${audios}concat=n=${trechos.length}:v=0:a=1,highpass=f=70,loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000,apad=whole_dur=${numero(duracaoDaSaidaS)},atrim=duration=${numero(duracaoDaSaidaS)},afade=t=out:st=${numero(duracaoDaSaidaS - fadeDoAudio)}:d=${numero(fadeDoAudio)}[aout]`,
  );

  const filtro = filtros.join(";");
  const argumentos = [
    "-nostdin",
    "-y",
    "-v",
    "error",
    "-progress",
    "pipe:1",
    "-nostats",
    ...entradas,
    "-filter_complex",
    filtro,
    "-map",
    "[vout]",
    "-map",
    "[aout]",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    String(tela.crf),
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(FPS),
    "-colorspace",
    "bt709",
    "-color_primaries",
    "bt709",
    "-color_trc",
    "bt709",
    "-c:a",
    "aac",
    "-b:a",
    `${tela.audioKbps}k`,
    "-movflags",
    "+faststart",
    "-t",
    numero(duracaoDaSaidaS),
    "-f",
    "mp4",
    entrada.saida,
  ];
  return { argumentos, filtro, duracaoDaSaidaS, quadros: total };
}
