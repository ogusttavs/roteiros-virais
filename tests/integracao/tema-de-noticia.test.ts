/**
 * O tema do dia que nasceu de uma notícia do setor (hotfix de 23/10/2026, "os temas de hoje só tá vindo 1"), contra o Postgres real e com o simulador de IA: o roteiro desse tema parte da
 * notícia (o mesmo ponto de partida do "Criar vídeo com esta notícia", E43), e o de um tema com vídeo de prova segue sem notícia nenhuma.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { briefings, clientes, nichos, noticias, temasDia, user, type TemaDoDia } from "@/db/schema";
import { hojeISO } from "@/lib/config";
import { gerarRoteiro } from "@/servicos/roteiro";

import { resetarSchema } from "../../scripts/resetar-schema";

let nichoId: number;
let clienteId: number;
let noticiaId: number;

function tema(titulo: string, extra: Partial<TemaDoDia> = {}): TemaDoDia {
  return { titulo, descricao: "d", porQue: "p", evidencias: [], evidenciasNoticias: [], puxaPara: "alcance", ...extra };
}

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db().insert(nichos).values({ slug: "tema-de-noticia-teste", nome: "Produtos de limpeza", termos: ["limpeza"] }).returning();
  nichoId = nicho.id;
  await db().insert(user).values({ id: "tema-noticia-usuario", name: "Marca", email: "tema-noticia@exemplo.teste" });
  const [cliente] = await db().insert(clientes).values({ usuarioId: "tema-noticia-usuario", nome: "Marca", nichoId }).returning();
  clienteId = cliente.id;
  await db()
    .insert(briefings)
    .values({
      clienteId,
      completo: true,
      perfil: {
        fatos: { oQueVende: "kit tira-mancha", preco: "kit a partir de 89 reais", clienteIdeal: "mora em apartamento", medos: [], frasesDaFala: [], proibicoes: [], cenasFilmaveis: [], concorrentes: [], perfisAdmirados: [] },
        resumo: "produtos de limpeza",
        referencias: [],
      },
    });
  const [noticia] = await db()
    .insert(noticias)
    .values({
      nichoId,
      url: "https://exemplo.invalido/tema-de-noticia",
      titulo: "Seminários gratuitos abordam branding para pequenos negócios",
      fonte: "Veículo de teste",
      resumo: "Eventos gratuitos ensinam branding.",
      publicadoEm: new Date(),
      relevante: true,
      angulo: "saiu esta semana, explique o que muda para o seu cliente",
    })
    .returning({ id: noticias.id });
  noticiaId = noticia.id;
  await db()
    .insert(temasDia)
    .values({
      nichoId,
      data: hojeISO(),
      temas: [tema("tema de noticia", { evidenciasNoticias: [noticiaId] }), tema("tema comum", { evidencias: [] })],
    });
}, 60_000);

afterAll(async () => {
  await getPool().end();
});

describe("o roteiro de um tema do dia que nasceu de uma notícia", () => {
  it("parte da notícia: guarda o id dela no roteiro, como o Criar vídeo com esta notícia", async () => {
    const roteiro = await gerarRoteiro(clienteId, { origem: "sugerido", temaIndice: 0, objetivo: "alcance" });
    expect(roteiro.noticiaId).toBe(noticiaId);
    expect(roteiro.origem).toBe("sugerido");
  });

  it("o de um tema sem notícia nenhuma segue sem ponto de partida", async () => {
    const roteiro = await gerarRoteiro(clienteId, { origem: "sugerido", temaIndice: 1, objetivo: "alcance" });
    expect(roteiro.noticiaId).toBeNull();
  });
});
