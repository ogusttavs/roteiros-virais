/**
 * O estado da leitura por rede (23/10/2026): a regra de "parou", de "desde quando" e de "voltou", provada sem banco.
 */
import { describe, expect, it } from "vitest";

import {
  causasDaRodada,
  estadoDaLeituraDasExecucoes,
  FALHAS_SEM_LEITURA_PARA_PARAR,
  type ObservacaoDaRodada,
  outrasParadas,
  paradasEmLista,
  proximoEstadoDaLeitura,
  proxyDoEstado,
} from "./leitura-parada";

const dia = (d: number) => new Date(`2026-10-${String(d).padStart(2, "0")}T07:00:00.000Z`);

function observacao(extra: Partial<ObservacaoDaRodada> = {}): ObservacaoDaRodada {
  return {
    sucessos: { youtube: 0, tiktok: 0, instagram: 0, ...extra.sucessos },
    falhas: { youtube: 0, tiktok: 0, instagram: 0, ...extra.falhas },
    falhasDeBloqueioNoYoutube: extra.falhasDeBloqueioNoYoutube ?? 0,
    proxyParado: extra.proxyParado ?? null,
    freio: extra.freio ?? { youtube: false, tiktok: false },
    proxyRespondeu: extra.proxyRespondeu ?? false,
  };
}

describe("causasDaRodada", () => {
  it("o proxy que parou para o YouTube e o TikTok juntos, e deixa o Instagram em paz", () => {
    expect(causasDaRodada(observacao({ proxyParado: "proxy sem trafego" }))).toEqual({ youtube: "proxy sem trafego", tiktok: "proxy sem trafego" });
  });

  it("falhas demais sem nenhuma leitura boa param a rede (o Instagram incluído); uma leitura boa no meio impede", () => {
    const n = FALHAS_SEM_LEITURA_PARA_PARAR;
    expect(causasDaRodada(observacao({ falhas: { youtube: 0, tiktok: 0, instagram: n } }))).toEqual({ instagram: "sem leitura" });
    expect(causasDaRodada(observacao({ falhas: { youtube: 0, tiktok: 0, instagram: n - 1 } }))).toEqual({});
    expect(causasDaRodada(observacao({ sucessos: { youtube: 0, tiktok: 0, instagram: 1 }, falhas: { youtube: 0, tiktok: 0, instagram: n + 10 } }))).toEqual({});
  });

  it("no YouTube, o robô barrado ou o download pendurado é bloqueio; o freio das dez falhas seguidas também, mesmo com leitura boa antes", () => {
    const n = FALHAS_SEM_LEITURA_PARA_PARAR;
    expect(causasDaRodada(observacao({ falhas: { youtube: n, tiktok: 0, instagram: 0 }, falhasDeBloqueioNoYoutube: n }))).toEqual({ youtube: "bloqueio" });
    expect(causasDaRodada(observacao({ falhas: { youtube: n, tiktok: 0, instagram: 0 } }))).toEqual({ youtube: "sem leitura" });
    expect(causasDaRodada(observacao({ sucessos: { youtube: 3, tiktok: 0, instagram: 0 }, freio: { youtube: true, tiktok: false } }))).toEqual({ youtube: "bloqueio" });
    expect(causasDaRodada(observacao({ freio: { youtube: false, tiktok: true } }))).toEqual({ tiktok: "sem leitura" });
  });
});

describe("proximoEstadoDaLeitura", () => {
  const parada = (causa: "proxy sem trafego" | "bloqueio" | "sem leitura", desde: Date) => ({ causa, desde: desde.toISOString() });

  it("a rede que para pela primeira vez fica parada desde agora", () => {
    const novo = proximoEstadoDaLeitura({}, observacao({ proxyParado: "proxy sem trafego" }), dia(23));
    expect(novo).toEqual({ youtube: parada("proxy sem trafego", dia(23)), tiktok: parada("proxy sem trafego", dia(23)) });
  });

  it("a rede que continua parada guarda o 'desde' da primeira noite, não o de hoje", () => {
    const antes = { youtube: parada("proxy sem trafego", dia(3)), tiktok: parada("proxy sem trafego", dia(3)) };
    const novo = proximoEstadoDaLeitura(antes, observacao({ proxyParado: "proxy sem trafego" }), dia(23));
    expect(novo.youtube?.desde).toBe(dia(3).toISOString());
    expect(novo.tiktok?.desde).toBe(dia(3).toISOString());
  });

  it("uma leitura boa limpa a rede", () => {
    const antes = { youtube: parada("bloqueio", dia(3)) };
    expect(proximoEstadoDaLeitura(antes, observacao({ sucessos: { youtube: 1, tiktok: 0, instagram: 0 } }), dia(23))).toEqual({});
  });

  it("parada pelo proxy e o proxy respondeu (o vídeo é que falhou): o proxy voltou, a parada some", () => {
    const antes = { youtube: parada("proxy sem trafego", dia(3)), tiktok: parada("proxy sem trafego", dia(3)) };
    expect(proximoEstadoDaLeitura(antes, observacao({ proxyRespondeu: true, falhas: { youtube: 1, tiktok: 0, instagram: 0 } }), dia(23))).toEqual({});
  });

  it("parada por bloqueio e a tentativa de prova falhou sem concluir nada: continua parada, com o mesmo 'desde'", () => {
    const antes = { youtube: parada("bloqueio", dia(3)) };
    const novo = proximoEstadoDaLeitura(antes, observacao({ proxyRespondeu: true, falhas: { youtube: 1, tiktok: 0, instagram: 0 }, falhasDeBloqueioNoYoutube: 1 }), dia(23));
    expect(novo).toEqual(antes);
  });

  it("rodada que não tentou nada na rede não muda o que já estava (nem inventa parada)", () => {
    const antes = { instagram: parada("sem leitura", dia(20)) };
    expect(proximoEstadoDaLeitura(antes, observacao(), dia(23))).toEqual(antes);
    expect(proximoEstadoDaLeitura({}, observacao(), dia(23))).toEqual({});
  });

  it("parou de novo depois de ler algo na mesma noite: o 'desde' é de agora (a rede estava boa antes)", () => {
    const antes = { youtube: parada("proxy sem trafego", dia(3)) };
    const novo = proximoEstadoDaLeitura(antes, observacao({ proxyParado: "proxy sem trafego", sucessos: { youtube: 12, tiktok: 0, instagram: 0 } }), dia(23));
    expect(novo.youtube?.desde).toBe(dia(23).toISOString());
  });
});

describe("estadoDaLeituraDasExecucoes", () => {
  it("vale o estado gravado pela rodada mais nova, mesmo vazio (tudo lê)", () => {
    const execucoes = [
      { iniciadoEm: dia(23), resumo: { leituraParada: {} } },
      { iniciadoEm: dia(22), resumo: { leituraParada: { youtube: { causa: "bloqueio", desde: dia(20).toISOString() } }, youtubePausadoMotivo: "proxy sem trafego" } },
    ];
    expect(estadoDaLeituraDasExecucoes(execucoes)).toEqual({});
  });

  it("lê a causa e a data de cada rede e ignora o que não é válido", () => {
    const estado = estadoDaLeituraDasExecucoes([
      { iniciadoEm: dia(23), resumo: { leituraParada: { youtube: { causa: "bloqueio", desde: dia(20).toISOString() }, tiktok: { causa: "outra coisa", desde: dia(20).toISOString() }, instagram: { causa: "sem leitura", desde: "nao e data" } } } },
    ]);
    expect(estado).toEqual({ youtube: { causa: "bloqueio", desde: dia(20).toISOString() } });
  });

  it("sem nenhuma rodada que tenha gravado o estado (as de antes deste aviso), vale o que o resumo antigo dizia do proxy, para o YouTube e o TikTok", () => {
    const estado = estadoDaLeituraDasExecucoes([
      { iniciadoEm: dia(22), resumo: { youtubePausadoMotivo: "proxy sem trafego" } },
      { iniciadoEm: dia(21), resumo: { youtubePausadoMotivo: "proxy sem trafego", proxyPausadoDesde: dia(3).toISOString() } },
    ]);
    expect(estado.youtube).toEqual({ causa: "proxy sem trafego", desde: dia(3).toISOString() });
    expect(estado.tiktok).toEqual(estado.youtube);
    expect(estado.instagram).toBeUndefined();
  });

  it("sem nada, nada parado", () => {
    expect(estadoDaLeituraDasExecucoes([])).toEqual({});
    expect(estadoDaLeituraDasExecucoes([{ iniciadoEm: dia(23), resumo: null }])).toEqual({});
  });
});

describe("a lista e o proxy a partir do estado", () => {
  const estado = {
    youtube: { causa: "proxy sem trafego" as const, desde: dia(3).toISOString() },
    tiktok: { causa: "proxy sem trafego" as const, desde: dia(5).toISOString() },
    instagram: { causa: "sem leitura" as const, desde: dia(20).toISOString() },
  };

  it("lista na ordem das redes, com a data como Date", () => {
    expect(paradasEmLista(estado).map((p) => [p.plataforma, p.causa, p.desde.toISOString()])).toEqual([
      ["youtube", "proxy sem trafego", dia(3).toISOString()],
      ["tiktok", "proxy sem trafego", dia(5).toISOString()],
      ["instagram", "sem leitura", dia(20).toISOString()],
    ]);
  });

  it("o proxy é a causa do proxy mais antiga; as outras paradas ficam à parte", () => {
    expect(proxyDoEstado(estado)).toEqual({ motivo: "proxy sem trafego", desde: dia(3) });
    expect(outrasParadas(estado).map((p) => p.plataforma)).toEqual(["instagram"]);
    expect(proxyDoEstado({ instagram: estado.instagram })).toBeNull();
    expect(proxyDoEstado({})).toBeNull();
  });
});
