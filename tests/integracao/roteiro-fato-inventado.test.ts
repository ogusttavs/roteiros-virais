/**
 * O roteiro não inventa fato (04/10/2026), pelo caminho de produção (`gerarComVerificacao`, mock): com `fontesDosFatos` o verificador manda as fontes ao `verificarTexto`; o mock reprova o
 * marcador de teste de fato inventado, as duas tentativas reprovam e a geração falha com o motivo; sem fontes (as outras tarefas) a mesma saída passa. A prova de verdade é a chave real.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { geracoesIA } from "@/db/schema";
import { ErroIA } from "@/ia/erro";
import * as roteiroIA from "@/ia/prompts/roteiro";
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
    extrairCampos: () => ({ gancho: marcador ? "o Uli está do meu lado [mock:fato-inventado]" : "olha o que acontece com a mancha", corpo: "texto do corpo" }),
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
