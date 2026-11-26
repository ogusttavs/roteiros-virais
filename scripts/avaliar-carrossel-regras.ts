/**
 * Regras puras da avaliação do carrossel (sem banco, sem IA, sem process.exit): o formato do resultado de uma rodada, o resumo (prontos na 1ª, na 2ª, falhas, motivos, custo e tempo),
 * o teto de gasto que para a rodada, o comparador antes e depois (contagens lado a lado e Markdown com os textos) e o motivo normalizado. O script que gasta é `avaliar-carrossel.ts`; o
 * comparador de linha de comando é `avaliar-carrossel-comparar.ts`.
 */

export type DesfechoDoCaso = "1a" | "2a" | "falhou" | "nao-rodou";

export type ResultadoDoCaso = {
  id: string;
  nome: string;
  ramo: string;
  quantidade: number;
  /** "1a": pronto na 1ª tentativa; "2a": só na 2ª; "falhou": reprovado nas duas (em produção, o erro que a pessoa vê); "nao-rodou": o teto de gasto parou a rodada antes dele. */
  desfecho: DesfechoDoCaso;
  /** Os motivos de reprova das tentativas que reprovaram (vazio no que passou de primeira). */
  motivos: string[];
  custoUsd: number;
  tempoS: number;
  /** O texto de cada slide, na ordem, um item por linha de texto do slide. */
  slides: string[][];
  legenda: string;
  hashtags: string[];
  avisos: string[];
  erro?: string;
};

export type Rodada = {
  data: string;
  versaoPrompt: string;
  conjunto: string;
  /** Os preços usados (dólar por 1 milhão de tokens) e a data deles (`src/config/precos-ia.ts`). */
  precos: { forte: { entrada: number; saida: number }; barato: { entrada: number; saida: number }; datados: string };
  tetoUsd: number | null;
  gastoUsd: number;
  parouPeloTeto: boolean;
  casos: ResultadoDoCaso[];
};

/** O motivo sem o que muda de caso para caso (aspas, números), para contar "o mesmo motivo" em casos diferentes. O código da regra (R-COPY-26) vale sozinho. */
export function categoriaDoMotivo(motivo: string): string {
  const m = motivo.trim();
  const codigo = /^(R-[A-Z]+-\d+)/.exec(m);
  if (codigo) return codigo[1];
  return m
    .replace(/["“”][^"“”]*["“”]/g, "\"...\"")
    .replace(/\d+/g, "N")
    .slice(0, 90);
}

export type Resumo = {
  total: number;
  rodados: number;
  prontosNa1a: number;
  prontosNa2a: number;
  falhas: number;
  naoRodou: number;
  motivosMaisComuns: { motivo: string; vezes: number }[];
  custoTotalUsd: number;
  custoMedioUsd: number;
  tempoMedioS: number;
};

export function resumir(rodada: Rodada, quantosMotivos = 8): Resumo {
  const rodados = rodada.casos.filter((c) => c.desfecho !== "nao-rodou");
  const contagem = new Map<string, number>();
  for (const c of rodados) for (const m of c.motivos) contagem.set(categoriaDoMotivo(m), (contagem.get(categoriaDoMotivo(m)) ?? 0) + 1);
  const motivosMaisComuns = [...contagem.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, quantosMotivos)
    .map(([motivo, vezes]) => ({ motivo, vezes }));
  const custoTotalUsd = rodados.reduce((s, c) => s + c.custoUsd, 0);
  const tempoTotal = rodados.reduce((s, c) => s + c.tempoS, 0);
  return {
    total: rodada.casos.length,
    rodados: rodados.length,
    prontosNa1a: rodados.filter((c) => c.desfecho === "1a").length,
    prontosNa2a: rodados.filter((c) => c.desfecho === "2a").length,
    falhas: rodados.filter((c) => c.desfecho === "falhou").length,
    naoRodou: rodada.casos.length - rodados.length,
    motivosMaisComuns,
    custoTotalUsd,
    custoMedioUsd: rodados.length ? custoTotalUsd / rodados.length : 0,
    tempoMedioS: rodados.length ? tempoTotal / rodados.length : 0,
  };
}

const usd = (n: number) => `US$ ${n.toFixed(4)}`;

/** As contagens das duas rodadas lado a lado, em texto para o terminal. */
export function compararEmTexto(antes: Rodada, depois: Rodada): string {
  const a = resumir(antes);
  const d = resumir(depois);
  const linhas: [string, string, string][] = [
    ["", "antes", "depois"],
    ["versao do prompt", antes.versaoPrompt, depois.versaoPrompt],
    ["data", antes.data.slice(0, 10), depois.data.slice(0, 10)],
    ["casos rodados", `${a.rodados}/${a.total}`, `${d.rodados}/${d.total}`],
    ["prontos na 1a", String(a.prontosNa1a), String(d.prontosNa1a)],
    ["prontos na 2a", String(a.prontosNa2a), String(d.prontosNa2a)],
    ["falhas", String(a.falhas), String(d.falhas)],
    ["custo medio", usd(a.custoMedioUsd), usd(d.custoMedioUsd)],
    ["custo total", usd(a.custoTotalUsd), usd(d.custoTotalUsd)],
    ["tempo medio", `${a.tempoMedioS.toFixed(1)} s`, `${d.tempoMedioS.toFixed(1)} s`],
  ];
  const l0 = Math.max(...linhas.map((l) => l[0].length));
  const l1 = Math.max(...linhas.map((l) => l[1].length));
  const saida = linhas.map(([x, y, z]) => `${x.padEnd(l0)}  ${y.padEnd(l1)}  ${z}`);
  saida.push("", "motivos de reprova mais comuns (vezes)");
  const motivos = new Set([...a.motivosMaisComuns, ...d.motivosMaisComuns].map((m) => m.motivo));
  const conta = (r: Resumo, m: string) => r.motivosMaisComuns.find((x) => x.motivo === m)?.vezes ?? 0;
  if (motivos.size === 0) saida.push("  nenhum");
  for (const m of [...motivos].sort((x, y) => conta(d, y) + conta(a, y) - conta(d, x) - conta(a, x))) saida.push(`  ${conta(a, m)} -> ${conta(d, m)}  ${m}`);
  return saida.join("\n");
}

function blocoDoCaso(c: ResultadoDoCaso | undefined): string {
  if (!c) return "_caso fora desta rodada_";
  if (c.desfecho === "nao-rodou") return "_nao rodou (teto de gasto)_";
  const cab = `**${c.desfecho === "1a" ? "pronto na 1a" : c.desfecho === "2a" ? "pronto na 2a" : "falhou"}**, ${usd(c.custoUsd)}, ${c.tempoS.toFixed(1)} s`;
  const motivos = c.motivos.length ? `\n\nMotivos de reprova:\n${c.motivos.map((m) => `- ${m}`).join("\n")}` : "";
  const erro = c.erro ? `\n\nErro: ${c.erro}` : "";
  const slides = c.slides.map((s, i) => `${i + 1}. ${s.join(" / ")}`).join("\n");
  return `${cab}${motivos}${erro}\n\n${slides || "_sem slides_"}\n\nLegenda: ${c.legenda || "_sem legenda_"}`;
}

/** O Markdown dos textos dos dois lado a lado, caso a caso (uma tabela de duas colunas por caso; quebras viram `<br>`). */
export function compararEmMarkdown(antes: Rodada, depois: Rodada): string {
  const ids = [...new Set([...antes.casos.map((c) => c.id), ...depois.casos.map((c) => c.id)])];
  const celula = (t: string) => t.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
  const partes = [
    "# Carrossel: antes e depois",
    "",
    `Antes: prompt ${antes.versaoPrompt}, ${antes.data.slice(0, 10)}. Depois: prompt ${depois.versaoPrompt}, ${depois.data.slice(0, 10)}.`,
    "",
    "```",
    compararEmTexto(antes, depois),
    "```",
  ];
  for (const id of ids) {
    const a = antes.casos.find((c) => c.id === id);
    const d = depois.casos.find((c) => c.id === id);
    partes.push("", `## ${id}`, "", `Tema: ${(a ?? d)?.nome ?? ""}`, "", "| Antes | Depois |", "| --- | --- |", `| ${celula(blocoDoCaso(a))} | ${celula(blocoDoCaso(d))} |`);
  }
  return partes.join("\n") + "\n";
}

/** Parar a rodada: o gasto até aqui já passou do teto (ou o chegou nele). Sem teto, nunca para. */
export function passouDoTeto(gastoUsd: number, tetoUsd: number | null): boolean {
  return tetoUsd !== null && gastoUsd >= tetoUsd;
}

/**
 * Roda os casos em ordem, um por vez, e soma o custo; antes de cada caso confere o teto. Um caso que já começou termina (o gasto dele entra), então o gasto final pode passar do teto por um
 * caso, no máximo. Os casos que sobram voltam como "nao-rodou". `executar` é injetado (o script passa o serviço de verdade; o teste, resultados simulados).
 */
export async function rodarComTeto<C extends { id: string; nome: string; ramo: string; quantidade: number }>(
  casos: C[],
  executar: (caso: C) => Promise<ResultadoDoCaso>,
  tetoUsd: number | null,
): Promise<{ casos: ResultadoDoCaso[]; gastoUsd: number; parouPeloTeto: boolean }> {
  const resultados: ResultadoDoCaso[] = [];
  let gasto = 0;
  let parou = false;
  for (const caso of casos) {
    if (passouDoTeto(gasto, tetoUsd)) {
      parou = true;
      resultados.push({ id: caso.id, nome: caso.nome, ramo: caso.ramo, quantidade: caso.quantidade, desfecho: "nao-rodou", motivos: [], custoUsd: 0, tempoS: 0, slides: [], legenda: "", hashtags: [], avisos: [] });
      continue;
    }
    const r = await executar(caso);
    gasto += r.custoUsd;
    resultados.push(r);
  }
  return { casos: resultados, gastoUsd: gasto, parouPeloTeto: parou };
}

/** O desfecho pelo número de tentativas do carrossel que ficaram registradas e pelo caso ter dado certo ou não. */
export function desfechoDasTentativas(deuCerto: boolean, tentativas: number): DesfechoDoCaso {
  if (!deuCerto) return "falhou";
  return tentativas <= 1 ? "1a" : "2a";
}

/** Quebra o texto de motivo gravado (`motivo_avaliacao`, motivos separados por "; ") em motivos soltos. */
export function motivosDoTexto(texto: string | null | undefined): string[] {
  return (texto ?? "")
    .split("; ")
    .map((m) => m.trim())
    .filter(Boolean);
}

/** `--teto 0` ou `--teto sem` tiram o teto; ausente, o padrão é US$ 5. */
export function lerTeto(valor: string | undefined): number | null {
  if (valor === undefined) return 5;
  if (valor === "sem") return null;
  const n = Number(valor.replace(",", "."));
  if (!Number.isFinite(n) || n < 0) throw new Error(`--teto invalido: "${valor}"`);
  return n === 0 ? null : n;
}
