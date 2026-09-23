/**
 * `rodarLembrete` (etapa 12, decisão 5; guardas da etapa 13, ajuste 1 da
 * revisão da parte 2; V3, item 6 do `PROXIMO.md`): o lembrete é por PESSOA,
 * não por marca. Uma pessoa na hora certa recebe um só e-mail listando as
 * marcas dela que têm tema do dia (hoje ou nos últimos 3 dias,
 * `temasDoDiaOuRecente`, a mesma regra de estabilidade de `/hoje`) e ainda
 * não foram abertas hoje, por ela ou por outro membro (`clientes.
 * ultimoAcessoEm`, o acesso da marca inteira). Sem nenhuma marca pendente,
 * não envia. Pessoa que já recebeu hoje não recebe de novo (uma repetição
 * do pg-boss ou uma execução manual no mesmo dia). `enviarEmail` sai no log
 * fora de produção (`NODE_ENV` de teste), sem chamada de rede de verdade.
 */
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/email", () => ({ enviarEmail: vi.fn().mockResolvedValue(undefined) }));

import { db, getPool } from "@/db";
import {
  clientes,
  membrosMarca,
  nichos,
  type PapelMarca,
  planoGravacoes,
  preferenciasUsuario,
  temasDia,
  user,
} from "@/db/schema";
import { rodarLembrete } from "@/jobs/lembrete";
import { enviarEmail } from "@/lib/email";

import { resetarSchema } from "../../scripts/resetar-schema";

let contadorPessoa = 0;
async function criarPessoa(horaLembrete: string, opcoes: { ultimoLembreteEm?: Date | null } = {}): Promise<string> {
  contadorPessoa += 1;
  const usuarioId = `lembrete-teste-pessoa-${contadorPessoa}`;
  await db()
    .insert(user)
    .values({ id: usuarioId, name: `[teste] pessoa ${contadorPessoa}`, email: `${usuarioId}@lembrete.teste` });
  await db()
    .insert(preferenciasUsuario)
    .values({ usuarioId, horaLembrete, ultimoLembreteEm: opcoes.ultimoLembreteEm ?? null });
  return usuarioId;
}

let contadorMarca = 0;
async function criarMarca(
  usuarioDono: string,
  opcoes: { nichoId?: number | null; ultimoAcessoEm?: Date | null; ativo?: boolean } = {},
) {
  contadorMarca += 1;
  const [marca] = await db()
    .insert(clientes)
    .values({
      usuarioId: usuarioDono,
      nome: `[teste] marca ${contadorMarca}`,
      nichoId: opcoes.nichoId ?? null,
      ultimoAcessoEm: opcoes.ultimoAcessoEm ?? null,
      ativo: opcoes.ativo ?? true,
    })
    .returning();
  await db().insert(membrosMarca).values({ usuarioId: usuarioDono, clienteId: marca.id, papel: "dono" });
  return marca;
}

async function adicionarMembro(usuarioId: string, clienteId: number, papel: PapelMarca = "membro") {
  await db().insert(membrosMarca).values({ usuarioId, clienteId, papel });
}

let contadorPlano = 0;
async function criarItemPlano(clienteId: number, dia: string, dados: { lugar: string; situacao: string }) {
  contadorPlano += 1;
  await db()
    .insert(planoGravacoes)
    .values({
      clienteId,
      dia,
      ordem: contadorPlano,
      lugar: dados.lugar,
      situacao: dados.situacao,
      oQueMostrar: `a cena de ${dados.lugar}`,
      objetivo: "engajamento",
    });
}

function htmlsEnviados(): string[] {
  return vi.mocked(enviarEmail).mock.calls.map((chamada) => chamada[0].html);
}

/** 11:00 em Brasilia (UTC-3), uma quinta-feira qualquer, longe de meia-noite. */
const AGORA = new Date("2026-09-03T14:00:00Z");

let nichoComTemaId: number;
let nichoSemTemaId: number;
let nichoTemaOntemId: number;
let nichoTemaForaDaJanelaId: number;

function temaExemplo(titulo: string) {
  return [{ titulo, descricao: "descricao", porQue: "por que", evidencias: [], puxaPara: "alcance" as const }];
}

beforeAll(async () => {
  await resetarSchema(db());

  const [comTema] = await db()
    .insert(nichos)
    .values({ slug: "lembrete-teste-com-tema", nome: "Lembrete teste com tema", termos: [] })
    .returning();
  nichoComTemaId = comTema.id;
  await db()
    .insert(temasDia)
    .values({ nichoId: nichoComTemaId, data: "2026-09-03", temas: temaExemplo("tema 1") });

  const [semTema] = await db()
    .insert(nichos)
    .values({ slug: "lembrete-teste-sem-tema", nome: "Lembrete teste sem tema", termos: [] })
    .returning();
  nichoSemTemaId = semTema.id;

  // AGORA e 2026-09-03; "ontem" (2026-09-02) entra na janela de estabilidade de 3 dias.
  const [temaOntem] = await db()
    .insert(nichos)
    .values({ slug: "lembrete-teste-tema-ontem", nome: "Lembrete teste tema ontem", termos: [] })
    .returning();
  nichoTemaOntemId = temaOntem.id;
  await db()
    .insert(temasDia)
    .values({ nichoId: nichoTemaOntemId, data: "2026-09-02", temas: temaExemplo("tema de ontem") });

  // 5 dias atras, fora da janela de estabilidade de 3 dias: conta como sem tema.
  const [foraDaJanela] = await db()
    .insert(nichos)
    .values({ slug: "lembrete-teste-fora-da-janela", nome: "Lembrete teste fora da janela", termos: [] })
    .returning();
  nichoTemaForaDaJanelaId = foraDaJanela.id;
  await db()
    .insert(temasDia)
    .values({ nichoId: nichoTemaForaDaJanelaId, data: "2026-08-29", temas: temaExemplo("tema antigo demais") });
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

afterEach(async () => {
  // plano_gravacoes nao tem cascade a partir de clientes (schema.ts); precisa ir antes.
  await db().delete(planoGravacoes);
  // cascade cuida de clientes, membrosMarca e preferenciasUsuario (schema.ts).
  await db().delete(user);
  vi.mocked(enviarEmail).mockClear();
});

describe("rodarLembrete", () => {
  it("pessoa na hora certa, marca com tema hoje, sem ninguem ter aberto, recebe", async () => {
    const pessoa = await criarPessoa("11:00");
    const marca = await criarMarca(pessoa, { nichoId: nichoComTemaId });

    const resumo = await rodarLembrete(AGORA);
    expect(resumo.horaAtual).toBe("11:00");
    expect(resumo.candidatos).toBe(1);
    expect(resumo.enviados).toBe(1);
    expect(resumo.jaReceberam).toBe(0);
    expect(resumo.semMarcaPendente).toBe(0);
    expect(htmlsEnviados()[0]).toContain(marca.nome);
  });

  it("grava ultimo_lembrete_em da pessoa ao enviar", async () => {
    const pessoa = await criarPessoa("11:00");
    await criarMarca(pessoa, { nichoId: nichoComTemaId });

    await rodarLembrete(AGORA);

    const [linha] = await db().select().from(preferenciasUsuario).where(eq(preferenciasUsuario.usuarioId, pessoa));
    expect(linha.ultimoLembreteEm?.getTime()).toBe(AGORA.getTime());
  });

  it("pessoa que ja recebeu o lembrete hoje nao recebe de novo (repeticao do pg-boss ou execucao manual)", async () => {
    const pessoa = await criarPessoa("11:00");
    await criarMarca(pessoa, { nichoId: nichoComTemaId });

    const primeira = await rodarLembrete(AGORA);
    expect(primeira.enviados).toBe(1);

    const segunda = await rodarLembrete(AGORA);
    expect(segunda.enviados).toBe(0);
    expect(segunda.jaReceberam).toBe(1);
  });

  it("pessoa que recebeu ontem, nao hoje, ainda recebe", async () => {
    const ontem = new Date(AGORA.getTime() - 24 * 60 * 60 * 1000);
    const pessoa = await criarPessoa("11:00", { ultimoLembreteEm: ontem });
    await criarMarca(pessoa, { nichoId: nichoComTemaId });

    const resumo = await rodarLembrete(AGORA);
    expect(resumo.enviados).toBe(1);
    expect(resumo.jaReceberam).toBe(0);
  });

  it("marca ja aberta hoje nao entra na lista; sem outra marca pendente, nao envia", async () => {
    const pessoa = await criarPessoa("11:00");
    await criarMarca(pessoa, { nichoId: nichoComTemaId, ultimoAcessoEm: AGORA });

    const resumo = await rodarLembrete(AGORA);
    expect(resumo.candidatos).toBe(1);
    expect(resumo.enviados).toBe(0);
    expect(resumo.semMarcaPendente).toBe(1);
  });

  it("marca aberta ontem, nao hoje, ainda entra na lista", async () => {
    const ontem = new Date(AGORA.getTime() - 24 * 60 * 60 * 1000);
    const pessoa = await criarPessoa("11:00");
    await criarMarca(pessoa, { nichoId: nichoComTemaId, ultimoAcessoEm: ontem });

    const resumo = await rodarLembrete(AGORA);
    expect(resumo.enviados).toBe(1);
    expect(resumo.semMarcaPendente).toBe(0);
  });

  it("marca aberta hoje por outro membro tambem nao entra na lista (o acesso e da marca, nao da pessoa)", async () => {
    const dono = await criarPessoa("09:00");
    const marca = await criarMarca(dono, { nichoId: nichoComTemaId, ultimoAcessoEm: AGORA });
    const membro = await criarPessoa("11:00");
    await adicionarMembro(membro, marca.id);

    const resumo = await rodarLembrete(AGORA);
    expect(resumo.candidatos).toBe(1);
    expect(resumo.enviados).toBe(0);
    expect(resumo.semMarcaPendente).toBe(1);
  });

  it("nicho sem tema gravado: marca nao entra na lista; sem outra pendente, nao envia", async () => {
    const pessoa = await criarPessoa("11:00");
    await criarMarca(pessoa, { nichoId: nichoSemTemaId });

    const resumo = await rodarLembrete(AGORA);
    expect(resumo.enviados).toBe(0);
    expect(resumo.semMarcaPendente).toBe(1);
  });

  it("nicho so com tema de ontem (regra de estabilidade de /hoje): marca entra na lista", async () => {
    const pessoa = await criarPessoa("11:00");
    await criarMarca(pessoa, { nichoId: nichoTemaOntemId });

    const resumo = await rodarLembrete(AGORA);
    expect(resumo.enviados).toBe(1);
    expect(resumo.semMarcaPendente).toBe(0);
  });

  it("nicho so com tema de mais de 3 dias atras (fora da janela): marca nao entra na lista", async () => {
    const pessoa = await criarPessoa("11:00");
    await criarMarca(pessoa, { nichoId: nichoTemaForaDaJanelaId });

    const resumo = await rodarLembrete(AGORA);
    expect(resumo.enviados).toBe(0);
    expect(resumo.semMarcaPendente).toBe(1);
  });

  it("marca sem nicho nao entra na lista", async () => {
    const pessoa = await criarPessoa("11:00");
    await criarMarca(pessoa, { nichoId: null });

    const resumo = await rodarLembrete(AGORA);
    expect(resumo.enviados).toBe(0);
    expect(resumo.semMarcaPendente).toBe(1);
  });

  it("marca inativa nao entra na lista, mesmo com tema hoje", async () => {
    const pessoa = await criarPessoa("11:00");
    await criarMarca(pessoa, { nichoId: nichoComTemaId, ativo: false });

    const resumo = await rodarLembrete(AGORA);
    expect(resumo.enviados).toBe(0);
    expect(resumo.semMarcaPendente).toBe(1);
  });

  it("pessoa com outra hora escolhida nao entra nos candidatos desta hora", async () => {
    const pessoa = await criarPessoa("08:00");
    await criarMarca(pessoa, { nichoId: nichoComTemaId });

    const resumo = await rodarLembrete(AGORA);
    expect(resumo.candidatos).toBe(0);
    expect(resumo.enviados).toBe(0);
  });

  it("pessoa sem nenhuma marca nao recebe", async () => {
    await criarPessoa("11:00");

    const resumo = await rodarLembrete(AGORA);
    expect(resumo.candidatos).toBe(1);
    expect(resumo.enviados).toBe(0);
    expect(resumo.semMarcaPendente).toBe(1);
  });

  it("pessoa com duas marcas, uma pendente e outra ja aberta hoje: recebe um e-mail listando so a pendente", async () => {
    const pessoa = await criarPessoa("11:00");
    const pendente = await criarMarca(pessoa, { nichoId: nichoComTemaId });
    const aberta = await criarMarca(pessoa, { nichoId: nichoComTemaId, ultimoAcessoEm: AGORA });

    const resumo = await rodarLembrete(AGORA);
    expect(resumo.enviados).toBe(1);
    const [html] = htmlsEnviados();
    expect(html).toContain(pendente.nome);
    expect(html).not.toContain(aberta.nome);
  });

  it("pessoa com duas marcas pendentes: recebe um so e-mail listando as duas", async () => {
    const pessoa = await criarPessoa("11:00");
    const marcaA = await criarMarca(pessoa, { nichoId: nichoComTemaId });
    const marcaB = await criarMarca(pessoa, { nichoId: nichoTemaOntemId });

    const resumo = await rodarLembrete(AGORA);
    expect(resumo.enviados).toBe(1);
    expect(vi.mocked(enviarEmail)).toHaveBeenCalledTimes(1);
    const [html] = htmlsEnviados();
    expect(html).toContain(marcaA.nome);
    expect(html).toContain(marcaB.nome);
  });

  it("pessoa com tres marcas, uma ja aberta, recebe um e-mail com duas (definicao de pronto do item 6)", async () => {
    const pessoa = await criarPessoa("11:00");
    const pendenteA = await criarMarca(pessoa, { nichoId: nichoComTemaId });
    const pendenteB = await criarMarca(pessoa, { nichoId: nichoTemaOntemId });
    const aberta = await criarMarca(pessoa, { nichoId: nichoComTemaId, ultimoAcessoEm: AGORA });

    const resumo = await rodarLembrete(AGORA);
    expect(resumo.enviados).toBe(1);
    expect(vi.mocked(enviarEmail)).toHaveBeenCalledTimes(1);
    const [html] = htmlsEnviados();
    expect(html).toContain(pendenteA.nome);
    expect(html).toContain(pendenteB.nome);
    expect(html).not.toContain(aberta.nome);
  });

  it("marca com plano colado para hoje: o e-mail traz lugar e situacao acima do texto de sempre", async () => {
    const pessoa = await criarPessoa("11:00");
    const marca = await criarMarca(pessoa, { nichoId: nichoComTemaId });
    await criarItemPlano(marca.id, "2026-09-03", { lugar: "fabrica do fornecedor", situacao: "ver a linha nova" });
    await criarItemPlano(marca.id, "2026-09-03", { lugar: "escritorio", situacao: "reuniao de fechamento" });

    const resumo = await rodarLembrete(AGORA);
    expect(resumo.enviados).toBe(1);
    const [html] = htmlsEnviados();
    expect(html).toContain("fabrica do fornecedor: ver a linha nova");
    expect(html).toContain("escritorio: reuniao de fechamento");
    expect(html).toContain(`O tema de <strong>${marca.nome}</strong> está pronto para gravar.`);
    expect(html.indexOf("fabrica do fornecedor")).toBeLessThan(html.indexOf("está pronto para gravar"));
  });

  it("marca sem plano colado para hoje: o e-mail so tem o texto de sempre, sem bloco de plano", async () => {
    const pessoa = await criarPessoa("11:00");
    const marca = await criarMarca(pessoa, { nichoId: nichoComTemaId });

    const resumo = await rodarLembrete(AGORA);
    expect(resumo.enviados).toBe(1);
    const [html] = htmlsEnviados();
    expect(html).toContain(`O tema de <strong>${marca.nome}</strong> está pronto para gravar.`);
    expect(html).not.toContain(": ");
  });

  it("plano colado so em uma das duas marcas pendentes: cada uma mostra o seu bloco, com o nome na frente", async () => {
    const pessoa = await criarPessoa("11:00");
    const comPlano = await criarMarca(pessoa, { nichoId: nichoComTemaId });
    await criarMarca(pessoa, { nichoId: nichoTemaOntemId });
    await criarItemPlano(comPlano.id, "2026-09-03", { lugar: "fabrica", situacao: "ver a linha" });

    const resumo = await rodarLembrete(AGORA);
    expect(resumo.enviados).toBe(1);
    const [html] = htmlsEnviados();
    expect(html).toContain(`<strong>${comPlano.nome}</strong></p><p>fabrica: ver a linha`);
  });

  it("item pulado do plano nao entra no e-mail (planoDoDia ja exclui pulado)", async () => {
    const pessoa = await criarPessoa("11:00");
    const marca = await criarMarca(pessoa, { nichoId: nichoComTemaId });
    await criarItemPlano(marca.id, "2026-09-03", { lugar: "fabrica", situacao: "ver a linha" });
    await db().update(planoGravacoes).set({ estado: "pulado" }).where(eq(planoGravacoes.clienteId, marca.id));

    const resumo = await rodarLembrete(AGORA);
    expect(resumo.enviados).toBe(1);
    const [html] = htmlsEnviados();
    expect(html).not.toContain("ver a linha");
  });

  it("se o envio falhar, desfaz o ultimo_lembrete_em da pessoa (nao perde o lembrete do dia por falha do provedor)", async () => {
    const pessoa = await criarPessoa("11:00");
    await criarMarca(pessoa, { nichoId: nichoComTemaId });
    vi.mocked(enviarEmail).mockRejectedValueOnce(new Error("falha simulada do provedor"));

    const resumo = await rodarLembrete(AGORA);
    expect(resumo.enviados).toBe(0);
    expect(resumo.erros).toBeDefined();

    const [linha] = await db().select().from(preferenciasUsuario).where(eq(preferenciasUsuario.usuarioId, pessoa));
    expect(linha.ultimoLembreteEm).toBeNull();
  });
});
