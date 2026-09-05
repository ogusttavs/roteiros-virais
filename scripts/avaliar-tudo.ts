/**
 * Roda os tres golden sets em sequencia (etapa 18, decisao 4 do
 * `PROXIMO.md`) e grava o resultado num JSON, porque a CI nao tem chave de
 * producao (etapa 13) e cada rodada custa credito: o PR que muda um prompt
 * traz esse arquivo (ou o resumo dele) no corpo, em vez da CI rodar de
 * novo. Grava em `<GOLDEN_SET_DIR ou ../avaliacoes-privadas>/resultados/
 * <AAAA-MM-DD>-<sha curto>.json`, criando a pasta se nao existir; sem
 * `GOLDEN_SET_DIR`, cada golden set avisa e usa o proprio exemplo, como
 * `npm run avaliar:briefing` etc ja fazem sozinhos.
 */
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { avaliarBriefing } from "./avaliar-briefing";
import { avaliarRoteiros } from "./avaliar-roteiros";
import { avaliarTemas } from "./avaliar-temas";

function shaCurto(): string {
  return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
}

function hojeAAAAMMDD(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

async function avaliarTudo() {
  console.log("=== briefing ===\n");
  const briefing = await avaliarBriefing();

  console.log("\n=== temas ===\n");
  const temas = await avaliarTemas();

  console.log("\n=== roteiros ===\n");
  const roteiros = await avaliarRoteiros();

  const resultado = {
    data: hojeAAAAMMDD(),
    sha: shaCurto(),
    briefing,
    temas,
    roteiros,
  };

  const dirResultados = path.resolve(process.cwd(), process.env.GOLDEN_SET_DIR ?? "../avaliacoes-privadas", "resultados");
  mkdirSync(dirResultados, { recursive: true });
  const caminho = path.join(dirResultados, `${resultado.data}-${resultado.sha}.json`);
  writeFileSync(caminho, JSON.stringify(resultado, null, 2));

  console.log(`\n=== resultado gravado em ${caminho} ===`);
}

if (require.main === module) {
  avaliarTudo().catch((erro: unknown) => {
    console.error(erro);
    process.exitCode = 1;
  });
}
