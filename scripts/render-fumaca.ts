/**
 * Fumaça do render da edição (E47 PR 4): gera um vídeo sintético, monta a prévia 540p e o final 1080p com o ffmpeg de verdade e confere as durações. Mede o tempo de cada um, que é o número do
 * aceite ("60 s de bruto com prévia em menos de 5 minutos"). Sem nenhum vídeo de ninguém. Roda no contêiner de render, que tem 1 vCPU, para medir como a produção vai se comportar:
 *   docker compose exec roteiros-render npx tsx scripts/render-fumaca.ts --segundos 60 [--hdr]
 * ou na máquina de desenvolvimento: `npx tsx scripts/render-fumaca.ts --segundos 60`. Sai com erro se alguma duração fugir do plano em mais de 0,25 s.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { renderizar } from "../src/edicao/render";
import { gerarVideoSintetico, montarCasoSintetico, sondarSaida } from "../src/edicao/sintetica-video";

function argumento(nome: string, padrao: string): string {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
}

async function main(): Promise<void> {
  const segundos = Number(argumento("segundos", "20"));
  const hdr = process.argv.includes("--hdr");
  const pasta = await mkdtemp(join(tmpdir(), "render-fumaca-"));
  let falhou = false;
  try {
    const caso = montarCasoSintetico(segundos);
    const bruto = join(pasta, "bruto.mp4");
    await gerarVideoSintetico(bruto, caso.duracaoDoBrutoS, { hdr });
    const esperada = Math.round((caso.edl.duracao + caso.edl.respiroFinal) * 30) / 30;
    console.log(`bruto sintetico: ${caso.duracaoDoBrutoS.toFixed(1)} s${hdr ? " (HEVC 10 bits HLG)" : ""}; plano: ${caso.edl.trechos.length} trechos, ${esperada.toFixed(1)} s`);
    for (const perfil of ["previa", "final"] as const) {
      const saida = join(pasta, `${perfil}.mp4`);
      const inicio = Date.now();
      await renderizar({ perfil, bruto, saida, edl: caso.edl, blocos: caso.legenda.blocos, titulo: caso.titulo, hdr: hdr ? "hlg" : null });
      const segundosDeRender = (Date.now() - inicio) / 1000;
      const lido = await sondarSaida(saida);
      const ok = Math.abs(lido.duracaoS - esperada) <= 0.25 && lido.temAudio && lido.largura === (perfil === "previa" ? 540 : 1080);
      if (!ok) falhou = true;
      console.log(`${ok ? "ok" : "ERRO"} ${perfil}: ${segundosDeRender.toFixed(1)} s de render para ${lido.duracaoS.toFixed(1)} s de video (${lido.largura}x${lido.altura}), razao ${(segundosDeRender / lido.duracaoS).toFixed(2)}`);
    }
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }
  process.exit(falhou ? 1 : 0);
}

main().catch((erro: unknown) => {
  console.error("render-fumaca falhou:", erro instanceof Error ? erro.message : erro);
  process.exit(1);
});
