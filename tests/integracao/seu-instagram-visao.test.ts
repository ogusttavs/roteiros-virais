/**
 * E19 PR 2: o que a tela de Conta recebe do banco para o cartão "Seu Instagram" (a mesma composição que `conta/page.tsx` faz: a conta ativa, as candidatas, o papel de quem olha),
 * contra o Postgres local e sem rede. Prova: a visão nunca leva o acesso guardado (nem cifrado), cada marca vê só a própria conta, as candidatas vencidas (30 minutos) não aparecem,
 * a lista de escolha é só de quem pode escolher, e quem é só membro e o "ver como" não ganham botão.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { db, getPool } from "@/db";
import { clientes, contasConectadas, membrosMarca, nichos, user } from "@/db/schema";
import { cifrarToken, contextoDoToken } from "@/lib/meta-token";
import { candidatasDaMarca, contaLigadaDaMarca, ehDonoDaMarca, VALIDADE_DA_ESCOLHA_MS } from "@/servicos/conta-conectada";
import { textosLigacao } from "@/textos/conta-conectada";

import { montarVisaoSeuInstagram } from "@/app/(painel)/(completo)/conta/seu-instagram-visao";

import { resetarSchema } from "../../scripts/resetar-schema";

let marcaA: number;
let marcaB: number;
const AGORA = new Date("2026-10-22T12:00:00Z");

async function guardar(o: { clienteId: number; contaId: string; nome: string; estado: "ativa" | "escolher"; conectadaEm: Date; erro?: string | null; ultimaLeituraEm?: Date | null }) {
  await db()
    .insert(contasConectadas)
    .values({
      clienteId: o.clienteId,
      plataforma: "instagram",
      contaId: o.contaId,
      nome: o.nome,
      paginaNome: `Pagina de ${o.nome}`,
      metaUsuarioId: `meta-${o.clienteId}`,
      estado: o.estado,
      tokenCifrado: cifrarToken("EAA-SEGREDO-DA-TELA", contextoDoToken(o.clienteId, "instagram", o.contaId)),
      tokenExpiraEm: new Date("2026-12-20T00:00:00Z"),
      conectadaEm: o.conectadaEm,
      erro: o.erro ?? null,
      ultimaLeituraEm: o.ultimaLeituraEm ?? null,
    });
}

/** O mesmo caminho de `conta/page.tsx`. */
async function visaoPara(usuarioId: string, clienteId: number, verComo = false) {
  return montarVisaoSeuInstagram({
    ligacaoAberta: true,
    aprovadoPelaMeta: false,
    dono: await ehDonoDaMarca(usuarioId, clienteId),
    verComo,
    conta: await contaLigadaDaMarca(clienteId),
    candidatas: await candidatasDaMarca(clienteId, AGORA),
    retorno: null,
  });
}

beforeAll(async () => {
  await resetarSchema(db());
  const [nicho] = await db().insert(nichos).values({ slug: "seu-instagram-teste", nome: "Seu Instagram teste", termos: [] }).returning();
  await db().insert(user).values([
    { id: "si-dono-a", name: "Dono A", email: "si-dono-a@exemplo.teste", role: "cliente" },
    { id: "si-membro-a", name: "Membro A", email: "si-membro-a@exemplo.teste", role: "cliente" },
    { id: "si-dono-b", name: "Dono B", email: "si-dono-b@exemplo.teste", role: "cliente" },
  ]);
  const [a] = await db().insert(clientes).values({ usuarioId: "si-dono-a", nome: "[teste] Marca A", nichoId: nicho.id }).returning();
  const [b] = await db().insert(clientes).values({ usuarioId: "si-dono-b", nome: "[teste] Marca B", nichoId: nicho.id }).returning();
  marcaA = a.id;
  marcaB = b.id;
  await db().insert(membrosMarca).values([
    { usuarioId: "si-dono-a", clienteId: marcaA, papel: "dono" },
    { usuarioId: "si-membro-a", clienteId: marcaA, papel: "membro" },
    { usuarioId: "si-dono-b", clienteId: marcaB, papel: "dono" },
  ]);
}, 30_000);

beforeEach(async () => {
  await db().delete(contasConectadas);
});

afterAll(async () => {
  await getPool().end();
});

describe("a visão do cartão a partir do banco", () => {
  it("sem nada ligado: sem conta e sem candidatas, e a dona pode ligar", async () => {
    const visao = await visaoPara("si-dono-a", marcaA);
    expect(visao.conta).toBeNull();
    expect(visao.candidatas).toEqual([]);
    expect(visao.podeMexer).toBe(true);
  });

  it("a conta ligada chega com o nome, a Página, o dia e a última leitura, e nada do acesso guardado", async () => {
    await guardar({ clienteId: marcaA, contaId: "ig-a", nome: "conta.a", estado: "ativa", conectadaEm: new Date("2026-10-12T15:30:00Z"), ultimaLeituraEm: new Date("2026-10-22T09:20:00Z") });
    const visao = await visaoPara("si-dono-a", marcaA);
    expect(visao.conta).toEqual({ nome: "conta.a", pagina: "Pagina de conta.a", desde: "12/10/2026", ultimaLeitura: "22/10/2026 às 06:20", erro: null });
    const tudo = JSON.stringify(visao);
    expect(tudo).not.toContain("EAA-SEGREDO-DA-TELA");
    expect(tudo).not.toMatch(/token/i);
    expect(tudo).not.toContain("ig-a");
  });

  it("o problema guardado na conta chega como a frase pronta", async () => {
    await guardar({ clienteId: marcaA, contaId: "ig-a", nome: "conta.a", estado: "ativa", conectadaEm: new Date("2026-10-12T15:30:00Z"), erro: textosLigacao.erroDaConta.naoRenovou });
    expect((await visaoPara("si-dono-a", marcaA)).conta?.erro).toBe(textosLigacao.erroDaConta.naoRenovou);
  });

  it("cada marca vê só a própria conta", async () => {
    await guardar({ clienteId: marcaA, contaId: "ig-a", nome: "conta.a", estado: "ativa", conectadaEm: new Date("2026-10-12T15:30:00Z") });
    await guardar({ clienteId: marcaB, contaId: "ig-b", nome: "conta.b", estado: "ativa", conectadaEm: new Date("2026-10-13T15:30:00Z") });
    expect((await visaoPara("si-dono-a", marcaA)).conta?.nome).toBe("conta.a");
    expect((await visaoPara("si-dono-b", marcaB)).conta?.nome).toBe("conta.b");
    await db().delete(contasConectadas);
    await guardar({ clienteId: marcaB, contaId: "ig-b", nome: "conta.b", estado: "ativa", conectadaEm: new Date("2026-10-13T15:30:00Z") });
    expect((await visaoPara("si-dono-a", marcaA)).conta).toBeNull();
  });

  it("as candidatas valem 30 minutos: as vencidas não aparecem, as de outra marca nunca", async () => {
    const dentro = new Date(AGORA.getTime() - VALIDADE_DA_ESCOLHA_MS + 60_000);
    const vencida = new Date(AGORA.getTime() - VALIDADE_DA_ESCOLHA_MS - 60_000);
    await guardar({ clienteId: marcaA, contaId: "ig-1", nome: "um", estado: "escolher", conectadaEm: dentro });
    await guardar({ clienteId: marcaA, contaId: "ig-2", nome: "dois", estado: "escolher", conectadaEm: vencida });
    await guardar({ clienteId: marcaB, contaId: "ig-3", nome: "tres", estado: "escolher", conectadaEm: dentro });
    const visao = await visaoPara("si-dono-a", marcaA);
    expect(visao.candidatas.map((c) => c.nome)).toEqual(["um"]);
  });

  it("quem é só membro lê a conta e não ganha botão nem a lista de escolha", async () => {
    await guardar({ clienteId: marcaA, contaId: "ig-a", nome: "conta.a", estado: "ativa", conectadaEm: new Date("2026-10-12T15:30:00Z") });
    await guardar({ clienteId: marcaA, contaId: "ig-1", nome: "um", estado: "escolher", conectadaEm: new Date(AGORA.getTime() - 60_000) });
    const visao = await visaoPara("si-membro-a", marcaA);
    expect(visao.podeMexer).toBe(false);
    expect(visao.conta?.nome).toBe("conta.a");
    expect(visao.candidatas).toEqual([]);
  });

  it("no ver como a dona também não ganha botão", async () => {
    await guardar({ clienteId: marcaA, contaId: "ig-1", nome: "um", estado: "escolher", conectadaEm: new Date(AGORA.getTime() - 60_000) });
    const visao = await visaoPara("si-dono-a", marcaA, true);
    expect(visao.podeMexer).toBe(false);
    expect(visao.verComo).toBe(true);
    expect(visao.candidatas).toEqual([]);
  });
});
