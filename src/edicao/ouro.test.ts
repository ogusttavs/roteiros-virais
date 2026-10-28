/**
 * Casos de ouro do motor de corte e legenda (E47, PR 1).
 *
 * Os três casos são projetos reais do editor do Gustavo (passeios em loja, 26/10/2026): `walgreens`
 * (versão longa, 4min43 de bruto), `walgreens-2min` (a versão curta do mesmo bruto, com seleções e 7
 * transições) e `riva` (dois clipes juntados). Em `__ouro__/<caso>/` ficam só `words.json` (palavras com
 * tempo), `project.json` (decisões do editor, sem caminhos da máquina) e o que os scripts Python do
 * editor (`plan_cuts.py` e `make_srt.py`, versão de 28/10/2026) devolvem hoje para eles:
 * `edl.esperado.json`, `captions.esperado.srt` e `palavras-chave.esperado.json`. A energia do áudio
 * (`__ouro__/energia/*.json`) é a curva de dB por janela de 10 ms já calculada, arredondada a 0,01 dB
 * (o Python, rodando com a curva arredondada, devolve o mesmo resultado que com a original).
 * Nunca entra vídeo nem áudio.
 *
 * Aceite: mesmos trechos, tempos com diferença de até 20 ms, mesmas transições, mesmo `.srt`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { planejarCortes } from "./cortes";
import { montarLegendas } from "./legendas";
import type {
  ConfigCorte,
  IntervaloEditorial,
  OpcoesLegenda,
  PalavraFalada,
  PresetRitmo,
  TransicaoCorte,
} from "./tipos";

const PASTA = join(__dirname, "__ouro__");
const TOLERANCIA_S = 0.02;

type PalavraPython = { w: string; s: number; e: number; ss?: boolean };
type ItemPython = [number, number, string?, (string | boolean)?];
type ProjetoPython = {
  preset?: PresetRitmo;
  pacing?: { max_pause?: number; keep_pause?: number; lead_in?: number; tail?: number };
  removals?: ItemPython[];
  selects?: ItemPython[];
  zoom_jumpcuts?: number;
  outro_hold?: number;
  caption_fixes?: Array<[string, string]>;
  title?: { style?: string };
  captions?: { max_chars?: number; max_words?: number; upper?: boolean };
  highlight?: string[];
  no_highlight?: string[];
  energia: string;
};
type EdlPython = {
  silence_db: number;
  duration: number;
  outro_hold: number;
  source_duration: number;
  segments: Array<{
    src: [number, number];
    dst: [number, number];
    cut_after: string | null;
    transition_in?: string;
    scale: number;
  }>;
  alerts: string[];
  kept_words: number[];
};

function lerJson<T>(...partes: string[]): T {
  return JSON.parse(readFileSync(join(PASTA, ...partes), "utf8")) as T;
}

function lerTexto(...partes: string[]): string {
  return readFileSync(join(PASTA, ...partes), "utf8").replace(/\r\n/g, "\n");
}

function intervalos(itens: ItemPython[] | undefined): IntervaloEditorial[] | undefined {
  return itens?.map(([de, ate, motivo, transicao]) => ({
    de,
    ate,
    motivo,
    transicao: transicao
      ? ((transicao === true ? "combinar" : transicao) as TransicaoCorte)
      : undefined,
  }));
}

function configDoProjeto(p: ProjetoPython): ConfigCorte {
  return {
    preset: p.preset,
    ritmo: p.pacing && {
      pausaMaxima: p.pacing.max_pause,
      pausaQueFica: p.pacing.keep_pause,
      folgaInicio: p.pacing.lead_in,
      folgaFim: p.pacing.tail,
    },
    remocoes: intervalos(p.removals),
    selecoes: intervalos(p.selects),
    zoomEmCortes: p.zoom_jumpcuts,
    respiroFinal: p.outro_hold,
  };
}

function opcoesDoProjeto(p: ProjetoPython): OpcoesLegenda {
  return {
    estilo: (p.title?.style ?? "nativo") === "nativo" ? "nativo" : "destaque",
    maxCaracteres: p.captions?.max_chars,
    maxPalavras: p.captions?.max_words,
    caixaAlta: p.captions?.upper,
  };
}

function carregar(caso: string) {
  const projeto = lerJson<ProjetoPython>(caso, "project.json");
  const palavras: PalavraFalada[] = lerJson<PalavraPython[]>(caso, "words.json").map((w) => ({
    texto: w.w,
    inicio: w.s,
    fim: w.e,
    abreTrecho: w.ss,
  }));
  const energia = lerJson<{ duracao: number; db: number[] }>("energia", `${projeto.energia}.json`);
  const edl = planejarCortes({
    palavras,
    energia: { db: Float32Array.from(energia.db), duracao: energia.duracao },
    config: configDoProjeto(projeto),
  });
  return { projeto, palavras, edl };
}

function legendasDoCaso(caso: string) {
  const { projeto, palavras, edl } = carregar(caso);
  return montarLegendas({
    palavras,
    edl,
    correcoes: projeto.caption_fixes,
    destaques: projeto.highlight,
    semDestaque: projeto.no_highlight,
    opcoes: opcoesDoProjeto(projeto),
  });
}

const CASOS = [
  { caso: "walgreens", trechos: 9, transicoes: 0 },
  { caso: "walgreens-2min", trechos: 14, transicoes: 7 },
  { caso: "riva", trechos: 19, transicoes: 5 },
];

describe.each(CASOS)("caso de ouro $caso", ({ caso, trechos, transicoes }) => {
  const { edl } = carregar(caso);
  const esperado = lerJson<EdlPython>(caso, "edl.esperado.json");

  it("devolve os mesmos trechos, com diferença de até 20 ms", () => {
    expect(edl.trechos).toHaveLength(trechos);
    expect(edl.trechos).toHaveLength(esperado.segments.length);
    esperado.segments.forEach((s, k) => {
      const t = edl.trechos[k];
      expect(
        Math.abs(t.origem[0] - s.src[0]),
        `trecho ${k + 1}, inicio na origem`,
      ).toBeLessThanOrEqual(TOLERANCIA_S);
      expect(
        Math.abs(t.origem[1] - s.src[1]),
        `trecho ${k + 1}, fim na origem`,
      ).toBeLessThanOrEqual(TOLERANCIA_S);
      expect(
        Math.abs(t.destino[0] - s.dst[0]),
        `trecho ${k + 1}, inicio no destino`,
      ).toBeLessThanOrEqual(TOLERANCIA_S);
      expect(
        Math.abs(t.destino[1] - s.dst[1]),
        `trecho ${k + 1}, fim no destino`,
      ).toBeLessThanOrEqual(TOLERANCIA_S);
      expect(t.corteDepois).toBe(s.cut_after);
      expect(t.escala).toBe(s.scale);
    });
  });

  it("devolve as mesmas transições, nos mesmos trechos", () => {
    const doMotor = edl.trechos.map((t) => t.transicaoEntrada ?? null);
    const doPython = esperado.segments.map((s) => s.transition_in ?? null);
    expect(doMotor).toEqual(doPython);
    expect(doMotor.filter(Boolean)).toHaveLength(transicoes);
  });

  it("devolve o mesmo resumo da edição", () => {
    expect(edl.limiarSilencioDb).toBe(esperado.silence_db);
    expect(Math.abs(edl.duracao - esperado.duration)).toBeLessThanOrEqual(TOLERANCIA_S);
    expect(edl.duracaoOrigem).toBe(esperado.source_duration);
    expect(edl.respiroFinal).toBe(esperado.outro_hold);
    expect(edl.palavrasMantidas).toEqual(esperado.kept_words);
    expect(edl.alertas).toHaveLength(esperado.alerts.length);
  });

  it("monta o mesmo captions.srt", () => {
    expect(legendasDoCaso(caso).srt).toBe(lerTexto(caso, "captions.esperado.srt"));
  });

  it("acha as mesmas palavras-chave", () => {
    expect(legendasDoCaso(caso).palavrasChave).toEqual(
      lerJson<string[]>(caso, "palavras-chave.esperado.json"),
    );
  });
});

describe("regras do motor, fora dos casos de ouro", () => {
  it("os trechos cobrem a linha do tempo cortada sem buraco nem sobreposição", () => {
    for (const { caso } of CASOS) {
      const { edl } = carregar(caso);
      let fim = 0;
      for (const t of edl.trechos) {
        expect(Math.abs(t.destino[0] - fim), caso).toBeLessThanOrEqual(0.002);
        fim = t.destino[1];
      }
      expect(Math.abs(fim - edl.duracao), caso).toBeLessThanOrEqual(0.002);
    }
  });
});
