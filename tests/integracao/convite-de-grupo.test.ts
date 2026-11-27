/**
 * Convite de grupo: o link de uso único, a primeira empresa, as outras empresas do dono e a equipe. Contra o Postgres local, sem rede e sem e-mail de verdade (fora de produção o
 * e-mail cai no log).
 */
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ set: () => undefined, get: () => undefined, delete: () => undefined }), headers: async () => new Headers() }));

import { db, getPool } from "@/db";
import { account, cadastrosProprios, clientes, convitesDeGrupo, marcasDoGrupo, membrosMarca, nichos, user } from "@/db/schema";
import { criarLimitador } from "@/lib/limite-de-taxa";
import { criarMarca, darAcesso, NOME_SEM_NOME_AINDA } from "@/servicos/clientes";
import {
  aceitarConviteDeGrupo,
  codigoTemFormatoValido,
  conviteValido,
  criarConviteDeGrupo,
  criarEmpresaDoGrupo,
  darAcessoNaEmpresa,
  empresaEhDoGrupo,
  desativarConviteDeGrupo,
  ErroConviteDeGrupo,
  hashDoCodigoDoConvite,
  gerarCodigoDoConvite,
  LIMITES_DO_CONVITE_DE_GRUPO,
  membrosParaODono,
  situacaoDasEmpresas,
  tirarAcessoDaEmpresa,
} from "@/servicos/convite-de-grupo";
import { limparSenhaProvisoria } from "@/servicos/senha";

import { resetarSchema } from "../../scripts/resetar-schema";

let nichoId: number;

beforeAll(async () => {
  await resetarSchema(db());
  const [n] = await db().insert(nichos).values({ slug: "odontologia-teste", nome: "Odontologia teste" }).returning({ id: nichos.id });
  nichoId = n.id;
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

let sequencia = 0;
const opcoes = () => ({ ip: "1.1.1.1", limitador: criarLimitador({ janelaMs: 1000, maximo: 10_000 }), avisar: async () => undefined });
function dadosBons(sobre: Record<string, unknown> = {}) {
  sequencia += 1;
  return { nome: "Leandro Dono", negocio: `Clinica ${sequencia}`, email: `leandro${sequencia}@grupo.teste`, senha: "SenhaBoa123", aceite: true, ...sobre };
}

async function novoConvite(sobre: Partial<Parameters<typeof criarConviteDeGrupo>[0]> = {}) {
  return criarConviteDeGrupo({ rotulo: "Grupo de teste", nichoId, ...sobre });
}

/** Cria o convite e aceita: devolve o dono e a primeira empresa. */
async function donoNovo(sobre: Partial<Parameters<typeof criarConviteDeGrupo>[0]> = {}) {
  const convite = await novoConvite(sobre);
  const dados = dadosBons();
  const r = await aceitarConviteDeGrupo(convite.codigo, dados, opcoes());
  if (!r.ok) throw new Error(`aceite recusado: ${JSON.stringify(r)}`);
  return { convite, dados, usuarioId: r.usuarioId, clienteId: r.clienteId };
}

describe("o código", () => {
  it("tem 43 caracteres base64url e só o hash vai ao banco", async () => {
    const codigo = gerarCodigoDoConvite();
    expect(codigoTemFormatoValido(codigo)).toBe(true);
    expect(codigoTemFormatoValido("curto")).toBe(false);
    expect(codigoTemFormatoValido(`${codigo}x`)).toBe(false);
    expect(codigoTemFormatoValido(null)).toBe(false);
    expect(hashDoCodigoDoConvite(codigo)).toMatch(/^[0-9a-f]{64}$/);

    const convite = await novoConvite();
    const [linha] = await db().select().from(convitesDeGrupo).where(eq(convitesDeGrupo.id, convite.id));
    expect(linha.codigoHash).toBe(hashDoCodigoDoConvite(convite.codigo));
    expect(linha.codigoHash).not.toContain(convite.codigo);
  });

  it("recusa ramo que não existe, empresas demais e validade longa demais", async () => {
    await expect(criarConviteDeGrupo({ rotulo: "x1", nichoId: 999_999 })).rejects.toThrow(/ramo/);
    await expect(novoConvite({ marcasMax: 21 })).rejects.toThrow(/empresas/);
    await expect(novoConvite({ dias: 31 })).rejects.toThrow(/validade/);
  });
});

describe("aceitar o link", () => {
  it("cria o usuário, a empresa no ramo, o dono, o vínculo do grupo, a cortesia e usa o convite, sem cadastro próprio", async () => {
    const { convite, dados, usuarioId, clienteId } = await donoNovo();

    const [u] = await db().select().from(user).where(eq(user.id, usuarioId));
    expect(u.email).toBe(dados.email);
    expect(u.emailVerified).toBe(false);
    expect(u.role).toBe("cliente");
    expect(await db().select().from(account).where(and(eq(account.userId, usuarioId), eq(account.providerId, "credential")))).toHaveLength(1);

    const [marca] = await db().select().from(clientes).where(eq(clientes.id, clienteId));
    expect(marca.nichoId).toBe(nichoId);
    expect(marca.cortesia).toBe(true);
    expect(marca.nome).toBe(dados.negocio);

    const [membro] = await db().select().from(membrosMarca).where(and(eq(membrosMarca.clienteId, clienteId), eq(membrosMarca.usuarioId, usuarioId)));
    expect(membro.papel).toBe("dono");
    expect(await db().select().from(marcasDoGrupo).where(eq(marcasDoGrupo.clienteId, clienteId))).toHaveLength(1);
    expect(await db().select().from(cadastrosProprios).where(eq(cadastrosProprios.usuarioId, usuarioId))).toHaveLength(0);

    const [usado] = await db().select().from(convitesDeGrupo).where(eq(convitesDeGrupo.id, convite.id));
    expect(usado.usadoPor).toBe(usuarioId);
    expect(usado.usadoEm).not.toBeNull();
  });

  it("--sem-cortesia: a empresa nasce sem cortesia", async () => {
    const { clienteId } = await donoNovo({ cortesia: false });
    const [marca] = await db().select().from(clientes).where(eq(clientes.id, clienteId));
    expect(marca.cortesia).toBe(false);
  });

  it("o segundo uso do mesmo link é recusado", async () => {
    const { convite } = await donoNovo();
    const r = await aceitarConviteDeGrupo(convite.codigo, dadosBons(), opcoes());
    expect(r).toEqual({ ok: false, motivo: "invalido" });
    expect(await conviteValido(convite.codigo)).toEqual({ valido: false });
  });

  it("convite vencido e convite desativado são recusados, com a mesma resposta", async () => {
    const vencido = await novoConvite();
    const depoisDoPrazo = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);
    expect(await aceitarConviteDeGrupo(vencido.codigo, dadosBons(), { ...opcoes(), agora: depoisDoPrazo })).toEqual({ ok: false, motivo: "invalido" });

    const desativado = await novoConvite();
    expect(await desativarConviteDeGrupo(desativado.id)).toBe(true);
    expect(await aceitarConviteDeGrupo(desativado.codigo, dadosBons(), opcoes())).toEqual({ ok: false, motivo: "invalido" });

    expect(await aceitarConviteDeGrupo(gerarCodigoDoConvite(), dadosBons(), opcoes())).toEqual({ ok: false, motivo: "invalido" });
  });

  it("formulário errado em link que não vale responde 'inválido', e em link que vale aponta os campos", async () => {
    const convite = await novoConvite();
    const ruim = await aceitarConviteDeGrupo(convite.codigo, dadosBons({ senha: "curta", aceite: false }), opcoes());
    expect(ruim.ok).toBe(false);
    if (!ruim.ok && ruim.motivo === "campos") expect(Object.keys(ruim.erros).sort()).toEqual(["aceite", "senha"]);
    else throw new Error("esperava campos");
    // O link continua valendo: o erro de campo não gasta o convite.
    expect((await conviteValido(convite.codigo)).valido).toBe(true);

    const vencido = await novoConvite();
    const depois = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);
    expect(await aceitarConviteDeGrupo(vencido.codigo, dadosBons({ senha: "curta" }), { ...opcoes(), agora: depois })).toEqual({ ok: false, motivo: "invalido" });
  });

  it("e-mail que já tem conta: não cria nada e não gasta o convite", async () => {
    const existente = await donoNovo();
    const convite = await novoConvite();
    const marcasAntes = (await db().select().from(clientes)).length;
    const r = await aceitarConviteDeGrupo(convite.codigo, dadosBons({ email: existente.dados.email.toUpperCase() }), opcoes());
    expect(r).toEqual({ ok: false, motivo: "jaTemConta" });
    expect((await db().select().from(clientes)).length).toBe(marcasAntes);
    const [linha] = await db().select().from(convitesDeGrupo).where(eq(convitesDeGrupo.id, convite.id));
    expect(linha.usadoEm).toBeNull();
    expect((await conviteValido(convite.codigo)).valido).toBe(true);
  });

  it("dois usos ao mesmo tempo: só um passa", async () => {
    const convite = await novoConvite();
    const [a, b] = await Promise.all([aceitarConviteDeGrupo(convite.codigo, dadosBons(), opcoes()), aceitarConviteDeGrupo(convite.codigo, dadosBons(), opcoes())]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    const perdedor = a.ok ? b : a;
    expect(perdedor).toEqual({ ok: false, motivo: "invalido" });
    expect(await db().select().from(marcasDoGrupo).where(eq(marcasDoGrupo.conviteId, convite.id))).toHaveLength(1);
  });

  it("o limite por IP segura quem tenta demais", async () => {
    const limitador = criarLimitador({ janelaMs: 60_000, maximo: 1 });
    const convite = await novoConvite();
    await aceitarConviteDeGrupo(convite.codigo, dadosBons({ senha: "curta" }), { ...opcoes(), limitador });
    expect(await aceitarConviteDeGrupo(convite.codigo, dadosBons(), { ...opcoes(), limitador })).toEqual({ ok: false, motivo: "limite" });
  });
});

describe("outras empresas do dono", () => {
  it("cria até o máximo do convite e recusa a seguinte", async () => {
    const { usuarioId, convite } = await donoNovo({ marcasMax: 2 });
    expect(await situacaoDasEmpresas(usuarioId)).toEqual({ usadas: 1, maximo: 2 });
    const { clienteId } = await criarEmpresaDoGrupo(usuarioId, "  Segunda   Clinica ");
    const [marca] = await db().select().from(clientes).where(eq(clientes.id, clienteId));
    expect(marca.nome).toBe("Segunda Clinica");
    expect(marca.nichoId).toBe(nichoId);
    expect(marca.cortesia).toBe(true);
    expect(await situacaoDasEmpresas(usuarioId)).toEqual({ usadas: 2, maximo: 2 });
    await expect(criarEmpresaDoGrupo(usuarioId, "Terceira")).rejects.toMatchObject({ motivo: "cheio" });
    expect(await db().select().from(marcasDoGrupo).where(eq(marcasDoGrupo.conviteId, convite.id))).toHaveLength(2);
  });

  it("dois pedidos ao mesmo tempo não passam do máximo", async () => {
    const { usuarioId, convite } = await donoNovo({ marcasMax: 2 });
    const resultados = await Promise.allSettled([criarEmpresaDoGrupo(usuarioId, "Filial A"), criarEmpresaDoGrupo(usuarioId, "Filial B")]);
    expect(resultados.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db().select().from(marcasDoGrupo).where(eq(marcasDoGrupo.conviteId, convite.id))).toHaveLength(2);
  });

  it("recusa quem não é dono de grupo e nome inválido", async () => {
    const [semGrupo] = await db().insert(user).values({ id: "sem-grupo", name: "Sem Grupo", email: "semgrupo@grupo.teste", emailVerified: true, role: "cliente" as unknown as "admin" }).returning();
    await expect(criarEmpresaDoGrupo(semGrupo.id, "Qualquer")).rejects.toMatchObject({ motivo: "semPermissao" });
    expect(await situacaoDasEmpresas(semGrupo.id)).toBeNull();
    const { usuarioId } = await donoNovo();
    await expect(criarEmpresaDoGrupo(usuarioId, "x")).rejects.toMatchObject({ motivo: "nomeInvalido" });
  });

  it("convite desativado depois: o dono perde o poder de criar E o de dar e tirar acesso", async () => {
    const { usuarioId, convite, clienteId } = await donoNovo();
    await darAcessoNaEmpresa(usuarioId, clienteId, "equipe.antes@grupo.teste");
    expect(await empresaEhDoGrupo(clienteId)).toBe(true);
    await desativarConviteDeGrupo(convite.id);
    await expect(criarEmpresaDoGrupo(usuarioId, "Outra")).rejects.toBeInstanceOf(ErroConviteDeGrupo);
    await expect(darAcessoNaEmpresa(usuarioId, clienteId, "equipe.depois@grupo.teste")).rejects.toMatchObject({ motivo: "semPermissao" });
    const [antes] = await db().select().from(user).where(eq(user.email, "equipe.antes@grupo.teste"));
    await expect(tirarAcessoDaEmpresa(usuarioId, clienteId, antes.id)).rejects.toMatchObject({ motivo: "semPermissao" });
    expect(await empresaEhDoGrupo(clienteId)).toBe(false);
    // O que já existe continua: a pessoa ligada antes segue na empresa.
    expect(await db().select().from(membrosMarca).where(and(eq(membrosMarca.usuarioId, antes.id), eq(membrosMarca.clienteId, clienteId)))).toHaveLength(1);
  });
});

describe("a equipe da empresa", () => {
  let registro: { mock: { calls: unknown[][] } };
  beforeEach(() => {
    registro = vi.spyOn(console, "log").mockImplementation(() => undefined);
  });
  /** Os corpos dos e-mails simulados que saíram para este endereço (o assunto vem numa linha e o corpo na seguinte). */
  const emailsPara = (email: string) => {
    const linhas = registro.mock.calls.map((c) => String(c[0]));
    return linhas.flatMap((l, i) => (l.startsWith(`[e-mail simulado] para ${email},`) ? [linhas[i + 1] ?? ""] : []));
  };

  it("o dono dá acesso: nasce usuário sem empresa própria, membro da empresa, e a resposta não traz senha", async () => {
    const { usuarioId, clienteId } = await donoNovo();
    const r = await darAcessoNaEmpresa(usuarioId, clienteId, "  Pessoa.Nova@Grupo.Teste ");
    expect(r).toEqual({ email: "pessoa.nova@grupo.teste" });
    expect(JSON.stringify(r)).not.toMatch(/senha/i);

    const [novo] = await db().select().from(user).where(eq(user.email, "pessoa.nova@grupo.teste"));
    const vinculos = await db().select().from(membrosMarca).where(eq(membrosMarca.usuarioId, novo.id));
    expect(vinculos).toHaveLength(1);
    expect(vinculos[0]).toMatchObject({ clienteId, papel: "membro" });
    // Sem marca própria: a única marca dele é a do grupo, e não é de cadastro próprio.
    expect(await db().select().from(cadastrosProprios).where(eq(cadastrosProprios.usuarioId, novo.id))).toHaveLength(0);
  });

  it("e-mail que já tem conta é ligado à empresa e recebe a MESMA resposta do caso novo", async () => {
    const { usuarioId, clienteId } = await donoNovo();
    const outra = await donoNovo();
    // Conta de e-mail confirmado (uma de convite ainda sem confirmar não é ligada: teste abaixo).
    await db().update(user).set({ emailVerified: true }).where(eq(user.id, outra.usuarioId));
    const novo = await darAcessoNaEmpresa(usuarioId, clienteId, "mesma.resposta.nova@grupo.teste");
    const existente = await darAcessoNaEmpresa(usuarioId, clienteId, outra.dados.email);
    expect(Object.keys(existente)).toEqual(Object.keys(novo));
    expect(existente.email).toBe(outra.dados.email);
    expect(await db().select().from(membrosMarca).where(and(eq(membrosMarca.usuarioId, outra.usuarioId), eq(membrosMarca.clienteId, clienteId)))).toHaveLength(1);
    // Dar de novo a quem já tem acesso responde igual e não duplica.
    expect(await darAcessoNaEmpresa(usuarioId, clienteId, outra.dados.email)).toEqual(existente);
    expect(await db().select().from(membrosMarca).where(and(eq(membrosMarca.usuarioId, outra.usuarioId), eq(membrosMarca.clienteId, clienteId)))).toHaveLength(1);
  });

  it("membro não convida, dono de marca fora do grupo não convida e e-mail torto é recusado", async () => {
    const { usuarioId, clienteId } = await donoNovo();
    await darAcessoNaEmpresa(usuarioId, clienteId, "membro.que.tenta@grupo.teste");
    const [membro] = await db().select().from(user).where(eq(user.email, "membro.que.tenta@grupo.teste"));
    await expect(darAcessoNaEmpresa(membro.id, clienteId, "alguem@grupo.teste")).rejects.toMatchObject({ motivo: "semPermissao" });

    // Dono de uma marca comum (fora do grupo).
    const [foraDoGrupo] = await db().insert(user).values({ id: "dono-fora", name: "Dono Fora", email: "donofora@grupo.teste", emailVerified: true, role: "cliente" as unknown as "admin" }).returning();
    const marcaComum = await criarMarca({ nome: "Marca Comum", nichoId });
    await db().insert(membrosMarca).values({ usuarioId: foraDoGrupo.id, clienteId: marcaComum.id, papel: "dono" });
    await expect(darAcessoNaEmpresa(foraDoGrupo.id, marcaComum.id, "alguem@grupo.teste")).rejects.toMatchObject({ motivo: "semPermissao" });

    await expect(darAcessoNaEmpresa(usuarioId, clienteId, "isto nao e email")).rejects.toMatchObject({ motivo: "emailInvalido" });
  });

  it("o dono de um grupo não dá acesso em empresa de outro grupo", async () => {
    const a = await donoNovo();
    const b = await donoNovo();
    await expect(darAcessoNaEmpresa(a.usuarioId, b.clienteId, "invasor@grupo.teste")).rejects.toMatchObject({ motivo: "semPermissao" });
    expect(await db().select().from(user).where(eq(user.email, "invasor@grupo.teste"))).toHaveLength(0);
  });

  it("quem criou conta sozinho e ainda não confirmou o e-mail não é ligado, e a resposta é a mesma", async () => {
    const { usuarioId, clienteId } = await donoNovo();
    const marca = await criarMarca({ nome: "Marca do cadastro", nichoId });
    await db().insert(user).values({ id: "nao-confirmado", name: "Nao Confirmado", email: "naoconfirmado@grupo.teste", emailVerified: false, role: "cliente" as unknown as "admin" });
    await db().insert(cadastrosProprios).values({ usuarioId: "nao-confirmado", clienteId: marca.id, termosVersao: "x" });
    const r = await darAcessoNaEmpresa(usuarioId, clienteId, "naoconfirmado@grupo.teste");
    expect(r).toEqual({ email: "naoconfirmado@grupo.teste" });
    expect(await db().select().from(membrosMarca).where(and(eq(membrosMarca.usuarioId, "nao-confirmado"), eq(membrosMarca.clienteId, clienteId)))).toHaveLength(0);
  });

  it("conta criada pelo link do convite e ainda sem e-mail confirmado não é ligada, nem por aqui nem por darAcesso do admin", async () => {
    const { usuarioId, clienteId } = await donoNovo();
    const outra = await donoNovo();
    // `outra` abriu o link, escolheu a senha e nunca confirmou o e-mail: qualquer um poderia ter feito isso com o e-mail de outra pessoa.
    const r = await darAcessoNaEmpresa(usuarioId, clienteId, outra.dados.email);
    expect(r).toEqual({ email: outra.dados.email });
    expect(await db().select().from(membrosMarca).where(and(eq(membrosMarca.usuarioId, outra.usuarioId), eq(membrosMarca.clienteId, clienteId)))).toHaveLength(0);
    const marca = await criarMarca({ nome: "Marca do admin", nichoId });
    await expect(darAcesso(marca.id, "Outra", outra.dados.email)).rejects.toThrow();
    // Depois de confirmar o e-mail, passa.
    await db().update(user).set({ emailVerified: true }).where(eq(user.id, outra.usuarioId));
    await darAcessoNaEmpresa(usuarioId, clienteId, outra.dados.email);
    expect(await db().select().from(membrosMarca).where(and(eq(membrosMarca.usuarioId, outra.usuarioId), eq(membrosMarca.clienteId, clienteId)))).toHaveLength(1);
  });

  it("dar acesso de novo a quem ainda não escolheu a senha reenvia o link de 48 horas, com o nome de quem deu; quem já tem senha recebe o aviso de entrar", async () => {
    const { usuarioId, clienteId } = await donoNovo();
    await darAcessoNaEmpresa(usuarioId, clienteId, "sem.senha.ainda@grupo.teste");
    expect(emailsPara("sem.senha.ainda@grupo.teste")).toHaveLength(1);
    // O pedido repetido (já é membro) manda de novo o e-mail COM o link para escolher a senha.
    await darAcessoNaEmpresa(usuarioId, clienteId, "sem.senha.ainda@grupo.teste");
    const corpos = emailsPara("sem.senha.ainda@grupo.teste");
    expect(corpos).toHaveLength(2);
    for (const corpo of corpos) {
      expect(corpo).toContain("Entrar e escolher a senha");
      expect(corpo).toContain("Leandro Dono deu a você acesso");
    }
    // Quem já tem senha: o aviso simples, sem o link de escolher a senha.
    const [novo] = await db().select().from(user).where(eq(user.email, "sem.senha.ainda@grupo.teste"));
    await limparSenhaProvisoria(novo.id);
    await darAcessoNaEmpresa(usuarioId, clienteId, "sem.senha.ainda@grupo.teste");
    const ultimo = emailsPara("sem.senha.ainda@grupo.teste").at(-1) ?? "";
    expect(ultimo).not.toContain("escolher a senha");
    expect(ultimo).toContain("Suas marcas");
  });

  it("o laço de dar e tirar acesso não zera o teto: as contas novas do dia são contadas no banco", async () => {
    const { usuarioId, clienteId } = await donoNovo();
    for (let i = 0; i < LIMITES_DO_CONVITE_DE_GRUPO.contasNovasPorDia; i += 1) {
      await db().insert(user).values({ id: `lixo-${i}`, name: NOME_SEM_NOME_AINDA, email: `lixo${i}@grupo.teste`, emailVerified: false, role: "cliente" as unknown as "admin" });
    }
    await expect(darAcessoNaEmpresa(usuarioId, clienteId, "mais.um.lixo@grupo.teste")).rejects.toMatchObject({ motivo: "limite" });
    expect(await db().select().from(user).where(eq(user.email, "mais.um.lixo@grupo.teste"))).toHaveLength(0);
    await db().delete(user).where(sql`${user.id} like 'lixo-%'`);
  });

  it("a lista do dono mostra só o e-mail de quem ele ligou, e o nome dele continua", () => {
    const lista = membrosParaODono([
      { nome: "Leandro Dono", email: "l@g.teste", papel: "dono" as const },
      { nome: "Gustavo Silva", email: "gustavo@g.teste", papel: "membro" as const },
    ]);
    expect(lista[0].nome).toBe("Leandro Dono");
    expect(lista[1].nome).toBe("gustavo@g.teste");
  });

  it("limite de 20 acessos por dia por dono", async () => {
    const { usuarioId, clienteId } = await donoNovo();
    for (let i = 0; i < 20; i += 1) await darAcessoNaEmpresa(usuarioId, clienteId, `lote${i}@grupo.teste`);
    await expect(darAcessoNaEmpresa(usuarioId, clienteId, "vigesimo.primeiro@grupo.teste")).rejects.toMatchObject({ motivo: "limite" });
    // Acesso dado há mais de um dia sai da conta.
    await db().update(membrosMarca).set({ criadoEm: sql`now() - interval '2 days'` }).where(and(eq(membrosMarca.clienteId, clienteId), eq(membrosMarca.papel, "membro")));
    await expect(darAcessoNaEmpresa(usuarioId, clienteId, "agora.pode@grupo.teste")).resolves.toEqual({ email: "agora.pode@grupo.teste" });
  });

  it("tirar acesso: o dono tira um membro, e nunca tira a si mesmo nem outro dono; membro não tira", async () => {
    const { usuarioId, clienteId } = await donoNovo();
    await darAcessoNaEmpresa(usuarioId, clienteId, "sai.logo@grupo.teste");
    await darAcessoNaEmpresa(usuarioId, clienteId, "fica.aqui@grupo.teste");
    const [sai] = await db().select().from(user).where(eq(user.email, "sai.logo@grupo.teste"));
    const [fica] = await db().select().from(user).where(eq(user.email, "fica.aqui@grupo.teste"));

    await expect(tirarAcessoDaEmpresa(fica.id, clienteId, sai.id)).rejects.toMatchObject({ motivo: "semPermissao" });
    await tirarAcessoDaEmpresa(usuarioId, clienteId, sai.id);
    expect(await db().select().from(membrosMarca).where(and(eq(membrosMarca.usuarioId, sai.id), eq(membrosMarca.clienteId, clienteId)))).toHaveLength(0);

    await expect(tirarAcessoDaEmpresa(usuarioId, clienteId, usuarioId)).rejects.toThrow();
    expect(await db().select().from(membrosMarca).where(and(eq(membrosMarca.usuarioId, usuarioId), eq(membrosMarca.clienteId, clienteId)))).toHaveLength(1);
  });
});
