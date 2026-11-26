/**
 * E74 PR 2a (R-n): o deploy não mata pedido. `deploy/pedidos-andando.sh` espera os pedidos de geração em andamento terminarem (até 4 minutos) antes de o `deploy/deploy.sh` recriar o app e o
 * worker. O `contar_pedidos` de mentira (o de verdade fala com o Postgres da VPS) devolve os números que o teste quer, sem tocar em nada fora daqui.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ESPERA_DO_DEPLOY_S, ESTADOS_EM_ANDAMENTO } from "@/config/pedidos";

const LIB = path.join(process.cwd(), "deploy", "pedidos-andando.sh");
const DEPLOY = path.join(process.cwd(), "deploy", "deploy.sh");
const ENSAIO = path.join(process.cwd(), "deploy", "ensaio", "ensaiar.sh");

/** O caminho como o bash (Git Bash no Windows, bash comum no resto) o entende. */
function paraBash(caminho: string): string {
  const unix = caminho.replace(/\\/g, "/");
  return unix.replace(/^([A-Za-z]):/, (_t, letra: string) => `/${letra.toLowerCase()}`);
}

/** Roda `esperar_pedidos <limite>` com um `contar_pedidos` que devolve, a cada chamada, o próximo número da lista (o último se repete). */
function esperar(numeros: string[], limite: number) {
  const lista = numeros.map((n) => `'${n}'`).join(" ");
  const script = [
    `. '${paraBash(LIB)}'`,
    "INTERVALO_DOS_PEDIDOS_S=0",
    `RESPOSTAS=(${lista})`,
    "CHAMADAS=0",
    // contar_pedidos roda numa subshell ($(...)): o contador mora num arquivo.
    'CONTA=$(mktemp)',
    'echo 0 > "$CONTA"',
    'contar_pedidos() { local i; i=$(cat "$CONTA"); echo $((i + 1)) > "$CONTA"; [ "$i" -ge "${#RESPOSTAS[@]}" ] && i=$((${#RESPOSTAS[@]} - 1)); [ "${RESPOSTAS[$i]}" = "falha" ] && return 1; echo "${RESPOSTAS[$i]}"; }',
    `esperar_pedidos ${limite}`,
    'echo "codigo=$? chamadas=$(cat "$CONTA")"',
    'rm -f "$CONTA"',
  ].join("\n");
  const r = spawnSync("bash", ["-c", script], { encoding: "utf-8" });
  return `${r.stdout}${r.stderr}`;
}

describe("a espera do deploy pelos pedidos em andamento", () => {
  it("espera até não haver pedido andando e segue", () => {
    const saida = esperar(["2", "1", "0"], 60);
    expect(saida).toContain("2 pedido(s) em andamento");
    expect(saida).toContain("nenhum pedido em andamento");
    expect(saida).toContain("codigo=0 chamadas=3");
  });

  it("sem pedido andando, segue na hora", () => {
    expect(esperar(["0"], 60)).toContain("codigo=0 chamadas=1");
  });

  it("passado o prazo, segue mesmo com pedido andando (nunca trava o deploy)", () => {
    const saida = esperar(["1"], 0);
    expect(saida).toContain("depois de 0s; seguindo");
    expect(saida).toContain("codigo=0");
  });

  it("sem conseguir contar (o banco não respondeu, a saída não é número), segue em vez de travar", () => {
    expect(esperar(["falha"], 60)).toContain("nao deu para contar");
    expect(esperar(["erro de conexao"], 60)).toContain("nao deu para contar");
    expect(esperar([""], 60)).toContain("nao deu para contar");
  });

  it("o prazo é o mesmo de src/config/pedidos.ts, e a conta usa os mesmos estados em andamento", () => {
    const lib = readFileSync(LIB, "utf-8");
    expect(lib).toContain(`ESPERA_DOS_PEDIDOS_S=${ESPERA_DO_DEPLOY_S}`);
    expect(ESPERA_DO_DEPLOY_S).toBe(240);
    const sql = /SQL_PEDIDOS_ANDANDO="([^"]+)"/.exec(lib)?.[1] ?? "";
    expect(sql).toContain("from pedidos_de_geracao");
    const estados = /estado in \(([^)]+)\)/.exec(sql)?.[1].split(",").map((e) => e.trim().replace(/'/g, ""));
    expect(estados).toEqual([...ESTADOS_EM_ANDAMENTO]);
  });

  it("o deploy espera os pedidos DEPOIS de migrar e ANTES de recriar o app e o worker", () => {
    const deploy = readFileSync(DEPLOY, "utf-8");
    const migra = deploy.indexOf("npm run -s db:migrate");
    const espera = deploy.indexOf('esperar_pedidos "$ESPERA_DOS_PEDIDOS_S"');
    const sobe = deploy.indexOf("docker compose up -d --remove-orphans");
    expect(migra).toBeGreaterThan(0);
    expect(espera).toBeGreaterThan(migra);
    expect(sobe).toBeGreaterThan(espera);
    expect(deploy).toContain(". \"$AQUI/pedidos-andando.sh\"");
    expect(deploy).toMatch(/contar_pedidos\(\) \{\s+ssh "\$ALIAS" .*psql -U roteiros -d roteiros -tAc .*\$SQL_PEDIDOS_ANDANDO/);
  });

  it("o ensaio confere a conta contra o banco recém-migrado, antes de subir o resto", () => {
    const ensaio = readFileSync(ENSAIO, "utf-8");
    const migra = ensaio.indexOf('passo "migra o banco pelo container do worker" migrar');
    const conta = ensaio.indexOf("espera_dos_pedidos_funciona\n", migra);
    const sobe = ensaio.indexOf('passo "sobe o app, o worker e o backup" subir_resto');
    expect(migra).toBeGreaterThan(0);
    expect(conta).toBeGreaterThan(migra);
    expect(sobe).toBeGreaterThan(conta);
  });
});
