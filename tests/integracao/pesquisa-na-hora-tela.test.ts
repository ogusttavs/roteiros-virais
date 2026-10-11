/**
 * A pesquisa na hora do lado da tela (E54, parte 3), contra o Postgres real e com a busca simulada: o teto do dia com a "Mais a fundo" valendo duas, a pesquisa como a tela a lê
 * (dados com etiquetas, premissa só quando não bate, pergunta só quando falta), "Escrever com estes N" (marcar, decidir, posição, carimbo), a pesquisa que ficou para depois, e
 * "Pesquisar de novo". Nenhuma chamada paga.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { clientes, geracoesIA, pesquisasNaHora, user, type AchadoDaPesquisa, type DestinoDaPesquisa } from "@/db/schema";
import { config } from "@/lib/config";
import {
  achadosParaATela,
  confirmarPesquisa,
  criarPesquisa,
  dadosDoCampoDePesquisa,
  ErroPesquisa,
  executarPesquisa,
  lerPesquisa,
  pesquisaEmAberto,
  ErroDoTeto,
  pesquisarDeNovo,
  pesquisaParaATela,
  pesquisasDeHoje,
  registrarVistaDoFim,
} from "@/servicos/pesquisa-na-hora";

import { resetarSchema } from "../../scripts/resetar-schema";

let clienteId: number;
let outroClienteId: number;
const enfileirar = async () => {};
const PEDIDO = "dados de 2026 sobre o preço dos produtos de limpeza";
const DESTINO: DestinoDaPesquisa = { tipo: "objetivo", consulta: { livre: "o preço subiu", data: "2026-10-20" } };

function achado(id: number, extra: Partial<AchadoDaPesquisa> = {}): AchadoDaPesquisa {
  return {
    id,
    texto: `os produtos de limpeza subiram ${id}0% em 12 meses.`,
    fonteNome: id % 2 ? "IBGE" : "G1",
    fonteTipo: id % 2 ? "oficial" : "imprensa",
    url: `https://www.ibge.gov.br/${id}`,
    titulo: null,
    dataDaPagina: "2026-08-31",
    dataTexto: "August 31, 2026",
    antigo: false,
    citacao: `Trecho ${id}.`,
    ...extra,
  };
}

/** Uma pesquisa pronta de verdade (a busca simulada), com o destino que a tela guarda. */
async function pesquisaPronta(cliente = clienteId, destino: DestinoDaPesquisa | null = DESTINO) {
  const criada = await criarPesquisa(cliente, { pedido: PEDIDO, tema: "o preço subiu", destino }, { enfileirar });
  await executarPesquisa(criada.id);
  return criada.id;
}

beforeAll(async () => {
  await resetarSchema(db());
  await db().insert(user).values([
    { id: "pnt-a", name: "Marca A", email: "pnt-a@exemplo.teste" },
    { id: "pnt-b", name: "Marca B", email: "pnt-b@exemplo.teste" },
  ]);
  const [a] = await db().insert(clientes).values({ usuarioId: "pnt-a", nome: "Marca A" }).returning();
  const [b] = await db().insert(clientes).values({ usuarioId: "pnt-b", nome: "Marca B" }).returning();
  clienteId = a.id;
  outroClienteId = b.id;
}, 60_000);

beforeEach(async () => {
  await db().delete(geracoesIA);
  await db().delete(pesquisasNaHora);
});

afterAll(async () => {
  await getPool().end();
});

describe("o teto do dia com a pesquisa 'Mais a fundo' valendo duas", () => {
  it("uma a fundo e uma rápida cabem em 3; uma segunda a fundo depois de uma rápida não cabe", async () => {
    expect(config.regras.pesquisasNaHoraPorMarcaPorDia).toBe(3);
    await criarPesquisa(clienteId, { pedido: PEDIDO, profundidade: "aprofundada" }, { enfileirar });
    expect(await pesquisasDeHoje(clienteId)).toBe(2);
    await criarPesquisa(clienteId, { pedido: PEDIDO }, { enfileirar });
    expect(await pesquisasDeHoje(clienteId)).toBe(3);
    await expect(criarPesquisa(clienteId, { pedido: PEDIDO }, { enfileirar })).rejects.toThrow("Você já usou as 3 pesquisas de hoje");

    await db().delete(pesquisasNaHora);
    await criarPesquisa(clienteId, { pedido: PEDIDO }, { enfileirar });
    await expect(criarPesquisa(clienteId, { pedido: PEDIDO, profundidade: "aprofundada" }, { enfileirar })).resolves.toBeTruthy();
    await expect(criarPesquisa(clienteId, { pedido: PEDIDO, profundidade: "aprofundada" }, { enfileirar })).rejects.toThrow(ErroPesquisa);
  });

  it("com saldo que não cabe a 'Mais a fundo', a frase diz a verdade (sobra uma, a rápida cabe) e o erro marca que a rápida cabe", async () => {
    await criarPesquisa(clienteId, { pedido: PEDIDO, profundidade: "aprofundada" }, { enfileirar });
    const falha = await criarPesquisa(clienteId, { pedido: PEDIDO, profundidade: "aprofundada" }, { enfileirar }).catch((e) => e);
    expect(falha).toBeInstanceOf(ErroDoTeto);
    expect(falha.soCabeRapida).toBe(true);
    expect(falha.message).toBe('Hoje só sobra 1 pesquisa, e a "Mais a fundo" usa 2. A rápida cabe.');
    // e a rápida de fato cabe
    await expect(criarPesquisa(clienteId, { pedido: PEDIDO }, { enfileirar })).resolves.toBeTruthy();
    const cheio = await criarPesquisa(clienteId, { pedido: PEDIDO }, { enfileirar }).catch((e) => e);
    expect(cheio).toBeInstanceOf(ErroDoTeto);
    expect(cheio.soCabeRapida).toBe(false);
    expect(cheio.message).toBe("Você já usou as 3 pesquisas de hoje. Amanhã tem mais; hoje dá para escrever com o que a gente já sabe do seu setor.");
  });

  it("o campo diz o dia da marca e o custo de cada tamanho em língua de gente", async () => {
    await criarPesquisa(clienteId, { pedido: PEDIDO }, { enfileirar });
    const campo = await dadosDoCampoDePesquisa(clienteId);
    expect(campo.usadasHoje).toBe(1);
    expect(campo.teto).toBe(3);
    expect(campo.rapida).toMatch(/^uns R\$ 0,\d0$|^uns R\$ 0,\d5$/);
    expect(campo.aFundo).toMatch(/^uns R\$ \d,\d[05]$/);
    // a a fundo custa mais que a rápida
    const reais = (texto: string) => Number(texto.replace("uns R$ ", "").replace(",", "."));
    expect(reais(campo.aFundo)).toBeGreaterThan(reais(campo.rapida));
  });
});

describe("achadosParaATela", () => {
  it("tira o 'Do outro lado:' e marca a etiqueta, avisa o que não tem número, limpa o endereço e escolhe a data", () => {
    const lista = achadosParaATela(
      [
        achado(1, { texto: "Do outro lado: os fabricantes dizem que a alta veio do frete." }),
        achado(2, { texto: "O Procon orienta comparar o preço pelo litro.", dataDaPagina: null, dataTexto: "março de 2025", url: "http://127.0.0.1/x" }),
        achado(3, { antigo: true, dataDaPagina: "2024-01-10", dataTexto: null }),
        achado(4, { dataDaPagina: null, dataTexto: null }),
      ],
      [1, 3],
    );
    expect(lista[0]).toMatchObject({ dado: "Os fabricantes dizem que a alta veio do frete.", outroLado: true, semNumero: true, marcado: true });
    // o que a ferramenta devolveu e não deu para ler não vira "data"
    expect(lista[1]).toMatchObject({ semNumero: true, data: null, url: null, marcado: false });
    expect(lista[2]).toMatchObject({ antigo: true, data: "10 de janeiro de 2024", outroLado: false, semNumero: false, marcado: true });
    expect(lista[3].data).toBeNull();
  });

  it("a data que a ferramenta devolveu sem dar para ler nunca vira a data do dado ('2 days ago' não é uma data)", () => {
    const [a, b] = achadosParaATela([achado(1, { dataDaPagina: null, dataTexto: "2 days ago" }), achado(2, { dataDaPagina: null, dataTexto: "x".repeat(80) })], []);
    expect(a.data).toBeNull();
    expect(b.data).toBeNull();
  });
});

describe("pesquisaParaATela", () => {
  it("a que acabou de ser pedida é 'pesquisando', sem dado, com o dia e o destino", async () => {
    const criada = await criarPesquisa(clienteId, { pedido: PEDIDO, destino: DESTINO }, { enfileirar });
    const tela = (await pesquisaParaATela(clienteId, criada.id))!;
    expect(tela).toMatchObject({ status: "pesquisando", pedido: PEDIDO, achados: [], premissa: null, pergunta: null, usadasHoje: 1, tetoPorDia: 3, confirmada: false, destino: DESTINO });
  });

  it("'executando' (a que um worker pegou) também é 'pesquisando' para quem lê", async () => {
    const criada = await criarPesquisa(clienteId, { pedido: PEDIDO }, { enfileirar });
    await db().update(pesquisasNaHora).set({ status: "executando" }).where(eq(pesquisasNaHora.id, criada.id));
    expect((await pesquisaParaATela(clienteId, criada.id))!.status).toBe("pesquisando");
  });

  it("a pronta traz os dados marcados de início, a premissa só quando não bate e a pergunta só enquanto não foi respondida", async () => {
    const id = await pesquisaPronta();
    await db()
      .update(pesquisasNaHora)
      .set({
        premissa: { situacao: "nao_confere", aviso: "O que você escreveu não bate com as fontes: subiu 9,4%.", anguloSugerido: "Fale da alta.", achadoIds: [1] },
        perguntaDePosicao: { pergunta: "De quem é a culpa?", opcoes: ["Do fabricante", "Prefiro não dar opinião"] },
      })
      .where(eq(pesquisasNaHora.id, id));
    const tela = (await pesquisaParaATela(clienteId, id))!;
    expect(tela.status).toBe("pronta");
    expect(tela.achados.length).toBeGreaterThan(0);
    expect(tela.achados.some((a) => a.marcado)).toBe(true);
    expect(tela.premissa).toEqual({ aviso: "O que você escreveu não bate com as fontes: subiu 9,4%.", anguloSugerido: "Fale da alta." });
    expect(tela.pergunta).toEqual({ pergunta: "De quem é a culpa?", opcoes: ["Do fabricante", "Prefiro não dar opinião"] });
    expect(tela.fontes).toBeGreaterThan(0);

    await db().update(pesquisasNaHora).set({ posicaoDaPessoa: "Dos dois" }).where(eq(pesquisasNaHora.id, id));
    expect((await pesquisaParaATela(clienteId, id))!.pergunta).toBeNull();
  });

  it("a premissa que confere ou que não existia não vira aviso", async () => {
    const id = await pesquisaPronta();
    await db().update(pesquisasNaHora).set({ premissa: { situacao: "confere", aviso: null, anguloSugerido: null, achadoIds: [] } }).where(eq(pesquisasNaHora.id, id));
    expect((await pesquisaParaATela(clienteId, id))!.premissa).toBeNull();
    // mesmo que a linha traga um texto (o motor não deixa, a tela não confia): só "não confere" vira aviso
    await db()
      .update(pesquisasNaHora)
      .set({ premissa: { situacao: "confere", aviso: "O que você escreveu não bate com as fontes: x.", anguloSugerido: "y", achadoIds: [1] } })
      .where(eq(pesquisasNaHora.id, id));
    expect((await pesquisaParaATela(clienteId, id))!.premissa).toBeNull();
  });

  it("a de outra marca nunca vem", async () => {
    const id = await pesquisaPronta(outroClienteId);
    expect(await pesquisaParaATela(clienteId, id)).toBeNull();
    expect(await pesquisaParaATela(clienteId, 999_999)).toBeNull();
  });
});

describe("confirmarPesquisa", () => {
  it("guarda o que a pessoa marcou, carimba a confirmação e devolve o destino", async () => {
    const id = await pesquisaPronta();
    const antes = (await lerPesquisa(clienteId, id))!;
    const alvo = antes.achados.slice(0, 2).map((a) => a.id);
    const resultado = await confirmarPesquisa(clienteId, id, { ids: alvo });
    expect(resultado.destino).toEqual(DESTINO);
    const depois = (await lerPesquisa(clienteId, id))!;
    expect(depois.selecionados).toEqual(alvo);
    expect(depois.confirmadaEm).not.toBeNull();
  });

  it("é idempotente: confirmar de novo (a geração falhou e a pessoa tenta outra vez) funciona", async () => {
    const id = await pesquisaPronta();
    const ids = (await lerPesquisa(clienteId, id))!.achados.map((a) => a.id).slice(0, 1);
    await confirmarPesquisa(clienteId, id, { ids });
    await expect(confirmarPesquisa(clienteId, id, { ids })).resolves.toMatchObject({ destino: DESTINO });
  });

  it("a premissa que não bate guarda a decisão (sem escolha, as fontes), e a que a pessoa trouxe vale", async () => {
    const id = await pesquisaPronta();
    await db()
      .update(pesquisasNaHora)
      .set({ premissa: { situacao: "nao_confere", aviso: "O que você escreveu não bate com as fontes: x.", anguloSugerido: null, achadoIds: [1] } })
      .where(eq(pesquisasNaHora.id, id));
    const ids = (await lerPesquisa(clienteId, id))!.achados.map((a) => a.id).slice(0, 1);
    await confirmarPesquisa(clienteId, id, { ids });
    expect((await lerPesquisa(clienteId, id))!.decisaoDaPremissa).toBe("fontes");
    await confirmarPesquisa(clienteId, id, { ids, decisao: "manter" });
    expect((await lerPesquisa(clienteId, id))!.decisaoDaPremissa).toBe("manter");
  });

  it("com a pergunta de posição sem resposta, não segue; com a resposta, guarda", async () => {
    const id = await pesquisaPronta();
    await db()
      .update(pesquisasNaHora)
      .set({ perguntaDePosicao: { pergunta: "De quem é a culpa?", opcoes: ["Do fabricante", "Prefiro não dar opinião"] } })
      .where(eq(pesquisasNaHora.id, id));
    const ids = (await lerPesquisa(clienteId, id))!.achados.map((a) => a.id).slice(0, 1);
    await expect(confirmarPesquisa(clienteId, id, { ids })).rejects.toThrow("Diga qual é a sua posição");
    expect((await lerPesquisa(clienteId, id))!.confirmadaEm).toBeNull();
    await confirmarPesquisa(clienteId, id, { ids, posicao: "Prefiro não dar opinião" });
    expect((await lerPesquisa(clienteId, id))!.posicaoDaPessoa).toBe("Prefiro não dar opinião");
  });

  it("a pergunta de posição sem resposta não deixa os dados marcados pela metade: nada é gravado", async () => {
    const id = await pesquisaPronta();
    await db()
      .update(pesquisasNaHora)
      .set({
        selecionados: [1],
        premissa: { situacao: "nao_confere", aviso: "O que você escreveu não bate com as fontes: x.", anguloSugerido: null, achadoIds: [1] },
        perguntaDePosicao: { pergunta: "De quem é a culpa?", opcoes: ["Do fabricante", "Prefiro não dar opinião"] },
      })
      .where(eq(pesquisasNaHora.id, id));
    const ids = (await lerPesquisa(clienteId, id))!.achados.map((a) => a.id).slice(1, 3);
    await expect(confirmarPesquisa(clienteId, id, { ids, decisao: "manter" })).rejects.toThrow("Diga qual é a sua posição");
    const depois = (await lerPesquisa(clienteId, id))!;
    expect(depois.selecionados).toEqual([1]);
    expect(depois.decisaoDaPremissa).toBeNull();
    expect(depois.confirmadaEm).toBeNull();
  });

  it("recusa com a frase pronta: nenhum dado marcado, pesquisa que não está pronta, e a de outra marca", async () => {
    const id = await pesquisaPronta();
    await expect(confirmarPesquisa(clienteId, id, { ids: [] })).rejects.toThrow("Marque pelo menos um dado");
    await expect(confirmarPesquisa(clienteId, id, { ids: [9999] })).rejects.toThrow("Marque pelo menos um dado");

    const rodando = await criarPesquisa(clienteId, { pedido: PEDIDO }, { enfileirar });
    await expect(confirmarPesquisa(clienteId, rodando.id, { ids: [1] })).rejects.toThrow("não está pronta");

    await expect(confirmarPesquisa(outroClienteId, id, { ids: [1] })).rejects.toThrow("não está pronta");
  });
});

describe("pesquisaEmAberto (o 'Voltar depois' no Criar)", () => {
  it("a que está rodando e a que está pronta sem ser confirmada aparecem, a mais recente primeiro", async () => {
    const pronta = await pesquisaPronta();
    expect(await pesquisaEmAberto(clienteId)).toEqual({ id: pronta, pedido: PEDIDO, estado: "pronta" });
    const rodando = await criarPesquisa(clienteId, { pedido: `${PEDIDO} outra`, destino: DESTINO }, { enfileirar });
    expect(await pesquisaEmAberto(clienteId)).toMatchObject({ id: rodando.id, estado: "pesquisando" });
  });

  it("some depois de confirmada, e a de outra marca nunca aparece", async () => {
    const id = await pesquisaPronta();
    const ids = (await lerPesquisa(clienteId, id))!.achados.map((a) => a.id).slice(0, 1);
    await confirmarPesquisa(clienteId, id, { ids });
    expect(await pesquisaEmAberto(clienteId)).toBeNull();
    await pesquisaPronta(outroClienteId);
    expect(await pesquisaEmAberto(clienteId)).toBeNull();
  });

  it("sem destino (as do motor) ou de mais de 3 horas não aparece", async () => {
    await pesquisaPronta(clienteId, null);
    expect(await pesquisaEmAberto(clienteId)).toBeNull();

    const antiga = await pesquisaPronta();
    await db().update(pesquisasNaHora).set({ criadoEm: new Date(Date.now() - 4 * 3_600_000) }).where(eq(pesquisasNaHora.id, antiga));
    expect(await pesquisaEmAberto(clienteId)).toBeNull();
  });

  it("a que terminou sem dado ou em erro e que a pessoa não viu (saiu com 'Voltar depois') aparece, e some quando ela a vê", async () => {
    const id = await pesquisaPronta();
    await db().update(pesquisasNaHora).set({ status: "sem_achados", achados: [], selecionados: [] }).where(eq(pesquisasNaHora.id, id));
    expect(await pesquisaEmAberto(clienteId)).toEqual({ id, pedido: PEDIDO, estado: "sem_achados" });
    await db().update(pesquisasNaHora).set({ status: "erro" }).where(eq(pesquisasNaHora.id, id));
    expect(await pesquisaEmAberto(clienteId)).toMatchObject({ id, estado: "erro" });

    await registrarVistaDoFim(clienteId, id);
    expect(await pesquisaEmAberto(clienteId)).toBeNull();
  });

  it("registrarVistaDoFim só mexe na da própria marca e só nas que terminaram sem dado ou em erro", async () => {
    const pronta = await pesquisaPronta();
    await registrarVistaDoFim(clienteId, pronta);
    expect((await lerPesquisa(clienteId, pronta))!.confirmadaEm).toBeNull();

    const deOutra = await pesquisaPronta(outroClienteId);
    await db().update(pesquisasNaHora).set({ status: "erro" }).where(eq(pesquisasNaHora.id, deOutra));
    await registrarVistaDoFim(clienteId, deOutra);
    expect((await lerPesquisa(outroClienteId, deOutra))!.confirmadaEm).toBeNull();
  });
});

describe("pesquisarDeNovo", () => {
  it("cria outra com o mesmo pedido, assunto, tamanho e destino, e ela conta no teto como qualquer outra", async () => {
    const original = await criarPesquisa(clienteId, { pedido: PEDIDO, tema: "o preço subiu", profundidade: "aprofundada", destino: DESTINO }, { enfileirar });
    // "Tentar de novo": a que deu erro sem ter feito busca não custou nada e não conta (uma a fundo a mais não caberia no teto).
    await db().update(pesquisasNaHora).set({ status: "erro" }).where(eq(pesquisasNaHora.id, original.id));
    const nova = await pesquisarDeNovo(clienteId, original.id, { enfileirar });
    expect(nova.id).not.toBe(original.id);
    expect(nova).toMatchObject({ pedido: PEDIDO, tema: "o preço subiu", profundidade: "aprofundada", destino: DESTINO, status: "pesquisando" });
  });

  it("a pessoa pode pedir a rápida no lugar da a fundo (quando só ela cabe)", async () => {
    const original = await criarPesquisa(clienteId, { pedido: PEDIDO, profundidade: "aprofundada", destino: DESTINO }, { enfileirar });
    await criarPesquisa(clienteId, { pedido: PEDIDO }, { enfileirar });
    // 2 + 1 = 3: nada cabe; a original cai sem busca e libera as 2, e a a fundo cabe de novo; sobrando 1, só a rápida
    await db().update(pesquisasNaHora).set({ status: "erro" }).where(eq(pesquisasNaHora.id, original.id));
    await criarPesquisa(clienteId, { pedido: PEDIDO }, { enfileirar });
    await expect(pesquisarDeNovo(clienteId, original.id, { enfileirar })).rejects.toThrow(ErroDoTeto);
    const rapida = await pesquisarDeNovo(clienteId, original.id, { enfileirar, profundidade: "normal" });
    expect(rapida).toMatchObject({ profundidade: "normal", pedido: PEDIDO, destino: DESTINO });
  });

  it("no teto do dia, a frase pronta (sem criar nada); a de outra marca nunca", async () => {
    const original = await criarPesquisa(clienteId, { pedido: PEDIDO, destino: DESTINO }, { enfileirar });
    await criarPesquisa(clienteId, { pedido: PEDIDO }, { enfileirar });
    await criarPesquisa(clienteId, { pedido: PEDIDO }, { enfileirar });
    await expect(pesquisarDeNovo(clienteId, original.id, { enfileirar })).rejects.toThrow("Você já usou as 3 pesquisas de hoje");
    await expect(pesquisarDeNovo(outroClienteId, original.id, { enfileirar })).rejects.toThrow("Pesquisa não encontrada");
    expect(await pesquisasDeHoje(clienteId)).toBe(3);
  });
});
