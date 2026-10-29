/**
 * E47 PR 4: roda o ffmpeg do render. Junta o plano de corte (`Edl`), o título e a legenda num vídeo pronto: escreve o arquivo ASS numa pasta de trabalho, copia a fonte, monta o grafo
 * (`render-grafo.ts`) e roda o ffmpeg com tempo máximo, andamento e a saída num arquivo `.parte` que o chamador renomeia quando termina bem.
 *
 * Nada daqui vai para log além do nome do erro: a linha de comando e a saída do ffmpeg levam o caminho do vídeo e, às vezes, texto da fala. Só o final do que o ffmpeg reclamou sobe no erro,
 * para o worker decidir se tenta de novo sem o tratamento de HDR.
 */
import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { limiteDoRenderMs } from "@/config/edicao";
import { executarComLimite, ErroTempoLimite, type ExecutorDeProcesso } from "@/jobs/processo";

import { montarAss } from "./ass";
import { montarGrafoDoRender, type HdrDoBruto, type PerfilDeRender } from "./render-grafo";
import type { BlocoLegenda, Edl } from "./tipos";

export class ErroDoRender extends Error {
  constructor(
    mensagem: string,
    /** O fim do que o ffmpeg escreveu de erro (já sem o caminho do vídeo). Só para decidir a nova tentativa; nunca vai para a pessoa nem para o log. */
    readonly saidaDeErro = "",
  ) {
    super(mensagem);
    this.name = "ErroDoRender";
  }
}

/** A pasta da fonte embutida. Em produção o diretório de trabalho do contêiner é `/app`; `EDICAO_FONTES` troca, para os testes e para quem roda de outro lugar. */
export function pastaDasFontes(): string {
  return process.env.EDICAO_FONTES || join(process.cwd(), "src", "edicao", "fontes");
}

const ARQUIVO_DA_FONTE = "Montserrat-Bold.ttf";

/** Lê o HDR do bruto (HLG do iPhone ou PQ) pelo `ffprobe`. Qualquer dúvida devolve `null` (cor normal). */
export async function lerHdrDoBruto(caminho: string, executar?: ExecutorDeProcesso): Promise<HdrDoBruto> {
  try {
    const { stdout } = await executarComLimite(
      "ffprobe",
      ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=color_transfer", "-of", "default=nw=1:nk=1", caminho],
      30_000,
      executar,
    );
    const transferencia = stdout.trim();
    if (transferencia === "arib-std-b67") return "hlg";
    if (transferencia === "smpte2084") return "pq";
    return null;
  } catch {
    return null;
  }
}

export type EntradaDoRender = {
  perfil: PerfilDeRender;
  /** O vídeo bruto, caminho de disco. */
  bruto: string;
  /** Onde o ffmpeg escreve (o chamador renomeia no fim). */
  saida: string;
  edl: Edl;
  blocos: BlocoLegenda[];
  titulo: { texto: string; subtitulo: string | null };
  hdr: HdrDoBruto;
  /** Chamado com 0 a 100 enquanto o ffmpeg trabalha (no máximo a cada 2 segundos). */
  aoProgredir?: (porcento: number) => void;
};

export type ResultadoDoRender = { duracaoEsperadaS: number };

type SaidaDoFfmpeg = { codigo: number | null; sinal: NodeJS.Signals | null; fimDoErro: string };

/** Roda o ffmpeg, lê o `-progress` da saída padrão e mata o processo se passar do limite. */
function rodarFfmpeg(argumentos: string[], cwd: string, duracaoS: number, limiteMs: number, aoProgredir?: (porcento: number) => void): Promise<SaidaDoFfmpeg> {
  return new Promise((resolver, rejeitar) => {
    const filho = spawn("ffmpeg", argumentos, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let fimDoErro = "";
    let buffer = "";
    let ultimoAviso = 0;
    let estourou = false;
    const prazo = setTimeout(() => {
      estourou = true;
      filho.kill("SIGKILL");
    }, limiteMs);

    filho.stdout.on("data", (pedaco: Buffer) => {
      buffer += pedaco.toString("utf8");
      const linhas = buffer.split("\n");
      buffer = linhas.pop() ?? "";
      for (const linha of linhas) {
        const achado = /^out_time_(?:us|ms)=(-?\d+)/.exec(linha);
        if (!achado || !aoProgredir) continue;
        const agora = Date.now();
        if (agora - ultimoAviso < 2000) continue;
        ultimoAviso = agora;
        const segundos = Number(achado[1]) / 1_000_000;
        aoProgredir(Math.max(0, Math.min(99, Math.floor((segundos / duracaoS) * 100))));
      }
    });
    filho.stderr.on("data", (pedaco: Buffer) => {
      fimDoErro = (fimDoErro + pedaco.toString("utf8")).slice(-2000);
    });
    filho.once("error", (erro) => {
      clearTimeout(prazo);
      rejeitar(erro);
    });
    filho.once("close", (codigo, sinal) => {
      clearTimeout(prazo);
      if (estourou) rejeitar(new ErroTempoLimite("ffmpeg", limiteMs));
      else resolver({ codigo, sinal, fimDoErro });
    });
  });
}

/**
 * Monta o vídeo. A pasta de trabalho é criada e apagada aqui (o ASS e a fonte). Lança `ErroDoRender` se o ffmpeg falha e `ErroTempoLimite` se passa do limite (três vezes o tempo esperado).
 */
export async function renderizar(entrada: EntradaDoRender): Promise<ResultadoDoRender> {
  const pasta = await mkdtemp(join(tmpdir(), "render-"));
  try {
    const fontesRelativo = "fontes";
    await mkdir(join(pasta, fontesRelativo), { recursive: true });
    await copyFile(join(pastaDasFontes(), ARQUIVO_DA_FONTE), join(pasta, fontesRelativo, ARQUIVO_DA_FONTE));

    const grafo = montarGrafoDoRender({
      perfil: entrada.perfil,
      bruto: entrada.bruto,
      saida: entrada.saida,
      edl: entrada.edl,
      hdr: entrada.hdr,
      assRelativo: "legenda.ass",
      fontesRelativo,
    });
    await writeFile(join(pasta, "legenda.ass"), montarAss({ blocos: entrada.blocos, titulo: entrada.titulo, duracaoS: grafo.duracaoDaSaidaS }), "utf8");

    const limite = limiteDoRenderMs(entrada.perfil, grafo.duracaoDaSaidaS);
    const resultado = await rodarFfmpeg(grafo.argumentos, pasta, grafo.duracaoDaSaidaS, limite, entrada.aoProgredir);
    if (resultado.codigo !== 0) {
      const semCaminhos = resultado.fimDoErro.split(entrada.bruto).join("<video>").split(entrada.saida).join("<saida>");
      throw new ErroDoRender(resultado.sinal ? `o ffmpeg foi encerrado (${resultado.sinal})` : `o ffmpeg terminou com o codigo ${resultado.codigo}`, semCaminhos);
    }
    return { duracaoEsperadaS: grafo.duracaoDaSaidaS };
  } finally {
    await rm(pasta, { recursive: true, force: true }).catch(() => undefined);
  }
}
