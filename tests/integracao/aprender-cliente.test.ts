/**
 * Job `aprender-cliente` (E27, parte 2, item 2): ciclo completo contra o
 * Postgres real, em mock (`AI_PROVIDER=mock`, `vitest.config.mts`). Usa
 * `gerarRoteiro` e `reprovarERescrever` de verdade para produzir reprovacoes
 * reais (mesmo padrao de `roteiro.test.ts`), depois roda o job e confere a
 * consolidacao (contagem, regra desativada nunca volta) e o isolamento entre
 * clientes (item 6: "circula padrao, nunca conteudo").
 */
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { IdMotivoReprovacao } from "@/config/motivos-reprovacao";
import { db, getPool } from "@/db";
import {
  aprendizadoCliente,
  briefings,
  clientes,
  modelosNicho,
  nichos,
  roteiros,
  user,
  videos,
  type ModeloNicho,
  type PerfilCompilado,
} from "@/db/schema";
import { rodarAprenderCliente } from "@/jobs/aprender-cliente";
import { ErroColeta } from "@/jobs/execucoes";
import { desativarRegra, regrasAtivasDoCliente } from "@/servicos/aprendizado";
import { gerarRoteiro, reprovarERescrever } from "@/servicos/roteiro";

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
  const usuarioId = `aprender-cliente-teste-${contadorUsuario}`;
  await db()
    .insert(user)
    .values({
      id: usuarioId,
      name: `[teste] cliente ${contadorUsuario}`,
      email: `${usuarioId}@aprender.teste`,
    });

  const [cliente] = await db()
    .insert(clientes)
    .values({ usuarioId, nome: `[teste] cliente ${contadorUsuario}`, nichoId })
    .returning();

  await db().insert(briefings).values({ clienteId: cliente.id, completo: true, perfil: PERFIL_PADRAO });
  return cliente.id;
}

async function criarVideoEvidencia(idExterno: string, assunto: string): Promise<void> {
  await db()
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
    });
}

/** Gera um roteiro e reprova na hora, com o(s) motivo(s) dados; devolve o roteiro reprovado. */
async function gerarEReprovar(clienteId: number, tema: string, motivos: IdMotivoReprovacao[]) {
  await criarVideoEvidencia(`ev-${tema}`, tema);
  const roteiro = await gerarRoteiro(clienteId, { origem: "livre", textoTema: tema, objetivo: "engajamento" });
  await reprovarERescrever(roteiro.id, motivos);
  return roteiro;
}

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db()
    .insert(nichos)
    .values({ slug: "aprender-cliente-teste", nome: "Aprender cliente teste", termos: [] })
    .returning();
  nichoId = nicho.id;
  await db().insert(modelosNicho).values({ nichoId, semana: "2026-08-31", modelo: MODELO_PADRAO });
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

afterEach(async () => {
  await db().delete(roteiros);
  await db().delete(videos).where(eq(videos.nichoId, nichoId));
});

describe("rodarAprenderCliente", () => {
  it("sem reprovacao nenhuma nos ultimos 90 dias: erro nao retentavel, nao cria regra", async () => {
    const clienteId = await criarCliente();

    await expect(rodarAprenderCliente(clienteId)).rejects.toThrow(ErroColeta);
    try {
      await rodarAprenderCliente(clienteId);
    } catch (erro) {
      expect(erro).toBeInstanceOf(ErroColeta);
      expect((erro as InstanceType<typeof ErroColeta>).retentavel).toBe(false);
    }

    const regras = await regrasAtivasDoCliente(clienteId);
    expect(regras).toEqual([]);
  });

  it("uma reprovacao com motivo estruturado vira uma regra com contagem 1; a segunda reprovacao com o mesmo motivo soma para contagem 2", async () => {
    const clienteId = await criarCliente();

    await gerarEReprovar(clienteId, "mancha de vinho no estofado", ["gancho_fraco"]);

    const primeiraRodada = await rodarAprenderCliente(clienteId);
    expect(primeiraRodada).toMatchObject({ reprovacoesConsideradas: 1, regrasNovas: 1, regrasMantidas: 0 });

    const regrasApos1 = await db().select().from(aprendizadoCliente).where(eq(aprendizadoCliente.clienteId, clienteId));
    expect(regrasApos1).toHaveLength(1);
    expect(regrasApos1[0].motivoOrigem).toBe("gancho_fraco");
    expect(regrasApos1[0].contagem).toBe(1);
    expect(regrasApos1[0].ativa).toBe(true);
    const idOriginal = regrasApos1[0].id;
    const primeiraEmOriginal = regrasApos1[0].primeiraEm.getTime();

    // segunda reprovacao, mesmo motivo, tema diferente (nao repete gancho recente).
    await gerarEReprovar(clienteId, "cheiro de bicho de estimacao no sofa", ["gancho_fraco"]);

    const segundaRodada = await rodarAprenderCliente(clienteId);
    expect(segundaRodada).toMatchObject({ reprovacoesConsideradas: 2, regrasNovas: 0, regrasMantidas: 1 });

    const regrasApos2 = await db().select().from(aprendizadoCliente).where(eq(aprendizadoCliente.clienteId, clienteId));
    expect(regrasApos2).toHaveLength(1);
    expect(regrasApos2[0].id).toBe(idOriginal);
    expect(regrasApos2[0].contagem).toBe(2);
    expect(regrasApos2[0].primeiraEm.getTime()).toBe(primeiraEmOriginal);

    const ativas = await regrasAtivasDoCliente(clienteId);
    expect(ativas).toEqual([{ regra: regrasApos2[0].regra, contagem: 2 }]);
  });

  it("uma regra desativada pelo cliente nunca volta, mesmo que a reprovacao que a gerou continue valendo", async () => {
    const clienteId = await criarCliente();
    await gerarEReprovar(clienteId, "erro comum ao limpar estofado", ["ja_falei_disso"]);
    await rodarAprenderCliente(clienteId);

    const [regra] = await db().select().from(aprendizadoCliente).where(eq(aprendizadoCliente.clienteId, clienteId));
    await desativarRegra(clienteId, regra.id);

    const resumo = await rodarAprenderCliente(clienteId);
    expect(resumo.regrasDesativadasIgnoradas).toBeGreaterThan(0);

    const linhas = await db().select().from(aprendizadoCliente).where(eq(aprendizadoCliente.clienteId, clienteId));
    expect(linhas).toHaveLength(1);
    expect(linhas[0].id).toBe(regra.id);
    expect(linhas[0].ativa).toBe(false);

    const ativas = await regrasAtivasDoCliente(clienteId);
    expect(ativas).toEqual([]);
  });

  it("uma regra ativa que nao aparece mais na proposta do modelo e removida (conjunto substituido, nao acumulado)", async () => {
    const clienteId = await criarCliente();
    await gerarEReprovar(clienteId, "tema que so aparece uma vez", ["nao_e_o_meu_cliente"]);
    await rodarAprenderCliente(clienteId);

    const antes = await db().select().from(aprendizadoCliente).where(eq(aprendizadoCliente.clienteId, clienteId));
    expect(antes).toHaveLength(1);

    // apaga a reprovacao que sustentava a regra: a proxima rodada nao tem motivo nenhum
    // sobrando para propor de novo, entao a regra ativa antiga deve sumir.
    await db().delete(roteiros).where(eq(roteiros.clienteId, clienteId));
    await gerarEReprovar(clienteId, "outro tema, outro motivo", ["muito_longo"]);

    const resumo = await rodarAprenderCliente(clienteId);
    expect(resumo.regrasRemovidas).toBe(1);

    const depois = await db().select().from(aprendizadoCliente).where(eq(aprendizadoCliente.clienteId, clienteId));
    expect(depois).toHaveLength(1);
    expect(depois[0].motivoOrigem).toBe("muito_longo");
  });

  it("nunca mistura cliente: reprovacao e regra de um cliente nunca aparecem para o outro (item 6, circula padrao, nunca conteudo)", async () => {
    const clienteA = await criarCliente();
    const clienteB = await criarCliente();

    await gerarEReprovar(clienteA, "mancha de vinho no estofado do cliente a", ["gancho_fraco"]);
    await gerarEReprovar(clienteB, "cheiro de bicho de estimacao do cliente b", ["nao_e_assim_que_eu_falo"]);

    await rodarAprenderCliente(clienteA);
    await rodarAprenderCliente(clienteB);

    const regrasA = await regrasAtivasDoCliente(clienteA);
    const regrasB = await regrasAtivasDoCliente(clienteB);

    expect(regrasA).toHaveLength(1);
    expect(regrasB).toHaveLength(1);

    const linhasA = await db().select().from(aprendizadoCliente).where(eq(aprendizadoCliente.clienteId, clienteA));
    const linhasB = await db().select().from(aprendizadoCliente).where(eq(aprendizadoCliente.clienteId, clienteB));

    expect(linhasA).toHaveLength(1);
    expect(linhasA[0].motivoOrigem).toBe("gancho_fraco");
    expect(linhasB).toHaveLength(1);
    expect(linhasB[0].motivoOrigem).toBe("nao_e_assim_que_eu_falo");

    // rodar o job do cliente A de novo nao mexe em nada do cliente B.
    await gerarEReprovar(clienteA, "outro tema do cliente a", ["gancho_fraco"]);
    await rodarAprenderCliente(clienteA);

    const linhasBDepois = await db().select().from(aprendizadoCliente).where(eq(aprendizadoCliente.clienteId, clienteB));
    expect(linhasBDepois).toEqual(linhasB);
  });
});
