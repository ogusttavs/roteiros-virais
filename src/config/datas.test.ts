import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  DATAS_DO_CALENDARIO,
  DIAS_DE_AVISO,
  datasDeHojeEProximas,
  datasDoPeriodo,
  datasParaOAviso,
  datasPorDia,
  diasEntreDatas,
  enesimoDiaDaSemana,
  ocorrenciasNoAno,
  pascoaDoAno,
  somarDias,
  valeParaAMarca,
} from "./datas";
import { SLUGS_DE_RAMO } from "./ramos";

function data(chave: string) {
  const achada = DATAS_DO_CALENDARIO.find((d) => d.chave === chave);
  if (!achada) throw new Error(`data de teste inexistente: ${chave}`);
  return achada;
}

describe("a base de datas", () => {
  it("tem chave única, nome sem travessão e ramos que existem no catálogo", () => {
    const chaves = DATAS_DO_CALENDARIO.map((d) => d.chave);
    expect(new Set(chaves).size).toBe(chaves.length);
    for (const d of DATAS_DO_CALENDARIO) {
      expect(d.nome).not.toMatch(/[–—]/);
      expect(d.fonte.length).toBeGreaterThan(5);
      expect(d.arquivo.length).toBeGreaterThan(3);
      if (d.ramos !== "geral") {
        expect(d.ramos.length).toBeGreaterThan(0);
        for (const ramo of d.ramos) expect(SLUGS_DE_RAMO.has(ramo), `${d.chave}: ramo ${ramo}`).toBe(true);
      }
    }
  });

  it("é curta: nada de centenas de dias de", () => {
    expect(DATAS_DO_CALENDARIO.length).toBeLessThanOrEqual(60);
  });

  it("todo feriado nacional é geral e fixo ou da Páscoa", () => {
    for (const d of DATAS_DO_CALENDARIO.filter((x) => x.tipo === "feriado")) expect(d.ramos).toBe("geral");
  });

  it("os feriados nacionais de 2026 batem com a Portaria MGI 11.460/2025 (10 feriados)", () => {
    const feriados = DATAS_DO_CALENDARIO.filter((d) => d.tipo === "feriado").flatMap((d) => ocorrenciasNoAno(d, 2026));
    expect(feriados.sort()).toEqual([
      "2026-01-01",
      "2026-04-03",
      "2026-04-21",
      "2026-05-01",
      "2026-09-07",
      "2026-10-12",
      "2026-11-02",
      "2026-11-15",
      "2026-11-20",
      "2026-12-25",
    ]);
  });

  it("os pontos facultativos móveis de 2026 batem com a portaria (Carnaval 16 e 17 de fevereiro, Corpus Christi 4 de junho)", () => {
    expect(ocorrenciasNoAno(data("carnaval"), 2026)).toEqual(["2026-02-16", "2026-02-17"]);
    expect(ocorrenciasNoAno(data("corpus-christi"), 2026)).toEqual(["2026-06-04"]);
  });

  it("o tipo de cada data da portaria bate com o que a portaria escreve: feriado nacional é feriado, ponto facultativo nunca vira feriado", () => {
    // A pesquisa mora fora do repositório do código (no dos documentos): sobe as pastas até achar `pesquisa/datas/docs`; sem ela (CI), não há o que conferir.
    let texto: string | null = null;
    for (let pasta = __dirname, i = 0; i < 8 && texto === null; i++, pasta = resolve(pasta, "..")) {
      const caminho = resolve(pasta, "pesquisa/datas/docs/portaria-mgi-11460-2025-copia-do-dou.md");
      if (existsSync(caminho)) texto = readFileSync(caminho, "utf-8");
    }
    if (texto === null) return;
    const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
    // "V , 3 de abril, Paixão de Cristo (feriado nacional);" -> { "2026-04-03": "feriado" }
    const daPortaria = new Map<string, "feriado" | "ponto-facultativo">();
    for (const linha of texto.split("\n")) {
      const m = linha.match(/^\s*[IVXL]+\s*,\s*(\d{1,2})º? de ([a-zç]+)\b.*\((feriado nacional|ponto facultativo)/i);
      if (!m) continue;
      const mes = MESES.indexOf(m[2].toLowerCase()) + 1;
      expect(mes, linha).toBeGreaterThan(0);
      const iso = `2026-${String(mes).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
      daPortaria.set(iso, m[3].toLowerCase() === "feriado nacional" ? "feriado" : "ponto-facultativo");
    }
    expect(daPortaria.size).toBeGreaterThanOrEqual(18);

    const citam = DATAS_DO_CALENDARIO.filter((d) => d.arquivo === "portaria-mgi-11460-2025-copia-do-dou");
    expect(citam.length).toBeGreaterThan(0);
    for (const d of citam) {
      for (const dia of ocorrenciasNoAno(d, 2026)) {
        expect(daPortaria.get(dia), `${d.chave} em ${dia} não está na portaria`).toBe(d.tipo);
      }
    }
    // E o caminho inverso: todo ponto facultativo da portaria que o calendário tem não pode estar como feriado.
    const comoFeriado = new Set(DATAS_DO_CALENDARIO.filter((d) => d.tipo === "feriado").flatMap((d) => ocorrenciasNoAno(d, 2026)));
    for (const [dia, tipo] of daPortaria) if (tipo === "ponto-facultativo") expect(comoFeriado.has(dia), `${dia} é ponto facultativo`).toBe(false);
  });
});

describe("pascoaDoAno", () => {
  it.each([
    [2018, "2018-04-01"],
    [2019, "2019-04-21"],
    [2020, "2020-04-12"],
    [2021, "2021-04-04"],
    [2022, "2022-04-17"],
    [2023, "2023-04-09"],
    [2024, "2024-03-31"],
    [2025, "2025-04-20"],
    [2026, "2026-04-05"],
    [2027, "2027-03-28"],
    [2030, "2030-04-21"],
    [2038, "2038-04-25"],
  ])("a Páscoa de %i é %s", (ano, esperada) => {
    expect(pascoaDoAno(ano)).toBe(esperada);
  });
});

describe("as datas móveis a partir da Páscoa", () => {
  it.each([
    [2023, ["2023-02-20", "2023-02-21"], "2023-04-07", "2023-06-08"],
    [2024, ["2024-02-12", "2024-02-13"], "2024-03-29", "2024-05-30"],
    [2025, ["2025-03-03", "2025-03-04"], "2025-04-18", "2025-06-19"],
    [2026, ["2026-02-16", "2026-02-17"], "2026-04-03", "2026-06-04"],
    [2027, ["2027-02-08", "2027-02-09"], "2027-03-26", "2027-05-27"],
  ])("em %i: Carnaval, Sexta-feira Santa e Corpus Christi", (ano, carnaval, sextaSanta, corpusChristi) => {
    expect(ocorrenciasNoAno(data("carnaval"), ano)).toEqual(carnaval);
    expect(ocorrenciasNoAno(data("sexta-feira-santa"), ano)).toEqual([sextaSanta]);
    expect(ocorrenciasNoAno(data("corpus-christi"), ano)).toEqual([corpusChristi]);
  });
});

describe("as datas que dependem do dia da semana", () => {
  it("enesimoDiaDaSemana acha o segundo domingo e a quarta quinta", () => {
    expect(enesimoDiaDaSemana(2026, 5, 2, 0)).toBe("2026-05-10");
    expect(enesimoDiaDaSemana(2025, 5, 2, 0)).toBe("2025-05-11");
    expect(enesimoDiaDaSemana(2026, 11, 4, 4)).toBe("2026-11-26");
  });

  it("Dia das Mães e Dia dos Pais caem no segundo domingo de maio e de agosto", () => {
    expect(ocorrenciasNoAno(data("dia-das-maes"), 2024)).toEqual(["2024-05-12"]);
    expect(ocorrenciasNoAno(data("dia-das-maes"), 2025)).toEqual(["2025-05-11"]);
    expect(ocorrenciasNoAno(data("dia-das-maes"), 2026)).toEqual(["2026-05-10"]);
    expect(ocorrenciasNoAno(data("dia-dos-pais"), 2024)).toEqual(["2024-08-11"]);
    expect(ocorrenciasNoAno(data("dia-dos-pais"), 2025)).toEqual(["2025-08-10"]);
    expect(ocorrenciasNoAno(data("dia-dos-pais"), 2026)).toEqual(["2026-08-09"]);
  });

  it("Black Friday é a sexta depois do Dia de Ação de Graças (quarta quinta de novembro)", () => {
    expect(ocorrenciasNoAno(data("black-friday"), 2023)).toEqual(["2023-11-24"]);
    expect(ocorrenciasNoAno(data("black-friday"), 2024)).toEqual(["2024-11-29"]);
    expect(ocorrenciasNoAno(data("black-friday"), 2025)).toEqual(["2025-11-28"]);
    expect(ocorrenciasNoAno(data("black-friday"), 2026)).toEqual(["2026-11-27"]);
  });
});

describe("somarDias e diasEntreDatas", () => {
  it("atravessam mês, ano e ano bissexto", () => {
    expect(somarDias("2026-12-30", 3)).toBe("2027-01-02");
    expect(somarDias("2024-02-28", 2)).toBe("2024-03-01");
    expect(somarDias("2026-03-01", -1)).toBe("2026-02-28");
    expect(diasEntreDatas("2026-10-23", "2026-10-30")).toBe(7);
    expect(diasEntreDatas("2026-12-30", "2027-01-02")).toBe(3);
    expect(diasEntreDatas("2026-10-30", "2026-10-23")).toBe(-7);
  });
});

describe("a escolha por ramo", () => {
  it("quem não tem ramo vê só as gerais", () => {
    const vistas = datasDoPeriodo("2026-10-01", "2026-10-31", []).map((d) => d.chave);
    expect(vistas).toContain("dia-das-criancas");
    expect(vistas).toContain("dia-da-micro-e-pequena-empresa");
    expect(vistas).not.toContain("dia-do-cirurgiao-dentista");
    expect(vistas).not.toContain("dia-do-medico");
  });

  it("a clínica odontológica vê o Dia do Cirurgião-Dentista e não o Dia do Médico", () => {
    const vistas = datasDoPeriodo("2026-10-01", "2026-10-31", ["odontologia"]);
    expect(vistas.find((d) => d.chave === "dia-do-cirurgiao-dentista")?.data).toBe("2026-10-25");
    expect(vistas.map((d) => d.chave)).not.toContain("dia-do-medico");
  });

  it("os ramos alternativos da marca também valem", () => {
    const vistas = datasDoPeriodo("2026-10-01", "2026-10-31", ["odontologia", "medicina-e-clinicas"]).map((d) => d.chave);
    expect(vistas).toContain("dia-do-cirurgiao-dentista");
    expect(vistas).toContain("dia-do-medico");
  });

  it("uma data de vários ramos vale para qualquer um deles", () => {
    const alimentacao = data("dia-mundial-da-alimentacao");
    expect(valeParaAMarca(alimentacao, ["confeitaria-e-padaria"])).toBe(true);
    expect(valeParaAMarca(alimentacao, ["restaurante-e-lanchonete"])).toBe(true);
    expect(valeParaAMarca(alimentacao, ["odontologia"])).toBe(false);
  });

  it("no mesmo dia, a do ramo vem antes da que vende e do feriado", () => {
    const doDia = datasDoPeriodo("2026-10-12", "2026-10-12", ["educacao-e-cursos"]);
    expect(doDia.map((d) => d.chave)).toEqual(["dia-das-criancas", "nossa-senhora-aparecida"]);
    const doRamo = datasDoPeriodo("2026-10-15", "2026-10-15", ["educacao-e-cursos"]);
    expect(doRamo.map((d) => d.chave)).toEqual(["dia-do-professor"]);
  });

  it("o período cruza o ano sem perder o Natal nem o Ano Novo", () => {
    const vistas = datasDoPeriodo("2026-12-24", "2027-01-02", []).map((d) => `${d.data} ${d.chave}`);
    expect(vistas).toEqual(["2026-12-25 natal", "2027-01-01 confraternizacao-universal"]);
  });

  it("datasPorDia agrupa por dia", () => {
    const porDia = datasPorDia("2026-04-01", "2026-04-30", []);
    expect(Object.keys(porDia).sort()).toEqual(["2026-04-03", "2026-04-05", "2026-04-21"]);
    expect(porDia["2026-04-05"][0].nome).toBe("Páscoa");
  });
});

describe("a janela de 7 e 2 dias", () => {
  it("o aviso de manhã usa 7 e 2 dias", () => {
    expect(DIAS_DE_AVISO).toEqual([7, 2]);
  });

  it("daqui a 7 dias e daqui a 2 dias entram no aviso; 6, 5, 3 e 1 não", () => {
    // Dia das Mães de 2026 é domingo, 10 de maio.
    expect(datasParaOAviso("2026-05-03", []).map((d) => [d.chave, d.dias])).toEqual([["dia-das-maes", 7]]);
    expect(datasParaOAviso("2026-05-08", []).map((d) => [d.chave, d.dias])).toEqual([["dia-das-maes", 2]]);
    for (const dia of ["2026-05-04", "2026-05-05", "2026-05-07", "2026-05-09"]) {
      expect(datasParaOAviso(dia, [])).toEqual([]);
    }
    // No próprio dia o aviso não repete: a data é "hoje", não "daqui a N dias".
    expect(datasParaOAviso("2026-05-10", [])).toEqual([]);
  });

  it("o aviso respeita o ramo: a clínica recebe o Dia do Dentista daqui a 7 dias, o restaurante não", () => {
    expect(datasParaOAviso("2026-10-18", ["odontologia"]).map((d) => d.chave)).toEqual(["dia-do-cirurgiao-dentista"]);
    expect(datasParaOAviso("2026-10-18", ["restaurante-e-lanchonete"]).map((d) => d.chave)).toEqual([]);
  });

  it("o Hoje separa o que é hoje do que vem nos próximos 7 dias, com a distância", () => {
    const { hoje, proximas } = datasDeHojeEProximas("2026-10-08", []);
    expect(hoje).toEqual([]);
    expect(proximas.map((d) => [d.chave, d.dias])).toEqual([
      ["dia-das-criancas", 4],
      ["nossa-senhora-aparecida", 4],
    ]);
    const noDia = datasDeHojeEProximas("2026-10-12", []);
    expect(noDia.hoje.map((d) => d.chave)).toEqual(["dia-das-criancas", "nossa-senhora-aparecida"]);
    expect(noDia.proximas).toEqual([]);
  });

  it("o Hoje não olha além de 7 dias", () => {
    expect(datasDeHojeEProximas("2026-05-02", []).proximas).toEqual([]);
    expect(datasDeHojeEProximas("2026-05-03", []).proximas.map((d) => d.dias)).toEqual([7]);
  });
});
