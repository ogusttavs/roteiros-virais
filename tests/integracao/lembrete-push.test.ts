/**
 * O lembrete por push (E48 PR 2), contra o Postgres real, com `enviarPush` e `enviarEmail` mockados: quem tem aparelho inscrito recebe o push e não o
 * e-mail; quem não tem (ou cujo push não foi aceito) recebe o e-mail; 404 e 410 apagam a inscrição na hora, a segunda falha seguida apaga; o texto muda
 * com e sem roteiro marcado na agenda; e as inscrições são da pessoa (registrar, trocar de dono, desligar).
 */
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/email", () => ({ enviarEmail: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/push", () => ({
  enviarPush: vi.fn().mockResolvedValue({ ok: true }),
  pushConfigurado: () => true,
}));

import { db, getPool } from "@/db";
import { clientes, inscricoesPush, membrosMarca, nichos, preferenciasUsuario, roteiros, temasDia, user } from "@/db/schema";
import { rodarLembrete } from "@/jobs/lembrete";
import { enviarEmail } from "@/lib/email";
import { enviarPush } from "@/lib/push";
import { listarClientesAdmin } from "@/servicos/admin-coleta";
import {
  adiarPedidoDePush,
  apagarInscricaoDaPessoa,
  aparelhosAtivosPorPessoa,
  ErroInscricaoPush,
  aparelhosSemFalha,
  DIAS_DE_FALHA_PARA_APAGAR,
  enderecoDeServicoDePush,
  registrarEnvioBemSucedido,
  inscricoesDaPessoa,
  pedidoDePushPodeAparecer,
  registrarInscricaoPush,
} from "@/servicos/push";

import { resetarSchema } from "../../scripts/resetar-schema";

/** 11:00 em Brasilia (UTC-3), uma quinta-feira qualquer, longe de meia-noite. */
const AGORA = new Date("2026-09-03T14:00:00Z");

let nichoId: number;
let contador = 0;

async function criarPessoaComMarca(): Promise<{ usuarioId: string; clienteId: number }> {
  contador += 1;
  const usuarioId = `lembrete-push-${contador}`;
  await db().insert(user).values({ id: usuarioId, name: `[teste] pessoa ${contador}`, email: `${usuarioId}@lembrete-push.teste` });
  await db().insert(preferenciasUsuario).values({ usuarioId, horaLembrete: "11:00" });
  const [marca] = await db().insert(clientes).values({ usuarioId, nome: `[teste] marca ${contador}`, nichoId }).returning();
  await db().insert(membrosMarca).values({ usuarioId, clienteId: marca.id, papel: "dono" });
  return { usuarioId, clienteId: marca.id };
}

function inscricao(usuarioId: string, chave: string) {
  return { endpoint: `https://fcm.googleapis.com/fcm/send/${usuarioId}-${chave}`, p256dh: "chave-publica-de-teste-longa", auth: "auth-de-teste" };
}

async function inscrever(usuarioId: string, chave = "a", sistema: "iphone" | "android" = "android") {
  return registrarInscricaoPush(usuarioId, inscricao(usuarioId, chave), sistema);
}

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db().insert(nichos).values({ slug: "lembrete-push", nome: "Lembrete push", termos: [] }).returning();
  nichoId = nicho.id;
  await db()
    .insert(temasDia)
    .values({ nichoId, data: "2026-09-03", temas: [{ titulo: "tema 1", descricao: "d", porQue: "p", evidencias: [], puxaPara: "alcance" as const }] });
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

afterEach(async () => {
  await db().delete(roteiros);
  await db().delete(user);
  vi.mocked(enviarEmail).mockClear();
  vi.mocked(enviarPush).mockReset();
  vi.mocked(enviarPush).mockResolvedValue({ ok: true });
});

describe("rodarLembrete com push", () => {
  it("quem tem aparelho inscrito recebe o push (um por aparelho) e não o e-mail; o toque abre /hoje", async () => {
    const { usuarioId } = await criarPessoaComMarca();
    await inscrever(usuarioId, "a", "android");
    await inscrever(usuarioId, "b", "iphone");

    const resumo = await rodarLembrete(AGORA);

    expect(resumo.enviados).toBe(1);
    expect(resumo.enviadosPorPush).toBe(1);
    expect(vi.mocked(enviarPush)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(enviarEmail)).not.toHaveBeenCalled();
    expect(vi.mocked(enviarPush).mock.calls[0][1].url).toBe("/hoje");
  });

  it("quem não tem inscrição recebe o e-mail de sempre, e nenhum push", async () => {
    await criarPessoaComMarca();

    const resumo = await rodarLembrete(AGORA);

    expect(resumo.enviados).toBe(1);
    expect(resumo.enviadosPorPush).toBe(0);
    expect(vi.mocked(enviarPush)).not.toHaveBeenCalled();
    expect(vi.mocked(enviarEmail)).toHaveBeenCalledTimes(1);
  });

  it("o texto é 'Os temas de hoje chegaram' sem roteiro marcado na agenda, e 'O seu roteiro de hoje está pronto' com ele", async () => {
    const semRoteiro = await criarPessoaComMarca();
    await inscrever(semRoteiro.usuarioId);
    await rodarLembrete(AGORA);
    expect(vi.mocked(enviarPush).mock.calls[0][1].corpo).toBe("Os temas de hoje chegaram");

    vi.mocked(enviarPush).mockClear();
    const comRoteiro = await criarPessoaComMarca();
    await inscrever(comRoteiro.usuarioId);
    await db()
      .insert(roteiros)
      .values({
        clienteId: comRoteiro.clienteId,
        data: "2026-09-03",
        tema: "tema marcado",
        origem: "sugerido",
        objetivo: "engajamento",
        formato: "reels",
        conteudo: {
          titulo: "o roteiro do dia",
          duracaoS: 40,
          gancho: "g",
          corpo: "c",
          fechamento: "f",
          chamadaFinal: "x",
          cartoes: null,
          porQueAssim: [],
          cenas: [],
          ondeGravar: "no local",
          edicao: { textoNaTela: [], ritmoDeCorte: "moderado", recursos: [], audio: null, referencia: null },
          evidencias: [],
          semEvidencia: true,
          forcaEvidencia: null,
        } as never,
        status: "gerado",
      });
    // A primeira pessoa já recebeu hoje (ultimo_lembrete_em): só a segunda é candidata nesta rodada.
    await rodarLembrete(AGORA);
    const corpos = vi.mocked(enviarPush).mock.calls.map((chamada) => chamada[1].corpo);
    expect(corpos).toContain("O seu roteiro de hoje está pronto");
    expect(corpos).not.toContain("Os temas de hoje chegaram");
  });

  it("inscrição que o serviço diz que não existe mais (404 ou 410) é apagada na hora, e a pessoa recebe o e-mail", async () => {
    const { usuarioId } = await criarPessoaComMarca();
    await inscrever(usuarioId);
    vi.mocked(enviarPush).mockResolvedValue({ ok: false, apagar: true, contar: false, motivo: "servico de push respondeu 410" });

    const resumo = await rodarLembrete(AGORA);

    expect(await inscricoesDaPessoa(usuarioId)).toEqual([]);
    expect(resumo.enviadosPorPush).toBe(0);
    expect(vi.mocked(enviarEmail)).toHaveBeenCalledTimes(1);
  });

  it("outra falha conta uma vez (a inscrição fica) e a segunda falha seguida apaga; nos dois dias a pessoa recebe o e-mail", async () => {
    const { usuarioId } = await criarPessoaComMarca();
    await inscrever(usuarioId);
    vi.mocked(enviarPush).mockResolvedValue({ ok: false, apagar: false, contar: true, motivo: "servico de push respondeu 400" });

    await rodarLembrete(AGORA);
    const [depoisDaPrimeira] = await inscricoesDaPessoa(usuarioId);
    expect(depoisDaPrimeira.falhasSeguidas).toBe(1);
    expect(depoisDaPrimeira.ultimaFalhaEm).not.toBeNull();
    expect(vi.mocked(enviarEmail)).toHaveBeenCalledTimes(1);

    // No dia seguinte, outra falha: a segunda seguida apaga.
    await db().update(preferenciasUsuario).set({ ultimoLembreteEm: null }).where(eq(preferenciasUsuario.usuarioId, usuarioId));
    await rodarLembrete(AGORA);
    expect(await inscricoesDaPessoa(usuarioId)).toEqual([]);
    expect(vi.mocked(enviarEmail)).toHaveBeenCalledTimes(2);
  });

  it("falha do ambiente ou do serviço de push (chaves, 401, 403, 429, 5xx, rede) não conta contra o aparelho: a inscrição fica e a pessoa recebe o e-mail", async () => {
    const { usuarioId } = await criarPessoaComMarca();
    await inscrever(usuarioId);
    vi.mocked(enviarPush).mockResolvedValue({ ok: false, apagar: false, contar: false, motivo: "servico de push respondeu 503" });

    for (let dia = 0; dia < 3; dia += 1) {
      await db().update(preferenciasUsuario).set({ ultimoLembreteEm: null }).where(eq(preferenciasUsuario.usuarioId, usuarioId));
      await rodarLembrete(AGORA);
    }

    const [restante] = await inscricoesDaPessoa(usuarioId);
    expect(restante.falhasSeguidas).toBe(0);
    expect(vi.mocked(enviarEmail)).toHaveBeenCalledTimes(3);
  });

  it("uma falha do banco ao contar o envio não derruba o lembrete nem manda e-mail por cima de um push que já saiu", async () => {
    const { usuarioId } = await criarPessoaComMarca();
    const feita = await inscrever(usuarioId);
    // A inscrição some entre o envio e a contagem (como uma falha do banco): a contabilidade não pode lançar.
    vi.mocked(enviarPush).mockImplementation(async () => {
      await db().delete(inscricoesPush).where(eq(inscricoesPush.id, feita.id));
      return { ok: true };
    });

    const resumo = await rodarLembrete(AGORA);

    expect(resumo.enviadosPorPush).toBe(1);
    expect(resumo.erros).toBeUndefined();
    expect(vi.mocked(enviarEmail)).not.toHaveBeenCalled();
  });

  it("um envio aceito zera as falhas seguidas (a falha de ontem não soma com a de amanhã)", async () => {
    const { usuarioId } = await criarPessoaComMarca();
    const feita = await inscrever(usuarioId);
    await db().update(inscricoesPush).set({ falhasSeguidas: 1 }).where(eq(inscricoesPush.id, feita.id));

    await rodarLembrete(AGORA);

    const [depois] = await inscricoesDaPessoa(usuarioId);
    expect(depois.falhasSeguidas).toBe(0);
  });

  it("com dois aparelhos, um falhando e o outro aceitando: o push chegou, sem e-mail, e só o que falhou conta", async () => {
    const { usuarioId } = await criarPessoaComMarca();
    const boa = await inscrever(usuarioId, "boa");
    const ruim = await inscrever(usuarioId, "ruim");
    vi.mocked(enviarPush).mockImplementation(async (alvo) =>
      alvo.endpoint === ruim.endpoint ? { ok: false, apagar: false, contar: true, motivo: "servico de push respondeu 400" } : { ok: true },
    );

    const resumo = await rodarLembrete(AGORA);

    expect(resumo.enviadosPorPush).toBe(1);
    expect(vi.mocked(enviarEmail)).not.toHaveBeenCalled();
    const restantes = await inscricoesDaPessoa(usuarioId);
    expect(restantes.find((i) => i.id === boa.id)?.falhasSeguidas).toBe(0);
    expect(restantes.find((i) => i.id === ruim.id)?.falhasSeguidas).toBe(1);
  });
});

describe("as inscrições da pessoa", () => {
  it("o mesmo aparelho (endpoint) é uma linha só: chaves iguais só confirmam o sistema e NÃO zeram a falha corrente; chaves novas (inscrição nova) zeram", async () => {
    const { usuarioId } = await criarPessoaComMarca();
    const primeira = await inscrever(usuarioId);
    const falhaDeOntem = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await db().update(inscricoesPush).set({ falhasSeguidas: 1, ultimaFalhaEm: falhaDeOntem }).where(eq(inscricoesPush.id, primeira.id));

    const reconciliada = await registrarInscricaoPush(usuarioId, inscricao(usuarioId, "a"), "iphone");
    expect(reconciliada.id).toBe(primeira.id);
    expect(reconciliada.sistema).toBe("iphone");
    expect(reconciliada.falhasSeguidas).toBe(1);
    expect(reconciliada.ultimaFalhaEm?.getTime()).toBe(falhaDeOntem.getTime());

    const nova = await registrarInscricaoPush(usuarioId, { ...inscricao(usuarioId, "a"), auth: "auth-nova-de-teste" }, "iphone");
    expect(nova.id).toBe(primeira.id);
    expect(nova.auth).toBe("auth-nova-de-teste");
    expect(nova.falhasSeguidas).toBe(0);
    expect(nova.ultimaFalhaEm).toBeNull();
    expect((await inscricoesDaPessoa(usuarioId)).length).toBe(1);
  });

  it("o mesmo aparelho de outra pessoa: chaves iguais são recusadas (desligar e ligar de novo); chaves novas mudam o dono; e uma pessoa pode ter mais de um aparelho", async () => {
    const a = await criarPessoaComMarca();
    const b = await criarPessoaComMarca();
    await inscrever(a.usuarioId, "x");
    await inscrever(a.usuarioId, "y");

    await expect(registrarInscricaoPush(b.usuarioId, inscricao(a.usuarioId, "x"), "android")).rejects.toBeInstanceOf(ErroInscricaoPush);
    expect((await inscricoesDaPessoa(a.usuarioId)).length).toBe(2);
    expect((await inscricoesDaPessoa(b.usuarioId)).length).toBe(0);

    await registrarInscricaoPush(b.usuarioId, { ...inscricao(a.usuarioId, "x"), p256dh: "outra-chave-publica-de-teste" }, "android");
    expect((await inscricoesDaPessoa(a.usuarioId)).length).toBe(1);
    expect((await inscricoesDaPessoa(b.usuarioId)).length).toBe(1);
    const contagem = await aparelhosAtivosPorPessoa([a.usuarioId, b.usuarioId]);
    expect(contagem.get(a.usuarioId)).toBe(1);
    expect(contagem.get(b.usuarioId)).toBe(1);
  });

  it("só os serviços de push conhecidos: um endereço real de cada um passa; ponto final, porta, usuário, IP, nome interno e nome público que resolve para dentro não", async () => {
    const reais = [
      "https://fcm.googleapis.com/fcm/send/dXyzAbc123:APA91bH",
      "https://web.push.apple.com/QWxlbXBsbzEyMzQ1",
      "https://updates.push.services.mozilla.com/wpush/v2/gAAAAABk",
      "https://wns2-par02p.notify.windows.com/w/?token=BQYAAAB",
    ];
    for (const endereco of reais) expect(enderecoDeServicoDePush(endereco), endereco).toEqual({ ok: true });

    const recusados = [
      "https://localhost./push",
      "https://postgres./push",
      "https://x.internal./push",
      "https://fcm.googleapis.com./fcm/send/x",
      "https://fcm.googleapis.com:8443/fcm/send/x",
      "https://usuario@fcm.googleapis.com/fcm/send/x",
      "https://usuario:senha@fcm.googleapis.com/fcm/send/x",
      "https://127.0.0.1.nip.io/push",
      "https://fcm.googleapis.com.evil.example/fcm/send/x",
      "https://evilfcm.googleapis.com/fcm/send/x",
      "https://evilpush.apple.com/x",
      "https://push.apple.com/x",
      "https://10.0.0.5/push",
      "https://[::1]/push",
      "https://localhost/push",
      "https://servico-interno/push",
      "http://fcm.googleapis.com/fcm/send/x",
      "nao e uma url",
    ];
    for (const endereco of recusados) expect(enderecoDeServicoDePush(endereco).ok, endereco).toBe(false);

    const a = await criarPessoaComMarca();
    for (const endereco of recusados.slice(0, 8)) {
      await expect(registrarInscricaoPush(a.usuarioId, { endpoint: endereco, p256dh: "chave-publica-de-teste-longa", auth: "auth-de-teste" }, "android")).rejects.toBeInstanceOf(ErroInscricaoPush);
    }
    expect(await inscricoesDaPessoa(a.usuarioId)).toEqual([]);
  });

  it("falha que não é do aparelho (403) por mais de 14 dias sem nenhum envio aceito apaga a inscrição; antes disso ela fica; e a pessoa volta ao pedido", async () => {
    const dia = 24 * 60 * 60 * 1000;
    const velha = await criarPessoaComMarca();
    const recente = await criarPessoaComMarca();
    const ainda = await inscrever(recente.usuarioId, "r");
    const morta = await inscrever(velha.usuarioId, "v");
    await db().update(inscricoesPush).set({ ultimaFalhaEm: new Date(AGORA.getTime() - (DIAS_DE_FALHA_PARA_APAGAR + 1) * dia) }).where(eq(inscricoesPush.id, morta.id));
    await db().update(inscricoesPush).set({ ultimaFalhaEm: new Date(AGORA.getTime() - (DIAS_DE_FALHA_PARA_APAGAR - 1) * dia) }).where(eq(inscricoesPush.id, ainda.id));
    vi.mocked(enviarPush).mockResolvedValue({ ok: false, apagar: false, contar: false, motivo: "servico de push respondeu 403" });

    await rodarLembrete(AGORA);

    expect(await inscricoesDaPessoa(velha.usuarioId)).toEqual([]);
    const [restante] = await inscricoesDaPessoa(recente.usuarioId);
    expect(restante.id).toBe(ainda.id);
    expect(restante.falhasSeguidas).toBe(0);
    // As duas receberam o e-mail do dia (nenhum push foi aceito).
    expect(vi.mocked(enviarEmail)).toHaveBeenCalledTimes(2);
    // Sem aparelho, o pedido de permissão volta; com a inscrição ainda falhando (ou já apagada), nenhum aparelho "sem falha" conta.
    expect(await aparelhosSemFalha(velha.usuarioId)).toBe(0);
    expect(pedidoDePushPodeAparecer({ pushAdiadoAte: null }, await aparelhosSemFalha(recente.usuarioId), AGORA)).toBe(true);
  });

  it("registrar o endereço de um aparelho que o job apagou no meio do caminho cria a inscrição de novo, e nunca devolve nada", async () => {
    const { usuarioId } = await criarPessoaComMarca();
    const feita = await inscrever(usuarioId);
    await db().delete(inscricoesPush).where(eq(inscricoesPush.id, feita.id));

    const outra = await registrarInscricaoPush(usuarioId, inscricao(usuarioId, "a"), "android");

    expect(outra.id).toBeGreaterThan(0);
    expect((await inscricoesDaPessoa(usuarioId)).length).toBe(1);
  });

  it("a falha corrente começa na primeira falha da sequência (não anda a cada dia); um envio aceito a termina e anota o sucesso", async () => {
    const { usuarioId } = await criarPessoaComMarca();
    const feita = await inscrever(usuarioId);
    vi.mocked(enviarPush).mockResolvedValue({ ok: false, apagar: false, contar: false, motivo: "servico de push respondeu 503" });

    await rodarLembrete(AGORA);
    const [primeira] = await inscricoesDaPessoa(usuarioId);
    const inicio = primeira.ultimaFalhaEm!.getTime();
    // Uma falha corrente de menos de 3 dias ainda não tira o aparelho da conta (uma queda curta do serviço não convida todo mundo a ligar de novo).
    expect(await aparelhosSemFalha(usuarioId, AGORA)).toBe(1);
    expect(await aparelhosSemFalha(usuarioId, new Date(AGORA.getTime() + 4 * 24 * 60 * 60 * 1000))).toBe(0);

    await db().update(preferenciasUsuario).set({ ultimoLembreteEm: null }).where(eq(preferenciasUsuario.usuarioId, usuarioId));
    await new Promise((resolver) => setTimeout(resolver, 20));
    await rodarLembrete(AGORA);
    const [segunda] = await inscricoesDaPessoa(usuarioId);
    expect(segunda.ultimaFalhaEm!.getTime()).toBe(inicio);

    const depois = new Date("2026-09-10T14:00:00Z");
    await registrarEnvioBemSucedido(feita.id, depois);
    const [sucesso] = await inscricoesDaPessoa(usuarioId);
    expect(sucesso.ultimaFalhaEm).toBeNull();
    expect(sucesso.ultimoSucessoEm?.getTime()).toBe(depois.getTime());
    expect(await aparelhosSemFalha(usuarioId)).toBe(1);
  });

  it("a linha de preferências criada por 'agora não' no pedido de push nasce com a hora de fábrica de 09:00", async () => {
    const { usuarioId } = await criarPessoaComMarca();
    await db().delete(preferenciasUsuario).where(eq(preferenciasUsuario.usuarioId, usuarioId));

    await adiarPedidoDePush(usuarioId, AGORA);

    const [prefs] = await db().select().from(preferenciasUsuario).where(eq(preferenciasUsuario.usuarioId, usuarioId));
    expect(prefs.horaLembrete).toBe("09:00");
  });

  it("a lista de marcas do admin traz quantos aparelhos do dono recebem o aviso, e zero para quem não tem", async () => {
    const com = await criarPessoaComMarca();
    const sem = await criarPessoaComMarca();
    await inscrever(com.usuarioId, "a");
    await inscrever(com.usuarioId, "b");

    const lista = await listarClientesAdmin();

    expect(lista.find((c) => c.id === com.clienteId)?.aparelhosComPush).toBe(2);
    expect(lista.find((c) => c.id === sem.clienteId)?.aparelhosComPush).toBe(0);
  });

  it("recusa endereço que não é https e chaves vazias; desligar só apaga a inscrição da própria pessoa", async () => {
    const a = await criarPessoaComMarca();
    const b = await criarPessoaComMarca();
    await expect(registrarInscricaoPush(a.usuarioId, { endpoint: "http://push.exemplo.test/x", p256dh: "chave-publica-de-teste-longa", auth: "auth-de-teste" }, "android")).rejects.toBeInstanceOf(ErroInscricaoPush);
    await expect(registrarInscricaoPush(a.usuarioId, { endpoint: "nao e uma url", p256dh: "chave-publica-de-teste-longa", auth: "auth-de-teste" }, "android")).rejects.toBeInstanceOf(ErroInscricaoPush);
    await expect(registrarInscricaoPush(a.usuarioId, { endpoint: "https://push.exemplo.test/x", p256dh: "", auth: "" }, "android")).rejects.toBeInstanceOf(ErroInscricaoPush);

    const feita = await inscrever(a.usuarioId);
    await apagarInscricaoDaPessoa(b.usuarioId, feita.endpoint);
    expect((await inscricoesDaPessoa(a.usuarioId)).length).toBe(1);
    await apagarInscricaoDaPessoa(a.usuarioId, feita.endpoint);
    expect(await inscricoesDaPessoa(a.usuarioId)).toEqual([]);
  });

  it("o pedido de permissão não aparece com aparelho já inscrito nem com agora não valendo; sete dias depois volta", async () => {
    const { usuarioId } = await criarPessoaComMarca();
    expect(pedidoDePushPodeAparecer(null, 0, AGORA)).toBe(true);
    expect(pedidoDePushPodeAparecer({ pushAdiadoAte: null }, 1, AGORA)).toBe(false);

    const ate = await adiarPedidoDePush(usuarioId, AGORA);
    expect(ate.getTime() - AGORA.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
    expect(pedidoDePushPodeAparecer({ pushAdiadoAte: ate }, 0, new Date(AGORA.getTime() + 3 * 24 * 60 * 60 * 1000))).toBe(false);
    expect(pedidoDePushPodeAparecer({ pushAdiadoAte: ate }, 0, new Date(AGORA.getTime() + 8 * 24 * 60 * 60 * 1000))).toBe(true);
  });
});
