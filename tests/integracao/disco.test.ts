/**
 * O job `vigiar-disco` e o aviso do alarme do disco (29/10/2026), contra o Postgres local, com o disco, o e-mail e o Sentry simulados. Prova: o nível (atenção em 80%, crítico em 90%), o aviso
 * único por nível por dia, a marca que só vale quando o envio deu certo, o "voltou ao normal" uma vez, a limpeza pedida no crítico, o estado que o Início do admin lê e o e-mail que sai
 * para cada admin pelo caminho de sempre.
 */
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import { db, getPool } from "@/db";
import { configuracaoAdmin, user } from "@/db/schema";
import { rodarVigiarDisco, type DepsDoVigiarDisco } from "@/jobs/vigiar-disco";
import { inicioDoAdmin } from "@/servicos/admin-inicio";
import { avisarDisco } from "@/servicos/aviso-de-disco";
import { CHAVE_DO_ALARME_DE_DISCO, lerEstadoDoAlarme, type MedidaDoDisco } from "@/servicos/disco";
import type { NumerosDoAviso } from "@/textos/aviso-disco";

import { resetarSchema } from "../../scripts/resetar-schema";

const LIMITES = { atencao: 80, critico: 90 };
const MIN = 60_000;
const DIA_MS = 24 * 60 * MIN;
const MEIO_DIA = new Date("2026-10-29T15:00:00.000Z");

function medida(usadoPercentual: number): MedidaDoDisco {
  const total = 100_000_000_000;
  return { totalBytes: total, livreBytes: Math.round(total * (1 - usadoPercentual / 100)), usadoPercentual, edicaoBytes: 4_000_000_000, publicarBytes: 100_000_000 };
}

type Espioes = {
  avisar: Mock<NonNullable<DepsDoVigiarDisco["avisar"]>>;
  sentry: Mock<NonNullable<DepsDoVigiarDisco["sentry"]>>;
  limparAgora: Mock<NonNullable<DepsDoVigiarDisco["limparAgora"]>>;
};

function espioes(enviado = true): Espioes {
  return {
    avisar: vi.fn<NonNullable<DepsDoVigiarDisco["avisar"]>>(async () => (enviado ? { enviado: true, destinatarios: 1 } : { enviado: false, motivo: "falha no envio" as const })),
    sentry: vi.fn<NonNullable<DepsDoVigiarDisco["sentry"]>>(),
    limparAgora: vi.fn<NonNullable<DepsDoVigiarDisco["limparAgora"]>>(async () => true),
  };
}

function rodar(usado: number, e: Espioes, quando: Date = MEIO_DIA, extra: Partial<DepsDoVigiarDisco> = {}) {
  return rodarVigiarDisco({ agora: () => quando, medir: async () => medida(usado), limites: LIMITES, avisar: e.avisar, sentry: e.sentry, limparAgora: e.limparAgora, ...extra });
}

const tipos = (e: Espioes) => e.avisar.mock.calls.map((c) => c[0]);
const depois = (minutos: number) => new Date(MEIO_DIA.getTime() + minutos * MIN);

beforeAll(async () => {
  await resetarSchema(db());
}, 120_000);

afterAll(async () => {
  await getPool().end();
});

beforeEach(async () => {
  await db().delete(configuracaoAdmin).where(eq(configuracaoAdmin.chave, CHAVE_DO_ALARME_DE_DISCO));
  await db().delete(user);
});

describe("vigiar-disco: o nível e o aviso", () => {
  it("disco normal: não avisa, não limpa, guarda a medida e o resumo tem só os números", async () => {
    const e = espioes();
    const resumo = await rodar(55.5, e);

    expect(e.avisar).not.toHaveBeenCalled();
    expect(e.sentry).not.toHaveBeenCalled();
    expect(e.limparAgora).not.toHaveBeenCalled();
    expect(resumo).toEqual({ nivel: "normal", usadoPercentual: 55.5, livreGb: 44.5, edicaoMb: 4000, publicarMb: 100, aviso: null, limpezaPedida: false });
    expect(await lerEstadoDoAlarme()).toMatchObject({ nivel: "normal", usadoPercentual: 55.5, voltaPendente: false });
  });

  it("atenção em 80%: um e-mail e um registro no Sentry; a medida seguinte do mesmo dia não repete e não limpa", async () => {
    const e = espioes();
    const resumo = await rodar(81, e);
    expect(resumo).toMatchObject({ nivel: "atencao", aviso: "atencao", limpezaPedida: false });
    expect(tipos(e)).toEqual(["atencao"]);
    expect(e.sentry).toHaveBeenCalledTimes(1);
    expect(e.avisar.mock.calls[0][1]).toMatchObject({ usadoPercentual: 81, limiteAtencao: 80, limiteCritico: 90 });

    await rodar(82, e, depois(15));
    await rodar(84, e, depois(30));
    expect(tipos(e)).toEqual(["atencao"]);
    expect(e.sentry).toHaveBeenCalledTimes(1);
    expect(e.limparAgora).not.toHaveBeenCalled();
  });

  it("79,9% ainda é normal e 80% já é atenção", async () => {
    const e = espioes();
    expect((await rodar(79.9, e)).nivel).toBe("normal");
    expect((await rodar(80, e, depois(15))).nivel).toBe("atencao");
  });

  it("crítico em 90%: avisa o crítico, pede a limpeza na hora a cada medida e não repete o e-mail no dia", async () => {
    const e = espioes();
    const primeira = await rodar(91, e);
    expect(primeira).toMatchObject({ nivel: "critico", aviso: "critico", limpezaPedida: true });
    await rodar(92, e, depois(15));

    expect(tipos(e)).toEqual(["critico"]);
    expect(e.sentry).toHaveBeenCalledTimes(1);
    expect(e.sentry.mock.calls[0][0]).toBe("critico");
    expect(e.limparAgora).toHaveBeenCalledTimes(2);
  });

  it("um aviso por nível por dia: atenção e depois crítico no mesmo dia dão dois avisos; no dia seguinte avisa de novo", async () => {
    const e = espioes();
    await rodar(85, e);
    await rodar(93, e, depois(15));
    expect(tipos(e)).toEqual(["atencao", "critico"]);

    await rodar(93, e, new Date(MEIO_DIA.getTime() + DIA_MS));
    expect(tipos(e)).toEqual(["atencao", "critico", "critico"]);
  });

  it("o 'voltou ao normal' sai uma vez, depois de qualquer aviso, e a medida normal seguinte não repete", async () => {
    const e = espioes();
    await rodar(86, e);
    await rodar(70, e, depois(15));
    await rodar(70, e, depois(30));

    expect(tipos(e)).toEqual(["atencao", "voltou"]);
    expect(await lerEstadoDoAlarme()).toMatchObject({ nivel: "normal", voltaPendente: false });
  });

  it("o disco que oscila em volta do limite não pisca: 79% depois de atenção segue atenção, sem aviso novo", async () => {
    const e = espioes();
    await rodar(81, e);
    const resumo = await rodar(79, e, depois(15));
    expect(resumo.nivel).toBe("atencao");
    expect(tipos(e)).toEqual(["atencao"]);
    const abaixo = await rodar(77, e, depois(30));
    expect(abaixo.nivel).toBe("normal");
    expect(tipos(e)).toEqual(["atencao", "voltou"]);
  });

  it("o desde do nível só muda quando o nível muda", async () => {
    const e = espioes();
    await rodar(81, e);
    const primeiro = (await lerEstadoDoAlarme())!.desde;
    await rodar(83, e, depois(15));
    expect((await lerEstadoDoAlarme())!.desde).toBe(primeiro);
    await rodar(91, e, depois(30));
    expect((await lerEstadoDoAlarme())!.desde).toBe(depois(30).toISOString());
  });

  it("e-mail que não saiu não grava a marca do dia: a medida seguinte tenta de novo (e o Sentry não repete)", async () => {
    const falha = espioes(false);
    const r1 = await rodar(82, falha);
    expect(r1.aviso).toBe("nao enviado (falha no envio)");

    const ok = espioes(true);
    await rodar(82, ok, depois(15));
    expect(tipos(ok)).toEqual(["atencao"]);
    expect(falha.sentry).toHaveBeenCalledTimes(1);
    expect(ok.sentry).not.toHaveBeenCalled();

    await rodar(82, ok, depois(30));
    expect(tipos(ok)).toEqual(["atencao"]);
  });

  it("aviso que quebra não derruba o job: o estado é gravado e a limpeza do crítico roda", async () => {
    const e = espioes();
    e.avisar.mockRejectedValue(new Error("resend caiu"));
    const resumo = await rodar(95, e);
    expect(resumo).toMatchObject({ nivel: "critico", aviso: "nao enviado (erro)", limpezaPedida: true });
    expect(await lerEstadoDoAlarme()).toMatchObject({ nivel: "critico" });
  });

  it("mede o disco de verdade quando nada é simulado (statfs e pastas)", async () => {
    const e = espioes();
    const resumo = await rodarVigiarDisco({ agora: () => MEIO_DIA, limites: { atencao: 99.5, critico: 100 }, avisar: e.avisar, sentry: e.sentry, limparAgora: e.limparAgora });
    expect(typeof resumo.usadoPercentual).toBe("number");
    expect(resumo.usadoPercentual as number).toBeGreaterThan(0);
    expect(resumo.usadoPercentual as number).toBeLessThanOrEqual(100);
    expect(resumo.edicaoMb as number).toBeGreaterThanOrEqual(0);
  });
});

describe("o Início do admin", () => {
  it("mostra o disco em atenção e em crítico com o que o job mediu, e some quando volta ao normal", async () => {
    const e = espioes();
    expect((await inicioDoAdmin(MEIO_DIA)).atencao.disco).toBeNull();

    await rodar(82.5, e);
    expect((await inicioDoAdmin(MEIO_DIA)).atencao.disco).toMatchObject({ nivel: "atencao", usadoPercentual: 82.5, livreBytes: 17_500_000_000 });

    await rodar(94, e, depois(15));
    expect((await inicioDoAdmin(MEIO_DIA)).atencao.disco).toMatchObject({ nivel: "critico", usadoPercentual: 94 });

    await rodar(60, e, depois(30));
    expect((await inicioDoAdmin(MEIO_DIA)).atencao.disco).toBeNull();
  });
});

describe("o e-mail do alarme (o mesmo caminho do aviso da leitura parada)", () => {
  const numeros: NumerosDoAviso = { ...medida(91), limiteAtencao: 80, limiteCritico: 90 };

  async function criarAdmin(email: string, extra: { banido?: boolean; papel?: string } = {}) {
    await db().insert(user).values({ id: `disco-${email}`, name: "Admin", email, role: extra.papel ?? "admin", banned: extra.banido ?? false });
  }

  it("manda um e-mail por admin (sem banido nem cliente), com o assunto e o que fazer", async () => {
    await criarAdmin("admin@disco.teste");
    await criarAdmin("outro@disco.teste");
    await criarAdmin("cliente@disco.teste", { papel: "cliente" });
    await criarAdmin("banido@disco.teste", { banido: true });
    const enviar = vi.fn().mockResolvedValue(undefined);

    const r = await avisarDisco("critico", numeros, enviar);

    expect(r).toEqual({ enviado: true, destinatarios: 2 });
    expect(enviar.mock.calls.map((c) => c[0].para).sort()).toEqual(["admin@disco.teste", "outro@disco.teste"]);
    const { assunto, html } = enviar.mock.calls[0][0];
    expect(assunto).toBe("O disco do servidor passou de 90%: o envio de vídeos foi pausado");
    expect(html).toContain("91%");
    expect(html).toContain("Publicar no Instagram continua funcionando");
  });

  it("sem admin nada é enviado; com e-mail que falha, diz que falhou", async () => {
    const enviar = vi.fn().mockRejectedValue(new Error("resend fora do ar"));
    expect(await avisarDisco("atencao", numeros, enviar)).toEqual({ enviado: false, motivo: "sem destinatario" });
    await criarAdmin("admin@disco.teste");
    expect(await avisarDisco("atencao", numeros, enviar)).toEqual({ enviado: false, motivo: "falha no envio", destinatarios: 0 });
  });
});
