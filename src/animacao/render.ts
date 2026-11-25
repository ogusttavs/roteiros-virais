/**
 * E68 A1: o motor do vídeo de animação de texto. A entrada é `renderizarAnimacao({ cenas, molde, marca, qualidade, saida })`; a saída é um MP4 vertical, 30 quadros por segundo, sem som.
 *
 * O caminho: o montador faz a linha do tempo -> o molde vira uma página HTML em que tudo depende do tempo (`irPara(t)`) -> o Chromium sem tela (o mesmo `playwright` e a mesma guarda
 * `comLimiteDeChromium` do PDF e do carrossel) abre a página e tira uma foto JPEG por quadro -> cada foto vai direto para o stdin do ffmpeg (`image2pipe`), sem arquivo de quadro no disco (o
 * contêiner de render é só de leitura e tem /tmp pequeno; a fase 0 mediu pipe e arquivo empatados em JPEG com 1 CPU) -> o MP4 sai no arquivo `saida`.
 *
 * Segurança: o texto do cliente só entra escapado no molde; a página tem uma política de conteúdo sem rede e o Chromium aborta toda requisição que não seja `data:` e resolve nenhum nome de
 * servidor; a página nem tem arquivo local para abrir (`setContent`, não `file://`). Tempo limite: um prazo para o render inteiro (`limiteDaAnimacaoMs`) mata o ffmpeg e o navegador; cada foto ainda
 * tem os 15 s de `comTempoLimite`. Em qualquer falha o arquivo parcial é apagado. Nada do texto vai para log nem para erro: só números e o código curto.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { rm, stat } from "node:fs/promises";
import path from "node:path";

import { chromium } from "playwright";

import {
  AJUSTES_DA_ANIMACAO,
  ALTURA_DA_CENA,
  LARGURA_DA_CENA,
  limiteDaAnimacaoMs,
  QUADROS_POR_SEGUNDO,
} from "@/config/animacao";
import { comLimiteDeChromium, comTempoLimite } from "@/lib/chromium-de-impressao";
import { config } from "@/lib/config";
import { logger } from "@/lib/log";

import { MOLDE_PADRAO, MOLDES } from "./moldes";
import { montarLinhaDoTempo, resolverMarca } from "./montador";
import { ErroDaAnimacao, type EntradaDaAnimacao, type ResultadoDaAnimacao } from "./tipos";

let fonteDoProjeto: string | null | undefined;

/** A letra do projeto (Mona Sans), lida uma vez; sem o arquivo, o render segue com a letra do sistema (a imagem de produção copia `src/ui/fontes`). */
function lerFonteDoProjeto(): string | null {
  if (fonteDoProjeto !== undefined) return fonteDoProjeto;
  try {
    fonteDoProjeto = readFileSync(
      path.join(process.cwd(), "src", "ui", "fontes", "monasans-latin.woff2"),
    ).toString("base64");
  } catch {
    logger.warn(
      "animacao: a fonte monasans-latin.woff2 nao foi achada, o render usa a letra do sistema",
    );
    fonteDoProjeto = null;
  }
  return fonteDoProjeto;
}

/** O HTML da cena, sem navegador: serve ao render e aos testes. Lança `ErroDaAnimacao("entrada")` para cena inválida ou molde que não existe. */
export function montarHtmlDaAnimacao(
  entrada: Pick<EntradaDaAnimacao, "cenas" | "molde" | "marca">,
): { html: string; duracaoS: number } {
  const molde = MOLDES[entrada.molde ?? MOLDE_PADRAO];
  if (!molde) throw new ErroDaAnimacao("molde desconhecido", "entrada");
  const linha = montarLinhaDoTempo(entrada.cenas);
  const marca = resolverMarca(entrada.marca);
  if (!marca.fonteBase64) marca.fonteBase64 = lerFonteDoProjeto();
  return {
    html: molde.html({ linha, marca, largura: LARGURA_DA_CENA, altura: ALTURA_DA_CENA }),
    duracaoS: linha.duracaoS,
  };
}

/** Os argumentos do ffmpeg: fotos JPEG pelo stdin, H.264 em yuv420p (toca em qualquer celular), sem som, MP4 com o índice no começo. `-f mp4` porque o arquivo parcial não termina em `.mp4`. */
export function argumentosDoFfmpeg(qualidade: "previa" | "final", saida: string): string[] {
  const a = AJUSTES_DA_ANIMACAO[qualidade];
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-y",
    "-f",
    "image2pipe",
    "-framerate",
    String(QUADROS_POR_SEGUNDO),
    "-c:v",
    "mjpeg",
    "-i",
    "-",
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    a.preset,
    "-crf",
    String(a.crf),
    "-vf",
    "scale=in_range=pc:out_range=tv,format=yuv420p",
    "-fflags",
    "+bitexact",
    "-flags:v",
    "+bitexact",
    "-map_metadata",
    "-1",
    "-r",
    String(QUADROS_POR_SEGUNDO),
    "-movflags",
    "+faststart",
    "-f",
    "mp4",
    saida,
  ];
}

export async function renderizarAnimacao(entrada: EntradaDaAnimacao): Promise<ResultadoDaAnimacao> {
  const { html, duracaoS } = montarHtmlDaAnimacao(entrada);
  const ajustes = AJUSTES_DA_ANIMACAO[entrada.qualidade];
  const quadros = Math.ceil(duracaoS * QUADROS_POR_SEGUNDO);
  const limiteMs = entrada.limiteMs ?? limiteDaAnimacaoMs(entrada.qualidade, duracaoS);

  let estourou = false;
  let deuCerto = false;
  let fimDoErro = "";
  let navegador: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  const ffmpeg = spawn("ffmpeg", argumentosDoFfmpeg(entrada.qualidade, entrada.saida), {
    stdio: ["pipe", "ignore", "pipe"],
  });
  ffmpeg.stderr.on("data", (p: Buffer) => {
    fimDoErro = (fimDoErro + p.toString("utf8")).slice(-1000);
  });
  let erroDoFfmpeg: Error | null = null;
  ffmpeg.once("error", (e) => {
    erroDoFfmpeg = e;
  });
  // Se o ffmpeg morre, escrever no stdin dá EPIPE: o erro é guardado e a captura para no próximo quadro.
  ffmpeg.stdin.on("error", (e) => {
    erroDoFfmpeg = erroDoFfmpeg ?? e;
  });
  const terminou = new Promise<number | null>((resolver) =>
    ffmpeg.once("close", (codigo) => resolver(codigo)),
  );

  const prazo = setTimeout(() => {
    estourou = true;
    ffmpeg.kill("SIGKILL");
    void navegador?.close().catch(() => undefined);
  }, limiteMs);

  try {
    await comLimiteDeChromium(async () => {
      const args = [
        "--host-resolver-rules=MAP * ~NOTFOUND",
        "--num-raster-threads=1",
        "--disable-skia-runtime-opts",
        "--font-render-hinting=none",
      ];
      if (config.animacao.semSandbox) args.push("--no-sandbox");
      navegador = await chromium.launch({ args, chromiumSandbox: !config.animacao.semSandbox });
      const contexto = await navegador.newContext({
        viewport: { width: LARGURA_DA_CENA, height: ALTURA_DA_CENA },
        deviceScaleFactor: ajustes.fator,
        serviceWorkers: "block",
        acceptDownloads: false,
      });
      // Nenhuma requisição sai do Chromium: só `data:` (a letra embutida) passa.
      await contexto.route("**/*", (rota) =>
        rota.request().url().startsWith("data:") ? rota.continue() : rota.abort(),
      );
      const pagina = await contexto.newPage();
      await comTempoLimite(
        pagina.setContent(html, { waitUntil: "load" }),
        "tempo esgotado montando a cena",
      );
      await comTempoLimite(
        pagina.evaluate("document.fonts.ready.then(() => true)"),
        "tempo esgotado esperando a letra",
      );
      let ultimoAviso = 0;
      for (let q = 0; q < quadros; q += 1) {
        if (estourou || erroDoFfmpeg) break;
        await comTempoLimite(
          pagina.evaluate(`window.irPara(${(q / QUADROS_POR_SEGUNDO).toFixed(4)})`),
          "tempo esgotado posicionando o quadro",
        );
        const foto = await comTempoLimite(
          pagina.screenshot({ type: "jpeg", quality: ajustes.qualidadeDoJpeg }),
          "tempo esgotado gerando o quadro",
        );
        // Sem a corrida com `terminou`, um ffmpeg morto (prazo estourado) deixaria o `drain` esperando para sempre.
        if (!ffmpeg.stdin.write(foto))
          await Promise.race([
            new Promise<void>((resolver) => ffmpeg.stdin.once("drain", () => resolver())),
            terminou,
          ]);
        const agora = Date.now();
        if (entrada.aoProgredir && agora - ultimoAviso >= 2000) {
          ultimoAviso = agora;
          entrada.aoProgredir(Math.min(99, Math.floor((q / quadros) * 100)));
        }
      }
    });
    if (estourou)
      throw new ErroDaAnimacao("o render passou do tempo limite e foi encerrado", "tempo");
    if (erroDoFfmpeg) throw new ErroDaAnimacao("o ffmpeg parou no meio do render", "ffmpeg");
    ffmpeg.stdin.end();
    const codigo = await terminou;
    if (estourou)
      throw new ErroDaAnimacao("o render passou do tempo limite e foi encerrado", "tempo");
    if (codigo !== 0)
      throw new ErroDaAnimacao(
        `o ffmpeg terminou com erro: ${fimDoErro.trim().slice(-300)}`,
        "ffmpeg",
      );
    const { size } = await stat(entrada.saida);
    entrada.aoProgredir?.(100);
    deuCerto = true;
    return { saida: entrada.saida, duracaoS, quadros, bytes: size };
  } catch (erro) {
    if (estourou && !(erro instanceof ErroDaAnimacao))
      throw new ErroDaAnimacao("o render passou do tempo limite e foi encerrado", "tempo");
    if (erro instanceof ErroDaAnimacao) throw erro;
    throw new ErroDaAnimacao(
      `o navegador falhou: ${erro instanceof Error ? erro.name : "erro"}`,
      "navegador",
    );
  } finally {
    clearTimeout(prazo);
    ffmpeg.kill("SIGKILL");
    await (navegador as Awaited<ReturnType<typeof chromium.launch>> | null)
      ?.close()
      .catch(() => undefined);
    await terminou.catch(() => undefined);
    // Só o arquivo de uma falha sai: o do sucesso é do chamador.
    if (!deuCerto) await rm(entrada.saida, { force: true }).catch(() => undefined);
  }
}
