/**
 * O preparo comum dos e2e das vozes do público (E28, parte 3): uma marca num ramo só dela, com `nichos.vozes` lido agora (a leitura da semana do `comentarios-semana`). Um ramo e uma marca por
 * teste, com o id do usuário trazendo o número da tentativa (o retry do Playwright insere de novo).
 */
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";

import { db } from "../../src/db";
import { account, briefings, clientes, membrosMarca, nichos, preferenciasUsuario, temasDia, user, type TemaDoDia, type VozDoPublico, type VozesDoSetor } from "../../src/db/schema";
import { hojeISO } from "../../src/lib/config";
import { chaveDaVoz } from "../../src/servicos/vozes-do-publico";

const SENHA = "ExemploSenha123";
export const PREFIXO_VOZES = "E2E vozes";

export const PERGUNTA_PADRAO = "Serve em tecido de camurça?";

export async function entrar(page: Page, email: string) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/hoje/);
}

const voz = (texto: string, vezes: number): VozDoPublico => ({ texto, vezes, videos: [1, 2], plataformas: ["youtube"] });

export type PreparoDeVozes = {
  /** Sem leitura nenhuma no setor (o setor pequeno que fechou a semana sem voz). */
  semVozes?: boolean;
  /** As dúvidas; padrão: três que passam do piso de cinco comentários. */
  duvidas?: VozDoPublico[];
  objecoes?: VozDoPublico[];
  /** Os três temas de hoje do setor (a porta "Os temas de hoje" mostra as perguntas depois deles). */
  comTemas?: boolean;
};

/** Uma marca num ramo só dela, com as vozes da semana lidas agora. */
export async function prepararMarcaComVozes(opcoes: PreparoDeVozes = {}) {
  const sufixo = `${test.info().testId}-r${test.info().retry}`;
  const usuarioId = `e2e-vozes-${sufixo}`;
  const duvidas = opcoes.duvidas ?? [voz(PERGUNTA_PADRAO, 14), voz("Quanto tempo tem que esperar para secar?", 9), voz("Tem em galão de cinco litros?", 6)];
  const objecoes = opcoes.objecoes ?? [voz("A mancha voltou depois de secar", 7)];
  const vozes: VozesDoSetor = { duvidas, objecoes, pedidos: [], videos: 12, comentarios: 840, plataformas: ["youtube"] };

  const [nicho] = await db()
    .insert(nichos)
    .values({ slug: `e2e-vozes-${sufixo}`, nome: `${PREFIXO_VOZES} ${sufixo}`, termos: [], vozes: opcoes.semVozes ? null : vozes, vozesEm: opcoes.semVozes ? null : new Date() })
    .returning();
  await db().insert(user).values({ id: usuarioId, name: "[teste] Vozes", email: `${usuarioId}@exemplo.teste` });
  await db()
    .insert(account)
    .values({ id: `${usuarioId}-credential`, issuer: "local:credential", accountId: usuarioId, providerId: "credential", userId: usuarioId, password: await hashPassword(SENHA) });
  await db().insert(preferenciasUsuario).values({ usuarioId, aceitouTermosEm: new Date() });
  const [marca] = await db().insert(clientes).values({ usuarioId, nome: "[teste] Vozes", nichoId: nicho.id }).returning();
  await db().insert(membrosMarca).values({ usuarioId, clienteId: marca.id, papel: "dono" });
  await db().insert(briefings).values({
    clienteId: marca.id,
    completo: true,
    notaGeral: "8.50",
    perfil: {
      fatos: { oQueVende: "lavagem de estofados", preco: "sofá de 3 lugares por R$ 180", clienteIdeal: "mora em apartamento", medos: [], frasesDaFala: [], proibicoes: [], cenasFilmaveis: [], concorrentes: [], perfisAdmirados: [] },
      resumo: "lava estofados em domicílio",
      referencias: [],
    },
  });

  if (opcoes.comTemas) {
    const temas: TemaDoDia[] = [1, 2, 3].map((n) => ({ titulo: `Tema de teste ${n} do setor`, descricao: "d", porQue: "p", evidencias: [], puxaPara: "alcance" }));
    await db().insert(temasDia).values({ nichoId: nicho.id, data: hojeISO(), temas });
  }

  return {
    email: `${usuarioId}@exemplo.teste`,
    marcaId: marca.id,
    nichoId: nicho.id,
    chaveDaPergunta: chaveDaVoz("duvida", duvidas[0]?.texto ?? PERGUNTA_PADRAO),
    chaveDaReclamacao: chaveDaVoz("objecao", objecoes[0]?.texto ?? "A mancha voltou depois de secar"),
  };
}
