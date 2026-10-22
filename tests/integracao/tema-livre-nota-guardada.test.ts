/**
 * Hotfix de 22/10/2026, itens 3 e 4 (achados do Gustavo usando em produção).
 *
 * Item 3: o rascunho do Tema livre guarda também a NOTA dos cinco pilares, junto da marca do texto avaliado. Voltar com o mesmo texto não chama a IA (cada avaliação é paga: contam-se as
 * gerações de `avaliarTema`); mudar o texto apaga a nota e pede uma nova; o tema preso a uma notícia, a um assunto em alta ou a uma pergunta nunca é guardado.
 *
 * Item 4: a avaliação de um tema não reprova mais por a terceira pessoa ("ela vende", que era de OUTRA pessoa do tema) nem por CITAR uma proibição ou o risco do tema ao comentá-lo, e a falha
 * da IA chega como resultado com frase calma, nunca como exceção que deixa a tela girando. O simulador força cada caso (`[mock:terceira-pessoa]`, `[mock:cita-proibicao]`, `[mock:erro-sobrecarga]`).
 */
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/sessao", () => ({ sessaoAtual: vi.fn() }));

import { db, getPool } from "@/db";
import { briefings, clientes, geracoesIA, membrosMarca, nichos, rascunhosTemaLivre, user, type PerfilCompilado } from "@/db/schema";
import { verificarLocalmente } from "@/ia/verificador";
import { sessaoAtual } from "@/lib/sessao";
import { limparNotaDoRascunhoSeForDoTexto, marcaDoTexto, notaGuardadaDoTexto, rascunhoComNotaTemaLivre, VALIDADE_DA_NOTA_GUARDADA_MS } from "@/servicos/temas";

import { resetarSchema } from "../../scripts/resetar-schema";
import { avaliarTemaAction, descartarTemaLivreAction, salvarRascunhoAction } from "../../src/app/(painel)/(completo)/criar/tema-livre/acoes";

function perfil(proibicoes: string[]): PerfilCompilado {
  return {
    fatos: { oQueVende: "lavagem de estofados", preco: "sofa de 3 lugares por R$ 180", clienteIdeal: "mora em apartamento", medos: [], frasesDaFala: [], proibicoes, cenasFilmaveis: [], concorrentes: [], perfisAdmirados: [] },
    resumo: "lava estofados em domicilio",
    referencias: [],
  };
}

let marca: { id: number };

function sessaoDe(usuarioId: string) {
  return { user: { id: usuarioId, role: "cliente" } } as never;
}

async function quantasAvaliacoes(): Promise<number> {
  const linhas = await db()
    .select({ id: geracoesIA.id })
    .from(geracoesIA)
    .where(and(eq(geracoesIA.tarefa, "avaliarTema"), eq(geracoesIA.clienteId, marca.id)));
  return linhas.length;
}

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db().insert(nichos).values({ slug: "nota-guardada-teste", nome: "Nota guardada teste", termos: [] }).returning();
  await db().insert(user).values({ id: "nota-guardada-dono", name: "[teste] Dono", email: "dono@nota-guardada.teste" });
  const [m] = await db().insert(clientes).values({ usuarioId: "nota-guardada-dono", nome: "[teste] Marca", nichoId: nicho.id }).returning();
  marca = { id: m.id };
  await db().insert(briefings).values({ clienteId: m.id, completo: true, perfil: perfil(["política"]) });
  await db().insert(membrosMarca).values({ usuarioId: "nota-guardada-dono", clienteId: m.id, papel: "dono" });
  vi.mocked(sessaoAtual).mockResolvedValue(sessaoDe("nota-guardada-dono"));
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

describe("a nota do tema fica guardada com o rascunho (item 3)", () => {
  it("voltar com o mesmo texto NÃO chama a IA: a segunda avaliação devolve a nota guardada e nenhuma geração nova nasce", async () => {
    const texto = "como tirar mancha de café do sofá";
    await salvarRascunhoAction(texto);
    const antes = await quantasAvaliacoes();

    const primeira = await avaliarTemaAction(texto);
    expect(primeira.ok).toBe(true);
    expect(await quantasAvaliacoes()).toBe(antes + 1);

    // O mesmo texto, com outra caixa e espaço sobrando (a marca é do texto normalizado): a nota guardada, sem IA.
    const segunda = await avaliarTemaAction("  Como tirar mancha de café   do sofá ");
    expect(segunda.ok).toBe(true);
    expect(await quantasAvaliacoes()).toBe(antes + 1);
    if (primeira.ok && segunda.ok) expect(segunda.dado.nota).toBe(primeira.dado.nota);

    // E a tela, ao abrir de novo, lê a nota do rascunho.
    const rascunho = await rascunhoComNotaTemaLivre("nota-guardada-dono", marca.id);
    expect(rascunho?.texto).toBe(texto);
    expect(rascunho?.nota?.nota).toBe(primeira.ok ? primeira.dado.nota : -1);
  });

  it("o salvamento automático do MESMO texto (digitar e apagar, outra caixa) mantém a nota; mudar uma palavra apaga a nota e a avaliação seguinte chama a IA", async () => {
    const texto = "dica de limpeza de colchão";
    await salvarRascunhoAction(texto);
    await avaliarTemaAction(texto);
    const depoisDaPrimeira = await quantasAvaliacoes();
    expect((await rascunhoComNotaTemaLivre("nota-guardada-dono", marca.id))?.nota).not.toBeNull();

    await salvarRascunhoAction("Dica de limpeza de colchão  ");
    expect((await rascunhoComNotaTemaLivre("nota-guardada-dono", marca.id))?.nota).not.toBeNull();

    await salvarRascunhoAction("dica de limpeza de colchão de casal");
    const mudou = await rascunhoComNotaTemaLivre("nota-guardada-dono", marca.id);
    expect(mudou?.texto).toBe("dica de limpeza de colchão de casal");
    expect(mudou?.nota).toBeNull();
    expect(await notaGuardadaDoTexto("nota-guardada-dono", marca.id, "dica de limpeza de colchão de casal")).toBeNull();

    const nova = await avaliarTemaAction("dica de limpeza de colchão de casal");
    expect(nova.ok).toBe(true);
    expect(await quantasAvaliacoes()).toBe(depoisDaPrimeira + 1);
  });

  it("a nota velha (mais de 72 horas) não vale: pede para avaliar de novo", async () => {
    const texto = "o erro de quem lava tapete";
    await salvarRascunhoAction(texto);
    await avaliarTemaAction(texto);
    const hoje = new Date();
    expect((await rascunhoComNotaTemaLivre("nota-guardada-dono", marca.id, hoje))?.nota).not.toBeNull();
    const muitoDepois = new Date(hoje.getTime() + VALIDADE_DA_NOTA_GUARDADA_MS + 60_000);
    expect((await rascunhoComNotaTemaLivre("nota-guardada-dono", marca.id, muitoDepois))?.nota).toBeNull();
    expect(await notaGuardadaDoTexto("nota-guardada-dono", marca.id, texto, muitoDepois)).toBeNull();
  });

  it("o tema preso a um assunto em alta é avaliado com esse contexto e a nota dele nunca é guardada nem reaproveitada pelo texto sozinho", async () => {
    await descartarTemaLivreAction();
    const texto = "meu jeito de falar do assunto do momento";
    await salvarRascunhoAction(texto);
    const antes = await quantasAvaliacoes();
    const preso = await avaliarTemaAction(texto, undefined, "chave-de-um-assunto");
    expect(preso.ok).toBe(true);
    expect(await quantasAvaliacoes()).toBe(antes + 1);
    expect((await rascunhoComNotaTemaLivre("nota-guardada-dono", marca.id))?.nota).toBeNull();
    // Sem o contexto, é outra avaliação: a anterior não foi guardada.
    await avaliarTemaAction(texto);
    expect(await quantasAvaliacoes()).toBe(antes + 2);
  });

  it("duas avaliações do mesmo texto ao mesmo tempo (toque repetido, página recarregada) pagam uma só", async () => {
    await descartarTemaLivreAction();
    const texto = "o que eu faria no lugar do concorrente";
    const antes = await quantasAvaliacoes();
    const [a, b, c] = await Promise.all([avaliarTemaAction(texto), avaliarTemaAction(texto), avaliarTemaAction(texto)]);
    expect(a.ok && b.ok && c.ok).toBe(true);
    expect(await quantasAvaliacoes()).toBe(antes + 1);
  });

  it("'Descartar' apaga o rascunho com a nota; usar o texto num roteiro apaga só a nota (o texto fica)", async () => {
    const texto = "mais um assunto para descartar";
    await salvarRascunhoAction(texto);
    await avaliarTemaAction(texto);
    expect((await rascunhoComNotaTemaLivre("nota-guardada-dono", marca.id))?.nota).not.toBeNull();

    await limparNotaDoRascunhoSeForDoTexto("nota-guardada-dono", marca.id, "outro texto qualquer");
    expect((await rascunhoComNotaTemaLivre("nota-guardada-dono", marca.id))?.nota).not.toBeNull();
    await limparNotaDoRascunhoSeForDoTexto("nota-guardada-dono", marca.id, texto);
    const semNota = await rascunhoComNotaTemaLivre("nota-guardada-dono", marca.id);
    expect(semNota?.texto).toBe(texto);
    expect(semNota?.nota).toBeNull();

    await avaliarTemaAction(texto);
    await descartarTemaLivreAction();
    expect(await rascunhoComNotaTemaLivre("nota-guardada-dono", marca.id)).toBeNull();
    const linhas = await db().select({ id: rascunhosTemaLivre.id }).from(rascunhosTemaLivre).where(eq(rascunhosTemaLivre.clienteId, marca.id));
    expect(linhas).toHaveLength(0);
  });

  it("a marca do texto ignora caixa, acento solto e espaço sobrando, mas não uma palavra a mais", () => {
    expect(marcaDoTexto("Como lavar o sofá")).toBe(marcaDoTexto("  como   lavar o sofa "));
    expect(marcaDoTexto("como lavar o sofá")).not.toBe(marcaDoTexto("como lavar o sofá hoje"));
  });
});

describe("a nota do tema não reprova à toa e a falha vira frase calma (item 4)", () => {
  it("'ela vende', de OUTRA pessoa do tema, passa: a avaliação é aprovada de primeira, sem segunda tentativa", async () => {
    await descartarTemaLivreAction();
    const antes = await quantasAvaliacoes();
    const r = await avaliarTemaAction("como a minha concorrente faz [mock:terceira-pessoa]");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.dado.recomendacao).toContain("ela vende");
    // Uma geração só: nada foi reprovado nem refeito.
    expect(await quantasAvaliacoes()).toBe(antes + 1);
    const [linha] = await db()
      .select({ motivo: geracoesIA.motivoAvaliacao })
      .from(geracoesIA)
      .where(and(eq(geracoesIA.tarefa, "avaliarTema"), eq(geracoesIA.clienteId, marca.id)))
      .orderBy(geracoesIA.id)
      .limit(1)
      .offset(antes);
    expect(linha?.motivo ?? null).toBeNull();
  });

  it("o tema da analogia de eleição, com a proibição de política no briefing, passa com o aviso em língua de gente (a proibição é preferência da pessoa, não bloqueio)", async () => {
    const antes = await quantasAvaliacoes();
    const r = await avaliarTemaAction("a disputa de voto como analogia para escolher a empresa de limpeza [mock:cita-proibicao]");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.dado.recomendacao).toContain("esbarra no que você disse no briefing");
      expect(r.dado.recomendacao).toContain("não cite candidato nem partido");
    }
    // Uma geração só: nada foi reprovado, nada foi refeito.
    expect(await quantasAvaliacoes()).toBe(antes + 1);
  });

  it("o mesmo texto, no roteiro (sem a licença), continua ferindo a proibição na conferência local", () => {
    const campos = { recomendacao: "Atenção: este tema esbarra no que você disse no briefing: não falar de política." };
    expect(verificarLocalmente(campos, { proibicoes: ["política"] }).aprovado).toBe(false);
    // A avaliação do tema não passa a proibição à conferência local (`citarProibicaoVale`): o sentido fica com o verificador por IA, gênero "tema".
    expect(verificarLocalmente(campos, { proibicoes: undefined }).aprovado).toBe(true);
  });

  it("a falha da IA chega como resultado com a frase calma (nunca uma exceção que deixa a tela girando)", async () => {
    const r = await avaliarTemaAction("um tema qualquer [mock:erro-sobrecarga]");
    expect(r).toEqual({ ok: false, erro: "Não conseguimos fazer isso agora. Tente de novo em um minuto." });
  });
});
