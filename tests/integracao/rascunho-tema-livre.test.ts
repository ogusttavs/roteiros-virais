/**
 * O rascunho de `/hoje/tema-livre` (V5b, item 2 do `PROXIMO.md`): uma linha
 * por pessoa e por marca, sem prazo, que some quando a avaliação daquele
 * texto termina com sucesso e continua se ela der erro. Testa a Server
 * Action (a rota de verdade que a tela chama, mesmo padrão de
 * `isolamento-rotas-briefing.test.ts`), com duas marcas diferentes e duas
 * pessoas na mesma marca (item 2: "duas pessoas na mesma marca podem estar
 * escrevendo assuntos diferentes").
 */
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/sessao", () => ({ sessaoAtual: vi.fn() }));

import { db, getPool } from "@/db";
import { briefings, clientes, membrosMarca, nichos, rascunhosTemaLivre, user, type PerfilCompilado } from "@/db/schema";
import { sessaoAtual } from "@/lib/sessao";

import { resetarSchema } from "../../scripts/resetar-schema";
import { avaliarTemaAction, salvarRascunhoAction } from "../../src/app/(painel)/(completo)/hoje/tema-livre/acoes";

const PERFIL_PADRAO: PerfilCompilado = {
  fatos: {
    oQueVende: "lavagem de estofados",
    preco: "sofa de 3 lugares por R$ 180",
    clienteIdeal: "mora em apartamento",
    medos: [],
    frasesDaFala: [],
    proibicoes: [],
    cenasFilmaveis: [],
    concorrentes: [],
    perfisAdmirados: [],
  },
  resumo: "lava estofados em domicilio",
  referencias: [],
};

/**
 * Só um dono por marca (não duas marcas do mesmo usuário): sem cookie de
 * sessão, `clienteDaSessaoAtual` resolve pela "marca de acesso mais
 * recente" (`resolverMarcaAtiva`), o que tornaria ambíguo qual marca um
 * usuário dono de duas cairia num teste de integração puro, fora de uma
 * requisição Next.js de verdade.
 */
let marcaA: { id: number };
let marcaB: { id: number };

function sessaoDe(usuarioId: string) {
  return { user: { id: usuarioId, role: "cliente" } } as never;
}

async function rascunhoDireto(usuarioId: string, clienteId: number): Promise<string | null> {
  const [linha] = await db()
    .select({ texto: rascunhosTemaLivre.texto })
    .from(rascunhosTemaLivre)
    .where(and(eq(rascunhosTemaLivre.usuarioId, usuarioId), eq(rascunhosTemaLivre.clienteId, clienteId)));
  return linha?.texto ?? null;
}

beforeAll(async () => {
  await resetarSchema(db());

  const [nicho] = await db()
    .insert(nichos)
    .values({ slug: "rascunho-tema-livre-teste", nome: "Rascunho tema livre teste", termos: [] })
    .returning();

  await db()
    .insert(user)
    .values([
      { id: "rascunho-dono-a", name: "[teste] Dono A", email: "dono-a@rascunho-tema.teste" },
      { id: "rascunho-dono-b", name: "[teste] Dono B", email: "dono-b@rascunho-tema.teste" },
      { id: "rascunho-membro-a", name: "[teste] Membro de A", email: "membro-a@rascunho-tema.teste" },
    ]);

  const [a] = await db()
    .insert(clientes)
    .values({ usuarioId: "rascunho-dono-a", nome: "[teste] Marca A", nichoId: nicho.id })
    .returning();
  const [b] = await db()
    .insert(clientes)
    .values({ usuarioId: "rascunho-dono-b", nome: "[teste] Marca B", nichoId: nicho.id })
    .returning();
  marcaA = { id: a.id };
  marcaB = { id: b.id };

  await db()
    .insert(briefings)
    .values([
      { clienteId: a.id, completo: true, perfil: PERFIL_PADRAO },
      { clienteId: b.id, completo: true, perfil: PERFIL_PADRAO },
    ]);

  await db()
    .insert(membrosMarca)
    .values([
      { usuarioId: "rascunho-dono-a", clienteId: a.id, papel: "dono" },
      { usuarioId: "rascunho-dono-b", clienteId: b.id, papel: "dono" },
      { usuarioId: "rascunho-membro-a", clienteId: a.id, papel: "membro" },
    ]);
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

describe("rascunho de tema livre, isolado por usuario e por marca", () => {
  it("o rascunho de uma marca nunca aparece para o dono de outra marca", async () => {
    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe("rascunho-dono-a"));
    await salvarRascunhoAction("assunto da marca A");

    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe("rascunho-dono-b"));
    await salvarRascunhoAction("assunto da marca B");

    expect(await rascunhoDireto("rascunho-dono-a", marcaA.id)).toBe("assunto da marca A");
    expect(await rascunhoDireto("rascunho-dono-b", marcaB.id)).toBe("assunto da marca B");
    // Nenhum rascunho do dono A ficou gravado na marca B, nem o contrario.
    expect(await rascunhoDireto("rascunho-dono-a", marcaB.id)).toBeNull();
    expect(await rascunhoDireto("rascunho-dono-b", marcaA.id)).toBeNull();
  });

  it("duas pessoas na mesma marca podem escrever assuntos diferentes ao mesmo tempo, sem se misturar", async () => {
    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe("rascunho-dono-a"));
    await salvarRascunhoAction("assunto do dono, na marca A");

    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe("rascunho-membro-a"));
    await salvarRascunhoAction("assunto do membro, na mesma marca A");

    expect(await rascunhoDireto("rascunho-dono-a", marcaA.id)).toBe("assunto do dono, na marca A");
    expect(await rascunhoDireto("rascunho-membro-a", marcaA.id)).toBe("assunto do membro, na mesma marca A");
  });

  it("salvar de novo substitui o rascunho anterior da mesma pessoa na mesma marca (upsert)", async () => {
    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe("rascunho-membro-a"));
    await salvarRascunhoAction("primeira versao");
    await salvarRascunhoAction("segunda versao, substitui a primeira");

    expect(await rascunhoDireto("rascunho-membro-a", marcaA.id)).toBe("segunda versao, substitui a primeira");
  });

  it("avaliar com sucesso apaga o rascunho de quem avaliou; nao mexe no rascunho de outra pessoa na mesma marca", async () => {
    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe("rascunho-membro-a"));
    await salvarRascunhoAction("rascunho do membro, que nao deve sumir");

    vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe("rascunho-dono-a"));
    await salvarRascunhoAction("assunto que vai ser avaliado");
    await avaliarTemaAction("assunto que vai ser avaliado");

    expect(await rascunhoDireto("rascunho-dono-a", marcaA.id)).toBeNull();
    expect(await rascunhoDireto("rascunho-membro-a", marcaA.id)).toBe("rascunho do membro, que nao deve sumir");
  });

  it("sem sessao, salvar e avaliar recusam em vez de gravar em algum cliente", async () => {
    vi.mocked(sessaoAtual).mockResolvedValue(null);
    await expect(salvarRascunhoAction("sem sessao")).rejects.toThrow();
    await expect(avaliarTemaAction("sem sessao")).rejects.toThrow();
  });
});
