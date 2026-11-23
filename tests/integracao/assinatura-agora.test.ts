/**
 * Cobrança de 23/11/2026, contra o Postgres local e sem rede (a porta do Stripe é a simulada, trocada nos testes que precisam de outro comportamento):
 *  - assinar no meio do teste: com cartão encerra o teste e cobra na hora, sem cartão leva a cadastrá-lo, cartão recusado segue a regra de quem nunca pagou;
 *  - M1: o Stripe é chamado fora de qualquer transação, e dois cliques ao mesmo tempo abrem um Checkout só;
 *  - M2: a conferência com o Stripe, com e sem diferença;
 *  - M5: um e-mail ao admin por mudança, e nenhum no reenvio do mesmo aviso.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { DIAS_DE_TOLERANCIA_SEM_NENHUM_PAGAMENTO } from "@/config/assinatura";
import { db, getPool } from "@/db";
import { assinaturas, checkoutsStripe, clientes, eventosStripe, membrosMarca, nichos, user } from "@/db/schema";
import { chamadasSimuladas, criarPortaSimulada, limparSessoesSimuladas, usarPortaStripe, type PortaStripe } from "@/lib/stripe";
import {
  assinarAgora,
  assinaturaVale,
  assinaturasDaMarca,
  ErroAssinatura,
  frasesDaAssinatura,
  iniciarAssinatura,
  marcaPrecisaAssinar,
  tratarEventoDoStripe,
} from "@/servicos/assinatura";
import { destinatariosDoAviso } from "@/servicos/aviso-de-leitura";

import { resetarSchema } from "../../scripts/resetar-schema";
import { conferirMarca } from "../../scripts/stripe-conferir-logica";
import { eventoDeAssinatura, eventoDeFatura, SEGUNDOS } from "../fixtures/stripe-eventos";

type Email = { para: string; assunto: string; html: string };
const T0 = SEGUNDOS.T0;
const DIA = SEGUNDOS.DIA;

let marca: number;
let outraMarca: number;
const dono = { id: "ag-dono", email: "ag-dono@exemplo.teste" };
const membro = { id: "ag-membro" };

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db().insert(nichos).values({ slug: "agora-teste", nome: "Agora teste", termos: [] }).returning();
  await db().insert(user).values([
    { id: "ag-dono", name: "Dono", email: "ag-dono@exemplo.teste", role: "cliente" },
    { id: "ag-membro", name: "Membro", email: "ag-membro@exemplo.teste", role: "cliente" },
    { id: "ag-admin", name: "Admin", email: "ag-admin@exemplo.teste", role: "admin" },
  ]);
  const [a] = await db().insert(clientes).values({ usuarioId: "ag-dono", nome: "[teste] Pizzaria <b>Boa</b>", nichoId: nicho.id }).returning();
  const [b] = await db().insert(clientes).values({ usuarioId: "ag-dono", nome: "[teste] Outra marca", nichoId: nicho.id }).returning();
  marca = a.id;
  outraMarca = b.id;
  await db().insert(membrosMarca).values([
    { usuarioId: "ag-dono", clienteId: marca, papel: "dono" },
    { usuarioId: "ag-membro", clienteId: marca, papel: "membro" },
    { usuarioId: "ag-dono", clienteId: outraMarca, papel: "dono" },
  ]);
}, 30_000);

afterAll(async () => {
  usarPortaStripe();
  await getPool().end();
});

beforeEach(async () => {
  usarPortaStripe();
  limparSessoesSimuladas();
  chamadasSimuladas.length = 0;
  await db().delete(checkoutsStripe);
  await db().delete(assinaturas);
  await db().delete(eventosStripe);
});

const agoraS = () => Math.floor(Date.now() / 1000);

/** Uma assinatura em teste, que vale agora, com ou sem cartão. */
async function emTeste(cartao: boolean, assinaturaId = "sub_teste_agora", clienteId = marca) {
  await tratarEventoDoStripe(
    eventoDeAssinatura("customer.subscription.created", { clienteId, assinaturaId, status: "trialing", cartao, comTeste: true, criadoEm: agoraS(), inicio: agoraS(), fim: agoraS() + 5 * DIA }),
    null,
  );
}

function portaCom(troca: Partial<PortaStripe>): PortaStripe {
  const porta = { ...criarPortaSimulada(), ...troca };
  usarPortaStripe(porta);
  return porta;
}

describe("assinar no meio do teste", () => {
  it("com cartão: encerra o teste no Stripe e cobra na hora; quando o Stripe confirma, a assinatura vira active", async () => {
    await emTeste(true);
    const encerrar = vi.fn(async () => ({ cobrado: true }));
    portaCom({ encerrarTeste: encerrar });

    await expect(assinarAgora(dono, { id: marca })).resolves.toEqual({ tipo: "cobrado" });
    expect(encerrar).toHaveBeenCalledTimes(1);
    expect(encerrar).toHaveBeenCalledWith({ stripeAssinaturaId: "sub_teste_agora", clienteId: marca });

    // O Stripe confirma: assinatura ativa e fatura paga.
    await tratarEventoDoStripe(eventoDeAssinatura("customer.subscription.updated", { clienteId: marca, assinaturaId: "sub_teste_agora", status: "active", cartao: true, criadoEm: agoraS() + 1, inicio: agoraS(), fim: agoraS() + 90 * DIA }), null);
    await tratarEventoDoStripe(eventoDeFatura("invoice.paid", { clienteId: marca, assinaturaId: "sub_teste_agora", criadoEm: agoraS() + 1, inicio: agoraS(), fim: agoraS() + 90 * DIA, valorPago: 119_100 }), null);
    const [linha] = await assinaturasDaMarca(marca);
    expect(linha.status).toBe("active");
    expect(linha.primeiroPagamentoEm).not.toBeNull();
    expect(await marcaPrecisaAssinar({ id: marca, cortesia: false }, new Date(), true)).toBe(false);
  });

  it("sem cartão: não cobra nada, devolve o portal para cadastrar o cartão e o teste segue", async () => {
    await emTeste(false);
    const encerrar = vi.fn(async () => ({ cobrado: true }));
    portaCom({ encerrarTeste: encerrar });

    const r = await assinarAgora(dono, { id: marca });
    expect(r).toMatchObject({ tipo: "cadastrar-cartao", url: expect.stringContaining("simulado=portal") });
    expect(encerrar).not.toHaveBeenCalled();
    expect((await assinaturasDaMarca(marca))[0].status).toBe("trialing");
  });

  it("cartão recusado nessa hora: a pessoa lê a frase de cartão recusado e vale a regra de quem nunca pagou (3 dias)", async () => {
    await emTeste(true);
    portaCom({ encerrarTeste: async () => ({ cobrado: false }) });
    const erro = await assinarAgora(dono, { id: marca }).catch((e) => e);
    expect(erro).toBeInstanceOf(ErroAssinatura);
    expect((erro as ErroAssinatura).message).toBe(frasesDaAssinatura.cartaoRecusado);
    expect((erro as ErroAssinatura).message).toContain(String(DIAS_DE_TOLERANCIA_SEM_NENHUM_PAGAMENTO));

    // O aviso do Stripe da fatura que falhou: past_due, sem nenhum pagamento.
    const quando = agoraS() + 1;
    await tratarEventoDoStripe(eventoDeFatura("invoice.payment_failed", { clienteId: marca, assinaturaId: "sub_teste_agora", criadoEm: quando }), null);
    const [linha] = await assinaturasDaMarca(marca);
    expect(linha.status).toBe("past_due");
    expect(linha.primeiroPagamentoEm).toBeNull();
    const desde = linha.atrasadaDesde as Date;
    expect(assinaturaVale(linha, new Date(desde.getTime() + 1 * DIA * 1000))).toBe(true);
    expect(assinaturaVale(linha, new Date(desde.getTime() + (DIAS_DE_TOLERANCIA_SEM_NENHUM_PAGAMENTO + 1) * DIA * 1000))).toBe(false);
  });

  it("o Stripe falhar ao encerrar o teste dá a frase de falha e nada muda", async () => {
    await emTeste(true);
    portaCom({
      encerrarTeste: async () => {
        throw new Error("fora do ar");
      },
    });
    await expect(assinarAgora(dono, { id: marca })).rejects.toMatchObject({ message: frasesDaAssinatura.falhou });
    expect((await assinaturasDaMarca(marca))[0].status).toBe("trialing");
  });

  it("só o dono; quem não está em teste não assina agora", async () => {
    await expect(assinarAgora(membro, { id: marca })).rejects.toMatchObject({ message: frasesDaAssinatura.soODono });
    await expect(assinarAgora(dono, { id: marca })).rejects.toMatchObject({ message: frasesDaAssinatura.semTeste });
    await emTeste(true);
    await tratarEventoDoStripe(eventoDeAssinatura("customer.subscription.updated", { clienteId: marca, assinaturaId: "sub_teste_agora", status: "active", cartao: true, criadoEm: agoraS() + 5, inicio: agoraS(), fim: agoraS() + 90 * DIA }), null);
    await expect(assinarAgora(dono, { id: marca })).rejects.toMatchObject({ message: frasesDaAssinatura.jaAssinada });
  });

  it("dois cliques em assinar agora usam a mesma chave de idempotência do Stripe (a porta real fixa a chave por assinatura)", async () => {
    await emTeste(true);
    const encerrar = vi.fn(async () => ({ cobrado: true }));
    portaCom({ encerrarTeste: encerrar });
    await Promise.all([assinarAgora(dono, { id: marca }), assinarAgora(dono, { id: marca })]);
    // Os dois pedidos são idênticos: o Stripe, pela chave de idempotência da porta real, cobra uma vez só.
    expect(encerrar.mock.calls[0]).toEqual(encerrar.mock.calls[1]);
  });
});

describe("M1: o Stripe fora da transação", () => {
  it("durante a chamada ao Stripe nenhuma transação do nosso banco fica aberta", async () => {
    let abertas = -1;
    const simulada = criarPortaSimulada();
    portaCom({
      async criarCheckout(pedido) {
        await new Promise((r) => setTimeout(r, 150));
        const { rows } = await getPool().query("select count(*)::int as n from pg_stat_activity where datname = current_database() and state like 'idle in transaction%'");
        abertas = rows[0].n;
        return simulada.criarCheckout(pedido);
      },
    });
    await iniciarAssinatura(dono, { id: marca });
    expect(abertas).toBe(0);
  });

  it("dois cliques ao mesmo tempo abrem um Checkout só e devolvem o mesmo endereço", async () => {
    const [a, b] = await Promise.all([iniciarAssinatura(dono, { id: marca }), iniciarAssinatura(dono, { id: marca })]);
    expect(a.url).toBe(b.url);
    expect(chamadasSimuladas.filter((c) => c.metodo === "criarCheckout")).toHaveLength(1);
    const guardadas = await db().select().from(checkoutsStripe).where(eq(checkoutsStripe.clienteId, marca));
    expect(guardadas).toHaveLength(1);
    expect(guardadas[0].stripeSessaoId.startsWith("cs_simulada_")).toBe(true);
  });

  it("com um Checkout antigo já expirado, dois cliques ao mesmo tempo também abrem um só (a troca da reserva confere o valor que leu)", async () => {
    await db().insert(checkoutsStripe).values({ clienteId: marca, stripeSessaoId: "cs_expirada_antes" });
    const [a, b] = await Promise.all([iniciarAssinatura(dono, { id: marca }), iniciarAssinatura(dono, { id: marca })]);
    expect(a.url).toBe(b.url);
    expect(chamadasSimuladas.filter((c) => c.metodo === "criarCheckout")).toHaveLength(1);
  });

  it("a reserva de uma tentativa que morreu no meio (velha) é tomada pelo próximo clique", async () => {
    await db().insert(checkoutsStripe).values({ clienteId: marca, stripeSessaoId: "pendente:morta", criadoEm: new Date(Date.now() - 5 * 60 * 1000) });
    const r = await iniciarAssinatura(dono, { id: marca });
    expect(r.url).toContain("simulado=checkout");
    const [linha] = await db().select().from(checkoutsStripe).where(eq(checkoutsStripe.clienteId, marca));
    expect(linha.stripeSessaoId.startsWith("cs_simulada_")).toBe(true);
  });

  it("se o Stripe falha a reserva é devolvida: o clique seguinte não espera por ela", async () => {
    portaCom({
      async criarCheckout() {
        throw new Error("rede caiu");
      },
    });
    await expect(iniciarAssinatura(dono, { id: marca })).rejects.toBeInstanceOf(ErroAssinatura);
    expect(await db().select().from(checkoutsStripe)).toHaveLength(0);
    usarPortaStripe();
    await expect(iniciarAssinatura(dono, { id: marca })).resolves.toMatchObject({ url: expect.stringContaining("simulado=checkout") });
  });
});

describe("M2: a conferência com o Stripe", () => {
  function stripeCom(assinaturasDoStripe: Record<string, unknown>[]) {
    return {
      async lerAssinatura(id: string) {
        return assinaturasDoStripe.find((s) => s.id === id) ?? null;
      },
      async assinaturasDaMarca() {
        return assinaturasDoStripe;
      },
    };
  }
  const doStripe = (status: string) => eventoDeAssinatura("customer.subscription.updated", { clienteId: marca, assinaturaId: "sub_conf", status, cartao: true, inicio: T0, fim: T0 + 90 * DIA }).data.object;

  it("sem diferença: tudo igual e nada é escrito", async () => {
    await tratarEventoDoStripe(eventoDeAssinatura("customer.subscription.created", { clienteId: marca, assinaturaId: "sub_conf", status: "active", cartao: true, inicio: T0, fim: T0 + 90 * DIA }), null);
    const aplicar = vi.fn();
    const linhas = await conferirMarca({ clienteId: marca, banco: await assinaturasDaMarca(marca), porta: stripeCom([doStripe("active")]), corrigir: true, aplicar });
    expect(linhas).toMatchObject([{ situacao: "igual", diferencas: [], corrigida: false }]);
    expect(aplicar).not.toHaveBeenCalled();
  });

  it("com diferença: mostra, e só com --corrigir acerta o banco pelo Stripe", async () => {
    await tratarEventoDoStripe(eventoDeAssinatura("customer.subscription.created", { clienteId: marca, assinaturaId: "sub_conf", status: "trialing", cartao: true, comTeste: true, inicio: T0, fim: T0 + 7 * DIA }), null);
    const banco = await assinaturasDaMarca(marca);

    const soVer = await conferirMarca({ clienteId: marca, banco, porta: stripeCom([doStripe("canceled")]), corrigir: false, aplicar: (e) => tratarEventoDoStripe(e, null) });
    expect(soVer[0]).toMatchObject({ situacao: "diferente", corrigida: false });
    expect(soVer[0].diferencas.map((d) => d.campo)).toContain("status");
    expect((await assinaturasDaMarca(marca))[0].status).toBe("trialing");

    const corrigindo = await conferirMarca({ clienteId: marca, banco, porta: stripeCom([doStripe("canceled")]), corrigir: true, aplicar: (e) => tratarEventoDoStripe(e, null) });
    expect(corrigindo[0].corrigida).toBe(true);
    expect((await assinaturasDaMarca(marca))[0].status).toBe("canceled");
  });

  it("assinatura que o Stripe tem e o banco nunca recebeu aparece e, com --corrigir, entra", async () => {
    const linhas = await conferirMarca({ clienteId: marca, banco: [], porta: stripeCom([doStripe("active")]), corrigir: true, aplicar: (e) => tratarEventoDoStripe(e, null) });
    expect(linhas[0]).toMatchObject({ situacao: "so-no-stripe", corrigida: true });
    expect((await assinaturasDaMarca(marca))[0]).toMatchObject({ stripeAssinaturaId: "sub_conf", status: "active" });
  });
});

describe("M5: avisos ao admin", () => {
  it("um e-mail por mudança (teste começou, assinatura paga, cartão recusado, cancelamento) e nenhum no reenvio do Stripe", async () => {
    const enviar = vi.fn<(o: Email) => Promise<void>>(async () => undefined);
    const quantos = (await destinatariosDoAviso()).length;
    expect(quantos).toBeGreaterThan(0);

    const criada = eventoDeAssinatura("customer.subscription.created", { clienteId: marca, assinaturaId: "sub_av", status: "trialing", cartao: true, comTeste: true, criadoEm: T0, inicio: T0, fim: T0 + 7 * DIA });
    await tratarEventoDoStripe(criada, enviar);
    expect(enviar).toHaveBeenCalledTimes(quantos);
    expect(enviar.mock.calls[0][0]).toMatchObject({ assunto: expect.stringContaining("Teste grátis começou") });

    // O Stripe reenvia o mesmo aviso: nada novo.
    await tratarEventoDoStripe(criada, enviar);
    expect(enviar).toHaveBeenCalledTimes(quantos);

    // Outro aviso que repete o mesmo fato (assinatura atualizada, ainda em teste): nada novo.
    await tratarEventoDoStripe(eventoDeAssinatura("customer.subscription.updated", { clienteId: marca, assinaturaId: "sub_av", status: "trialing", cartao: true, comTeste: true, criadoEm: T0 + 10, inicio: T0, fim: T0 + 7 * DIA }), enviar);
    expect(enviar).toHaveBeenCalledTimes(quantos);

    // Pagou.
    const paga = eventoDeFatura("invoice.paid", { clienteId: marca, assinaturaId: "sub_av", criadoEm: T0 + 20, inicio: T0, fim: T0 + 90 * DIA, valorPago: 119_100 });
    await tratarEventoDoStripe(paga, enviar);
    expect(enviar).toHaveBeenCalledTimes(quantos * 2);
    expect(enviar.mock.calls[quantos][0].assunto).toContain("Assinatura nova paga");
    await tratarEventoDoStripe(paga, enviar);
    expect(enviar).toHaveBeenCalledTimes(quantos * 2);

    // Cartão recusado na renovação.
    await tratarEventoDoStripe(eventoDeFatura("invoice.payment_failed", { clienteId: marca, assinaturaId: "sub_av", criadoEm: T0 + 30 * DIA }), enviar);
    expect(enviar).toHaveBeenCalledTimes(quantos * 3);
    expect(enviar.mock.calls[quantos * 2][0].assunto).toContain("Cartão recusado");

    // Cancelou.
    await tratarEventoDoStripe(eventoDeAssinatura("customer.subscription.deleted", { clienteId: marca, assinaturaId: "sub_av", criadoEm: T0 + 40 * DIA }), enviar);
    expect(enviar).toHaveBeenCalledTimes(quantos * 4);
    expect(enviar.mock.calls[quantos * 3][0].assunto).toContain("Assinatura cancelada");
  });

  it("o e-mail traz só o nome do negócio (escapado) e o que aconteceu, e uma falha no envio não derruba o aviso do Stripe", async () => {
    const enviar = vi.fn<(o: Email) => Promise<void>>(async () => {
      throw new Error("Resend fora do ar");
    });
    const resultado = await tratarEventoDoStripe(eventoDeAssinatura("customer.subscription.created", { clienteId: marca, assinaturaId: "sub_fala", status: "trialing", comTeste: true, criadoEm: T0, inicio: T0, fim: T0 + 7 * DIA }), enviar);
    expect(resultado).toBe("tratado");
    const { html } = enviar.mock.calls[0][0] as { html: string };
    expect(html).toContain("&lt;b&gt;Boa&lt;/b&gt;");
    expect(html).not.toContain("<b>Boa</b>");
    expect(html).not.toMatch(/cus_|sub_|pm_|cartao [0-9]/);
  });

  it("evento que não é nosso ou repetido nunca avisa", async () => {
    const enviar = vi.fn<(o: Email) => Promise<void>>(async () => undefined);
    await tratarEventoDoStripe(eventoDeAssinatura("customer.subscription.created", { assinaturaId: "sub_outro", metadata: { produto: "odontotech" }, status: "trialing" }), enviar);
    expect(enviar).not.toHaveBeenCalled();
  });
});
