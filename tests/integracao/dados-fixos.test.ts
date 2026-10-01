/**
 * Dados fixos do briefing (briefing-e-rubricas.md, secao 1; brief-frontend.md,
 * 6.2): salvarDadosFixos grava nome, alcance (brasil ou local, com regiao),
 * site, ramo (nichoId ou ramoOutro, nunca os dois), persona, perfis e quem
 * grava. listarNichosAtivos alimenta a lista de ramo da tela.
 *
 * V12c, item 1 (a E37b): cidade e bairro saem da validacao, alcance e regiao
 * entram no lugar.
 */
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { clientes, nichos, preferenciasUsuario, user } from "@/db/schema";
import {
  aceitarTermos,
  listarNichosAtivos,
  preferenciasDoUsuario,
  salvarDadosFixos,
  salvarHoraLembrete,
  salvarPerfilConta,
  salvarTema,
} from "@/servicos/clientes";

import { resetarSchema } from "../../scripts/resetar-schema";

let clienteId: number;
let outroClienteId: number;
let nichoAtivoId: number;
const usuarioId = "dados-fixos-a";
const outroUsuarioId = "dados-fixos-b";

beforeAll(async () => {
  await resetarSchema(db());

  const [nichoAtivo] = await db()
    .insert(nichos)
    .values({ slug: "dados-fixos-ativo", nome: "Dados fixos ativo" })
    .returning();
  await db().insert(nichos).values({ slug: "dados-fixos-inativo", nome: "Dados fixos inativo", ativo: false });

  await db()
    .insert(user)
    .values([
      { id: usuarioId, name: "[teste] Dados Fixos A", email: "a@dados-fixos.teste" },
      { id: outroUsuarioId, name: "[teste] Dados Fixos B", email: "b@dados-fixos.teste" },
    ]);

  const [clienteA] = await db()
    .insert(clientes)
    .values({ usuarioId, nome: "[teste] Negocio A" })
    .returning();
  const [clienteB] = await db()
    .insert(clientes)
    .values({ usuarioId: outroUsuarioId, nome: "[teste] Negocio B" })
    .returning();

  clienteId = clienteA.id;
  outroClienteId = clienteB.id;
  nichoAtivoId = nichoAtivo.id;
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

describe("listarNichosAtivos", () => {
  it("lista so os nichos ativos", async () => {
    const ativos = await listarNichosAtivos();
    expect(ativos.some((n) => n.id === nichoAtivoId)).toBe(true);
    expect(ativos.every((n) => n.id !== undefined)).toBe(true);
    expect(ativos.map((n) => n.nome)).not.toContain("Dados fixos inativo");
  });
});

describe("salvarDadosFixos", () => {
  it("grava nome, alcance local com regiao, site, ramo (nichoId), persona, perfis e quem grava", async () => {
    const cliente = await salvarDadosFixos(clienteId, {
      nome: "Sorriso Novo",
      alcance: "local",
      regiao: "Belo Horizonte, Savassi",
      site: "https://sorrisonovo.com.br",
      nichoId: nichoAtivoId,
      persona: "negocio",
      perfis: { instagram: "@sorrisonovo" },
      quemGrava: "propria_pessoa",
    });

    expect(cliente.nome).toBe("Sorriso Novo");
    expect(cliente.alcance).toBe("local");
    expect(cliente.regiao).toBe("Belo Horizonte, Savassi");
    expect(cliente.site).toBe("https://sorrisonovo.com.br");
    expect(cliente.nichoId).toBe(nichoAtivoId);
    expect(cliente.ramoOutro).toBeNull();
    expect(cliente.persona).toBe("negocio");
    expect(cliente.perfis).toEqual({ instagram: "@sorrisonovo", tiktok: null, youtube: null });
    expect(cliente.quemGrava).toBe("propria_pessoa");
  });

  it("alcance brasil nao exige regiao, e regiao antiga some", async () => {
    await salvarDadosFixos(clienteId, {
      nome: "Sorriso Novo",
      alcance: "local",
      regiao: "Belo Horizonte",
      nichoId: nichoAtivoId,
      persona: "negocio",
    });
    const cliente = await salvarDadosFixos(clienteId, {
      nome: "Sorriso Novo",
      alcance: "brasil",
      nichoId: nichoAtivoId,
      persona: "negocio",
    });

    expect(cliente.alcance).toBe("brasil");
    expect(cliente.regiao).toBeNull();
  });

  it("recusa alcance local sem regiao", async () => {
    await expect(
      salvarDadosFixos(clienteId, { nome: "Sorriso Novo", alcance: "local", nichoId: nichoAtivoId, persona: "negocio" }),
    ).rejects.toThrow();
  });

  it("recusa um site que nao e https ou nao tem dominio", async () => {
    await expect(
      salvarDadosFixos(clienteId, {
        nome: "Sorriso Novo",
        alcance: "brasil",
        site: "http://sorrisonovo.com.br",
        nichoId: nichoAtivoId,
        persona: "negocio",
      }),
    ).rejects.toThrow();
    await expect(
      salvarDadosFixos(clienteId, {
        nome: "Sorriso Novo",
        alcance: "brasil",
        site: "https://localhost:3000",
        nichoId: nichoAtivoId,
        persona: "negocio",
      }),
    ).rejects.toThrow();
  });

  it("ramo por texto livre grava ramoOutro e limpa nichoId", async () => {
    const cliente = await salvarDadosFixos(clienteId, {
      nome: "Sorriso Novo",
      alcance: "brasil",
      ramoOutro: "clinica veterinaria",
      persona: "negocio",
    });

    expect(cliente.ramoOutro).toBe("clinica veterinaria");
    expect(cliente.nichoId).toBeNull();
  });

  it("recusa sem nichoId e sem ramoOutro", async () => {
    await expect(
      salvarDadosFixos(clienteId, { nome: "Sorriso Novo", alcance: "brasil", persona: "negocio" }),
    ).rejects.toThrow();
  });

  it("salvar os dados fixos de um cliente nao muda os de outro", async () => {
    await salvarDadosFixos(clienteId, {
      nome: "Sorriso Novo",
      alcance: "brasil",
      nichoId: nichoAtivoId,
      persona: "negocio",
    });

    const [outroCliente] = await db().select().from(clientes).where(eq(clientes.id, outroClienteId));
    expect(outroCliente?.alcance).toBeNull();
    expect(outroCliente?.nome).toBe("[teste] Negocio B");
  });
});

/**
 * A migracao 0043 preenche `alcance`/`regiao` a partir de `cidade`/`bairro`
 * para cliente antigo, sem esperar ele passar pela tela de novo (V12c, item
 * 1). Repete aqui o mesmo UPDATE do arquivo de migracao, contra um cliente
 * inserido direto (sem passar por salvarDadosFixos, que ja grava so na forma
 * nova), para provar a logica do preenchimento isolada da aplicacao da
 * migracao inteira (que ja roda no `beforeAll`, via `resetarSchema`).
 */
describe("preenchimento da migracao 0043 (cidade e bairro viram alcance local)", () => {
  async function rodarPreenchimento(clienteId: number) {
    await db().execute(sql`
      UPDATE clientes
      SET alcance = 'local',
          regiao = CASE WHEN bairro IS NOT NULL AND bairro <> '' THEN cidade || ', ' || bairro ELSE cidade END
      WHERE id = ${clienteId} AND cidade IS NOT NULL AND cidade <> ''
    `);
  }

  it("cidade com bairro vira local, regiao com os dois juntos", async () => {
    const [cliente] = await db()
      .insert(clientes)
      .values({ usuarioId, nome: "[teste] Migrado com bairro", cidade: "Campinas", bairro: "Taquaral" })
      .returning();

    await rodarPreenchimento(cliente.id);

    const [depois] = await db().select().from(clientes).where(eq(clientes.id, cliente.id));
    expect(depois?.alcance).toBe("local");
    expect(depois?.regiao).toBe("Campinas, Taquaral");
  });

  it("cidade sem bairro vira local, regiao so com a cidade", async () => {
    const [cliente] = await db()
      .insert(clientes)
      .values({ usuarioId, nome: "[teste] Migrado sem bairro", cidade: "Campinas" })
      .returning();

    await rodarPreenchimento(cliente.id);

    const [depois] = await db().select().from(clientes).where(eq(clientes.id, cliente.id));
    expect(depois?.alcance).toBe("local");
    expect(depois?.regiao).toBe("Campinas");
  });

  it("sem cidade, alcance e regiao continuam nulos (a pessoa escolhe na tela)", async () => {
    const [cliente] = await db()
      .insert(clientes)
      .values({ usuarioId, nome: "[teste] Sem cidade nenhuma" })
      .returning();

    await rodarPreenchimento(cliente.id);

    const [depois] = await db().select().from(clientes).where(eq(clientes.id, cliente.id));
    expect(depois?.alcance).toBeNull();
    expect(depois?.regiao).toBeNull();
  });
});

describe("salvarTema", () => {
  it("comeca em sistema por padrao", async () => {
    const [cliente] = await db().select().from(clientes).where(eq(clientes.id, outroClienteId));
    expect(cliente?.tema).toBe("sistema");
  });

  it("grava claro ou escuro", async () => {
    const cliente = await salvarTema(clienteId, "escuro");
    expect(cliente.tema).toBe("escuro");
  });

  it("recusa um valor que nao e claro, escuro ou sistema", async () => {
    await expect(salvarTema(clienteId, "cinza")).rejects.toThrow();
  });

  it("salvar o tema de um cliente nao muda o de outro", async () => {
    await salvarTema(clienteId, "claro");
    const [outroCliente] = await db().select().from(clientes).where(eq(clientes.id, outroClienteId));
    expect(outroCliente?.tema).toBe("sistema");
  });
});

describe("salvarPerfilConta", () => {
  it("grava nome e perfis", async () => {
    const cliente = await salvarPerfilConta(clienteId, {
      nome: "Sorriso Novo",
      perfis: { instagram: "@sorrisonovo" },
    });

    expect(cliente.nome).toBe("Sorriso Novo");
    expect(cliente.perfis).toEqual({ instagram: "@sorrisonovo", tiktok: null, youtube: null });
  });
});

/** V3, item 4: a hora do lembrete e da pessoa, nao da marca. */
describe("salvarHoraLembrete", () => {
  it("comeca em 08:00 por padrao (sem linha em preferencias_usuario ainda)", async () => {
    const preferencias = await preferenciasDoUsuario(outroUsuarioId);
    expect(preferencias).toBeNull();
  });

  it("grava a hora do lembrete, criando a linha de preferencias na primeira vez", async () => {
    const preferencias = await salvarHoraLembrete(usuarioId, "11:00");
    expect(preferencias.horaLembrete).toBe("11:00");
  });

  it("arredonda para a hora cheia anterior (etapa 13: o navegador nao obriga o step de hora cheia)", async () => {
    const preferencias = await salvarHoraLembrete(usuarioId, "11:45");
    expect(preferencias.horaLembrete).toBe("11:00");
  });

  it("aceita a hora cheia no limite da faixa (22:00)", async () => {
    const preferencias = await salvarHoraLembrete(usuarioId, "22:30");
    expect(preferencias.horaLembrete).toBe("22:00");
  });

  it("recusa fora da faixa de 06:00 a 22:00, mesmo depois de arredondar (etapa 13, ajuste 3)", async () => {
    await expect(salvarHoraLembrete(usuarioId, "05:45")).rejects.toThrow();
    await expect(salvarHoraLembrete(usuarioId, "23:00")).rejects.toThrow();
  });

  it("recusa uma hora mal formada", async () => {
    await expect(salvarHoraLembrete(usuarioId, "25:99")).rejects.toThrow();
  });

  it("salvar a hora de lembrete de uma pessoa nao muda a de outra", async () => {
    await salvarHoraLembrete(usuarioId, "09:00");
    const preferencias = await preferenciasDoUsuario(outroUsuarioId);
    expect(preferencias).toBeNull();
  });
});

describe("aceitarTermos", () => {
  it("comeca nulo, ninguem aceitou por padrao", async () => {
    const preferencias = await preferenciasDoUsuario(outroUsuarioId);
    expect(preferencias?.aceitouTermosEm ?? null).toBeNull();
  });

  it("grava a data do aceite, criando a linha de preferencias na primeira vez", async () => {
    const antes = new Date();
    const preferencias = await aceitarTermos(usuarioId);
    expect(preferencias.aceitouTermosEm).not.toBeNull();
    expect(preferencias.aceitouTermosEm!.getTime()).toBeGreaterThanOrEqual(antes.getTime());
  });

  it("aceitar por uma pessoa nao muda o aceite de outra (o layout do painel trava so quem nao aceitou)", async () => {
    await aceitarTermos(usuarioId);
    const preferencias = await preferenciasDoUsuario(outroUsuarioId);
    expect(preferencias?.aceitouTermosEm ?? null).toBeNull();
  });

  it("aceitar de novo so atualiza a data, nao duplica a linha", async () => {
    await aceitarTermos(usuarioId);
    await aceitarTermos(usuarioId);
    const linhas = await db().select().from(preferenciasUsuario).where(eq(preferenciasUsuario.usuarioId, usuarioId));
    expect(linhas).toHaveLength(1);
  });
});
