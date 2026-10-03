/**
 * Um processo de fora (`yt-dlp`) com tempo limite (M5c, achado da madrugada de 03/10/2026): o `transcrever`
 * da rodada global levou mais de 4 horas porque cada vídeo do YouTube passa pelo proxy residencial, com pausa,
 * e o `yt-dlp` não tinha tempo limite nenhum: um download pendurado segurava o job inteiro até o prazo de
 * 4 horas da fila (`expireInSeconds`), que vence sem repetir, e a cadeia `extrair-sem-fala` e `extrair` nunca
 * disparava. Com o limite, o processo é MORTO (`SIGKILL`: nenhum tratador de sinal do `yt-dlp` pode ignorar) e
 * quem chamou recebe um erro com nome, para contar a falha, marcar a nova tentativa e seguir para o próximo.
 *
 * O erro nunca carrega a linha de comando: ela leva `--proxy http://usuario:senha@host`, e a mensagem de erro
 * vai para o banco (`execucoes_job`) e para o log (`ocultarSegredos`, `audio.ts`, trata o resto).
 */
import { execFile } from "node:child_process";
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** O processo passou do limite e foi morto. Só o nome do comando e o limite, nunca os argumentos. */
export class ErroTempoLimite extends Error {
  constructor(
    readonly comando: string,
    readonly limiteMs: number,
  ) {
    super(`o ${comando} passou de ${Math.round(limiteMs / 1000)} s e foi encerrado (tempo limite)`);
    this.name = "ErroTempoLimite";
  }
}

export type ExecutorDeProcesso = (
  comando: string,
  argumentos: string[],
  opcoes: { timeout: number; killSignal: NodeJS.Signals },
) => Promise<{ stdout: string; stderr: string }>;

/**
 * O `execFile` do Node mata o processo quando o `timeout` passa e devolve o erro com `killed: true`; é o
 * único jeito de este código matar um processo, então `killed` basta para dizer "foi o limite".
 */
function foiEncerradoPeloLimite(erro: unknown): boolean {
  return typeof erro === "object" && erro !== null && (erro as { killed?: unknown }).killed === true;
}

export async function executarComLimite(
  comando: string,
  argumentos: string[],
  limiteMs: number,
  /** Só para o teste trocar o processo de verdade por uma função que ele controla. */
  executar: ExecutorDeProcesso = execFileAsync as unknown as ExecutorDeProcesso,
): Promise<{ stdout: string; stderr: string }> {
  try {
    return await executar(comando, argumentos, { timeout: limiteMs, killSignal: "SIGKILL" });
  } catch (erro) {
    if (foiEncerradoPeloLimite(erro)) throw new ErroTempoLimite(comando, limiteMs);
    throw erro;
  }
}

/**
 * Apaga tudo o que um download deixou na pasta temporária com aquele prefixo: o `yt-dlp` morto pelo limite deixa o `.part`
 * e o áudio pela metade, e sem isto a pasta enche, uma sobra por tempo limite. Nunca lança (limpeza não derruba o job).
 */
export async function apagarSobrasDoDownload(pasta: string, prefixo: string): Promise<void> {
  try {
    const nomes = await readdir(pasta);
    await Promise.all(nomes.filter((nome) => nome.startsWith(prefixo)).map((nome) => rm(join(pasta, nome), { force: true }).catch(() => undefined)));
  } catch {
    // pasta sumiu ou sem permissão: nada a limpar
  }
}
