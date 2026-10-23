/**
 * O "Quero testar" da página de entrada (E57a), contra o Postgres real: a inscrição grava (e-mail em minúsculas, WhatsApp só com dígitos, o aceite do contato com a hora), o
 * aviso ao admin sai uma vez por pessoa nova (e-mail simulado, nada sai de verdade), o mesmo e-mail de novo não duplica nem avisa, o campo escondido do robô descarta em
 * silêncio, o limite por IP e o teto geral por hora barram o excesso, a lista do admin vem do mais novo para o mais velho, e só o admin apaga.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db, getPool } from "@/db";
import { interessados, user } from "@/db/schema";
import { criarLimitador } from "@/lib/limite-de-taxa";
import {
  apagarInteressado,
  avisarAdminDoInteresse,
  LIMITE_GERAL_POR_HORA,
  listarInteressados,
  registrarInteresse,
} from "@/servicos/interessados";
import { textosInteressados } from "@/textos/interessados";

import { resetarSchema } from "../../scripts/resetar-schema";

const estado = vi.hoisted(() => ({
  cabecalhos: new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }),
  sessao: null as null | { user: { id: string; role: string; name: string } },
}));

vi.mock("@/lib/email", () => ({
  enviarEmail: vi.fn(async () => undefined),
  ErroEmail: class ErroEmail extends Error {},
}));
vi.mock("next/headers", () => ({ headers: async () => estado.cabecalhos }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/sessao", () => ({ sessaoAtual: vi.fn(async () => estado.sessao) }));

const { enviarEmail } = await import("@/lib/email");
const { queroTestarAction } = await import("@/app/acoes");
const { apagarInteressadoAction } = await import("@/app/admin/interessados/acoes");

const PEDIDO = { nome: "Ana Prado", email: "ana@exemplo.com.br", whatsapp: "(11) 91234-5678", ramo: "dentista", aceite: true, site: "" };

beforeAll(async () => {
  await resetarSchema(db());
  await db().insert(user).values({ id: "int-admin", name: "Admin de teste", email: "admin-int@exemplo.teste", role: "admin" });
}, 60_000);

afterAll(async () => {
  await getPool().end();
});

beforeEach(async () => {
  vi.mocked(enviarEmail).mockClear();
  estado.sessao = null;
  await db().delete(interessados);
});

/** Um limitador novo por teste: o do módulo é por processo e divide o IP entre os testes. */
const limitadorNovo = () => criarLimitador({ janelaMs: 60_000, maximo: 5 });

describe("registrarInteresse", () => {
  it("grava a pessoa: e-mail em minúsculas, WhatsApp só com dígitos, o aceite do contato com a hora", async () => {
    const antes = Date.now();
    const r = await registrarInteresse({ ...PEDIDO, email: "ANA@Exemplo.com.br" }, { ip: "1.1.1.1", limitador: limitadorNovo(), avisar: async () => undefined });
    expect(r).toEqual({ ok: true });
    const linhas = await db().select().from(interessados);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({ nome: "Ana Prado", email: "ana@exemplo.com.br", whatsapp: "11912345678", ramo: "dentista" });
    expect(linhas[0].aceitouContatoEm.getTime()).toBeGreaterThanOrEqual(antes - 1000);
  });

  it("sem o aceite ou com campo ruim, não grava, não avisa e devolve o erro de cada campo", async () => {
    const avisar = vi.fn(async () => undefined);
    const r = await registrarInteresse({ ...PEDIDO, aceite: false, email: "torto", nome: "" }, { ip: "1.1.1.2", limitador: limitadorNovo(), avisar });
    expect(r).toMatchObject({ ok: false, motivo: "campos" });
    if (!r.ok && r.motivo === "campos") {
      expect(Object.keys(r.erros).sort()).toEqual(["aceite", "email", "nome"]);
    }
    expect(await db().select().from(interessados)).toHaveLength(0);
    expect(avisar).not.toHaveBeenCalled();
  });

  it("o mesmo e-mail de novo (até em maiúsculas) responde ok, mas não cria outra linha nem outro aviso", async () => {
    const avisar = vi.fn(async () => undefined);
    const opcoes = { ip: "1.1.1.3", limitador: limitadorNovo(), avisar };
    expect(await registrarInteresse(PEDIDO, opcoes)).toEqual({ ok: true });
    expect(await registrarInteresse({ ...PEDIDO, email: "ANA@EXEMPLO.COM.BR", nome: "Outra Pessoa" }, opcoes)).toEqual({ ok: true });
    const linhas = await db().select().from(interessados);
    expect(linhas).toHaveLength(1);
    expect(linhas[0].nome).toBe("Ana Prado");
    expect(avisar).toHaveBeenCalledTimes(1);
  });

  it("o campo escondido preenchido (robô) devolve ok sem gravar nem avisar", async () => {
    const avisar = vi.fn(async () => undefined);
    const r = await registrarInteresse({ ...PEDIDO, site: "http://spam.example" }, { ip: "1.1.1.4", limitador: limitadorNovo(), avisar });
    expect(r).toEqual({ ok: true });
    expect(await db().select().from(interessados)).toHaveLength(0);
    expect(avisar).not.toHaveBeenCalled();
  });

  it("o limite por IP: o sexto pedido da janela é barrado e não grava; outro IP não é afetado", async () => {
    const limitador = limitadorNovo();
    const avisar = async () => undefined;
    for (let i = 1; i <= 5; i += 1) {
      const r = await registrarInteresse({ ...PEDIDO, email: `pessoa${i}@exemplo.com.br` }, { ip: "9.9.9.9", limitador, avisar });
      expect(r, `pedido ${i}`).toEqual({ ok: true });
    }
    const barrado = await registrarInteresse({ ...PEDIDO, email: "pessoa6@exemplo.com.br" }, { ip: "9.9.9.9", limitador, avisar });
    expect(barrado).toEqual({ ok: false, motivo: "limite" });
    expect(await db().select().from(interessados)).toHaveLength(5);
    const outro = await registrarInteresse({ ...PEDIDO, email: "pessoa7@exemplo.com.br" }, { ip: "8.8.8.8", limitador, avisar });
    expect(outro).toEqual({ ok: true });
  });

  it("o teto geral por hora: com o teto cheio, ninguém mais entra até a hora virar (IP novo não passa)", async () => {
    const agora = new Date();
    await db()
      .insert(interessados)
      .values(
        Array.from({ length: LIMITE_GERAL_POR_HORA }, (_, i) => ({
          nome: `Pessoa ${i}`,
          email: `teto${i}@exemplo.com.br`,
          whatsapp: "11912345678",
          ramo: "teste",
          aceitouContatoEm: agora,
          criadoEm: agora,
        })),
      );
    const avisar = vi.fn(async () => undefined);
    const barrado = await registrarInteresse(PEDIDO, { ip: "7.7.7.7", limitador: limitadorNovo(), avisar });
    expect(barrado).toEqual({ ok: false, motivo: "limite" });
    expect(avisar).not.toHaveBeenCalled();
    // Duas horas depois, as linhas saíram da janela e a pessoa entra.
    const depois = await registrarInteresse(PEDIDO, { ip: "7.7.7.7", limitador: limitadorNovo(), avisar, agora: new Date(agora.getTime() + 2 * 60 * 60 * 1000) });
    expect(depois).toEqual({ ok: true });
  });
});

describe("o aviso ao admin", () => {
  it("manda um e-mail a cada admin do banco, com os dados da pessoa escapados (nada de HTML do formulário no e-mail)", async () => {
    await avisarAdminDoInteresse({ nome: "Ana <b>Prado</b>", email: "ana@exemplo.com.br", whatsapp: "11912345678", ramo: "dentista & <script>x</script>" });
    expect(enviarEmail).toHaveBeenCalledTimes(1);
    const envio = vi.mocked(enviarEmail).mock.calls[0][0];
    expect(envio.para).toBe("admin-int@exemplo.teste");
    expect(envio.assunto).toContain("Ana");
    expect(envio.html).toContain("11 91234-5678");
    expect(envio.html).toContain("&lt;script&gt;");
    expect(envio.html).not.toContain("<script>");
    expect(envio.html).not.toContain("<b>Prado</b>");
  });

  it("a inscrição pelo servidor avisa uma vez e a falha do e-mail não derruba a inscrição", async () => {
    const r = await registrarInteresse(PEDIDO, { ip: "2.2.2.2", limitador: limitadorNovo() });
    expect(r).toEqual({ ok: true });
    expect(enviarEmail).toHaveBeenCalledTimes(1);

    vi.mocked(enviarEmail).mockRejectedValueOnce(new Error("sem rede"));
    const falhou = await registrarInteresse({ ...PEDIDO, email: "outra@exemplo.com.br" }, { ip: "2.2.2.2", limitador: limitadorNovo() });
    expect(falhou).toEqual({ ok: true });
    expect(await db().select().from(interessados)).toHaveLength(2);
  });
});

describe("queroTestarAction (a porta pública do formulário)", () => {
  it("sem sessão nenhuma, grava a pessoa e responde só ok (nada do banco volta ao navegador)", async () => {
    const r = await queroTestarAction({ ...PEDIDO, email: "porta@exemplo.com.br" });
    expect(r).toEqual({ ok: true });
    expect(await db().select().from(interessados).where(eq(interessados.email, "porta@exemplo.com.br"))).toHaveLength(1);
  });

  it("campo ruim volta como erro de campo, com a frase do produto, e o corpo de lixo não derruba", async () => {
    const r = await queroTestarAction({ ...PEDIDO, whatsapp: "123" });
    expect(r).toEqual({ ok: false, erros: { whatsapp: textosInteressados.erros.whatsapp } });
    expect(await queroTestarAction(null)).toMatchObject({ ok: false });
    expect(await queroTestarAction("texto")).toMatchObject({ ok: false });
  });
});

describe("a lista do admin", () => {
  it("vem do mais novo para o mais velho, com o total", async () => {
    const base = new Date("2026-10-20T12:00:00Z").getTime();
    for (const [i, nome] of ["Primeira", "Segunda", "Terceira"].entries()) {
      await db()
        .insert(interessados)
        .values({ nome, email: `${nome.toLowerCase()}@exemplo.com.br`, whatsapp: "11912345678", ramo: "teste", aceitouContatoEm: new Date(base), criadoEm: new Date(base + i * 60_000) });
    }
    const { total, linhas } = await listarInteressados();
    expect(total).toBe(3);
    expect(linhas.map((l) => l.nome)).toEqual(["Terceira", "Segunda", "Primeira"]);
    expect((await listarInteressados(2)).linhas).toHaveLength(2);
  });

  it("só o admin apaga: sem sessão ou com cliente comum a ação recusa e a linha continua", async () => {
    await registrarInteresse(PEDIDO, { ip: "3.3.3.3", limitador: limitadorNovo(), avisar: async () => undefined });
    const [{ id }] = await db().select().from(interessados);

    estado.sessao = null;
    await expect(apagarInteressadoAction(id)).rejects.toThrow();
    estado.sessao = { user: { id: "cliente-1", role: "cliente", name: "Cliente" } };
    await expect(apagarInteressadoAction(id)).rejects.toThrow();
    expect(await db().select().from(interessados)).toHaveLength(1);

    estado.sessao = { user: { id: "int-admin", role: "admin", name: "Admin" } };
    expect(await apagarInteressadoAction(id)).toEqual({ ok: true });
    expect(await db().select().from(interessados)).toHaveLength(0);
  });

  it("apagar um id que não existe não quebra; id inválido é recusado", async () => {
    expect(await apagarInteressado(999999)).toBe(false);
    estado.sessao = { user: { id: "int-admin", role: "admin", name: "Admin" } };
    expect(await apagarInteressadoAction(-1)).toEqual({ ok: false });
    expect(await apagarInteressadoAction(1.5)).toEqual({ ok: false });
  });
});
