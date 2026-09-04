/**
 * `gerarRoteiro`, `outroAngulo` e `marcarPostado` (etapa 11): ciclo
 * completo contra o Postgres real, em mock (`AI_PROVIDER=mock`,
 * `vitest.config.mts`).
 */
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import {
  briefings,
  clientes,
  modelosNicho,
  nichos,
  roteiros,
  user,
  videos,
  videosCliente,
  type ModeloNicho,
  type PerfilCompilado,
} from "@/db/schema";
import { ErroIA } from "@/ia/erro";
import { ErroRoteiro, gerarRoteiro, marcarGravado, marcarPostado, outroAngulo } from "@/servicos/roteiro";

import { resetarSchema } from "../../scripts/resetar-schema";

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
};

const MODELO_PADRAO: ModeloNicho = {
  resumo: "videos curtos mostrando o produto agindo",
  ganchos: [{ tipo: "mostrar o produto agindo", exemplo: "olha essa mancha saindo", frequencia: "alta" }],
  duracaoTipicaS: { min: 20, max: 30 },
  estruturas: ["gancho, demonstracao, fechamento"],
  fechamentos: ["mostra o resultado sem falar nada"],
  chamadasFinais: ["comenta se voce ja passou por isso"],
  formatos: [{ formato: "fala_para_camera", participacao: "60%" }],
  edicao: { textoNaTela: "curto, no topo", ritmoDeCorte: "moderado", recursos: ["zoom na mancha"], audio: null },
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
    .values({ id: usuarioId, name: `[teste] cliente ${contadorUsuario}`, email: `${usuarioId}@roteiro.teste` });

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

  await db().insert(briefings).values({ clienteId: cliente.id, completo: true, perfil: PERFIL_PADRAO });

  return cliente.id;
}

async function criarVideoEvidencia(idExterno: string, assunto: string): Promise<number> {
  const [video] = await db()
    .insert(videos)
    .values({
      plataforma: "youtube",
      idExterno,
      url: `https://exemplo.invalido/${idExterno}`,
      nichoId,
      titulo: assunto,
      foraDaCurva: "6",
      publicadoEm: new Date(),
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
    await db().insert(user).values({ id: usuarioId, name: "sem briefing", email: `${usuarioId}@roteiro.teste` });
    const [cliente] = await db().insert(clientes).values({ usuarioId, nome: "sem briefing", nichoId }).returning();

    await expect(
      gerarRoteiro(cliente.id, { origem: "livre", textoTema: "qualquer assunto", objetivo: "alcance" }),
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

describe("outroAngulo", () => {
  it("cria a versao 2 na mesma serie, mantendo a versao 1 acessivel", async () => {
    const clienteId = await criarCliente();
    await criarVideoEvidencia("ev-3", "erro comum ao limpar estofado");

    const v1 = await gerarRoteiro(clienteId, {
      origem: "livre",
      textoTema: "erro comum ao limpar estofado",
      objetivo: "engajamento",
    });

    const v2 = await outroAngulo(v1.id, "mais curto");

    expect(v2.versao).toBe(2);
    expect(v2.versaoDe).toBe(v1.id);
    expect(v2.clienteId).toBe(clienteId);
    expect(v2.tema).toBe(v1.tema);

    const [v1Recarregado] = await db().select().from(roteiros).where(eq(roteiros.id, v1.id));
    expect(v1Recarregado.versao).toBe(1);
    expect(v1Recarregado.conteudo).toBeTruthy();
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

    const atualizado = await marcarPostado(roteiro.id, "https://www.tiktok.com/@sofalimpo/video/1234567890");

    expect(atualizado.status).toBe("postado");
    expect(atualizado.urlPostado).toBe("https://www.tiktok.com/@sofalimpo/video/1234567890");
    expect(atualizado.postadoEm).not.toBeNull();

    const [videoCliente] = await db().select().from(videosCliente).where(eq(videosCliente.roteiroId, roteiro.id));
    expect(videoCliente.clienteId).toBe(clienteId);
    expect(videoCliente.plataforma).toBe("tiktok");
    expect(videoCliente.idExterno).toBe("1234567890");
  });
});
