import { describe, expect, it } from "vitest";

import { dadosFixosSchema, ErroAcessoNegado, fontesDeLeituraMudaram, garantirSessaoAdmin } from "./clientes";

describe("garantirSessaoAdmin", () => {
  it("passa para sessao de admin", () => {
    expect(() => garantirSessaoAdmin({ user: { role: "admin" } })).not.toThrow();
  });

  it("recusa sessao de cliente", () => {
    expect(() => garantirSessaoAdmin({ user: { role: "cliente" } })).toThrow(ErroAcessoNegado);
  });

  it("recusa sessao sem papel", () => {
    expect(() => garantirSessaoAdmin({ user: {} })).toThrow(ErroAcessoNegado);
  });

  it("recusa sessao nula (nao autenticado)", () => {
    expect(() => garantirSessaoAdmin(null)).toThrow(ErroAcessoNegado);
  });
});

describe("dadosFixosSchema (validacao dos dados fixos do briefing)", () => {
  const base = { nome: "Sorriso Novo", alcance: "brasil" as const, persona: "negocio" as const };

  it("aceita nome, alcance brasil, persona e um nicho da lista", () => {
    const resultado = dadosFixosSchema.safeParse({ ...base, nichoId: 1 });
    expect(resultado.success).toBe(true);
  });

  it("aceita ramo por texto livre quando o cliente escolhe outro", () => {
    const resultado = dadosFixosSchema.safeParse({ ...base, ramoOutro: "clínica veterinária" });
    expect(resultado.success).toBe(true);
  });

  it("recusa sem nichoId e sem ramoOutro", () => {
    const resultado = dadosFixosSchema.safeParse(base);
    expect(resultado.success).toBe(false);
  });

  it("recusa nome em branco", () => {
    const resultado = dadosFixosSchema.safeParse({ ...base, nichoId: 1, nome: "   " });
    expect(resultado.success).toBe(false);
  });

  it("recusa persona fora da lista", () => {
    const resultado = dadosFixosSchema.safeParse({ ...base, nichoId: 1, persona: "outra-coisa" });
    expect(resultado.success).toBe(false);
  });

  it("alcance local exige regiao, brasil nao", () => {
    expect(dadosFixosSchema.safeParse({ ...base, nichoId: 1, alcance: "local" }).success).toBe(false);
    expect(
      dadosFixosSchema.safeParse({ ...base, nichoId: 1, alcance: "local", regiao: "Campinas" }).success,
    ).toBe(true);
  });

  it("site precisa ser https com dominio, nunca endereco de rede interna", () => {
    expect(dadosFixosSchema.safeParse({ ...base, nichoId: 1, site: "https://drwash.com.br" }).success).toBe(true);
    expect(dadosFixosSchema.safeParse({ ...base, nichoId: 1, site: "http://drwash.com.br" }).success).toBe(false);
    expect(dadosFixosSchema.safeParse({ ...base, nichoId: 1, site: "https://localhost" }).success).toBe(false);
  });

  it("regiao, site, perfis e quem grava sao opcionais", () => {
    const resultado = dadosFixosSchema.safeParse({
      ...base,
      nichoId: 1,
      perfis: { instagram: "@sorriso" },
    });
    expect(resultado.success).toBe(true);
  });

  it("aceita os quatro valores de quem grava (V12c, item 3)", () => {
    for (const valor of ["propria_pessoa", "pessoa_e_equipe", "equipe", "outra_pessoa"] as const) {
      expect(dadosFixosSchema.safeParse({ ...base, nichoId: 1, quemGrava: valor }).success).toBe(true);
    }
  });
});

/** E38 PR 2: só relê o site e as redes quando algo que se lê mudou. */
describe("fontesDeLeituraMudaram", () => {
  const SEM_PERFIS = { instagram: null, tiktok: null, youtube: null };

  it("primeira vez: marca sem nada antes e com site agora", () => {
    expect(fontesDeLeituraMudaram({ site: null, perfis: SEM_PERFIS }, { site: "https://loja.exemplo.test", perfis: SEM_PERFIS })).toBe(true);
  });

  it("sem mudança nenhuma, não lê de novo (salvar a Conta sem mexer não bate no site)", () => {
    const perfis = { instagram: "loja", tiktok: null, youtube: null };
    expect(fontesDeLeituraMudaram({ site: "https://loja.exemplo.test", perfis }, { site: "https://loja.exemplo.test", perfis })).toBe(false);
  });

  it("ignora espaço sobrando e o TikTok (não é lido)", () => {
    expect(
      fontesDeLeituraMudaram(
        { site: "https://loja.exemplo.test", perfis: { instagram: "loja", tiktok: null, youtube: null } },
        { site: " https://loja.exemplo.test ", perfis: { instagram: "loja ", tiktok: "outro", youtube: null } },
      ),
    ).toBe(false);
  });

  it("mudou o Instagram, o YouTube ou o site", () => {
    const base = { site: "https://loja.exemplo.test", perfis: { instagram: "loja", tiktok: null, youtube: "@canal" } };
    expect(fontesDeLeituraMudaram(base, { ...base, perfis: { ...base.perfis, instagram: "loja2" } })).toBe(true);
    expect(fontesDeLeituraMudaram(base, { ...base, perfis: { ...base.perfis, youtube: "@canal2" } })).toBe(true);
    expect(fontesDeLeituraMudaram(base, { ...base, site: "https://loja2.exemplo.test" })).toBe(true);
  });

  it("a pessoa tirou tudo: mudou, mas não há o que ler, então não enfileira", () => {
    expect(
      fontesDeLeituraMudaram({ site: "https://loja.exemplo.test", perfis: { instagram: "loja", tiktok: null, youtube: null } }, { site: null, perfis: SEM_PERFIS }),
    ).toBe(false);
  });

  it("marca sem registro anterior (undefined) conta como primeira vez", () => {
    expect(fontesDeLeituraMudaram(undefined, { site: null, perfis: { instagram: "loja", tiktok: null, youtube: null } })).toBe(true);
  });
});
