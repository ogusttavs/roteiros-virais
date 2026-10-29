/**
 * O alarme do disco do servidor (29/10/2026), sem banco e sem disco de verdade: a medida com o `statfs` simulado, o nível com a folga, a decisão de avisar (um por nível por dia, e o "voltou")
 * e a recusa do envio de vídeo no crítico.
 */
import { describe, expect, it, vi } from "vitest";

import { fraseDaEdicao } from "@/textos/edicao";

import {
  decidirAvisos,
  type EstadoDoAlarme,
  estadoDoTexto,
  FOLGA_PARA_DESCER_PONTOS,
  limitesDoDisco,
  medirDisco,
  medirEspacoDoDisco,
  nivelDoUso,
  recusaPorDiscoCritico,
  type SistemaDeArquivos,
} from "./disco";

const LIMITES = { atencao: 80, critico: 90 };

/** Um disco de 100 GB (blocos de 1 KB) com tanto por cento usado. */
function discoCom(usadoPercentual: number): SistemaDeArquivos {
  const blocks = 100_000_000;
  const usados = Math.round((blocks * usadoPercentual) / 100);
  return { bsize: 1000, blocks, bfree: blocks - usados, bavail: blocks - usados };
}

describe("limitesDoDisco", () => {
  it("usa os valores configurados quando fazem sentido", () => {
    expect(limitesDoDisco({ atencaoPercentual: 70, criticoPercentual: 85 })).toEqual({ atencao: 70, critico: 85 });
  });

  it("volta para 80 e 90 quando a ordem se inverte ou o valor sai do razoável", () => {
    expect(limitesDoDisco({ atencaoPercentual: 90, criticoPercentual: 80 })).toEqual(LIMITES);
    expect(limitesDoDisco({ atencaoPercentual: 80, criticoPercentual: 80 })).toEqual(LIMITES);
    expect(limitesDoDisco({ atencaoPercentual: 0, criticoPercentual: 90 })).toEqual(LIMITES);
    expect(limitesDoDisco({ atencaoPercentual: 80, criticoPercentual: 120 })).toEqual(LIMITES);
    expect(limitesDoDisco({ atencaoPercentual: Number.NaN, criticoPercentual: 90 })).toEqual(LIMITES);
  });
});

describe("nivelDoUso", () => {
  it("normal abaixo de 80, atenção a partir de 80, crítico a partir de 90", () => {
    expect(nivelDoUso(79.9, LIMITES)).toBe("normal");
    expect(nivelDoUso(80, LIMITES)).toBe("atencao");
    expect(nivelDoUso(89.9, LIMITES)).toBe("atencao");
    expect(nivelDoUso(90, LIMITES)).toBe("critico");
    expect(nivelDoUso(100, LIMITES)).toBe("critico");
  });

  it("só desce de nível depois da folga, para o disco que oscila não avisar de novo", () => {
    expect(FOLGA_PARA_DESCER_PONTOS).toBe(2);
    expect(nivelDoUso(89, LIMITES, "critico")).toBe("critico");
    expect(nivelDoUso(87.9, LIMITES, "critico")).toBe("atencao");
    expect(nivelDoUso(79, LIMITES, "atencao")).toBe("atencao");
    expect(nivelDoUso(77.9, LIMITES, "atencao")).toBe("normal");
    expect(nivelDoUso(78.5, LIMITES, "critico")).toBe("atencao");
    expect(nivelDoUso(79, LIMITES, "normal")).toBe("normal");
  });
});

describe("medirEspacoDoDisco e medirDisco", () => {
  it("calcula o uso como o df: usado sobre (usado mais o que dá para gravar)", async () => {
    const espaco = await medirEspacoDoDisco({ statfs: async () => ({ bsize: 4096, blocks: 1000, bfree: 300, bavail: 250 }) });
    // usados = 700; 700 / (700 + 250) = 73,68%
    expect(espaco.usadoPercentual).toBe(73.7);
    expect(espaco.totalBytes).toBe(4_096_000);
    expect(espaco.livreBytes).toBe(250 * 4096);
  });

  it("soma o tamanho das duas pastas de vídeo", async () => {
    const pastas: string[] = [];
    const medida = await medirDisco({
      statfs: async () => discoCom(42),
      tamanhoDaPasta: async (pasta) => {
        pastas.push(pasta);
        return pasta.includes("edicao") ? 5_000_000_000 : 300_000_000;
      },
    });
    expect(medida.usadoPercentual).toBe(42);
    expect(medida.totalBytes).toBe(100_000_000_000);
    expect(medida.edicaoBytes).toBe(5_000_000_000);
    expect(medida.publicarBytes).toBe(300_000_000);
    expect(pastas).toHaveLength(2);
  });

  it("se a pasta da edição não existe, mede a raiz em vez de quebrar", async () => {
    const statfs = vi.fn().mockRejectedValueOnce(new Error("ENOENT")).mockResolvedValueOnce(discoCom(10));
    const espaco = await medirEspacoDoDisco({ statfs });
    expect(espaco.usadoPercentual).toBe(10);
    expect(statfs).toHaveBeenCalledTimes(2);
  });

  it("disco com zero blocos vale zero por cento (não divide por zero)", async () => {
    const espaco = await medirEspacoDoDisco({ statfs: async () => ({ bsize: 4096, blocks: 0, bfree: 0, bavail: 0 }) });
    expect(espaco.usadoPercentual).toBe(0);
  });
});

describe("decidirAvisos", () => {
  const hoje = "2026-10-29";
  const ontem = "2026-10-28";
  const semAviso = { emailEm: { atencao: null, critico: null }, sentryEm: { atencao: null, critico: null }, voltaPendente: false };

  it("a primeira medida em atenção avisa por e-mail e Sentry; a segunda do mesmo dia não repete", () => {
    expect(decidirAvisos(null, "atencao", hoje)).toEqual({ email: "atencao", sentry: "atencao" });
    const depois = { emailEm: { atencao: hoje, critico: null }, sentryEm: { atencao: hoje, critico: null }, voltaPendente: true };
    expect(decidirAvisos(depois, "atencao", hoje)).toEqual({ email: null, sentry: null });
  });

  it("no dia seguinte avisa de novo enquanto durar", () => {
    const antes = { emailEm: { atencao: ontem, critico: null }, sentryEm: { atencao: ontem, critico: null }, voltaPendente: true };
    expect(decidirAvisos(antes, "atencao", hoje)).toEqual({ email: "atencao", sentry: "atencao" });
  });

  it("subir de atenção para crítico no mesmo dia avisa o crítico (um aviso por nível por dia)", () => {
    const depoisDaAtencao = { emailEm: { atencao: hoje, critico: null }, sentryEm: { atencao: hoje, critico: null }, voltaPendente: true };
    expect(decidirAvisos(depoisDaAtencao, "critico", hoje)).toEqual({ email: "critico", sentry: "critico" });
  });

  it("a marca de um nível não vale para o outro", () => {
    const soCritico = { emailEm: { atencao: null, critico: hoje }, sentryEm: { atencao: null, critico: hoje }, voltaPendente: true };
    expect(decidirAvisos(soCritico, "atencao", hoje).email).toBe("atencao");
  });

  it("o 'voltou ao normal' sai uma vez, só depois de um aviso; normal sem aviso antes não diz nada", () => {
    expect(decidirAvisos(semAviso, "normal", hoje)).toEqual({ email: null, sentry: null });
    expect(decidirAvisos(null, "normal", hoje)).toEqual({ email: null, sentry: null });
    expect(decidirAvisos({ ...semAviso, voltaPendente: true }, "normal", hoje)).toEqual({ email: "voltou", sentry: null });
  });
});

describe("estadoDoTexto", () => {
  const bom: EstadoDoAlarme = {
    nivel: "atencao",
    desde: "2026-10-29T10:00:00.000Z",
    medidoEm: "2026-10-29T10:15:00.000Z",
    usadoPercentual: 83.2,
    livreBytes: 16_800_000_000,
    totalBytes: 100_000_000_000,
    edicaoBytes: 1,
    publicarBytes: 2,
    emailEm: { atencao: "2026-10-29", critico: null },
    sentryEm: { atencao: "2026-10-29", critico: null },
    voltaPendente: true,
  };

  it("lê o que o job gravou", () => {
    expect(estadoDoTexto(JSON.stringify(bom))).toEqual(bom);
  });

  it("texto estragado ou de outra forma vale como nunca medi", () => {
    expect(estadoDoTexto(null)).toBeNull();
    expect(estadoDoTexto("")).toBeNull();
    expect(estadoDoTexto("{quebrado")).toBeNull();
    expect(estadoDoTexto("[]")).toBeNull();
    expect(estadoDoTexto(JSON.stringify({ ...bom, nivel: "altissimo" }))).toBeNull();
    expect(estadoDoTexto(JSON.stringify({ ...bom, usadoPercentual: "muito" }))).toBeNull();
  });
});

describe("recusaPorDiscoCritico", () => {
  it("abaixo do crítico o envio segue e a limpeza não é pedida", async () => {
    const limparAgora = vi.fn();
    const recusa = await recusaPorDiscoCritico({ medir: async () => ({ usadoPercentual: 89.9 }), limites: LIMITES, limparAgora });
    expect(recusa).toBeNull();
    expect(limparAgora).not.toHaveBeenCalled();
  });

  it("no crítico recusa com a frase para a pessoa e pede a limpeza na hora", async () => {
    const limparAgora = vi.fn().mockResolvedValue(true);
    const recusa = await recusaPorDiscoCritico({ medir: async () => ({ usadoPercentual: 90 }), limites: LIMITES, limparAgora });
    expect(recusa).toEqual({ status: 503, codigo: "disco-cheio", frase: "O envio de vídeos está pausado por alguns minutos. Tente de novo mais tarde." });
    expect(recusa?.frase).toBe(fraseDaEdicao("disco-cheio"));
    expect(limparAgora).toHaveBeenCalledTimes(1);
  });

  it("se não conseguir medir o disco o envio segue (a medida quebrada não derruba o produto)", async () => {
    const limparAgora = vi.fn();
    const recusa = await recusaPorDiscoCritico({ medir: async () => Promise.reject(new Error("statfs falhou")), limites: LIMITES, limparAgora });
    expect(recusa).toBeNull();
    expect(limparAgora).not.toHaveBeenCalled();
  });
});
