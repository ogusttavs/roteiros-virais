/**
 * O roteiro que nasce de uma pesquisa na hora (E54, parte 2), contra o Postgres real e com a IA e a busca simuladas (`AI_PROVIDER=mock`): a
 * pesquisa que a pessoa aprovou entra na entrada e nas fontes dos fatos, o roteiro guarda a cópia dos dados marcados e a entrega (os três
 * ganchos, o que PODE aparecer, as fontes, o "Atenção"), a reescrita e o "Gerar outra" usam os mesmos dados, o verificador local barra o
 * número que nenhuma fonte tem, e o roteiro sem pesquisa sai como sempre.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { db, getPool } from "@/db";
import { briefings, clientes, geracoesIA, nichos, pesquisasNaHora, roteiros, user } from "@/db/schema";
import * as verificador from "@/ia/verificador";
import { criarPesquisa, executarPesquisa, marcarAchados } from "@/servicos/pesquisa-na-hora";
import { editarRoteiro, ErroRoteiro, gerarRoteiro, reprovarERescrever } from "@/servicos/roteiro";
import { ficarComVersao, gerarOutraVersao, gerarVersoes } from "@/servicos/versoes";

import { resetarSchema } from "../../scripts/resetar-schema";

/** Passa para o verificador de verdade, mas deixa ver o que cada tarefa recebeu. */
vi.mock("@/ia/verificador", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/ia/verificador")>();
  return { ...original, gerarComVerificacao: vi.fn(original.gerarComVerificacao) };
});

let clienteId: number;
let outroClienteId: number;
const enfileirar = async () => {};
const TEMA = "o preço dos produtos de limpeza subiu este ano";

function chamadasDoRoteiro() {
  return vi.mocked(verificador.gerarComVerificacao).mock.calls.filter(([params]) => params.tarefa === "roteiro");
}

function ultimaChamada() {
  const chamadas = chamadasDoRoteiro();
  expect(chamadas.length).toBeGreaterThan(0);
  const [params] = chamadas[chamadas.length - 1];
  return { entrada: String(params.entrada), fontes: String(params.fontesDosFatos ?? "") };
}

/** Uma pesquisa pronta, com os dados marcados (por padrão os três primeiros). */
async function pesquisaPronta(pedido = "dados de 2026 sobre o preço dos produtos de limpeza", tema: string | null = TEMA, cliente = clienteId) {
  const criada = await criarPesquisa(cliente, { pedido, tema }, { enfileirar });
  await executarPesquisa(criada.id);
  return criada.id;
}

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db().insert(nichos).values({ slug: "roteiro-pesquisa", nome: "Produtos de limpeza", termos: ["limpeza"] }).returning();
  await db().insert(user).values([
    { id: "rcp-a", name: "Marca A", email: "rcp-a@exemplo.teste" },
    { id: "rcp-b", name: "Marca B", email: "rcp-b@exemplo.teste" },
  ]);
  const [a] = await db().insert(clientes).values({ usuarioId: "rcp-a", nome: "Marca A", nichoId: nicho.id }).returning();
  const [b] = await db().insert(clientes).values({ usuarioId: "rcp-b", nome: "Marca B", nichoId: nicho.id }).returning();
  clienteId = a.id;
  outroClienteId = b.id;
  for (const id of [a.id, b.id]) {
    await db().insert(briefings).values({
      clienteId: id,
      completo: true,
      perfil: {
        fatos: { oQueVende: "kit tira-mancha", preco: "kit a partir de 89 reais", clienteIdeal: "mora em apartamento", medos: [], frasesDaFala: [], proibicoes: [], cenasFilmaveis: [], concorrentes: [] },
        resumo: "produtos de limpeza",
        referencias: [],
      } as never,
    });
  }
}, 60_000);

beforeEach(async () => {
  await db().delete(roteiros);
  await db().delete(geracoesIA);
  await db().delete(pesquisasNaHora);
  vi.mocked(verificador.gerarComVerificacao).mockClear();
});

afterAll(async () => {
  await getPool().end();
});

describe("o roteiro que responde a uma pesquisa", () => {
  it("a entrada traz o bloco datado, as fontes trazem os dados com o trecho, e o roteiro guarda a cópia do que a pessoa aprovou", async () => {
    const pesquisaId = await pesquisaPronta();
    const roteiro = await gerarRoteiro(clienteId, { origem: "livre", textoTema: TEMA, objetivo: "alcance", pesquisaId });

    const { entrada, fontes } = ultimaChamada();
    expect(entrada).toContain("<dados_da_pesquisa>");
    expect(entrada).toContain("trecho:");
    expect(entrada).toContain("entregaDaPesquisa");
    expect(fontes).toContain("Dados da pesquisa que a pessoa marcou");
    expect(fontes).toContain("| trecho:");

    expect(roteiro.pesquisaNaHora).toMatchObject({ pesquisaId, decisaoDaPremissa: null });
    expect(roteiro.pesquisaNaHora!.dados).toHaveLength(3);
    expect(roteiro.pesquisaNaHora!.dados.every((d) => d.url.startsWith("https://") && d.citacao.length > 0)).toBe(true);
  });

  it("o corpo cita a fonte e o ano, do jeito de quem fala", async () => {
    const pesquisaId = await pesquisaPronta();
    const roteiro = await gerarRoteiro(clienteId, { origem: "livre", textoTema: TEMA, objetivo: "alcance", pesquisaId });
    const primeiro = roteiro.pesquisaNaHora!.dados[0];
    expect(roteiro.conteudo.corpo).toContain(`Segundo ${primeiro.fonteNome}`);
    expect(roteiro.conteudo.corpo).toMatch(/em 20\d\d/);
  });

  it("guarda a entrega: três ganchos com o primeiro recomendado, o que pode aparecer, as fontes e o atenção", async () => {
    const pesquisaId = await pesquisaPronta();
    const roteiro = await gerarRoteiro(clienteId, { origem: "livre", textoTema: TEMA, objetivo: "alcance", pesquisaId });
    const entrega = roteiro.conteudo.entregaDaPesquisa!;
    expect(entrega).toBeTruthy();
    expect(entrega.ganchos).toHaveLength(3);
    expect(entrega.ganchos.map((g) => g.recomendado)).toEqual([true, false, false]);
    expect(entrega.oQueVaoTeResponder.length).toBeGreaterThanOrEqual(2);
    expect(entrega.oQueVaoTeResponder.every((o) => /^pode aparecer/i.test(o.objecao))).toBe(true);
    const idsMarcados = roteiro.pesquisaNaHora!.dados.map((d) => d.id);
    expect(entrega.fontes.every((id) => idsMarcados.includes(id))).toBe(true);
    expect(entrega.atencao.join(" ")).toContain("Confira a data de cada fonte antes de postar.");
    // o assunto fala de preço: a frase fixa do cuidado é do código, não do modelo
    expect(entrega.atencao.join(" ")).toContain("Preço muda");
  });

  it("a resposta que cita o número do dado fica na entrega (a conferência é contra as fontes do roteiro, não contra nada)", async () => {
    const pesquisaId = await pesquisaPronta();
    const roteiro = await gerarRoteiro(clienteId, { origem: "livre", textoTema: TEMA, objetivo: "alcance", pesquisaId });
    const primeiro = roteiro.pesquisaNaHora!.dados[0];
    const respostas = roteiro.conteudo.entregaDaPesquisa!.oQueVaoTeResponder.map((o) => o.resposta);
    expect(respostas.some((r) => r.includes(primeiro.texto.replace(/\.$/, "")))).toBe(true);
  });

  it("o roteiro sem pesquisa sai como sempre: nenhuma cópia, nenhuma entrega, a entrada sem o bloco", async () => {
    const roteiro = await gerarRoteiro(clienteId, { origem: "livre", textoTema: TEMA, objetivo: "alcance" });
    expect(roteiro.pesquisaNaHora).toBeNull();
    expect(roteiro.conteudo.entregaDaPesquisa ?? null).toBeNull();
    const { entrada, fontes } = ultimaChamada();
    expect(entrada).not.toContain("dados_da_pesquisa");
    expect(fontes).not.toContain("Dados da pesquisa");
  });

  it("só o que a pessoa marcou entra: marcar menos dados muda a entrada e a cópia", async () => {
    const pesquisaId = await pesquisaPronta();
    await marcarAchados(clienteId, pesquisaId, [2]);
    const roteiro = await gerarRoteiro(clienteId, { origem: "livre", textoTema: TEMA, objetivo: "alcance", pesquisaId });
    expect(roteiro.pesquisaNaHora!.dados.map((d) => d.id)).toEqual([2]);
    expect(ultimaChamada().entrada.match(/^dado \d+ \|/gm)).toHaveLength(1);
  });

  it("a posição da pessoa e a decisão de seguir com o que escreveu vão para a entrada e para o atenção", async () => {
    const pesquisaId = await pesquisaPronta("o que a escala 6x1 muda", "o decreto da 6x1 acabou com a escala");
    await db().update(pesquisasNaHora).set({ posicaoDaPessoa: "Prefiro não dar opinião", decisaoDaPremissa: "manter" }).where(eq(pesquisasNaHora.id, pesquisaId));
    const roteiro = await gerarRoteiro(clienteId, { origem: "livre", textoTema: "o decreto da 6x1 acabou com a escala", objetivo: "alcance", pesquisaId });
    const { entrada } = ultimaChamada();
    expect(entrada).toContain("decidiu seguir com o que escreveu");
    // "Prefiro não dar opinião" não é uma posição: o roteiro escreve só com os fatos
    expect(entrada).toContain("A pessoa preferiu não dar opinião");
    expect(entrada).not.toContain("A posição da pessoa sobre o assunto");
    expect(roteiro.pesquisaNaHora).toMatchObject({ decisaoDaPremissa: "manter", posicaoDaPessoa: "Prefiro não dar opinião" });
    expect(roteiro.conteudo.entregaDaPesquisa!.atencao.join(" ")).toContain("As fontes dizem outra coisa do que você escreveu");
  });
});

describe("a pesquisa que não serve", () => {
  it("de outra marca, inexistente, ainda rodando ou sem dado marcado: erro com a frase pronta, nunca um roteiro sem os dados", async () => {
    const dela = await pesquisaPronta(undefined, TEMA, outroClienteId);
    await expect(gerarRoteiro(clienteId, { origem: "livre", textoTema: TEMA, objetivo: "alcance", pesquisaId: dela })).rejects.toThrow(ErroRoteiro);
    await expect(gerarRoteiro(clienteId, { origem: "livre", textoTema: TEMA, objetivo: "alcance", pesquisaId: 999_999 })).rejects.toThrow("não está pronta");

    const rodando = await criarPesquisa(clienteId, { pedido: "dados de 2026 sobre o preço dos produtos" }, { enfileirar });
    await expect(gerarRoteiro(clienteId, { origem: "livre", textoTema: TEMA, objetivo: "alcance", pesquisaId: rodando.id })).rejects.toThrow("não está pronta");

    const pronta = await pesquisaPronta();
    await marcarAchados(clienteId, pronta, []);
    await expect(gerarRoteiro(clienteId, { origem: "livre", textoTema: TEMA, objetivo: "alcance", pesquisaId: pronta })).rejects.toThrow("Marque pelo menos um dado");
    expect(chamadasDoRoteiro()).toHaveLength(0);
  });
});

describe("o verificador local do roteiro com pesquisa", () => {
  it("o número que nenhuma fonte tem derruba a primeira tentativa, e a segunda, com o motivo na entrada, passa", async () => {
    const pesquisaId = await pesquisaPronta();
    const roteiro = await gerarRoteiro(clienteId, { origem: "livre", textoTema: `${TEMA} [mock:numero-fora-das-fontes]`, objetivo: "alcance", pesquisaId });
    const chamadas = chamadasDoRoteiro();
    expect(chamadas).toHaveLength(1);
    // dentro de `gerarComVerificacao` há uma segunda tentativa: o motivo do número fica na geração registrada
    const geracoes = await db().select().from(geracoesIA).where(eq(geracoesIA.tarefa, "roteiro"));
    expect(geracoes.length).toBeGreaterThanOrEqual(2);
    // a primeira (reprovada) trazia o número que nenhuma fonte tem; a que ficou é a segunda
    expect(JSON.stringify(geracoes[0].saida)).toContain("37%");
    expect(JSON.stringify(geracoes[geracoes.length - 1].saida)).not.toContain("37%");
    expect(roteiro.conteudo.corpo).not.toContain("37%");
  });

  it("se a segunda tentativa também traz o número, o roteiro não é gravado (reprovado duas vezes)", async () => {
    const pesquisaId = await pesquisaPronta();
    await expect(gerarRoteiro(clienteId, { origem: "livre", textoTema: `${TEMA} [mock:numero-fora-das-fontes-sempre]`, objetivo: "alcance", pesquisaId })).rejects.toThrow(
      /reprovad/i,
    );
    expect(await db().select().from(roteiros)).toHaveLength(0);
  });

  it("a objeção escrita como previsão de público sai da lista por código, sem derrubar nem refazer o roteiro", async () => {
    const pesquisaId = await pesquisaPronta();
    const roteiro = await gerarRoteiro(clienteId, { origem: "livre", textoTema: `${TEMA} [mock:previsao-de-publico]`, objetivo: "alcance", pesquisaId });
    const objecoes = roteiro.conteudo.entregaDaPesquisa!.oQueVaoTeResponder;
    expect(objecoes.length).toBeGreaterThan(0);
    expect(objecoes.every((o) => /^pode aparecer/i.test(o.objecao))).toBe(true);
    expect(objecoes.some((o) => /v[aã]o dizer/i.test(o.objecao))).toBe(false);
    // uma geração só: um item secundário não custa uma segunda chamada
    const geracoes = await db().select().from(geracoesIA).where(eq(geracoesIA.tarefa, "roteiro"));
    expect(geracoes).toHaveLength(1);
  });

  it("sem pesquisa, o número solto não é conferido por esta trava (o comportamento de antes): uma geração, com o número", async () => {
    const roteiro = await gerarRoteiro(clienteId, { origem: "livre", textoTema: `${TEMA} [mock:numero-solto]`, objetivo: "alcance" });
    expect(roteiro.conteudo.corpo).toContain("37%");
    expect(chamadasDoRoteiro()).toHaveLength(1);
    expect(await db().select().from(geracoesIA).where(eq(geracoesIA.tarefa, "roteiro"))).toHaveLength(1);
  });

  it("com pesquisa, o mesmo número solto derruba a primeira tentativa", async () => {
    const pesquisaId = await pesquisaPronta();
    const roteiro = await gerarRoteiro(clienteId, { origem: "livre", textoTema: `${TEMA} [mock:numero-solto]`, objetivo: "alcance", pesquisaId });
    expect(roteiro.conteudo.corpo).not.toContain("37%");
    expect((await db().select().from(geracoesIA).where(eq(geracoesIA.tarefa, "roteiro"))).length).toBeGreaterThanOrEqual(2);
  });
});

describe("os dados que a pessoa aprovou continuam os mesmos", () => {
  it("a reescrita usa a cópia guardada, mesmo que a pesquisa seja marcada de outro jeito depois", async () => {
    const pesquisaId = await pesquisaPronta();
    const primeiro = await gerarRoteiro(clienteId, { origem: "livre", textoTema: TEMA, objetivo: "alcance", pesquisaId });
    await marcarAchados(clienteId, pesquisaId, [5]);
    vi.mocked(verificador.gerarComVerificacao).mockClear();

    const novo = await reprovarERescrever(primeiro.id, ["gancho_fraco"]);
    expect(novo.pesquisaNaHora!.dados.map((d) => d.id)).toEqual(primeiro.pesquisaNaHora!.dados.map((d) => d.id));
    expect(novo.conteudo.entregaDaPesquisa).toBeTruthy();
    expect(ultimaChamada().entrada).toContain("<dados_da_pesquisa>");
  });

  it("o 'Gerar outra' escreve com os mesmos dados, mesmo que a pesquisa mude depois do grupo", async () => {
    const pesquisaId = await pesquisaPronta();
    const { grupo, versoes } = await gerarVersoes(clienteId, { origem: "livre", textoTema: TEMA, objetivo: "alcance", pesquisaId }, 1);
    expect(versoes).toHaveLength(1);
    await marcarAchados(clienteId, pesquisaId, [6]);
    vi.mocked(verificador.gerarComVerificacao).mockClear();

    await gerarOutraVersao(clienteId, grupo);
    const { entrada } = ultimaChamada();
    expect(entrada.match(/^dado \d+ \|/gm)).toHaveLength(3);
    expect(entrada).not.toContain("dado 6 |");
  });

  it("Ficar com esta leva a cópia e a entrega para o roteiro do dia", async () => {
    const pesquisaId = await pesquisaPronta();
    const { versoes } = await gerarVersoes(clienteId, { origem: "livre", textoTema: TEMA, objetivo: "alcance", pesquisaId }, 1);
    const roteiro = await ficarComVersao(clienteId, versoes[0].id);
    expect(roteiro.pesquisaNaHora).toMatchObject({ pesquisaId });
    expect(roteiro.pesquisaNaHora!.dados).toHaveLength(3);
    expect(roteiro.conteudo.entregaDaPesquisa!.ganchos).toHaveLength(3);
  });

  it("Story e vídeo sem fala também levam a pesquisa e a entrega, sem gancho do roteiro (os ganchos são os do modelo)", async () => {
    const pesquisaId = await pesquisaPronta();
    const story = await gerarRoteiro(clienteId, { origem: "livre", textoTema: TEMA, objetivo: "alcance", pesquisaId, formato: "story" });
    expect(story.pesquisaNaHora!.dados.length).toBeGreaterThan(0);
    expect(story.conteudo.gancho ?? "").toBe("");
    expect(story.conteudo.entregaDaPesquisa!.ganchos[0].recomendado).toBe(true);
    expect(ultimaChamada().entrada).toContain("<dados_da_pesquisa>");

    const semFala = await gerarRoteiro(clienteId, { origem: "livre", textoTema: TEMA, objetivo: "alcance", pesquisaId, estilo: "sem_fala" });
    expect(semFala.pesquisaNaHora!.dados.length).toBeGreaterThan(0);
    expect(semFala.conteudo.entregaDaPesquisa!.ganchos.length).toBeGreaterThan(0);
  });

  it("no Reels falado o primeiro gancho da entrega é o do roteiro; se a pessoa reescreve o gancho, o primeiro acompanha", async () => {
    const pesquisaId = await pesquisaPronta();
    const roteiro = await gerarRoteiro(clienteId, { origem: "livre", textoTema: TEMA, objetivo: "alcance", pesquisaId });
    const entrega = roteiro.conteudo.entregaDaPesquisa!;
    expect(entrega.ganchos[0]).toEqual({ texto: roteiro.conteudo.gancho, recomendado: true });

    const editado = await editarRoteiro(roteiro.id, { gancho: "Um gancho do meu jeito" });
    const depois = editado.conteudo.entregaDaPesquisa!;
    expect(depois.ganchos[0]).toEqual({ texto: "Um gancho do meu jeito", recomendado: true });
    expect(depois.ganchos.slice(1).every((g) => !g.recomendado)).toBe(true);
    expect(depois.ganchos).toHaveLength(entrega.ganchos.length);
    // o resto da entrega e a cópia dos dados ficam como estavam
    expect(depois.fontes).toEqual(entrega.fontes);
    expect(editado.pesquisaNaHora).toEqual(roteiro.pesquisaNaHora);
  });

  it("vale também no momento (a pessoa pediu a pesquisa para este vídeo)", async () => {
    const pesquisaId = await pesquisaPronta();
    const roteiro = await gerarRoteiro(clienteId, {
      origem: "momento",
      momento: { onde: "na loja", oQueEstaAcontecendo: "um cliente reclama do preço do produto", oQueDaParaMostrar: "a etiqueta" },
      objetivo: "alcance",
      pesquisaId,
    });
    expect(roteiro.pesquisaNaHora!.dados.length).toBeGreaterThan(0);
    expect(ultimaChamada().entrada).toContain("<dados_da_pesquisa>");
  });
});
