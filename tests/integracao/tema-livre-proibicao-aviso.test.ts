/**
 * Decisão do Gustavo, 22/10/2026: quando a PRÓPRIA pessoa escreve o tema (Tema livre), as proibições do briefing dela são preferências e viram AVISO, nunca bloqueio: na avaliação do tema (coberta
 * em `tema-livre-nota-guardada.test.ts`) e no roteiro que sai dele (aqui). Continuam barrando a conformidade (R-CONF: "grátis" sem a ficha, calão...) e o ataque a gente. Os temas que o sistema
 * sugere (origem "sugerido", o momento) seguem filtrando pela proibição, como antes.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { briefings, clientes, nichos, roteiros, user, type PerfilCompilado } from "@/db/schema";
import { ErroIA } from "@/ia/erro";
import * as roteiroIA from "@/ia/prompts/roteiro";
import { gerarComVerificacao } from "@/ia/verificador";
import { gerarRoteiro } from "@/servicos/roteiro";

import { resetarSchema } from "../../scripts/resetar-schema";

const PERFIL: PerfilCompilado = {
  fatos: {
    oQueVende: "lavagem de estofados",
    preco: "sofa de 3 lugares por R$ 180",
    clienteIdeal: "mora em apartamento",
    medos: ["ja mandou fazer em outro lugar e o sofa ficou manchado"],
    frasesDaFala: ['"relaxa que sai sim"'],
    proibicoes: ["política"],
    cenasFilmaveis: ["a maquina ligada"],
    concorrentes: [],
    perfisAdmirados: [],
  },
  resumo: "lava estofados em domicilio",
  referencias: [],
};

let clienteId: number;

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db().insert(nichos).values({ slug: "proibicao-aviso-teste", nome: "Proibicao aviso teste", termos: [] }).returning();
  await db().insert(user).values({ id: "proibicao-aviso-dono", name: "[teste] Dono", email: "dono@proibicao-aviso.teste" });
  const [c] = await db().insert(clientes).values({ usuarioId: "proibicao-aviso-dono", nome: "[teste] Marca", nichoId: nicho.id, cidade: "Sao Paulo", bairro: "Pinheiros" }).returning();
  clienteId = c.id;
  await db().insert(briefings).values({ clienteId: c.id, completo: true, perfil: PERFIL });
}, 30_000);

afterAll(async () => {
  await db().delete(roteiros).where(eq(roteiros.clienteId, clienteId));
  await getPool().end();
});

describe("o roteiro do tema livre com a proibição do briefing (22/10/2026)", () => {
  it("o tema da pessoa que toca a proibição ('política') passa: o roteiro é escrito sobre o tema dela, com a proibição como aviso", async () => {
    const roteiro = await gerarRoteiro(clienteId, { origem: "livre", textoTema: "a disputa de voto como analogia para escolher quem lava o seu sofá, sem falar de política de partido", objetivo: "engajamento" });
    expect(roteiro.status).toBe("gerado");
    // O roteiro foi escrito sobre o tema que ela escolheu (o gancho do simulador repete o tema).
    expect(roteiro.conteudo.gancho).toContain("política");
  });

  it("num tema que o sistema sugere (sem a licença), a proibição continua reprovando as duas tentativas; com a licença do tema da pessoa, a mesma saída passa", async () => {
    const campos = { gancho: "olha, a política entrou na limpeza", corpo: "texto do corpo" };
    const parametros = (citarProibicaoVale: boolean) => ({
      tarefa: "roteiro" as const,
      nivel: roteiroIA.nivel,
      versaoPrompt: roteiroIA.versao,
      schema: roteiroIA.schema,
      sistemaEstavel: "sistema",
      entrada: "Tema escolhido: limpeza",
      extrairCampos: () => campos,
      proibicoes: ["política"],
      generoTexto: "roteiro" as const,
      citarProibicaoVale,
    });
    await expect(gerarComVerificacao(parametros(false))).rejects.toThrow(/fere a proibicao do cliente/);
    await expect(gerarComVerificacao(parametros(true))).resolves.toBeDefined();
  });

  it("a conformidade continua barrando com a proibição como aviso: ataque a gente e calão reprovam as duas tentativas", async () => {
    await expect(gerarRoteiro(clienteId, { origem: "livre", textoTema: "falar mal do candidato rival sem medo [mock:ataque]", objetivo: "engajamento" })).rejects.toBeInstanceOf(ErroIA);
    await expect(gerarRoteiro(clienteId, { origem: "livre", textoTema: "política e essa porra de mancha", objetivo: "conversao" })).rejects.toBeInstanceOf(ErroIA);
  });
});
