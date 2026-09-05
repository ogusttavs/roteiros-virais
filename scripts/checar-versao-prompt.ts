/**
 * Ponto de entrada de linha de comando (npm run checar-versao-prompt, e o
 * mesmo passo na CI): compara `src/ia/prompts/` com `origin/main`. As
 * regras estao em checar-versao-prompt-regras.ts, sem process.exit, para
 * dar para testar.
 *
 * `git diff --name-only origin/main` (dois pontos, nao tres): a CI faz
 * checkout do commit de merge do PR (ja com `main` por baixo), entao
 * comparar direto com a ponta de `origin/main` mostra exatamente o que o PR
 * mudou. `origin/main` precisa estar buscado (a CI usa fetch-depth: 0 em
 * actions/checkout); localmente, um `git fetch` recente basta.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

import { verificarVersoesDePrompt, type ArquivoPrompt } from "./checar-versao-prompt-regras";

const BASE = "origin/main";
const PASTA = "src/ia/prompts/";

function git(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" });
}

function conteudoNoBase(caminho: string): string | null {
  try {
    return git(["show", `${BASE}:${caminho}`]);
  } catch {
    return null;
  }
}

function conteudoAtual(caminho: string): string | null {
  return existsSync(caminho) ? readFileSync(caminho, "utf8") : null;
}

function arquivosMudados(): string[] {
  const saida = git(["diff", "--name-only", BASE, "--", PASTA]);
  return saida
    .split("\n")
    .map((linha) => linha.trim())
    .filter(Boolean);
}

const caminhos = arquivosMudados();
const arquivos: ArquivoPrompt[] = caminhos.map((caminho) => ({
  caminho,
  antigo: conteudoNoBase(caminho),
  novo: conteudoAtual(caminho),
}));

const problemas = verificarVersoesDePrompt(arquivos);

if (problemas.length === 0) {
  console.log(
    caminhos.length === 0
      ? `checar-versao-prompt: nenhum arquivo de ${PASTA} mudou em relacao a ${BASE}.`
      : `checar-versao-prompt: ${caminhos.length} arquivo(s) mudado(s), todos com versao nova.`,
  );
  process.exit(0);
}

console.error(`checar-versao-prompt: ${problemas.length} problema(s) encontrado(s):\n`);
for (const p of problemas) {
  console.error(`  ${p}`);
}
process.exit(1);
