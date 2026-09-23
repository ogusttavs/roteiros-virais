/**
 * `gerarRoteiro`, `reprovarERescrever` (E27, parte 1; antes `outroAngulo`)
 * e `marcarPostado` (etapa 11): ciclo completo contra o Postgres real, em
 * mock (`AI_PROVIDER=mock`, `vitest.config.mts`).
 */
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/ia/cliente", async (importarOriginal) => {
  const original = await importarOriginal<typeof import("@/ia/cliente")>();
  return { ...original, gerarEstruturado: vi.fn(original.gerarEstruturado) };
});

// V9a, item 1: espiona a busca de evidencia para provar que a origem "momento" nunca a chama.
vi.mock("@/servicos/pesquisa", async (importarOriginal) => {
  const original = await importarOriginal<typeof import("@/servicos/pesquisa")>();
  return {
    ...original,
    evidenciaParaRoteiro: vi.fn(original.evidenciaParaRoteiro),
    evidenciaPorIds: vi.fn(original.evidenciaPorIds),
  };
});

import { db, getPool } from "@/db";
import {
  briefings,
  clientes,
  geracoesIA,
  membrosMarca,
  modelosNicho,
  nichos,
  roteiros,
  user,
  videos,
  videosCliente,
  type ModeloNicho,
  type PerfilCompilado,
  type TipoAbertura,
} from "@/db/schema";
import { gerarEstruturado } from "@/ia/cliente";
import { ErroIA } from "@/ia/erro";
import { boss, FILAS } from "@/jobs/fila";
import { hojeISO } from "@/lib/config";
import { evidenciaParaRoteiro, evidenciaPorIds } from "@/servicos/pesquisa";
import {
  ErroRoteiro,
  gerarRoteiro,
  marcarGravado,
  marcarPostado,
  reprovarERescrever,
  roteirosDeHoje,
} from "@/servicos/roteiro";

import { resetarSchema } from "../../scripts/resetar-schema";

const gerarEstruturadoMock = vi.mocked(gerarEstruturado);
const evidenciaParaRoteiroMock = vi.mocked(evidenciaParaRoteiro);
const evidenciaPorIdsMock = vi.mocked(evidenciaPorIds);

const PERFIL_PADRAO: PerfilCompilado = {
  fatos: {
    oQueVende: "lavagem de estofados",
    preco: "sofa de 3 lugares por R$ 180",
    clienteIdeal: "mora em apartamento",
    medos: ["ja mandou fazer em outro lugar e o sofa ficou manchado"],
    frasesDaFala: ['"relaxa que sai sim"'],
    proibicoes: ["garantia total"],
    cenasFilmaveis: ["a maquina ligada"],
    concorrentes: [],
    perfisAdmirados: [],
  },
  resumo: "lava estofados em domicilio",
  referencias: [],
};

const MODELO_PADRAO: ModeloNicho = {
  resumo: "videos curtos mostrando o produto agindo",
  ganchos: [
    { tipo: "mostrar o produto agindo", exemplo: "olha essa mancha saindo", frequencia: "alta" },
  ],
  duracaoTipicaS: { min: 20, max: 30 },
  estruturas: ["gancho, demonstracao, fechamento"],
  fechamentos: ["mostra o resultado sem falar nada"],
  chamadasFinais: ["comenta se voce ja passou por isso"],
  formatos: [{ formato: "fala_para_camera", participacao: "60%" }],
  edicao: {
    textoNaTela: "curto, no topo",
    ritmoDeCorte: "moderado",
    recursos: ["zoom na mancha"],
    audio: null,
  },
  assuntosQuentes: ["mancha em estofado"],
  baseadoEm: 3,
  acimaDoLimiar: 3,
};

let nichoId: number;
let contadorUsuario = 0;

async function criarCliente(): Promise<number> {
  contadorUsuario += 1;
  const usuarioId = `roteiro-teste-${contadorUsuario}`;
  await db()
    .insert(user)
    .values({
      id: usuarioId,
      name: `[teste] cliente ${contadorUsuario}`,
      email: `${usuarioId}@roteiro.teste`,
    });

  const [cliente] = await db()
    .insert(clientes)
    .values({
      usuarioId,
      nome: `[teste] cliente ${contadorUsuario}`,
      nichoId,
      cidade: "Sao Paulo",
      bairro: "Pinheiros",
    })
    .returning();

  await db()
    .insert(briefings)
    .values({ clienteId: cliente.id, completo: true, perfil: PERFIL_PADRAO });

  return cliente.id;
}

async function criarVideoEvidencia(
  idExterno: string,
  assunto: string,
  opcoes: { idioma?: string | null; foraDaCurva?: number; tipoAbertura?: TipoAbertura } = {},
): Promise<number> {
  const [video] = await db()
    .insert(videos)
    .values({
      plataforma: "youtube",
      idExterno,
      url: `https://exemplo.invalido/${idExterno}`,
      nichoId,
      titulo: assunto,
      foraDaCurva: String(opcoes.foraDaCurva ?? 6),
      publicadoEm: new Date(),
      // V2b, item 6: "pt" por padrao, para os testes que nao sao sobre a proporcao nao serem afetados por ela.
      idioma: opcoes.idioma === undefined ? "pt" : opcoes.idioma,
      // V4, item 3: nulo por padrao (o caso "nicho novo" de escolherTipoAbertura), a nao ser que o teste peca um tipo especifico.
      tipoAbertura: opcoes.tipoAbertura,
      analise: {
        assunto,
        gancho: "olha essa mancha saindo do estofado",
        estrutura: "gancho, demonstracao, fechamento",
        fechamento: "mostra o resultado sem falar nada",
        chamadaFinal: "comenta se voce ja passou por isso",
        formato: "fala_para_camera",
        porQueFuncionou: "mostra o problema acontecendo de verdade",
      } as never,
    })
    .returning();
  return video.id;
}

async function criarModeloNicho() {
  await db().insert(modelosNicho).values({ nichoId, semana: "2026-08-31", modelo: MODELO_PADRAO });
}

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db()
    .insert(nichos)
    .values({ slug: "roteiro-teste", nome: "Roteiro teste", termos: [] })
    .returning();
  nichoId = nicho.id;
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

afterEach(async () => {
  // videosCliente referencia roteiros; precisa apagar antes.
  await db().delete(videosCliente);
  await db().delete(roteiros);
  await db().delete(videos).where(eq(videos.nichoId, nichoId));
  await db().delete(modelosNicho).where(eq(modelosNicho.nichoId, nichoId));
  evidenciaParaRoteiroMock.mockClear();
  evidenciaPorIdsMock.mockClear();
});

describe("gerarRoteiro", () => {
  it("cita evidencia, tem todos os blocos, e respeita a duracao do modelo do nicho", async () => {
    const clienteId = await criarCliente();
    await criarVideoEvidencia("ev-1", "mancha de vinho no estofado");
    await criarModeloNicho();

    const cliente = (await db().select().from(clientes).where(eq(clientes.id, clienteId)))[0];
    const roteiro = await gerarRoteiro(clienteId, {
      origem: "livre",
      textoTema: "mancha de vinho no estofado",
      objetivo: "conversao",
    });

    expect(roteiro.clienteId).toBe(clienteId);
    expect(roteiro.status).toBe("gerado");
    expect(roteiro.versao).toBe(1);
    expect(roteiro.versaoDe).toBeNull();
    expect(roteiro.geracaoId).not.toBeNull();

    const c = roteiro.conteudo;
    expect(c.titulo).toBeTruthy();
    expect(c.gancho).toBeTruthy();
    expect(c.corpo).toBeTruthy();
    expect(c.fechamento).toBeTruthy();
    expect(c.chamadaFinal).toBeTruthy();
    expect(c.cenas.length).toBeGreaterThan(0);
    expect(c.ondeGravar).toBeTruthy();
    expect(c.edicao.textoNaTela.length).toBeGreaterThan(0);
    expect(c.evidencias.length).toBeGreaterThan(0);

    // o mock sempre devolve 40s; o modelo do nicho pede de 20 a 30.
    expect(c.duracaoS).toBe(30);

    expect(cliente.nichoId).toBe(nichoId);
  });

  it("sem modelo do nicho, aceita a duracao que veio (sem faixa para respeitar)", async () => {
    const clienteId = await criarCliente();
    await criarVideoEvidencia("ev-2", "cheiro de bicho de estimacao no sofa");

    const roteiro = await gerarRoteiro(clienteId, {
      origem: "livre",
      textoTema: "cheiro de bicho de estimacao no sofa",
      objetivo: "alcance",
    });

    expect(roteiro.conteudo.duracaoS).toBe(40);
  });

  it("cliente sem briefing compilado: erro nomeado", async () => {
    contadorUsuario += 1;
    const usuarioId = `roteiro-teste-sem-briefing-${contadorUsuario}`;
    await db()
      .insert(user)
      .values({ id: usuarioId, name: "sem briefing", email: `${usuarioId}@roteiro.teste` });
    const [cliente] = await db()
      .insert(clientes)
      .values({ usuarioId, nome: "sem briefing", nichoId })
      .returning();

    await expect(
      gerarRoteiro(cliente.id, {
        origem: "livre",
        textoTema: "qualquer assunto",
        objetivo: "alcance",
      }),
    ).rejects.toThrow(ErroRoteiro);
  });

  it("origem sugerido com indice invalido: erro nomeado (sem tema do dia)", async () => {
    const clienteId = await criarCliente();
    await expect(
      gerarRoteiro(clienteId, { origem: "sugerido", temaIndice: 0, objetivo: "alcance" }),
    ).rejects.toThrow(ErroRoteiro);
  });

  it("tema livre com jargao: o verificador reprova as duas tentativas e lanca ErroIA", async () => {
    const clienteId = await criarCliente();

    await expect(
      gerarRoteiro(clienteId, {
        origem: "livre",
        textoTema: "como aumentar o engajamento do seu negocio",
        objetivo: "alcance",
      }),
    ).rejects.toThrow(ErroIA);
  });

  it("vídeo de referência aponta a evidência sem análise visual, aos 0s, com o gancho dela (revisão do PR #17)", async () => {
    const clienteId = await criarCliente();
    const videoId = await criarVideoEvidencia("ev-referencia", "mancha de vinho no estofado");

    const roteiro = await gerarRoteiro(clienteId, {
      origem: "livre",
      textoTema: "mancha de vinho no estofado",
      objetivo: "conversao",
    });

    expect(roteiro.conteudo.edicao.referencia).toEqual({
      videoId,
      segundo: 0,
      oQueOlhar: "olha essa mancha saindo do estofado",
    });
  });

  /** V2b, item 6: a proporcao 70/30 corta o excesso de evidencia internacional. */
  it("evidencia internacional em excesso fica de fora, mesmo com prioridade maior; brasileira entra sempre", async () => {
    const clienteId = await criarCliente();
    const idsEn: number[] = [];
    for (let i = 1; i <= 4; i += 1) {
      idsEn.push(
        await criarVideoEvidencia(`prop-en-${i}`, "vazamento de agua no telhado", {
          idioma: "en",
          foraDaCurva: 20 - i, // prioridade maior que o "pt" abaixo
        }),
      );
    }
    const idPt = await criarVideoEvidencia("prop-pt", "vazamento de agua no telhado", {
      idioma: "pt",
      foraDaCurva: 1,
    });

    const roteiro = await gerarRoteiro(clienteId, {
      origem: "livre",
      textoTema: "vazamento de agua no telhado",
      objetivo: "conversao",
    });

    // Revisao do PR #46: so 1 brasileiro disponivel => maxInternacional = max(1, floor(1*0,3/0,7)) = 1.
    const evidenciasEn = roteiro.conteudo.evidencias.filter((id) => idsEn.includes(id));
    expect(evidenciasEn.length).toBeLessThanOrEqual(1);
    expect(roteiro.conteudo.evidencias).toContain(idPt);
  });

  /** Revisao do PR #46: sem nenhum brasileiro na base, a evidencia vem vazia, nunca so internacional. */
  it("sem nenhum brasileiro disponivel, evidencia do roteiro vem vazia mesmo com internacional de sobra", async () => {
    const clienteId = await criarCliente();
    for (let i = 1; i <= 4; i += 1) {
      await criarVideoEvidencia(`prop-sem-brasil-en-${i}`, "vazamento no telhado do galpao", {
        idioma: "en",
        foraDaCurva: 20 - i,
      });
    }

    const roteiro = await gerarRoteiro(clienteId, {
      origem: "livre",
      textoTema: "vazamento no telhado do galpao",
      objetivo: "conversao",
    });

    expect(roteiro.conteudo.evidencias).toEqual([]);
    expect(roteiro.conteudo.semEvidencia).toBe(true);
  });

  it("tema livre sem nenhuma evidência no banco: roteiro honesto, sem referência e sem citar id (ajuste 2 da revisão do PR #17)", async () => {
    const clienteId = await criarCliente();
    // nenhum video criado para este nicho: evidenciaParaRoteiro nao acha nada.

    const roteiro = await gerarRoteiro(clienteId, {
      origem: "livre",
      textoTema: "assunto sem nenhum video parecido no banco",
      objetivo: "engajamento",
    });

    expect(roteiro.conteudo.semEvidencia).toBe(true);
    expect(roteiro.conteudo.evidencias).toEqual([]);
    expect(roteiro.conteudo.edicao.referencia).toBeNull();
    expect(roteiro.geracaoId).not.toBeNull();
  });
});

describe("historico de ganchos entre roteiros do mesmo cliente (achado do primeiro uso no iPad, item 3)", () => {
  it("o gancho do roteiro anterior entra na entrada da geracao seguinte", async () => {
    const clienteId = await criarCliente();
    await criarVideoEvidencia("ev-gancho-1", "mancha de vinho no estofado");

    const v1 = await gerarRoteiro(clienteId, {
      origem: "livre",
      textoTema: "mancha de vinho no estofado",
      objetivo: "alcance",
    });

    await criarVideoEvidencia("ev-gancho-2", "cheiro de bicho de estimacao no sofa");
    const v2 = await gerarRoteiro(clienteId, {
      origem: "livre",
      textoTema: "cheiro de bicho de estimacao no sofa",
      objetivo: "alcance",
    });

    const [geracaoV2] = await db()
      .select()
      .from(geracoesIA)
      .where(eq(geracoesIA.id, v2.geracaoId!));
    const entradaV2 = (geracaoV2.entradas as { entrada: string }).entrada;

    expect(entradaV2).toContain(v1.conteudo.gancho);
  });

  it("reprova quando o novo gancho repete o de um roteiro recente do mesmo cliente (mock e deterministico no tema)", async () => {
    const clienteId = await criarCliente();
    // Um tipo so na evidencia (V4, item 3d): escolherTipoAbertura libera o
    // mesmo tipo de novo por falta de alternativa, o mock fica deterministico
    // no tema como antes, e o verificador nao reprova por tipoAbertura
    // repetido (repeticao instruida de proposito, nao vicio do modelo).
    await criarVideoEvidencia("ev-gancho-repete", "mancha de vinho no estofado", { tipoAbertura: "cena" });

    await gerarRoteiro(clienteId, {
      origem: "livre",
      textoTema: "mancha de vinho no estofado",
      objetivo: "alcance",
    });

    // mesmo tema, mesmo cliente: o mock devolve o mesmo gancho de novo nas
    // duas tentativas, e o verificador local reprova as duas.
    await expect(
      gerarRoteiro(clienteId, {
        origem: "livre",
        textoTema: "mancha de vinho no estofado",
        objetivo: "alcance",
      }),
    ).rejects.toThrow(ErroIA);
  });
});

describe("V4, roteiro sem vicio (escopo 5.12, item 7)", () => {
  it("cinco roteiros seguidos do mesmo cliente saem com cinco tipos de abertura diferentes e cinco primeiras palavras diferentes (item 7a)", async () => {
    const clienteId = await criarCliente();
    const tema = "erro comum ao limpar o carro por dentro";
    const tipos: TipoAbertura[] = ["cena", "resultado", "objeto", "fala_direta", "numero"];
    for (const [indice, tipo] of tipos.entries()) {
      await criarVideoEvidencia(`ev-abertura-${indice}`, tema, { tipoAbertura: tipo, foraDaCurva: 6 + indice });
    }

    const tiposDeclarados = new Set<string>();
    const primeirasPalavras = new Set<string>();
    for (let i = 0; i < 5; i += 1) {
      const roteiro = await gerarRoteiro(clienteId, { origem: "livre", textoTema: tema, objetivo: "alcance" });
      tiposDeclarados.add(roteiro.tipoAbertura!);
      primeirasPalavras.add(roteiro.conteudo.gancho.split(" ")[0]);
    }

    expect(tiposDeclarados.size).toBe(5);
    expect(primeirasPalavras.size).toBe(5);
  });

  it("os ultimos roteiros para a abertura sao so da marca ativa, nunca de outra marca do mesmo login (item 7c)", async () => {
    const clienteIdA = await criarCliente();
    const [{ usuarioId }] = await db()
      .select({ usuarioId: clientes.usuarioId })
      .from(clientes)
      .where(eq(clientes.id, clienteIdA));
    const [clienteB] = await db()
      .insert(clientes)
      .values({ usuarioId, nome: "[teste] marca b do mesmo login", nichoId })
      .returning();
    await db().insert(briefings).values({ clienteId: clienteB.id, completo: true, perfil: PERFIL_PADRAO });

    const tema = "erro comum ao encerar o carro";
    await criarVideoEvidencia("ev-isolamento-cena", tema, { tipoAbertura: "cena", foraDaCurva: 9 });
    await criarVideoEvidencia("ev-isolamento-resultado", tema, { tipoAbertura: "resultado", foraDaCurva: 5 });

    const roteiroA = await gerarRoteiro(clienteIdA, { origem: "livre", textoTema: tema, objetivo: "alcance" });
    // primeiro roteiro da marca A: sem historico para evitar, escolhe o de maior fora da curva.
    expect(roteiroA.tipoAbertura).toBe("cena");

    const roteiroB = await gerarRoteiro(clienteB.id, { origem: "livre", textoTema: tema, objetivo: "alcance" });
    // marca B nunca gerou roteiro antes: se a consulta dos "ultimos roteiros" vazasse entre
    // marcas do mesmo login, o "cena" da marca A apareceria como usado e a marca B cairia para
    // "resultado" mesmo sendo o primeiro roteiro dela.
    expect(roteiroB.tipoAbertura).toBe("cena");
  });
});

describe("reprovarERescrever", () => {
  it("com dois motivos e um texto, cria a versao 2 com o mesmo objetivo; a versao 1 fica marcada reprovada, com os motivos na geracao dela", async () => {
    const clienteId = await criarCliente();
    await criarVideoEvidencia("ev-3", "erro comum ao limpar estofado");

    const v1 = await gerarRoteiro(clienteId, {
      origem: "livre",
      textoTema: "erro comum ao limpar estofado",
      objetivo: "engajamento",
    });

    const v2 = await reprovarERescrever(v1.id, ["gancho_fraco", "muito_longo"], "comeca devagar demais");

    expect(v2.versao).toBe(2);
    expect(v2.versaoDe).toBe(v1.id);
    expect(v2.clienteId).toBe(clienteId);
    expect(v2.tema).toBe(v1.tema);
    expect(v2.objetivo).toBe(v1.objetivo);

    const [v1Recarregado] = await db().select().from(roteiros).where(eq(roteiros.id, v1.id));
    expect(v1Recarregado.versao).toBe(1);
    expect(v1Recarregado.conteudo).toBeTruthy();
    expect(v1Recarregado.reprovadoEm).not.toBeNull();

    const [geracaoV1] = await db().select().from(geracoesIA).where(eq(geracoesIA.id, v1.geracaoId!));
    expect(geracaoV1.avaliacao).toBe("reprovado");
    expect(geracaoV1.motivosAvaliacao).toEqual(["gancho_fraco", "muito_longo"]);
    expect(geracaoV1.motivoAvaliacao).toBe("comeca devagar demais");
  });

  it("sem motivo nenhum, erro nomeado, sem gerar versao nova", async () => {
    const clienteId = await criarCliente();
    await criarVideoEvidencia("ev-sem-motivo", "erro comum ao limpar estofado");

    const v1 = await gerarRoteiro(clienteId, {
      origem: "livre",
      textoTema: "erro comum ao limpar estofado",
      objetivo: "engajamento",
    });

    await expect(reprovarERescrever(v1.id, [])).rejects.toThrow(ErroRoteiro);

    const [v1Recarregado] = await db().select().from(roteiros).where(eq(roteiros.id, v1.id));
    expect(v1Recarregado.reprovadoEm).toBeNull();
  });

  /**
   * Item 1 do acabamento da E27 (revisão do PR #41): antes a v1 era
   * marcada reprovada ANTES de gerar a v2; se a IA falhasse, a v1 ficava
   * reprovada sem substituta. Agora gera primeiro; com a IA falhando, nada
   * e escrito.
   */
  it("com a IA falhando na segunda geracao, a v1 continua sem reprovadoEm e sem avaliacao, e nenhuma v2 e criada", async () => {
    const clienteId = await criarCliente();
    await criarVideoEvidencia("ev-ia-falha", "erro comum ao limpar estofado");
    // pgboss.job nunca e limpo entre execucoes (mesmo achado do teste do item 5, acima):
    // um clienteId numerico pode se repetir entre rodadas locais desta suite.
    await db().execute(sql`
      delete from pgboss.job
      where name = ${FILAS.aprenderCliente}
        and (data ->> 'clienteId')::int = ${clienteId}
    `);

    const v1 = await gerarRoteiro(clienteId, {
      origem: "livre",
      textoTema: "erro comum ao limpar estofado",
      objetivo: "engajamento",
    });
    const [geracaoV1Antes] = await db().select().from(geracoesIA).where(eq(geracoesIA.id, v1.geracaoId!));

    gerarEstruturadoMock.mockRejectedValueOnce(new ErroIA("simulado: IA fora do ar"));
    await expect(reprovarERescrever(v1.id, ["gancho_fraco"], "comeca fraco")).rejects.toThrow(ErroIA);

    const [v1Recarregado] = await db().select().from(roteiros).where(eq(roteiros.id, v1.id));
    expect(v1Recarregado.reprovadoEm).toBeNull();

    const [geracaoV1Depois] = await db().select().from(geracoesIA).where(eq(geracoesIA.id, v1.geracaoId!));
    expect(geracaoV1Depois.avaliacao).toBe(geracaoV1Antes.avaliacao);
    expect(geracaoV1Depois.motivosAvaliacao).toBeNull();

    const serie = await db().select().from(roteiros).where(eq(roteiros.clienteId, clienteId));
    expect(serie).toHaveLength(1);

    const jobs = await db().execute(sql`
      select 1 from pgboss.job
      where name = ${FILAS.aprenderCliente}
        and (data ->> 'clienteId')::int = ${clienteId}
      limit 1
    `);
    expect(jobs.rows.length).toBe(0);
  });

  /** Segunda rodada do PR #42, item 6: "a fila nunca derruba a reescrita". */
  it("reprovar enfileira o job aprender-cliente com o clienteId certo", async () => {
    const clienteId = await criarCliente();
    await criarVideoEvidencia("ev-enfileira", "erro comum ao limpar estofado");

    const v1 = await gerarRoteiro(clienteId, {
      origem: "livre",
      textoTema: "erro comum ao limpar estofado",
      objetivo: "engajamento",
    });
    await reprovarERescrever(v1.id, ["gancho_fraco"], "comeca fraco");

    const jobs = await db().execute(sql`
      select 1 from pgboss.job
      where name = ${FILAS.aprenderCliente}
        and (data ->> 'clienteId')::int = ${clienteId}
      limit 1
    `);
    expect(jobs.rows.length).toBe(1);
  });

  /**
   * Item 5 do acabamento da E27: `singletonKey` por cliente evita duas
   * rodadas do job por duas reprovacoes seguidas. Duas series diferentes
   * (nao a mesma reprovada duas vezes): o mock devolve sempre o mesmo
   * gancho "um jeito diferente de mostrar X" para toda reprovacao do mesmo
   * tema, entao reprovar a mesma serie duas vezes colide com o proprio
   * verificador local (gancho recente repetido); duas series distintas do
   * mesmo cliente evita esse falso positivo e ainda prova o que o item 5
   * pede, que e por cliente, nao por serie.
   *
   * `pgboss.job` nunca e limpo entre execucoes da suite (nao e tocado por
   * `resetarSchema`, so o schema do Drizzle) e um `clienteId` numerico pode
   * se repetir entre rodadas, porque a sequencia volta a contar do 1 a
   * cada reset: uma linha antiga de uma rodada anterior com o mesmo
   * `clienteId`, no mesmo minuto do relogio, ocupa o mesmo slot do
   * `singletonKey` e faz este teste flacar (achado rodando esta rodada mais
   * de uma vez na mesma sessao local). Apaga qualquer job antigo com este
   * `clienteId` antes de reprovar, para a contagem valer so para esta
   * execucao.
   */
  it("duas reprovacoes seguidas do mesmo cliente deixam um job so na fila aprender-cliente", async () => {
    const clienteId = await criarCliente();
    await criarVideoEvidencia("ev-duas-reprovacoes-1", "erro comum ao limpar estofado");
    await criarVideoEvidencia("ev-duas-reprovacoes-2", "cheiro de bicho de estimacao no sofa");
    await db().execute(sql`
      delete from pgboss.job
      where name = ${FILAS.aprenderCliente}
        and (data ->> 'clienteId')::int = ${clienteId}
    `);

    const v1 = await gerarRoteiro(clienteId, {
      origem: "livre",
      textoTema: "erro comum ao limpar estofado",
      objetivo: "engajamento",
    });
    const v3 = await gerarRoteiro(clienteId, {
      origem: "livre",
      textoTema: "cheiro de bicho de estimacao no sofa",
      objetivo: "engajamento",
    });
    await reprovarERescrever(v1.id, ["gancho_fraco"], "comeca fraco");
    await reprovarERescrever(v3.id, ["muito_longo"], "ficou longo");

    const jobs = await db().execute(sql`
      select count(*)::int as total from pgboss.job
      where name = ${FILAS.aprenderCliente}
        and (data ->> 'clienteId')::int = ${clienteId}
    `);
    expect(jobs.rows[0].total).toBe(1);
  });

  it("com boss().send lancando, a nova versao e gerada mesmo assim (a memoria e bonus, a reescrita nao pode falhar por causa dela)", async () => {
    const clienteId = await criarCliente();
    await criarVideoEvidencia("ev-boss-falha", "erro comum ao limpar estofado");

    const v1 = await gerarRoteiro(clienteId, {
      origem: "livre",
      textoTema: "erro comum ao limpar estofado",
      objetivo: "engajamento",
    });

    const envioEspiao = vi.spyOn(boss(), "send").mockRejectedValueOnce(new Error("ECONNREFUSED simulado"));
    const v2 = await reprovarERescrever(v1.id, ["gancho_fraco"], "comeca fraco");
    envioEspiao.mockRestore();

    expect(v2.versao).toBe(2);
    expect(v2.versaoDe).toBe(v1.id);
  });
});

describe("V9a, o momento (item 1, 2 e 4 do PROXIMO.md)", () => {
  const MOMENTO_1 = {
    onde: "no aeroporto, cinco da manha",
    oQueEstaAcontecendo: "esperando o embarque para a feira de fornecedores",
    oQueDaParaMostrar: "a fila do check-in e a mala de amostras",
  };

  it("nao chama a busca de evidencia, e grava origem e momento inteiros, com forca media", async () => {
    const clienteId = await criarCliente();
    // Evidencia de verdade existe no banco; se a busca rodasse, ela apareceria na entrada.
    await criarVideoEvidencia("ev-momento-existente", "esperando o embarque para a feira de fornecedores");

    const roteiro = await gerarRoteiro(clienteId, { origem: "momento", momento: MOMENTO_1, objetivo: "engajamento" });

    expect(evidenciaParaRoteiroMock).not.toHaveBeenCalled();
    expect(evidenciaPorIdsMock).not.toHaveBeenCalled();
    expect(roteiro.origem).toBe("momento");
    expect(roteiro.momento).toEqual(MOMENTO_1);
    expect(roteiro.conteudo.semEvidencia).toBe(true);
    expect(roteiro.conteudo.evidencias).toEqual([]);
    expect(roteiro.conteudo.forcaEvidencia).toBe("media");
    expect(roteiro.conteudo.edicao.referencia).toBeNull();
  });

  it("o tema gravado vem do temaCurto que o modelo devolveu, nao do texto provisorio", async () => {
    const clienteId = await criarCliente();
    const roteiro = await gerarRoteiro(clienteId, { origem: "momento", momento: MOMENTO_1, objetivo: "alcance" });

    // O mock so preenche temaCurto com momento, sempre com o prefixo "sobre " (ver src/ia/mock.ts).
    expect(roteiro.tema).toBe(`sobre ${MOMENTO_1.oQueEstaAcontecendo}`.slice(0, 60));
    expect(roteiro.tema).not.toBe(MOMENTO_1.oQueEstaAcontecendo.slice(0, 80));
  });

  it("contexto de serie: o roteiro seguinte cita o tema e o gancho do momento anterior do mesmo cliente", async () => {
    const clienteId = await criarCliente();
    const v1 = await gerarRoteiro(clienteId, { origem: "momento", momento: MOMENTO_1, objetivo: "engajamento" });

    const momento2 = {
      onde: "na feira de fornecedores",
      oQueEstaAcontecendo: "conversando com um fornecedor novo sobre embalagem",
      oQueDaParaMostrar: "as amostras em cima da mesa",
    };
    const v2 = await gerarRoteiro(clienteId, { origem: "momento", momento: momento2, objetivo: "engajamento" });

    const [geracaoV2] = await db().select().from(geracoesIA).where(eq(geracoesIA.id, v2.geracaoId!));
    const entradaV2 = (geracaoV2.entradas as { entrada: string }).entrada;

    expect(entradaV2).toContain("O que já foi gravado nesta sequência de momentos");
    expect(entradaV2).toContain(v1.tema);
    expect(entradaV2).toContain(v1.conteudo.gancho);
  });

  it("marca citada: a entrada leva o nome e o perfil da marca que a pessoa citou, com a regra dura 11", async () => {
    const clienteId = await criarCliente();
    contadorUsuario += 1;
    const usuarioIdB = `roteiro-teste-marca-citada-${contadorUsuario}`;
    await db().insert(user).values({ id: usuarioIdB, name: "[teste] dono da marca citada", email: `${usuarioIdB}@roteiro.teste` });
    const [marcaCitada] = await db()
      .insert(clientes)
      .values({ usuarioId: usuarioIdB, nome: "[teste] Marca Citada", nichoId })
      .returning();
    await db().insert(briefings).values({
      clienteId: marcaCitada.id,
      completo: true,
      perfil: { ...PERFIL_PADRAO, resumo: "vende cera automotiva artesanal" },
    });

    const roteiro = await gerarRoteiro(clienteId, {
      origem: "momento",
      momento: { ...MOMENTO_1, marcaId: marcaCitada.id },
      objetivo: "conversao",
    });

    expect(roteiro.momento?.marcaId).toBe(marcaCitada.id);
    const [geracao] = await db().select().from(geracoesIA).where(eq(geracoesIA.id, roteiro.geracaoId!));
    const entrada = (geracao.entradas as { entrada: string }).entrada;
    expect(entrada).toContain("Marca citada por quem está gravando");
    expect(entrada).toContain("Marca Citada");
    expect(entrada).toContain("vende cera automotiva artesanal");
  });

  it("marca citada inexistente: gera mesmo assim, sem a camada secundaria (nunca derruba a geracao por isso)", async () => {
    const clienteId = await criarCliente();
    const roteiro = await gerarRoteiro(clienteId, {
      origem: "momento",
      momento: { ...MOMENTO_1, marcaId: 999999 },
      objetivo: "engajamento",
    });

    expect(roteiro.origem).toBe("momento");
    const [geracao] = await db().select().from(geracoesIA).where(eq(geracoesIA.id, roteiro.geracaoId!));
    const entrada = (geracao.entradas as { entrada: string }).entrada;
    expect(entrada).not.toContain("Marca citada por quem está gravando");
  });

  it("reprovar e reescrever um roteiro de momento continua sem busca de evidencia, e herda o mesmo momento", async () => {
    const clienteId = await criarCliente();
    const v1 = await gerarRoteiro(clienteId, { origem: "momento", momento: MOMENTO_1, objetivo: "engajamento" });
    evidenciaParaRoteiroMock.mockClear();
    evidenciaPorIdsMock.mockClear();

    const v2 = await reprovarERescrever(v1.id, ["gancho_fraco"], "comeca fraco");

    expect(evidenciaParaRoteiroMock).not.toHaveBeenCalled();
    expect(v2.origem).toBe("momento");
    expect(v2.momento).toEqual(MOMENTO_1);
    expect(v2.conteudo.semEvidencia).toBe(true);
  });

  /**
   * Isolamento (item 4, "id de marca de que não é membro é recusado"): o
   * mecanismo de verdade que a Server Action usa antes de chamar
   * `gerarRoteiro` (`garantirMembroDaMarca`, já testado a fundo em
   * `isolamento.test.ts`); aqui, no contexto especifico do momento, para a
   * definicao de pronto da V9a.
   */
  it("garantirMembroDaMarca recusa uma marca de que a pessoa nao e membro, antes de qualquer geracao", async () => {
    const { garantirMembroDaMarca, ErroAcessoNegado } = await import("@/servicos/clientes");
    contadorUsuario += 1;
    const usuarioIdA = `roteiro-teste-isolamento-momento-a-${contadorUsuario}`;
    const usuarioIdB = `roteiro-teste-isolamento-momento-b-${contadorUsuario}`;
    await db()
      .insert(user)
      .values([
        { id: usuarioIdA, name: "[teste] a", email: `${usuarioIdA}@roteiro.teste` },
        { id: usuarioIdB, name: "[teste] b", email: `${usuarioIdB}@roteiro.teste` },
      ]);
    const [marcaDeB] = await db().insert(clientes).values({ usuarioId: usuarioIdB, nome: "[teste] marca de b", nichoId }).returning();
    await db().insert(membrosMarca).values({ usuarioId: usuarioIdB, clienteId: marcaDeB.id, papel: "dono" });

    await expect(garantirMembroDaMarca(usuarioIdA, marcaDeB.id)).rejects.toThrow(ErroAcessoNegado);
  });
});

describe("marcarGravado e marcarPostado", () => {
  it("marcarGravado muda o status para gravado", async () => {
    const clienteId = await criarCliente();
    await criarVideoEvidencia("ev-4", "antes e depois da limpeza do sofa");

    const roteiro = await gerarRoteiro(clienteId, {
      origem: "livre",
      textoTema: "antes e depois da limpeza do sofa",
      objetivo: "alcance",
    });

    const atualizado = await marcarGravado(roteiro.id);
    expect(atualizado.status).toBe("gravado");
  });

  it("marcarPostado cria o video do cliente, infere a plataforma pelo dominio, e muda o status", async () => {
    const clienteId = await criarCliente();
    await criarVideoEvidencia("ev-5", "estofado limpo em uma tarde");

    const roteiro = await gerarRoteiro(clienteId, {
      origem: "livre",
      textoTema: "estofado limpo em uma tarde",
      objetivo: "alcance",
    });

    const atualizado = await marcarPostado(
      roteiro.id,
      "https://www.tiktok.com/@sofalimpo/video/1234567890",
    );

    expect(atualizado.status).toBe("postado");
    expect(atualizado.urlPostado).toBe("https://www.tiktok.com/@sofalimpo/video/1234567890");
    expect(atualizado.postadoEm).not.toBeNull();

    const [videoCliente] = await db()
      .select()
      .from(videosCliente)
      .where(eq(videosCliente.roteiroId, roteiro.id));
    expect(videoCliente.clienteId).toBe(clienteId);
    expect(videoCliente.plataforma).toBe("tiktok");
    expect(videoCliente.idExterno).toBe("1234567890");
  });
});

const CONTEUDO_ROTEIRO_MINIMO = {
  titulo: "titulo",
  duracaoS: 40,
  gancho: "gancho",
  corpo: "corpo",
  fechamento: "fechamento",
  chamadaFinal: "chamada final",
  cenas: [],
  ondeGravar: "no local do negocio",
  edicao: { textoNaTela: [], ritmoDeCorte: "moderado", recursos: [], audio: null, referencia: null },
  evidencias: [],
  semEvidencia: false,
  forcaEvidencia: null,
};

/** Insercao direta, sem passar por `gerarRoteiro` (mais rapido; `roteirosDeHoje` so le a tabela). */
async function inserirRoteiroDireto(
  clienteId: number,
  opcoes: { data: string; origem?: "sugerido" | "momento"; versaoDe?: number },
) {
  const [roteiro] = await db()
    .insert(roteiros)
    .values({
      clienteId,
      data: opcoes.data,
      tema: `tema de ${opcoes.data}`,
      origem: opcoes.origem ?? "sugerido",
      objetivo: "alcance",
      conteudo: CONTEUDO_ROTEIRO_MINIMO,
      versaoDe: opcoes.versaoDe,
    })
    .returning();
  return roteiro;
}

describe("roteirosDeHoje (V9b-0, plano sem_limite)", () => {
  it("traz todos os roteiros de hoje, mais recente primeiro", async () => {
    const clienteId = await criarCliente();
    const primeiro = await inserirRoteiroDireto(clienteId, { data: hojeISO() });
    const segundo = await inserirRoteiroDireto(clienteId, { data: hojeISO() });

    const lista = await roteirosDeHoje(clienteId);

    expect(lista.map((r) => r.id)).toEqual([segundo.id, primeiro.id]);
  });

  it("nunca traz roteiro de outro dia, mesmo sendo o mais recente", async () => {
    const clienteId = await criarCliente();
    await inserirRoteiroDireto(clienteId, { data: "2026-01-01" });
    const deHoje = await inserirRoteiroDireto(clienteId, { data: hojeISO() });

    const lista = await roteirosDeHoje(clienteId);

    expect(lista.map((r) => r.id)).toEqual([deHoje.id]);
  });

  it("so traz a versao mais nova de cada serie (outro angulo nao duplica cartao)", async () => {
    const clienteId = await criarCliente();
    const v1 = await inserirRoteiroDireto(clienteId, { data: hojeISO() });
    const v2 = await inserirRoteiroDireto(clienteId, { data: hojeISO(), versaoDe: v1.id });

    const lista = await roteirosDeHoje(clienteId);

    expect(lista.map((r) => r.id)).toEqual([v2.id]);
  });

  it("isolado por cliente: o roteiro de hoje de outro cliente nunca aparece", async () => {
    const clienteA = await criarCliente();
    const clienteB = await criarCliente();
    const deA = await inserirRoteiroDireto(clienteA, { data: hojeISO() });
    await inserirRoteiroDireto(clienteB, { data: hojeISO() });

    const lista = await roteirosDeHoje(clienteA);

    expect(lista.map((r) => r.id)).toEqual([deA.id]);
  });

  it("sem nenhum roteiro hoje, devolve lista vazia", async () => {
    const clienteId = await criarCliente();

    const lista = await roteirosDeHoje(clienteId);

    expect(lista).toEqual([]);
  });

  it("roteiro de origem momento entra na lista junto com os de tema sugerido", async () => {
    const clienteId = await criarCliente();
    const doTema = await inserirRoteiroDireto(clienteId, { data: hojeISO(), origem: "sugerido" });
    const doMomento = await inserirRoteiroDireto(clienteId, { data: hojeISO(), origem: "momento" });

    const lista = await roteirosDeHoje(clienteId);

    expect(lista.map((r) => r.origem).sort()).toEqual(["momento", "sugerido"]);
    expect(lista.map((r) => r.id).sort()).toEqual([doMomento.id, doTema.id].sort());
  });
});
