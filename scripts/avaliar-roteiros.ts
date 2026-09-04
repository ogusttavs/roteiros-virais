/**
 * Conjunto de referência do roteiro (golden set, etapa 11, decisão 7 do
 * `PROXIMO.md`): diferente de briefing e tema, o roteiro não tem uma nota
 * de 0 a 10 para comparar. O julgamento é "o Gustavo leria isso e
 * gravaria?", então este script só chama a tarefa `roteiro` para cada caso
 * e imprime o roteiro inteiro, para leitura humana.
 *
 * O arquivo real, com casos de verdade, fica fora do repositório público
 * (`avaliacoes/README.md` explica o formato e o porquê). `GOLDEN_SET_DIR`
 * aponta para a pasta que tem `roteiros.json`; sem o arquivo real lá, roda
 * com `avaliacoes/roteiros.exemplo.json` e avisa que é exemplo.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

import { gerarEstruturado } from "../src/ia/cliente";
import * as roteiroIA from "../src/ia/prompts/roteiro";

const objetivoSchema = z.enum(["alcance", "engajamento", "conversao"]);

const evidenciaSchema = z.object({
  id: z.number(),
  assunto: z.string(),
  gancho: z.string(),
  estrutura: z.string(),
  fechamento: z.string(),
  chamadaFinal: z.string(),
  foraDaCurva: z.number(),
  momentoChave: z.string().optional(),
});

const casoSchema = z.object({
  tema: z.string(),
  objetivo: objetivoSchema,
  perfilCompilado: z.string(),
  camadaExclusiva: z.string(),
  modeloNicho: z.string(),
  evidencias: z.array(evidenciaSchema),
  roteirosRecentes: z.array(z.object({ tema: z.string(), objetivo: objetivoSchema, status: z.string() })),
  anguloParaEvitar: z.object({ gancho: z.string(), corpo: z.string() }).optional(),
  pontoPrincipal: z.string(),
});
const conjuntoSchema = z.array(casoSchema);

function caminhoDoConjunto(): { caminho: string; ehExemplo: boolean } {
  const dir = process.env.GOLDEN_SET_DIR ?? "../avaliacoes-privadas";
  const caminhoReal = path.resolve(process.cwd(), dir, "roteiros.json");
  if (existsSync(caminhoReal)) {
    return { caminho: caminhoReal, ehExemplo: false };
  }
  return {
    caminho: path.resolve(process.cwd(), "avaliacoes/roteiros.exemplo.json"),
    ehExemplo: true,
  };
}

function linha(rotulo: string, texto: string): string {
  return `  ${rotulo}: ${texto}`;
}

async function main() {
  const { caminho, ehExemplo } = caminhoDoConjunto();
  const conjunto = conjuntoSchema.parse(JSON.parse(readFileSync(caminho, "utf8")));

  console.log(`conjunto: ${caminho}${ehExemplo ? " (exemplo, nao e o golden set real)" : ""}`);
  console.log(`${conjunto.length} caso(s)\n`);

  for (const [indice, caso] of conjunto.entries()) {
    console.log(`${"=".repeat(70)}`);
    console.log(`caso ${indice + 1}/${conjunto.length}: "${caso.tema}"`);
    console.log(`ponto principal: ${caso.pontoPrincipal}`);
    console.log(`${"-".repeat(70)}\n`);

    const resultado = await gerarEstruturado({
      tarefa: "roteiro",
      nivel: roteiroIA.nivel,
      effort: roteiroIA.esforco,
      schema: roteiroIA.schema,
      sistemaEstavel: roteiroIA.montarSistemaEstavel({
        perfilCompilado: caso.perfilCompilado,
        camadaExclusiva: caso.camadaExclusiva,
        modeloNicho: caso.modeloNicho,
      }),
      entrada: roteiroIA.montarEntrada({
        tema: caso.tema,
        objetivo: caso.objetivo,
        evidencias: caso.evidencias,
        roteirosRecentes: caso.roteirosRecentes,
        anguloParaEvitar: caso.anguloParaEvitar,
      }),
    });

    const saida = resultado.dados;

    console.log(`titulo: ${saida.titulo}`);
    console.log(`duracao: ${saida.duracaoS}s\n`);
    console.log("OS 3 PRIMEIROS SEGUNDOS");
    console.log(`  ${saida.gancho}\n`);
    console.log("O MEIO");
    console.log(`  ${saida.corpo}\n`);
    console.log("O FECHAMENTO");
    console.log(`  ${saida.fechamento}\n`);
    console.log("A CHAMADA FINAL");
    console.log(`  ${saida.chamadaFinal}\n`);
    console.log("ONDE GRAVAR E O QUE MOSTRAR");
    console.log(`  ${saida.ondeGravar}`);
    for (const cena of saida.cenas) {
      console.log(linha(cena.momento, cena.oQueFazer));
    }
    console.log("\nCOMO EDITAR");
    for (const item of saida.edicao.textoNaTela) {
      console.log(linha(`texto na tela (${item.quando})`, `"${item.oQue}", ${item.onde}`));
    }
    console.log(linha("ritmo de corte", saida.edicao.ritmoDeCorte));
    console.log(linha("recursos", saida.edicao.recursos.join("; ") || "nenhum"));
    console.log(linha("audio", saida.edicao.audio ?? "nenhum"));
    if (saida.edicao.referencia) {
      console.log(linha("referencia", `video ${saida.edicao.referencia.videoId}, ${saida.edicao.referencia.oQueOlhar}`));
    }
    console.log(`\nevidencias citadas: ${saida.evidencias.length > 0 ? saida.evidencias.join(", ") : "nenhuma"}`);
    console.log(`custo aproximado: ${resultado.modelo}\n`);
  }
}

main().catch((erro: unknown) => {
  console.error(erro);
  process.exitCode = 1;
});
