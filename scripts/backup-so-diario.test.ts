/**
 * `deploy/backup/backup.sh` (23/10/2026): só o dump DIÁRIO vai para o bucket; o de deploy (`agora`) fica no volume; o bucket guarda
 * `BACKUP_REMOTO_DIAS` (14) dias, apagando de verdade (`--b2-hard-delete`) e nunca o arquivo que acabou de subir; o volume guarda os diários
 * 30 dias e os de deploy 3; falha do bucket nunca derruba o `agora`. Um `pg_dump` e um `rclone` de mentira, postos na frente do PATH, escrevem
 * cada chamada num arquivo; o dump falha se `FALHAR_PG_DUMP=1`, o `rclone` falha no comando de `FALHAR_RCLONE` (copy, delete ou todos).
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = path.join(process.cwd(), "deploy", "backup", "backup.sh");
let raiz = "";
let bin = "";
let volume = "";
let chamadas = "";

/** O caminho como o bash (Git Bash no Windows, bash comum no resto) o entende. */
function paraBash(caminho: string): string {
  const unix = caminho.replace(/\\/g, "/");
  return unix.replace(/^([A-Za-z]):/, (_t, letra: string) => `/${letra.toLowerCase()}`);
}

beforeAll(() => {
  raiz = mkdtempSync(path.join(tmpdir(), "backup-sh-"));
  bin = path.join(raiz, "bin");
  mkdirSync(bin);
  volume = path.join(raiz, "volume");
  chamadas = path.join(raiz, "chamadas.log");
  writeFileSync(
    path.join(bin, "pg_dump"),
    `#!/usr/bin/env bash\nif [ "\${FALHAR_PG_DUMP:-}" = "1" ]; then echo "pg_dump: erro de mentira" >&2; exit 1; fi\necho "-- dump de mentira"\n`,
    { mode: 0o755 },
  );
  writeFileSync(
    path.join(bin, "rclone"),
    [
      "#!/usr/bin/env bash",
      `echo "rclone $*" >> "${paraBash(chamadas)}"`,
      'if [ "${FALHAR_RCLONE:-}" = "todos" ] || [ "${FALHAR_RCLONE:-}" = "$1" ]; then echo "403 storage_cap_exceeded (de mentira)" >&2; exit 1; fi',
      "exit 0",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
});

afterAll(() => {
  rmSync(raiz, { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(volume, { recursive: true, force: true });
  mkdirSync(volume);
  rmSync(chamadas, { force: true });
});

function rodar(args: string[], env: Record<string, string> = {}) {
  const r = spawnSync("bash", [paraBash(SCRIPT), ...args], {
    encoding: "utf-8",
    env: {
      ...process.env,
      PATH: `${paraBash(bin)}:${process.env.PATH ?? ""}`,
      DATABASE_URL: "postgres://de-mentira",
      BACKUP_DESTINO: paraBash(volume),
      BACKUP_RCLONE_REMOTE: "b2:bucket-de-teste",
      ...env,
    },
  });
  return { codigo: r.status, saida: `${r.stdout}${r.stderr}` };
}

function rclone(): string[] {
  return existsSync(chamadas) ? readFileSync(chamadas, "utf-8").split("\n").filter(Boolean) : [];
}

function arquivos(): string[] {
  return readdirSync(volume).sort();
}

/** Cria um arquivo no volume com a data de modificação `dias` dias atrás. */
function criar(nome: string, dias: number) {
  const caminho = path.join(volume, nome);
  writeFileSync(caminho, "x");
  const t = new Date(Date.now() - dias * 86_400_000);
  spawnSync("touch", ["-d", t.toISOString(), paraBash(caminho)]);
}

const DEPLOY = /^roteiros-\d{4}-\d{2}-\d{2}-\d{4}-deploy\.sql\.gz$/;
const DIARIO = /^roteiros-\d{4}-\d{2}-\d{2}-\d{4}\.sql\.gz$/;

describe("backup.sh: só o diário vai para fora", () => {
  it("agora faz o dump de deploy no volume e não toca no bucket", () => {
    const r = rodar(["agora"]);
    expect(r.codigo).toBe(0);
    const lista = arquivos();
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatch(DEPLOY);
    expect(rclone()).toEqual([]);
    expect(r.saida).toContain("so no volume local");
  });

  it("agora --enviar manda também para o bucket, e poda", () => {
    const r = rodar(["agora", "--enviar"]);
    expect(r.codigo).toBe(0);
    const [copia, poda] = rclone();
    expect(copia).toMatch(/^rclone copy .*roteiros-.*-deploy\.sql\.gz b2:bucket-de-teste$/);
    expect(poda).toContain("rclone delete b2:bucket-de-teste");
  });

  it("diario manda o dump sem o sufixo -deploy e poda o bucket com 14 dias, apagando de verdade", () => {
    const r = rodar(["diario"]);
    expect(r.codigo).toBe(0);
    const lista = arquivos();
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatch(DIARIO);
    const chamadasRclone = rclone();
    expect(chamadasRclone[0]).toMatch(
      /^rclone copy .*roteiros-\d{4}-\d{2}-\d{2}-\d{4}\.sql\.gz b2:bucket-de-teste$/,
    );
    const poda = chamadasRclone[1];
    expect(poda).toContain("--min-age 14d");
    expect(poda).toContain("--b2-hard-delete");
    // o arquivo recém enviado é o primeiro a ser protegido, antes de qualquer regra de inclusão
    expect(poda).toContain(`--filter - ${lista[0]} --filter + roteiros-*.sql.gz --filter - *`);
    expect(chamadasRclone[2]).toBe("rclone backend cleanup-hidden b2:bucket-de-teste");
  });

  it("BACKUP_REMOTO_DIAS muda a retenção do bucket; valor torto volta a 14 com aviso (0 apagaria o dump novo)", () => {
    rodar(["diario"], { BACKUP_REMOTO_DIAS: "7" });
    expect(rclone()[1]).toContain("--min-age 7d");
    for (const torto of ["0", "-3", "abc", "1.5"]) {
      rmSync(chamadas, { force: true });
      const r = rodar(["diario"], { BACKUP_REMOTO_DIAS: torto });
      expect(r.codigo).toBe(0);
      expect(rclone()[1]).toContain("--min-age 14d");
      expect(r.saida).toContain("AVISO: BACKUP_REMOTO_DIAS");
    }
  });

  it("sem BACKUP_RCLONE_REMOTE, nada vai para fora e o dump fica no volume", () => {
    const r = rodar(["diario"], { BACKUP_RCLONE_REMOTE: "" });
    expect(r.codigo).toBe(0);
    expect(rclone()).toEqual([]);
    expect(arquivos()).toHaveLength(1);
  });
});

describe("backup.sh: falha no bucket não trava o deploy", () => {
  it.each(["copy", "delete", "todos"])(
    "agora --enviar sai com 0 quando o rclone falha (%s) e o dump local fica",
    (qual) => {
      const r = rodar(["agora", "--enviar"], { FALHAR_RCLONE: qual });
      expect(r.codigo).toBe(0);
      expect(arquivos()).toHaveLength(1);
      expect(arquivos()[0]).toMatch(DEPLOY);
      expect(r.saida).toContain("ERRO");
    },
  );

  it("agora (o que o deploy chama) sai com 0 mesmo com o bucket cheio, porque nem tenta o bucket", () => {
    const r = rodar(["agora"], { FALHAR_RCLONE: "todos" });
    expect(r.codigo).toBe(0);
    expect(rclone()).toEqual([]);
  });

  it("diario com o bucket cheio: o envio falha mas a poda roda mesmo assim (é ela que abre espaço)", () => {
    const r = rodar(["diario"], { FALHAR_RCLONE: "copy" });
    expect(r.codigo).toBe(0);
    expect(r.saida).toContain("o envio para b2:bucket-de-teste falhou");
    expect(rclone().some((c) => c.startsWith("rclone delete "))).toBe(true);
  });

  it("só o dump local falhando faz o agora sair com erro, sem deixar arquivo nem parcial", () => {
    const r = rodar(["agora"], { FALHAR_PG_DUMP: "1" });
    expect(r.codigo).toBe(1);
    expect(arquivos()).toEqual([]);
    expect(rclone()).toEqual([]);
  });

  it("dump que falha no diário não manda nada para fora", () => {
    const r = rodar(["diario"], { FALHAR_PG_DUMP: "1" });
    expect(r.codigo).toBe(1);
    expect(rclone()).toEqual([]);
  });
});

describe("backup.sh: retenção do volume", () => {
  it("dumps de deploy saem depois de 3 dias, os diários (e os nomes antigos) ficam até 30", () => {
    criar("roteiros-2026-01-01-0600-deploy.sql.gz", 4); // deploy velho: sai
    criar("roteiros-2026-01-02-1000-deploy.sql.gz", 2); // deploy recente: fica
    criar("roteiros-2026-01-03-0600.sql.gz", 20); // diário: fica
    criar("roteiros-2026-01-04-0600.sql.gz", 31); // diário velho: sai
    criar("roteiros-2026-01-05-1500.sql.gz", 5); // nome antigo (sem sufixo), tratado como diário: fica
    criar("roteiros-2026-01-06-0600.sql.gz.parcial", 2); // parcial esquecido: sai
    criar("outra-coisa.txt", 90); // não é dump nosso: nunca mexe
    const r = rodar(["agora"]);
    expect(r.codigo).toBe(0);
    const lista = arquivos();
    expect(lista).not.toContain("roteiros-2026-01-01-0600-deploy.sql.gz");
    expect(lista).toContain("roteiros-2026-01-02-1000-deploy.sql.gz");
    expect(lista).toContain("roteiros-2026-01-03-0600.sql.gz");
    expect(lista).not.toContain("roteiros-2026-01-04-0600.sql.gz");
    expect(lista).toContain("roteiros-2026-01-05-1500.sql.gz");
    expect(lista).not.toContain("roteiros-2026-01-06-0600.sql.gz.parcial");
    expect(lista).toContain("outra-coisa.txt");
    expect(lista.filter((n) => DEPLOY.test(n) && !n.startsWith("roteiros-2026-01"))).toHaveLength(
      1,
    );
  });

  it("BACKUP_RETENCAO_DIAS e BACKUP_RETENCAO_DEPLOY_DIAS mudam os cortes", () => {
    criar("roteiros-2026-01-01-0600-deploy.sql.gz", 2);
    criar("roteiros-2026-01-02-0600.sql.gz", 10);
    rodar(["agora"], { BACKUP_RETENCAO_DEPLOY_DIAS: "1", BACKUP_RETENCAO_DIAS: "7" });
    expect(arquivos().filter((n) => n.startsWith("roteiros-2026-01"))).toEqual([]);
  });

  it("o dump que acabou de sair nunca é apagado, nem com retenção mínima", () => {
    const r = rodar(["agora"], { BACKUP_RETENCAO_DEPLOY_DIAS: "0" });
    expect(r.codigo).toBe(0);
    expect(arquivos()).toHaveLength(1);
  });
});

describe("backup.sh: podar-remoto e uso", () => {
  it("podar-remoto só apaga do bucket, sem dump nem envio", () => {
    const r = rodar(["podar-remoto"]);
    expect(r.codigo).toBe(0);
    expect(arquivos()).toEqual([]);
    const c = rclone();
    expect(c.some((x) => x.startsWith("rclone copy"))).toBe(false);
    expect(c[0]).toContain("rclone delete b2:bucket-de-teste --min-age 14d --b2-hard-delete");
    expect(c[0]).not.toContain("--filter - roteiros-");
  });

  it("podar-remoto sem bucket configurado recusa", () => {
    const r = rodar(["podar-remoto"], { BACKUP_RCLONE_REMOTE: "" });
    expect(r.codigo).toBe(1);
    expect(rclone()).toEqual([]);
  });

  it("argumento desconhecido recusa com a frase de uso e o código 2, sem fazer dump", () => {
    const r = rodar(["agor"]);
    expect(r.codigo).toBe(2);
    expect(r.saida).toContain("uso: backup.sh");
    expect(arquivos()).toEqual([]);
  });
});
