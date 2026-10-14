/**
 * `deploy/deploy.sh` exige o sha (regra de 10/10/2026): sem argumento, com `latest` ou com qualquer coisa que não seja um sha de 7 a 40 caracteres hexadecimais, recusa com o código 2 e a frase
 * de uso ANTES de falar com a VPS. Um `ssh` e um `scp` de mentira, postos na frente do PATH, escrevem num arquivo quando são chamados: nenhuma recusa pode deixar rastro nele. `--conferir <sha>`
 * só valida e sai com 0, sem tocar na VPS.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SCRIPT = path.join(process.cwd(), "deploy", "deploy.sh");
let pasta = "";
let marca = "";

/** O caminho como o bash (Git Bash no Windows, bash comum no resto) o entende. */
function paraBash(caminho: string): string {
  const unix = caminho.replace(/\\/g, "/");
  return unix.replace(/^([A-Za-z]):/, (_t, letra: string) => `/${letra.toLowerCase()}`);
}

beforeAll(() => {
  pasta = mkdtempSync(path.join(tmpdir(), "deploy-sha-"));
  marca = path.join(pasta, "chamou-a-vps");
  for (const comando of ["ssh", "scp"]) {
    writeFileSync(path.join(pasta, comando), `#!/usr/bin/env bash\necho "${comando} $*" >> "${paraBash(marca)}"\nexit 1\n`, { mode: 0o755 });
  }
});

afterAll(() => {
  rmSync(pasta, { recursive: true, force: true });
});

function rodar(...args: string[]) {
  const r = spawnSync("bash", [paraBash(SCRIPT), ...args], {
    encoding: "utf-8",
    env: { ...process.env, PATH: `${paraBash(pasta)}:${process.env.PATH ?? ""}` },
  });
  return { codigo: r.status, saida: `${r.stdout}${r.stderr}` };
}

describe("deploy.sh exige o sha", () => {
  it("sem argumento, recusa com a frase de uso e o código 2", () => {
    const r = rodar();
    expect(r.codigo).toBe(2);
    expect(r.saida).toContain("uso: deploy/deploy.sh <sha>");
    expect(r.saida).toContain("nunca 'latest'");
  });

  it("recusa a palavra latest", () => {
    const r = rodar("latest");
    expect(r.codigo).toBe(2);
    expect(r.saida).toContain("tag recusada: 'latest'");
  });

  it.each([
    ["curto demais (6 caracteres)", "abc123"],
    ["comprido demais (41 caracteres)", "a".repeat(41)],
    ["com letra fora do hexadecimal", "abc123g"],
    ["uma branch", "main"],
    ["uma versão", "v1.2.3"],
    ["com espaço no meio", "abc 1234"],
    ["um sha com sobra no começo", " abc1234"],
    ["um sha com quebra de linha no meio", "abc12\n34"],
    ["um sha com tabulacao no fim", "abc1234\t"],
    ["uma expressão de shell", "$(echo abc1234)"],
    ["vazio", ""],
  ])("recusa %s", (_descricao, valor) => {
    const r = rodar(valor);
    expect(r.codigo).toBe(2);
    // uma quebra de linha no meio vira dois argumentos em alguns sistemas: a recusa então é a da contagem de argumentos
    expect(r.saida).toMatch(/tag recusada|uso: deploy\/deploy\.sh <sha>/);
  });

  it("recusa mais de um argumento (a crase que cortou o comando em pedaços)", () => {
    const r = rodar("abc1234", "latest");
    expect(r.codigo).toBe(2);
    expect(r.saida).toContain("uso: deploy/deploy.sh <sha>");
    expect(rodar("abc1234", "").codigo).toBe(2);
  });

  it("nenhuma recusa fala com a VPS", () => {
    rodar();
    rodar("latest");
    rodar("abc123");
    rodar("main");
    rodar("abc1234", "latest");
    expect(existsSync(marca)).toBe(false);
  });

  it("aceita o sha curto, o inteiro e as letras maiúsculas (com --conferir, sem tocar na VPS)", () => {
    for (const sha of ["abc1234", "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678", "ABCDEF1", "0000000"]) {
      const r = rodar("--conferir", sha);
      expect(r.codigo).toBe(0);
      expect(r.saida).toContain(`sha ok: ${sha}`);
    }
    expect(existsSync(marca)).toBe(false);
  });

  it("--conferir também recusa o que não é sha, e sem sha", () => {
    expect(rodar("--conferir", "latest").codigo).toBe(2);
    expect(rodar("--conferir").codigo).toBe(2);
    expect(rodar("--conferir", "abc1234", "extra").codigo).toBe(2);
  });

  it("com um sha válido e sem --conferir, o script segue para a VPS (a primeira coisa que faz é perguntar o nome da máquina)", () => {
    const r = rodar("abc1234");
    // o ssh de mentira falha: o script para, mas o rastro prova que passou da validação
    expect(r.codigo).not.toBe(0);
    expect(existsSync(marca)).toBe(true);
  });
});
