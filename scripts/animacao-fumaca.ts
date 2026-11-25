/**
 * Fumaça do vídeo de animação de texto (E68 A1): monta um vídeo de N segundos com o molde tipográfico, na qualidade pedida, e imprime o tempo, o tamanho e o que o ffprobe leu. Sem nenhum texto de
 * cliente. Na máquina de desenvolvimento ou, para medir como a produção vai se comportar, no contêiner de render (1 vCPU):
 *   npx tsx scripts/animacao-fumaca.ts --segundos 30 --qualidade final [--saida caminho.mp4]
 */
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { renderizarAnimacao } from "../src/animacao/render";

function argumento(nome: string, padrao: string): string {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
}

const FRASES = [
  "Você sabia que a maioria dos clientes some depois da primeira consulta?",
  "O erro está no que você fala nos três primeiros segundos",
  "Mostre o trabalho acontecendo, não só o resultado",
  "Responda hoje a pergunta que todo cliente faz",
  "Grave no celular, sem filtro, do jeito que você fala",
  "Chame para a conversa no final, uma vez só",
];

async function main(): Promise<void> {
  const segundos = Number(argumento("segundos", "30"));
  const qualidade = argumento("qualidade", "final") === "previa" ? "previa" : "final";
  const pasta = await mkdtemp(join(tmpdir(), "animacao-fumaca-"));
  const saida = argumento("saida", join(pasta, "fumaca.mp4"));
  try {
    const cenas: { texto: string; duracaoS: number }[] = [];
    for (let acumulado = 0, i = 0; acumulado < segundos; i += 1) {
      const duracaoS = Math.min(5, segundos - acumulado);
      cenas.push({ texto: FRASES[i % FRASES.length], duracaoS: Math.max(1.5, duracaoS) });
      acumulado += Math.max(1.5, duracaoS);
    }
    const inicio = Date.now();
    const r = await renderizarAnimacao({ cenas, qualidade, saida });
    const s = (Date.now() - inicio) / 1000;
    const sonda = execFileSync("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height,r_frame_rate,pix_fmt,nb_frames:format=duration",
      "-of",
      "default=nw=1",
      saida,
    ])
      .toString()
      .split(/\s+/)
      .filter(Boolean)
      .join(" ");
    console.log(
      `ok ${qualidade}: ${s.toFixed(1)} s de render para ${r.duracaoS.toFixed(1)} s de video (${r.quadros} quadros, ${(r.bytes / 1e6).toFixed(2)} MB, razao ${(s / r.duracaoS).toFixed(2)}); ${sonda}`,
    );
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }
}

main().catch((erro) => {
  console.error("ERRO", erro instanceof Error ? `${erro.name}: ${erro.message}` : erro);
  process.exit(1);
});
