/**
 * As datas que valem para a marca (E60), contra o Postgres real: os ramos da marca (o principal do catálogo e os alternativos que o admin ligou) escolhem as datas que o Hoje
 * mostra. Marca sem ramo do catálogo vê só as gerais; marca de odontologia vê o Dia do Cirurgião-Dentista; o alternativo ligado vale igual; uma marca nunca vê a data do ramo de outra.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { datasDeHojeEProximas } from "@/config/datas";
import { db, getPool } from "@/db";
import { clientes, nichos, ramosDaConta, user } from "@/db/schema";
import { ramosDaMarcaParaDatas } from "@/servicos/datas";

import { resetarSchema } from "../../scripts/resetar-schema";

let nichoOdonto: number;
let nichoMedicina: number;
let nichoSemRamo: number;
let marcaOdonto: number;
let marcaSemRamo: number;
let marcaSemNicho: number;

beforeAll(async () => {
  await resetarSchema(db());
  await db().insert(user).values({ id: "datas-pessoa", name: "[teste] pessoa", email: "datas-pessoa@datas.teste" });
  const [a] = await db().insert(nichos).values({ slug: "datas-odonto", nome: "Odontologia", termos: [], ramoCatalogo: "odontologia" }).returning();
  const [b] = await db().insert(nichos).values({ slug: "datas-medicina", nome: "Medicina", termos: [], ramoCatalogo: "medicina-e-clinicas" }).returning();
  const [c] = await db().insert(nichos).values({ slug: "datas-sem-ramo", nome: "Nicho antigo, sem ramo do catálogo", termos: [] }).returning();
  nichoOdonto = a.id;
  nichoMedicina = b.id;
  nichoSemRamo = c.id;
  const [m1] = await db().insert(clientes).values({ usuarioId: "datas-pessoa", nome: "Clínica Sorriso", nichoId: nichoOdonto }).returning();
  const [m2] = await db().insert(clientes).values({ usuarioId: "datas-pessoa", nome: "Loja da Ana", nichoId: nichoSemRamo }).returning();
  const [m3] = await db().insert(clientes).values({ usuarioId: "datas-pessoa", nome: "Marca sem ramo ainda" }).returning();
  marcaOdonto = m1.id;
  marcaSemRamo = m2.id;
  marcaSemNicho = m3.id;
}, 30_000);

afterAll(async () => {
  await getPool().end();
});

describe("ramosDaMarcaParaDatas", () => {
  it("a marca de odontologia tem o ramo principal; a sem ramo do catálogo e a sem nicho não têm nenhum", async () => {
    expect(await ramosDaMarcaParaDatas({ id: marcaOdonto, nichoId: nichoOdonto })).toEqual(["odontologia"]);
    expect(await ramosDaMarcaParaDatas({ id: marcaSemRamo, nichoId: nichoSemRamo })).toEqual([]);
    expect(await ramosDaMarcaParaDatas({ id: marcaSemNicho, nichoId: null })).toEqual([]);
  });

  it("o ramo alternativo ligado pelo admin entra depois do principal", async () => {
    await db().insert(ramosDaConta).values({ clienteId: marcaOdonto, nichoId: nichoMedicina, ligadoPorUsuarioId: "datas-pessoa" });
    expect(await ramosDaMarcaParaDatas({ id: marcaOdonto, nichoId: nichoOdonto })).toEqual(["odontologia", "medicina-e-clinicas"]);
    await db().delete(ramosDaConta);
  });
});

describe("o que o Hoje mostra a cada marca", () => {
  it("uma semana antes de 25 de outubro, a clínica vê o Dia do Cirurgião-Dentista daqui a 7 dias e a loja sem ramo não", async () => {
    const clinica = datasDeHojeEProximas("2026-10-18", await ramosDaMarcaParaDatas({ id: marcaOdonto, nichoId: nichoOdonto }));
    expect(clinica.proximas.map((d) => [d.nome, d.dias])).toEqual([["Dia do Cirurgião-Dentista", 7]]);
    const loja = datasDeHojeEProximas("2026-10-18", await ramosDaMarcaParaDatas({ id: marcaSemRamo, nichoId: nichoSemRamo }));
    expect(loja.proximas).toEqual([]);
  });

  it("a marca de odontologia não vê o Dia do Médico, mas passa a ver se o admin ligou medicina como alternativo", async () => {
    const antes = datasDeHojeEProximas("2026-10-11", await ramosDaMarcaParaDatas({ id: marcaOdonto, nichoId: nichoOdonto }));
    expect(antes.proximas.map((d) => d.chave)).not.toContain("dia-do-medico");
    await db().insert(ramosDaConta).values({ clienteId: marcaOdonto, nichoId: nichoMedicina, ligadoPorUsuarioId: "datas-pessoa" });
    const depois = datasDeHojeEProximas("2026-10-11", await ramosDaMarcaParaDatas({ id: marcaOdonto, nichoId: nichoOdonto }));
    expect(depois.proximas.map((d) => [d.chave, d.dias])).toContainEqual(["dia-do-medico", 7]);
    await db().delete(ramosDaConta);
  });

  it("no dia, o Hoje diz que hoje é a data", async () => {
    const hoje = datasDeHojeEProximas("2026-05-10", []);
    expect(hoje.hoje.map((d) => d.nome)).toEqual(["Dia das Mães"]);
  });
});
