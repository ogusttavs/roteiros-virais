/**
 * O aviso da manhã com o assunto do momento (E55 PR 2, parte c), contra o Postgres real, com `enviarPush` e `enviarEmail` mockados: quando uma marca da pessoa tem o tema do momento hoje, o push
 * tem o assunto no título ("Em alta hoje: <assunto>") e o e-mail o traz na frente; sem o tema do momento (ou com o assunto já fora da lista), o aviso é o de sempre; e o assunto, que vem de um feed
 * público, nunca entra no HTML do e-mail sem escapar.
 *
 * O relógio é o de verdade (o filtro do tema do momento olha a lista de agora e o dia de hoje), com a hora do lembrete escolhida a partir dele.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/email", () => ({ enviarEmail: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/push", () => ({
  enviarPush: vi.fn().mockResolvedValue({ ok: true }),
  pushConfigurado: () => true,
}));

import { db, getPool } from "@/db";
import { clientes, membrosMarca, nichos, preferenciasUsuario, temasDia, tendenciasBrasil, user, type TemaDoDia } from "@/db/schema";
import { rodarLembrete } from "@/jobs/lembrete";
import { config, hojeISO, horaAtualISO } from "@/lib/config";
import { enviarEmail } from "@/lib/email";
import { enviarPush } from "@/lib/push";
import { registrarInscricaoPush } from "@/servicos/push";
import { temasDoDiaOuRecente } from "@/servicos/temas";
import { chaveDoAssunto } from "@/servicos/tendencias";

import { resetarSchema } from "../../scripts/resetar-schema";

const HORA = 60 * 60 * 1000;

let nichoComMomento: number;
let nichoSemMomento: number;
let contador = 0;

function temaComum(titulo: string): TemaDoDia {
  return { titulo, descricao: "d", porQue: "p", evidencias: [], puxaPara: "alcance" };
}

function temaDoMomento(assunto: string, titulo: string): TemaDoDia {
  return {
    ...temaComum(titulo),
    doMomento: { chave: chaveDoAssunto(assunto), assunto, termos: [assunto], fonte: "Em alta no Google no Brasil", url: null, coletadaEm: new Date().toISOString(), encaixe: 9 },
  };
}

/** Uma pessoa com o lembrete na hora de agora e as marcas pedidas (cada uma num ramo). */
async function pessoaComMarcas(agora: Date, ramos: number[], nomes: string[] = []): Promise<{ usuarioId: string }> {
  contador += 1;
  const usuarioId = `lembrete-alta-${contador}`;
  await db().insert(user).values({ id: usuarioId, name: `[teste] pessoa ${contador}`, email: `${usuarioId}@lembrete-alta.teste` });
  await db().insert(preferenciasUsuario).values({ usuarioId, horaLembrete: horaAtualISO(agora) });
  for (const [i, nichoId] of ramos.entries()) {
    const [marca] = await db()
      .insert(clientes)
      .values({ usuarioId, nome: nomes[i] ?? `Marca ${contador}${String.fromCharCode(65 + i)}`, nichoId })
      .returning();
    await db().insert(membrosMarca).values({ usuarioId, clienteId: marca.id, papel: "dono" });
  }
  return { usuarioId };
}

async function rodadaDeAgora(agora: Date, assuntos: string[]): Promise<void> {
  await db()
    .insert(tendenciasBrasil)
    .values(
      assuntos.map((assunto, i) => ({
        coletadaEm: new Date(agora.getTime() - HORA),
        assunto,
        chave: chaveDoAssunto(assunto),
        termos: [assunto],
        fontes: [{ fonte: "google" as const, titulo: assunto, url: null, trafego: "2000+", posicao: i + 1 }],
        posicao: i + 1,
        sensivel: false,
      })),
    );
}

beforeAll(async () => {
  await resetarSchema(db());
  const [a] = await db().insert(nichos).values({ slug: "lembrete-alta-com", nome: "Com momento", termos: [] }).returning();
  const [b] = await db().insert(nichos).values({ slug: "lembrete-alta-sem", nome: "Sem momento", termos: [] }).returning();
  nichoComMomento = a.id;
  nichoSemMomento = b.id;
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

afterEach(async () => {
  await db().delete(user);
  await db().delete(temasDia);
  await db().delete(tendenciasBrasil);
  vi.mocked(enviarEmail).mockClear();
  vi.mocked(enviarPush).mockReset();
  vi.mocked(enviarPush).mockResolvedValue({ ok: true });
});

async function temasDeHoje(nichoId: number, temas: TemaDoDia[]): Promise<void> {
  await db().insert(temasDia).values({ nichoId, data: hojeISO(), temas });
}

describe("os temas do dia quando o do momento deixa de valer", () => {
  it("se hoje só tinha o tema do momento e o assunto saiu da lista, vale o dia mais recente que ainda tem tema, não nenhum", async () => {
    const agora = new Date();
    await rodadaDeAgora(agora, ["Jogo do Flamengo"]);
    const ontem = new Date(agora.getTime() - 24 * HORA);
    await db().insert(temasDia).values({ nichoId: nichoComMomento, data: hojeISO(ontem), temas: [temaComum("tema de ontem")] });
    await db().insert(temasDia).values({ nichoId: nichoComMomento, data: hojeISO(agora), temas: [temaDoMomento("Frente fria", "O mofo que a frente fria traz")] });

    const achado = await temasDoDiaOuRecente(nichoComMomento, hojeISO(agora), agora);
    expect(achado?.dataUsada).toBe(hojeISO(ontem));
    expect(achado?.temas.map((t) => t.titulo)).toEqual(["tema de ontem"]);
  });
});

describe("o aviso da manhã com o assunto do momento", () => {
  it("o push tem o assunto no título e a frase do tema pronto no corpo; o toque abre o Hoje", async () => {
    const agora = new Date();
    await rodadaDeAgora(agora, ["Frente fria"]);
    await temasDeHoje(nichoComMomento, [temaComum("tema comum"), temaDoMomento("Frente fria", "O mofo que a frente fria traz")]);
    const { usuarioId } = await pessoaComMarcas(agora, [nichoComMomento]);
    await registrarInscricaoPush(usuarioId, { endpoint: `https://fcm.googleapis.com/fcm/send/${usuarioId}`, p256dh: "chave-publica-de-teste-longa", auth: "auth-de-teste" }, "android");

    const resumo = await rodarLembrete(agora);

    expect(resumo.enviadosPorPush).toBe(1);
    const aviso = vi.mocked(enviarPush).mock.calls[0][1];
    expect(aviso).toEqual({ titulo: "Em alta hoje: Frente fria", corpo: "Tem um tema pronto para o seu ramo, para gravar hoje.", url: "/hoje" });
  });

  it("o e-mail tem o assunto no assunto da mensagem e traz o tema na frente, com o assunto escapado", async () => {
    const agora = new Date();
    const assunto = "Frente <b>fria</b> & vento";
    await rodadaDeAgora(agora, [assunto]);
    await temasDeHoje(nichoComMomento, [temaComum("tema comum"), temaDoMomento(assunto, 'O mofo que "a frente fria" traz')]);
    await pessoaComMarcas(agora, [nichoComMomento]);

    const resumo = await rodarLembrete(agora);

    expect(resumo.enviados).toBe(1);
    const email = vi.mocked(enviarEmail).mock.calls[0][0];
    expect(email.assunto).toBe(`Em alta hoje: ${assunto}`);
    expect(email.html).toContain("Em alta hoje no Brasil: Frente &lt;b&gt;fria&lt;/b&gt; &amp; vento.");
    expect(email.html).toContain("O mofo que &quot;a frente fria&quot; traz");
    expect(email.html).toContain("Ele vale enquanto o assunto estiver em alta.");
    expect(email.html).not.toContain("<b>fria</b>");
    // O texto de sempre ("O tema de ... está pronto") não repete o que o bloco do assunto já disse.
    expect(email.html).not.toContain("está pronto para gravar");
  });

  it("sem tema do momento, o aviso é o de sempre (o nome do aplicativo no push, o assunto de sempre no e-mail)", async () => {
    const agora = new Date();
    await temasDeHoje(nichoSemMomento, [temaComum("tema comum")]);
    const { usuarioId } = await pessoaComMarcas(agora, [nichoSemMomento]);
    await registrarInscricaoPush(usuarioId, { endpoint: `https://fcm.googleapis.com/fcm/send/${usuarioId}`, p256dh: "chave-publica-de-teste-longa", auth: "auth-de-teste" }, "android");

    await rodarLembrete(agora);

    expect(vi.mocked(enviarPush).mock.calls[0][1]).toEqual({ titulo: config.appName, corpo: "Os temas de hoje chegaram", url: "/hoje" });
  });

  it("o assunto que já saiu da lista não vai no aviso: o tema do momento deixou de valer", async () => {
    const agora = new Date();
    await rodadaDeAgora(agora, ["Jogo do Flamengo"]);
    await temasDeHoje(nichoComMomento, [temaComum("tema comum"), temaDoMomento("Frente fria", "O mofo que a frente fria traz")]);
    await pessoaComMarcas(agora, [nichoComMomento]);

    await rodarLembrete(agora);

    const email = vi.mocked(enviarEmail).mock.calls[0][0];
    expect(email.assunto).toBe("O seu tema está pronto para gravar");
    expect(email.html).not.toContain("Frente fria");
  });

  it("o assunto não quebra o assunto da mensagem nem o título do push: quebra de linha e caractere de controle viram espaço", async () => {
    const agora = new Date();
    const assunto = "Frente\n fria\r\t e vento";
    await rodadaDeAgora(agora, [assunto]);
    await temasDeHoje(nichoComMomento, [temaComum("tema comum"), temaDoMomento(assunto, "O mofo que a frente fria traz")]);
    const { usuarioId } = await pessoaComMarcas(agora, [nichoComMomento]);
    await registrarInscricaoPush(usuarioId, { endpoint: `https://fcm.googleapis.com/fcm/send/${usuarioId}`, p256dh: "chave-publica-de-teste-longa", auth: "auth-de-teste" }, "android");

    await rodarLembrete(agora);

    expect(vi.mocked(enviarPush).mock.calls[0][1].titulo).toBe("Em alta hoje: Frente fria e vento");
  });

  it("o nome da marca e os títulos que a pessoa escreveu entram no e-mail escapados (nada de HTML da pessoa no e-mail do aplicativo)", async () => {
    const agora = new Date();
    await rodadaDeAgora(agora, ["Frente fria"]);
    await temasDeHoje(nichoComMomento, [temaComum("tema comum"), temaDoMomento("Frente fria", "O mofo que a frente fria traz")]);
    await pessoaComMarcas(agora, [nichoComMomento], ["Café <b>& Cia"]);

    await rodarLembrete(agora);

    const html = vi.mocked(enviarEmail).mock.calls[0][0].html;
    expect(html).toContain("Tem um tema pronto para Café &lt;b&gt;&amp; Cia:");
    expect(html).not.toContain("<b>& Cia");
  });

  it("quem cuida de mais de uma marca recebe no push o nome da marca que tem o assunto (o toque abre a marca ativa, que pode ser outra)", async () => {
    const agora = new Date();
    await rodadaDeAgora(agora, ["Frente fria"]);
    await temasDeHoje(nichoComMomento, [temaComum("tema comum"), temaDoMomento("Frente fria", "O mofo que a frente fria traz")]);
    await temasDeHoje(nichoSemMomento, [temaComum("tema comum")]);
    const { usuarioId } = await pessoaComMarcas(agora, [nichoSemMomento, nichoComMomento], ["Aaa sem assunto", "Zzz com assunto"]);
    await registrarInscricaoPush(usuarioId, { endpoint: `https://fcm.googleapis.com/fcm/send/${usuarioId}`, p256dh: "chave-publica-de-teste-longa", auth: "auth-de-teste" }, "android");

    await rodarLembrete(agora);

    expect(vi.mocked(enviarPush).mock.calls[0][1]).toEqual({ titulo: "Em alta hoje: Frente fria", corpo: "Tem um tema pronto para Zzz com assunto, para gravar hoje.", url: "/hoje" });
  });

  it("duas marcas com assunto do momento: o e-mail nomeia as duas, na ordem do nome, e o assunto da mensagem é o da primeira", async () => {
    const agora = new Date();
    await rodadaDeAgora(agora, ["Frente fria", "Black Friday"]);
    await temasDeHoje(nichoComMomento, [temaComum("tema comum"), temaDoMomento("Frente fria", "O mofo que a frente fria traz")]);
    await temasDeHoje(nichoSemMomento, [temaComum("tema comum"), temaDoMomento("Black Friday", "A promoção que o seu cliente espera")]);
    await pessoaComMarcas(agora, [nichoSemMomento, nichoComMomento], ["Bbb loja", "Aaa limpeza"]);

    await rodarLembrete(agora);

    const email = vi.mocked(enviarEmail).mock.calls[0][0];
    expect(email.assunto).toBe("Em alta hoje: Frente fria");
    expect(email.html).toContain("Tem um tema pronto para Aaa limpeza:");
    expect(email.html).toContain("Em alta hoje no Brasil: Black Friday.");
    expect(email.html).toContain("Tem um tema pronto para Bbb loja:");
    expect(email.html.indexOf("Aaa limpeza")).toBeLessThan(email.html.indexOf("Bbb loja"));
  });

  it("com mais de uma marca, o aviso fala da que tem o assunto, e o e-mail segue com o texto de sempre para as outras", async () => {
    const agora = new Date();
    await rodadaDeAgora(agora, ["Frente fria"]);
    await temasDeHoje(nichoComMomento, [temaComum("tema comum"), temaDoMomento("Frente fria", "O mofo que a frente fria traz")]);
    await temasDeHoje(nichoSemMomento, [temaComum("tema comum")]);
    await pessoaComMarcas(agora, [nichoSemMomento, nichoComMomento]);

    await rodarLembrete(agora);

    const email = vi.mocked(enviarEmail).mock.calls[0][0];
    expect(email.assunto).toBe("Em alta hoje: Frente fria");
    // O bloco do assunto cita a marca que tem o assunto (a B, a segunda do cadastro); a outra (A) segue com a linha de sempre.
    expect(email.html).toMatch(/Tem um tema pronto para Marca \d+B:/);
    expect(email.html).toMatch(/O tema de <strong>Marca \d+A<\/strong> está pronto para gravar\./);
  });
});
