/**
 * O roteiro não inventa fato (04/10/2026), pelo caminho de produção (`gerarComVerificacao`, mock): com `fontesDosFatos` o verificador manda as fontes ao `verificarTexto`; o mock reprova o
 * marcador de teste de fato inventado, as duas tentativas reprovam e a geração falha com o motivo; sem fontes (as outras tarefas) a mesma saída passa. A prova de verdade é a chave real.
 */
import { desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { geracoesIA } from "@/db/schema";
import { ErroIA } from "@/ia/erro";
import * as roteiroIA from "@/ia/prompts/roteiro";
import { TITULO_DAS_INSTRUCOES } from "@/ia/prompts/verificarTexto";
import { gerarComVerificacao } from "@/ia/verificador";

import { resetarSchema } from "../../scripts/resetar-schema";

beforeAll(async () => {
  await resetarSchema(db());
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

function parametros(fontesDosFatos: string | undefined, marcador: boolean) {
  return {
    tarefa: "roteiro" as const,
    nivel: roteiroIA.nivel,
    versaoPrompt: roteiroIA.versao,
    schema: roteiroIA.schema,
    sistemaEstavel: "sistema",
    entrada: "Tema escolhido: o erro que faz a mancha voltar",
    extrairCampos: () => ({ gancho: marcador ? "o Uli está do meu lado {mock:fato-inventado}" : "olha o que acontece com a mancha", corpo: "texto do corpo" }),
    fontesDosFatos,
    generoTexto: "roteiro" as const,
  };
}

describe("fontesDosFatos no verificador", () => {
  it("com fontes, o fato fora delas reprova as duas tentativas e a geração falha dizendo o motivo", async () => {
    await expect(gerarComVerificacao(parametros("Perfil: lava estofado.\n\nTema: a mancha", true))).rejects.toThrow(/reprovada duas vezes.*nada nas fontes o sustenta.*fonte mais próxima: nenhuma/);
    const linhas = await db().select().from(geracoesIA);
    // As duas tentativas, cada uma com o seu verificarTexto, ficaram registradas.
    expect(linhas.filter((l) => l.tarefa === "verificarTexto").length).toBeGreaterThanOrEqual(2);
  });

  it("com fontes e sem fato inventado, aprova; sem fontes, a mesma saída com o marcador passa (a conferência só roda quando pedida)", async () => {
    await expect(gerarComVerificacao(parametros("Perfil: lava estofado.", false))).resolves.toBeDefined();
    await expect(gerarComVerificacao(parametros(undefined, true))).resolves.toBeDefined();
  });

  it("é um ErroIA (a tela mostra a frase de sempre), não um erro de servidor", async () => {
    await expect(gerarComVerificacao(parametros("fontes", true))).rejects.toBeInstanceOf(ErroIA);
  });
});

/**
 * 1.9.0 (rodada 3): a instrução de gravação e de edição não é afirmação sobre o negócio. Pelo caminho de produção (`gerarComVerificacao`, mock), o texto vai ao `verificarTexto` com a fala primeiro e as
 * instruções depois, sob o título que o critério conhece; o mock, como o critério, não confere o bloco das instruções como fato. A prova de verdade, com o modelo, é a chave real.
 */
function parametrosComCampos(campos: Record<string, string>, fontesDosFatos: string | null = "Perfil: lava estofado. Sofá de 3 lugares por R$ 180.") {
  return { ...parametros(fontesDosFatos ?? undefined, false), extrairCampos: () => campos };
}

describe("instrução para a pessoa não é fato (1.9.0)", () => {
  const MARCADOR = "{mock:fato-inventado}";

  it("o que o verificador lê como inventado numa instrução (onde gravar, cena, recurso, o que mostrar) aprova, na primeira tentativa", async () => {
    const casos: Record<string, string>[] = [
      { gancho: "olha esse sofá", ondeGravar: `na sala, com a foto das duas figuras ${MARCADOR}` },
      { gancho: "olha esse sofá", cena0: `mostre a foto de duas figuras eleitorais ${MARCADOR}` },
      { gancho: "olha esse sofá", recurso0: `coloque a foto na tela ${MARCADOR}`, audio: `o áudio da semana ${MARCADOR}` },
      { gancho: "olha esse sofá", cartao0Mostrar: `o antes e depois ${MARCADOR}` },
    ];
    for (const campos of casos) {
      const antes = (await db().select().from(geracoesIA)).length;
      await expect(gerarComVerificacao(parametrosComCampos(campos))).resolves.toBeDefined();
      const novas = (await db().select().from(geracoesIA)).length - antes;
      // Uma tentativa só: o roteiro e o seu verificarTexto.
      expect(novas).toBe(2);
    }
  });

  it("o mesmo marcador na fala que o público ouve ou lê (gancho, corpo, texto na tela) continua reprovando as duas tentativas", async () => {
    const casos: Record<string, string>[] = [
      { gancho: `o Uli está do meu lado ${MARCADOR}`, cena0: "mostre o sofá" },
      { gancho: "olha esse sofá", corpo: `aconteceu semana passada ${MARCADOR}`, ondeGravar: "na sala" },
      { gancho: "olha esse sofá", textoNaTela0: `mais de 500 sofás lavados ${MARCADOR}`, ondeGravar: "na sala" },
    ];
    for (const campos of casos) {
      await expect(gerarComVerificacao(parametrosComCampos(campos))).rejects.toThrow(/reprovada duas vezes.*nada nas fontes o sustenta/);
    }
  });

  it("o texto que chega ao verificarTexto traz a fala antes e as instruções depois do título, e o colchete ao lado do número já vai como marcador", async () => {
    const campos = { gancho: "olha esse sofá", corpo: "ele custa cento e oitenta reais [diga a condição: à vista ou parcelado]", ondeGravar: "na sala", recurso0: "coloque a foto na tela" };
    await gerarComVerificacao(parametrosComCampos(campos));
    const [ultima] = await db().select().from(geracoesIA).where(eq(geracoesIA.tarefa, "verificarTexto")).orderBy(desc(geracoesIA.id)).limit(1);
    const texto = (ultima.entradas as { texto: string }).texto;
    const [antes, depois] = texto.split(TITULO_DAS_INSTRUCOES);
    expect(antes).toContain("olha esse sofá");
    expect(antes).toContain("cento e oitenta reais [diga a condição: à vista ou parcelado]");
    expect(antes).not.toContain("na sala");
    expect(depois).toContain("na sala");
    expect(depois).toContain("coloque a foto na tela");
  });

  it("sem fontes (as outras tarefas) o texto é o de sempre, sem bloco nem título", async () => {
    await gerarComVerificacao(parametrosComCampos({ gancho: "olha esse sofá", ondeGravar: "na sala" }, null));
    const [ultima] = await db().select().from(geracoesIA).where(eq(geracoesIA.tarefa, "verificarTexto")).orderBy(desc(geracoesIA.id)).limit(1);
    expect((ultima.entradas as { texto: string }).texto).not.toContain(TITULO_DAS_INSTRUCOES);
  });
});
