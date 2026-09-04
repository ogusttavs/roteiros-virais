/**
 * `favoritar`, `desfavoritar` e `referenciasParaPerfil` (etapa 12, decisão 1
 * do `PROXIMO.md`) contra o Postgres real, em mock.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PERGUNTAS_BRIEFING } from "@/config/briefing";
import { db, getPool } from "@/db";
import { clientes, nichos, user, videos } from "@/db/schema";
import { avaliarResposta, perfilDoCliente } from "@/servicos/briefing";
import { desfavoritar, favoritar, favoritosDoCliente, referenciasParaPerfil } from "@/servicos/referencias";

import { resetarSchema } from "../../scripts/resetar-schema";

let clienteId: number;
let nichoId: number;
let videoId: number;

function respostaConcreta(id: string): string {
  return `Resposta concreta para ${id}, com o numero 42 na frase, a fala real do cliente "isso resolveu o meu problema", e uma mencao ao bairro de Pinheiros para dar contexto.`;
}

beforeAll(async () => {
  await resetarSchema(db());

  const [nicho] = await db()
    .insert(nichos)
    .values({ slug: "referencias-teste", nome: "Referencias teste" })
    .returning();
  nichoId = nicho.id;

  await db().insert(user).values({ id: "referencias-a", name: "[teste] Cliente", email: "a@referencias.teste" });
  const [cliente] = await db()
    .insert(clientes)
    .values({ usuarioId: "referencias-a", nome: "[teste] Cliente", nichoId })
    .returning();
  clienteId = cliente.id;

  const [video] = await db()
    .insert(videos)
    .values({
      plataforma: "tiktok",
      idExterno: "referencias-video-1",
      url: "https://exemplo.invalido/referencias-video-1",
      nichoId,
      titulo: "como limpar sofa de estofado",
      analise: {
        assunto: "limpeza de estofado",
        gancho: "abre mostrando a mancha saindo",
        estrutura: "antes e depois",
        fechamento: "resultado final",
        chamadaFinal: "comenta se ja passou por isso",
        formato: "fala_para_camera",
        porQueFuncionou: "todo mundo se reconhece no problema",
      } as never,
    })
    .returning();
  videoId = video.id;
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

describe("favoritar e desfavoritar", () => {
  it("favoritar de novo o mesmo video nao da erro (indice unico)", async () => {
    await favoritar(clienteId, videoId);
    await favoritar(clienteId, videoId);

    const favoritos = await favoritosDoCliente(clienteId);
    expect(favoritos.has(videoId)).toBe(true);
    expect(favoritos.size).toBe(1);
  });

  it("desfavoritar remove; desfavoritar de novo nao da erro", async () => {
    await desfavoritar(clienteId, videoId);
    await desfavoritar(clienteId, videoId);

    const favoritos = await favoritosDoCliente(clienteId);
    expect(favoritos.has(videoId)).toBe(false);
  });
});

describe("favorito entra no perfil compilado na proxima recompilacao", () => {
  it("perfil compilado sem favorito nenhum comeca com referencias vazias", async () => {
    for (const pergunta of PERGUNTAS_BRIEFING) {
      await avaliarResposta(clienteId, pergunta.id, respostaConcreta(pergunta.id));
    }

    const perfil = await perfilDoCliente(clienteId);
    expect(perfil?.referencias).toEqual([]);
  });

  it("favoritar e editar uma resposta (nova recompilacao) inclui o favorito em perfil.referencias", async () => {
    await favoritar(clienteId, videoId);

    // resposta nova (nao reusada) num briefing ja completo: dispara recompilacao (briefing.ts).
    await avaliarResposta(
      clienteId,
      "p1",
      'Resposta atualizada so deste teste, com o numero 7 e a fala "atualizei agora", bairro de Realengo.',
    );

    const perfil = await perfilDoCliente(clienteId);
    expect(perfil?.referencias).toEqual(["limpeza de estofado: abre mostrando a mancha saindo"]);

    const direto = await referenciasParaPerfil(clienteId);
    expect(direto).toEqual(perfil?.referencias);
  });
});
