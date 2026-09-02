/**
 * Regras puras do checar-texto (CLAUDE.md regras 1 e 2; brief-frontend.md
 * secao 8). Sem I/O nem process.exit aqui, para dar para testar; o ponto de
 * entrada de linha de comando fica em checar-texto.ts.
 */
import { globSync, readFileSync } from "node:fs";

export const PADROES = ["src/**/*.tsx", "src/textos/**/*.ts", "src/ia/prompts/**/*.ts"];

export const TRAVESSAO = /—/;
export const EMOJI = /\p{Extended_Pictographic}/u;

export const JARGAO: { proibido: RegExp; usar: string }[] = [
  {
    proibido: /\bengajamento\b/i,
    usar: "as pessoas lembrarem de voce, comentarios e salvamentos",
  },
  { proibido: /\bconvers(a|ã)o\b/i, usar: "gente te chamar para comprar" },
  { proibido: /\balcance\b/i, usar: "mais gente te conhecer" },
  { proibido: /\bcta\b/i, usar: "chamada final" },
  { proibido: /\bhook\b/i, usar: "os 3 primeiros segundos" },
  { proibido: /\bm(é|e)tricas?\b/i, usar: "quantas pessoas viram, o seu painel" },
  { proibido: /\bdashboard\b/i, usar: "o seu painel" },
  { proibido: /\bviral\b/i, usar: "fora da curva, muito acima do normal" },
  { proibido: /\bconte(ú|u)do\b/i, usar: "video" },
  { proibido: /\bonboarding\b/i, usar: "comecar, o seu briefing" },
];

export type Problema = { arquivo: string; linha: number; motivo: string };

export function verificarLinha(linha: string): string[] {
  const motivos: string[] = [];

  if (TRAVESSAO.test(linha)) {
    motivos.push("travessao (regra 1 do CLAUDE.md)");
  }
  if (EMOJI.test(linha)) {
    motivos.push("emoji (regra 2 do CLAUDE.md)");
  }
  for (const { proibido, usar } of JARGAO) {
    const achado = linha.match(proibido)?.[0];
    if (achado) {
      motivos.push(`jargao "${achado}" (brief-frontend.md secao 8), escreva algo como "${usar}"`);
    }
  }

  return motivos;
}

export function verificarArquivo(caminho: string): Problema[] {
  const conteudo = readFileSync(caminho, "utf8");
  return conteudo
    .split("\n")
    .flatMap((linha, i) =>
      verificarLinha(linha).map((motivo) => ({ arquivo: caminho, linha: i + 1, motivo })),
    );
}

export function listarArquivos(padroes: string[] = PADROES): string[] {
  const arquivos = new Set<string>();
  for (const padrao of padroes) {
    for (const arquivo of globSync(padrao)) arquivos.add(arquivo);
  }
  return [...arquivos].sort();
}
