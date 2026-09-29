/**
 * "Nova marca" e "dar acesso" (V12b, item 2): a marca nasce sem ninguém
 * (`criarMarca`), a primeira pessoa a ganhar acesso vira o dono
 * (`darAcesso`), os seguintes entram como membro. `renomearCliente`
 * (item 3) e `renomearPessoa` (item 4), isolados por marca.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { nichos, user } from "@/db/schema";
import {
  criarMarca,
  darAcesso,
  ErroCliente,
  membrosDaMarca,
  NOME_SEM_NOME_AINDA,
  renomearCliente,
  renomearPessoa,
} from "@/servicos/clientes";

import { resetarSchema } from "../../scripts/resetar-schema";

let nichoId: number;

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db()
    .insert(nichos)
    .values({ slug: "admin-marcas-teste", nome: "Admin marcas teste", termos: ["exemplo"] })
    .returning();
  nichoId = nicho.id;
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

describe("criarMarca", () => {
  it("cria so a marca, sem usuarioId nem membro nenhum", async () => {
    const marca = await criarMarca({ nome: "[teste] Marca nova", nichoId });
    expect(marca.usuarioId).toBeNull();
    expect(marca.tipo).toBe("negocio");
    expect(marca.plano).toBe("padrao");

    const membros = await membrosDaMarca(marca.id);
    expect(membros).toHaveLength(0);
  });

  it("tipo e plano respeitam o que foi pedido, quando informado", async () => {
    const marca = await criarMarca({ nome: "[teste] Marca pessoa sem limite", nichoId, tipo: "pessoa", plano: "sem_limite" });
    expect(marca.tipo).toBe("pessoa");
    expect(marca.plano).toBe("sem_limite");
  });
});

describe("darAcesso: quem chega primeiro vira dono", () => {
  it("a primeira pessoa (e-mail novo) vira dono, com o nome que a folha pediu", async () => {
    const marca = await criarMarca({ nome: "[teste] Marca para dar acesso", nichoId });

    const resultado = await darAcesso(marca.id, "Primeira Pessoa", "primeira-pessoa@admin-marcas.teste");
    expect(resultado.tipo).toBe("convite");

    const membros = await membrosDaMarca(marca.id);
    expect(membros).toHaveLength(1);
    expect(membros[0].papel).toBe("dono");
    expect(membros[0].nome).toBe("Primeira Pessoa");
  });

  it("a segunda pessoa entra como membro, nunca dono", async () => {
    const marca = await criarMarca({ nome: "[teste] Marca com duas pessoas", nichoId });
    await darAcesso(marca.id, "Dona da Marca", "dona@admin-marcas.teste");

    await darAcesso(marca.id, "Segunda Pessoa", "segunda@admin-marcas.teste");

    const membros = await membrosDaMarca(marca.id);
    expect(membros).toHaveLength(2);
    const segunda = membros.find((m) => m.email === "segunda@admin-marcas.teste");
    expect(segunda?.papel).toBe("membro");
  });

  it("sem nome informado, cai em 'Sem nome ainda' (mesmo padrao de antes)", async () => {
    const marca = await criarMarca({ nome: "[teste] Marca sem nome informado", nichoId });
    await darAcesso(marca.id, "  ", "sem-nome@admin-marcas.teste");

    const [membro] = await membrosDaMarca(marca.id);
    expect(membro.nome).toBe(NOME_SEM_NOME_AINDA);
  });

  it("e-mail que ja tem login entra na hora, sem sobrescrever o nome que ja tinha", async () => {
    await db()
      .insert(user)
      .values({ id: "admin-marcas-ja-tinha-login", name: "Nome Original", email: "ja-tinha-login@admin-marcas.teste" });

    const marca = await criarMarca({ nome: "[teste] Marca com e-mail existente", nichoId });
    const resultado = await darAcesso(marca.id, "Nome Digitado Agora", "ja-tinha-login@admin-marcas.teste");

    expect(resultado.tipo).toBe("jaTinhaLogin");
    if (resultado.tipo === "jaTinhaLogin") expect(resultado.nome).toBe("Nome Original");

    const [linha] = await db().select({ name: user.name }).from(user).where(eq(user.id, "admin-marcas-ja-tinha-login"));
    expect(linha.name).toBe("Nome Original");
  });

  it("pessoa que ja tem acesso: erro nomeado, sem duplicar membro", async () => {
    const marca = await criarMarca({ nome: "[teste] Marca sem acesso duplicado", nichoId });
    await darAcesso(marca.id, "Dona", "duplicada@admin-marcas.teste");

    await expect(darAcesso(marca.id, "Dona de Novo", "duplicada@admin-marcas.teste")).rejects.toThrow(ErroCliente);

    const membros = await membrosDaMarca(marca.id);
    expect(membros).toHaveLength(1);
  });
});

describe("renomearCliente", () => {
  it("grava o nome aparado", async () => {
    const marca = await criarMarca({ nome: "[teste] Nome antigo", nichoId });
    const renomeada = await renomearCliente(marca.id, "  [teste] Nome novo  ");
    expect(renomeada.nome).toBe("[teste] Nome novo");
  });

  it("recusa nome vazio, sem gravar", async () => {
    const marca = await criarMarca({ nome: "[teste] Fica assim", nichoId });
    await expect(renomearCliente(marca.id, "   ")).rejects.toThrow(ErroCliente);
  });

  it("recusa nome com mais de 80 caracteres", async () => {
    const marca = await criarMarca({ nome: "[teste] Tambem fica assim", nichoId });
    await expect(renomearCliente(marca.id, "a".repeat(81))).rejects.toThrow(ErroCliente);
  });
});

describe("renomearPessoa: isolado por marca", () => {
  it("grava o nome quando a pessoa e membro desta marca", async () => {
    const marca = await criarMarca({ nome: "[teste] Marca A da pessoa", nichoId });
    await darAcesso(marca.id, "Nome Velho", "pessoa-a@admin-marcas.teste");
    const [membro] = await membrosDaMarca(marca.id);

    await renomearPessoa(marca.id, membro.usuarioId, "  Nome Novo  ");

    const [linha] = await db().select({ name: user.name }).from(user).where(eq(user.id, membro.usuarioId));
    expect(linha.name).toBe("Nome Novo");
  });

  it("recusa renomear alguem que nao e membro desta marca", async () => {
    const marcaA = await criarMarca({ nome: "[teste] Marca A isolamento", nichoId });
    const marcaB = await criarMarca({ nome: "[teste] Marca B isolamento", nichoId });
    await darAcesso(marcaA.id, "Pessoa da A", "pessoa-isolamento@admin-marcas.teste");
    const [membroDaA] = await membrosDaMarca(marcaA.id);

    await expect(renomearPessoa(marcaB.id, membroDaA.usuarioId, "Tentando de fora")).rejects.toThrow(ErroCliente);

    const [linha] = await db().select({ name: user.name }).from(user).where(eq(user.id, membroDaA.usuarioId));
    expect(linha.name).toBe("Pessoa da A");
  });

  it("recusa nome vazio", async () => {
    const marca = await criarMarca({ nome: "[teste] Marca nome vazio", nichoId });
    await darAcesso(marca.id, "Pessoa", "pessoa-vazio@admin-marcas.teste");
    const [membro] = await membrosDaMarca(marca.id);

    await expect(renomearPessoa(marca.id, membro.usuarioId, "   ")).rejects.toThrow(ErroCliente);
  });
});
