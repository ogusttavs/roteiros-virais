/**
 * O preparo comum dos e2e do assunto em alta (E55 PR 2): uma marca num ramo só dela, com o tema do momento nos temas de hoje, a rodada de tendências de agora e, se pedido, o roteiro que a marca já criou
 * do assunto. Usado por `em-alta-hoje.spec.ts` (o cartão no Hoje e no Planejar) e `em-alta-criar.spec.ts` (o Criar, o Tema livre, o Objetivo, o Roteiro e o Histórico).
 *
 * Um ramo, uma marca e uma rodada de tendências por teste (a "lista de agora" é a rodada mais recente, então cada teste põe a sua por último), com o id do usuário trazendo o número da tentativa (o
 * retry do Playwright insere de novo). O que o teste gravou em `tendencias_brasil` e `tendencias_avaliadas` sai no fim (`limparTendencias`, no `afterAll`).
 */
import { expect, test, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { inArray, like } from "drizzle-orm";

import { db } from "../../src/db";
import { account, briefings, clientes, membrosMarca, nichos, preferenciasUsuario, roteiros, temasDia, tendenciasAvaliadas, tendenciasBrasil, user, type TemaDoDia } from "../../src/db/schema";
import { hojeISO } from "../../src/lib/config";
import { somarDiasISO } from "../../src/servicos/roteiro";

const SENHA = "ExemploSenha123";
export const PREFIXO = "E2E em alta";
export const TITULO_DO_TEMA = "O mofo que a frente fria traz para o armário, e como tirar hoje";
export const TITULO_DO_ROTEIRO = "Mofo no armário: o que fazer hoje";

const nichosCriados: number[] = [];

export const CONTEUDO_MINIMO = {
  titulo: TITULO_DO_ROTEIRO,
  duracaoS: 30,
  gancho: "gancho",
  corpo: "corpo",
  fechamento: "fechamento",
  chamadaFinal: "chamada final",
  cartoes: null,
  porQueAssim: [],
  cenas: [],
  ondeGravar: "no armário",
  edicao: { textoNaTela: [], ritmoDeCorte: "moderado", recursos: [], audio: null, referencia: null },
  evidencias: [],
  semEvidencia: true,
  forcaEvidencia: null,
};

export async function entrar(page: Page, email: string) {
  await page.goto("/entrar");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(SENHA);
  await page.getByRole("button", { name: "entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/hoje/);
}

export type Preparo = {
  assunto: string;
  /** O roteiro já criado do assunto: de hoje, ou de ontem (atrasado). */
  roteiro?: { data: "hoje" | "ontem"; formato?: "reels" | "story" };
  /** A rodada de agora tem o assunto? (`false` põe outro assunto na rodada mais recente.) */
  naLista?: boolean;
  trafego?: string | null;
  /** Sem o tema do momento nos temas de hoje (o setor não achou encaixe para nenhum assunto da lista). */
  semTema?: boolean;
  /** Os temas de hoje são só o do momento (o tema comum não saiu): sobra a lista em branco se o cartão não vier. */
  soOMomento?: boolean;
  /** O setor avaliou a lista de agora e o resultado foi este (`tendencias_avaliadas`). */
  avaliada?: "tema" | "sem_encaixe" | "sem_assunto";
  /** Outros assuntos na mesma rodada de agora (do mais alto para baixo, depois do principal). */
  outros?: { assunto: string; sensivel?: boolean; fonte?: "google" | "youtube"; trafego?: string | null }[];
  /** A ligação com o ramo que o roteiro guardou (o "porQue" do tema do momento). */
  ligacao?: string | null;
};

/** Uma marca num ramo só dela, com o tema do momento do dia (dois temas: um comum e o do momento) e a rodada de tendências de agora. */
export async function prepararMarca(opcoes: Preparo) {
  const sufixo = `${test.info().testId}-r${test.info().retry}`;
  const usuarioId = `e2e-em-alta-${sufixo}`;
  const [nicho] = await db().insert(nichos).values({ slug: `e2e-em-alta-${sufixo}`, nome: `${PREFIXO} ${sufixo}`, termos: [] }).returning();
  nichosCriados.push(nicho.id);
  await db().insert(user).values({ id: usuarioId, name: "[teste] Em alta", email: `${usuarioId}@exemplo.teste` });
  await db()
    .insert(account)
    .values({ id: `${usuarioId}-credential`, issuer: "local:credential", accountId: usuarioId, providerId: "credential", userId: usuarioId, password: await hashPassword(SENHA) });
  await db().insert(preferenciasUsuario).values({ usuarioId, aceitouTermosEm: new Date() });
  const [marca] = await db().insert(clientes).values({ usuarioId, nome: "[teste] Em alta", nichoId: nicho.id }).returning();
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

  const assunto = `${PREFIXO} ${opcoes.assunto} ${sufixo}`;
  const chave = assunto.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^a-z0-9]+/g, " ").trim();
  const doMomento = { chave, assunto, termos: [assunto], fonte: "Em alta no Google no Brasil", url: null, coletadaEm: new Date().toISOString(), encaixe: 8 };
  const temaComum: TemaDoDia = { titulo: "Um tema comum do setor", descricao: "d", porQue: "p", evidencias: [], puxaPara: "alcance" };
  const temaDoMomento: TemaDoDia = {
    titulo: TITULO_DO_TEMA,
    descricao: "Curto e fácil de gravar: 30 segundos, no celular, na frente do armário.",
    porQue: "o frio junta umidade onde o ar não passa",
    evidencias: [],
    puxaPara: "alcance",
    doMomento,
  };
  await db().insert(temasDia).values({ nichoId: nicho.id, data: hojeISO(), temas: opcoes.semTema ? [temaComum] : opcoes.soOMomento ? [temaDoMomento] : [temaComum, temaDoMomento] });

  const rodadaEm = new Date(Date.now() - 60_000);
  const naLista = opcoes.naLista !== false;
  const doAssunto = naLista ? assunto : `${PREFIXO} outro assunto ${sufixo}`;
  const linhas = [
    { assunto: doAssunto, chave: naLista ? chave : `outro ${chave}`, trafego: opcoes.trafego === undefined ? "2000+" : opcoes.trafego, sensivel: false, fonte: "google" as const },
    ...(opcoes.outros ?? []).map((o) => ({
      assunto: `${PREFIXO} ${o.assunto} ${sufixo}`,
      chave: `${PREFIXO} ${o.assunto} ${sufixo}`.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^a-z0-9]+/g, " ").trim(),
      trafego: o.trafego === undefined ? "500+" : o.trafego,
      sensivel: o.sensivel ?? false,
      fonte: o.fonte ?? ("google" as const),
    })),
  ];
  await db()
    .insert(tendenciasBrasil)
    .values(
      linhas.map((l, i) => ({
        coletadaEm: rodadaEm,
        assunto: l.assunto,
        chave: l.chave,
        termos: [l.assunto],
        fontes: [{ fonte: l.fonte, titulo: l.assunto, url: null, trafego: l.trafego, posicao: i + 1 }],
        posicao: i + 1,
        sensivel: l.sensivel,
      })),
    );
  if (opcoes.avaliada) await db().insert(tendenciasAvaliadas).values({ nichoId: nicho.id, rodadaEm, resultado: opcoes.avaliada });

  let roteiroId: number | null = null;
  if (opcoes.roteiro) {
    const [criado] = await db()
      .insert(roteiros)
      .values({
        clienteId: marca.id,
        data: opcoes.roteiro.data === "hoje" ? hojeISO() : somarDiasISO(hojeISO(), -1),
        tema: TITULO_DO_TEMA,
        origem: "sugerido",
        objetivo: "alcance",
        formato: opcoes.roteiro.formato ?? "reels",
        conteudo: CONTEUDO_MINIMO,
        status: "gerado",
        temaDoMomento: { chave, assunto, termos: [assunto], fonte: "Em alta no Google no Brasil", url: null, coletadaEm: new Date().toISOString(), ligacao: opcoes.ligacao ?? null },
      })
      .returning({ id: roteiros.id });
    roteiroId = criado.id;
  }
  return { email: `${usuarioId}@exemplo.teste`, assunto, chave, marcaId: marca.id, nichoId: nicho.id, roteiroId };
}

/** O que o teste gravou nas tabelas de tendências sai no fim (as outras tabelas ficam: o banco do e2e é refeito a cada rodada). */
export async function limparTendencias() {
  if (nichosCriados.length > 0) await db().delete(tendenciasAvaliadas).where(inArray(tendenciasAvaliadas.nichoId, nichosCriados));
  await db().delete(tendenciasBrasil).where(like(tendenciasBrasil.assunto, `${PREFIXO}%`));
}
