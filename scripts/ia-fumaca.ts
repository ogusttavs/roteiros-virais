/**
 * Fumaca manual da camada de IA (plano de execucao, etapa 4): chama as nove
 * tarefas do plano uma vez cada, com dados ficticios encadeados (o resumo do
 * perfil e do modelo do nicho de uma chamada alimenta o sistema estavel da
 * proxima, como em producao), e imprime o resumo de cada saida com o custo.
 * Nivel e esforco de cada chamada vem do que o proprio modulo do prompt
 * exporta (etapa 5, revisao da etapa 4), nunca repetidos aqui.
 *
 * So faz sentido rodar com a chave de verdade (ANTHROPIC_API_KEY no .env,
 * sem AI_PROVIDER=mock). Nunca roda em teste automatizado: vitest.config.mts
 * e playwright.config.ts forcam AI_PROVIDER=mock para todo teste.
 *
 * Nao grava em geracoes_ia (essa gravacao ja tem teste de integracao
 * proprio); so chama src/ia/cliente.ts e soma o custo com a mesma formula de
 * src/ia/registro.ts.
 */
import type { NivelIA } from "../src/config/precos-ia";
import { gerarEstruturado } from "../src/ia/cliente";
import * as analisarVisual from "../src/ia/prompts/analisarVisual";
import * as avaliarResposta from "../src/ia/prompts/avaliarResposta";
import * as avaliarTema from "../src/ia/prompts/avaliarTema";
import * as compilarPerfil from "../src/ia/prompts/compilarPerfil";
import * as extrairVideo from "../src/ia/prompts/extrairVideo";
import * as modeloNicho from "../src/ia/prompts/modeloNicho";
import * as roteiro from "../src/ia/prompts/roteiro";
import * as temasDoDia from "../src/ia/prompts/temasDoDia";
import * as verificarTexto from "../src/ia/prompts/verificarTexto";
import { calcularCustoUsd } from "../src/ia/registro";
import type { ImagemEntrada, ResultadoGeracao, TarefaIA } from "../src/ia/tipos";
import { config } from "../src/lib/config";

/** Pixel 1x1: so para exercitar o caminho com imagem, nao a qualidade da leitura visual. */
const QUADRO_PLACEHOLDER: ImagemEntrada = {
  mediaType: "image/png",
  base64:
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
};

let custoTotalUsd = 0;

async function chamar<T>(
  tarefa: TarefaIA,
  nivel: NivelIA,
  resumo: (dados: T) => string,
  promessa: Promise<ResultadoGeracao<T>>,
): Promise<T> {
  const resultado = await promessa;
  const custo = calcularCustoUsd(nivel, resultado);
  custoTotalUsd += custo;

  console.log(`\n${tarefa} (${nivel}, ${resultado.modelo})`);
  console.log(
    `  tokens entrada=${resultado.tokensEntrada} saida=${resultado.tokensSaida} ` +
      `cache leitura=${resultado.tokensCacheLeitura} escrita=${resultado.tokensCacheEscrita}`,
  );
  console.log(`  custo: US$ ${custo.toFixed(4)}`);
  console.log(`  ${resumo(resultado.dados)}`);

  return resultado.dados;
}

async function main() {
  console.log(`provedor de IA: ${config.ia.provedor}`);
  if (config.ia.provedor === "mock") {
    console.log(
      "AI_PROVIDER=mock: isto so testa o caminho de mock, com custo zero. " +
        "Para o teste de fumaca de verdade, rode com ANTHROPIC_API_KEY valida no .env " +
        "e sem AI_PROVIDER=mock.",
    );
  }

  await chamar(
    "avaliarResposta",
    avaliarResposta.nivel,
    (d) => `nota ${d.nota}: ${d.bom.slice(0, 80)}`,
    gerarEstruturado({
      tarefa: "avaliarResposta",
      nivel: avaliarResposta.nivel,
      effort: avaliarResposta.esforco,
      schema: avaliarResposta.schema,
      sistemaEstavel: avaliarResposta.montarSistemaEstavel(),
      entrada: avaliarResposta.montarEntrada({
        pergunta: "O que voce vende e por quanto?",
        oQueAIAProcura: "produto ou servico principal, com preco real",
        resposta:
          "Vendo lavagem a seco de estofado. O pacote de sofa de 3 lugares fica em R$ 180.",
      }),
    }),
  );

  const perfil = await chamar(
    "compilarPerfil",
    compilarPerfil.nivel,
    (d) => d.resumo.slice(0, 100),
    gerarEstruturado({
      tarefa: "compilarPerfil",
      nivel: compilarPerfil.nivel,
      effort: compilarPerfil.esforco,
      schema: compilarPerfil.schema,
      sistemaEstavel: compilarPerfil.montarSistemaEstavel(),
      entrada: compilarPerfil.montarEntrada({
        respostas: {
          "O que voce vende e por quanto?":
            "Lavagem a seco de estofado. Sofa de 3 lugares R$ 180, colchao de casal R$ 150.",
          "Quem e seu cliente ideal?":
            "Mora em apartamento, tem filho pequeno ou animal de estimacao, zona sul de Sao Paulo.",
          "O que voce nunca diria ou faria num video?":
            "Nunca prometo tirar mancha de vinho tinto, isso seria mentira.",
        },
      }),
    }),
  );

  const extraido = await chamar(
    "extrairVideo",
    extrairVideo.nivel,
    (d) => `${d.assunto}: "${d.gancho.slice(0, 60)}"`,
    gerarEstruturado({
      tarefa: "extrairVideo",
      nivel: extrairVideo.nivel,
      effort: extrairVideo.esforco,
      schema: extrairVideo.schema,
      sistemaEstavel: extrairVideo.montarSistemaEstavel(),
      entrada: extrairVideo.montarEntrada({
        titulo: "3 erros que estragam o sofa",
        transcricao:
          "Oi gente, hoje eu vou mostrar os 3 erros que quase todo mundo comete limpando o proprio sofa em casa.",
      }),
    }),
  );

  await chamar(
    "analisarVisual",
    analisarVisual.nivel,
    (d) => `ritmo ${d.ritmoDeCorte}, ${d.recursos.length} recurso(s)`,
    gerarEstruturado({
      tarefa: "analisarVisual",
      nivel: analisarVisual.nivel,
      effort: analisarVisual.esforco,
      schema: analisarVisual.schema,
      sistemaEstavel: analisarVisual.montarSistemaEstavel(),
      entrada: analisarVisual.montarEntrada({
        titulo: "3 erros que estragam o sofa",
        duracaoS: 42,
        transcricao:
          "Oi gente, hoje eu vou mostrar os 3 erros que quase todo mundo comete limpando o proprio sofa em casa.",
      }),
      imagens: [QUADRO_PLACEHOLDER],
    }),
  );

  const nicho = await chamar(
    "modeloNicho",
    modeloNicho.nivel,
    (d) => d.resumo.slice(0, 100),
    gerarEstruturado({
      tarefa: "modeloNicho",
      nivel: modeloNicho.nivel,
      effort: modeloNicho.esforco,
      schema: modeloNicho.schema,
      sistemaEstavel: modeloNicho.montarSistemaEstavel(),
      entrada: modeloNicho.montarEntrada({
        videosAnalisados: [
          {
            id: 1,
            assunto: extraido.assunto,
            gancho: extraido.gancho,
            estrutura: extraido.estrutura,
            fechamento: extraido.fechamento,
            chamadaFinal: extraido.chamadaFinal,
            formato: extraido.formato,
          },
        ],
        analisesVisuais: [{ id: 1, ritmoDeCorte: "rapido", recursos: ["texto na tela", "zoom"] }],
      }),
    }),
  );

  await chamar(
    "temasDoDia",
    temasDoDia.nivel,
    (d) => d.temas.map((t) => t.titulo).join(" | "),
    gerarEstruturado({
      tarefa: "temasDoDia",
      nivel: temasDoDia.nivel,
      effort: temasDoDia.esforco,
      schema: temasDoDia.schema,
      sistemaEstavel: temasDoDia.montarSistemaEstavel({ modeloNicho: nicho.resumo }),
      entrada: temasDoDia.montarEntrada({
        subindoHoje: [{ id: 2, assunto: "mancha de vinho tinto no sofa", velocidadeRelativa: 4.2 }],
        noticias: [
          { titulo: "Inverno chega mais cedo em SP", resumo: "friagem aumenta o uso de sofa e cobertor" },
        ],
      }),
    }),
  );

  await chamar(
    "avaliarTema",
    avaliarTema.nivel,
    (d) => `nota ${d.nota}: ${d.recomendacao.slice(0, 80)}`,
    gerarEstruturado({
      tarefa: "avaliarTema",
      nivel: avaliarTema.nivel,
      effort: avaliarTema.esforco,
      schema: avaliarTema.schema,
      sistemaEstavel: avaliarTema.montarSistemaEstavel({
        perfilCompilado: perfil.resumo,
        modeloNicho: nicho.resumo,
        persona: "negocio",
      }),
      entrada: avaliarTema.montarEntrada({
        tema: "como tirar mancha de vinho tinto do sofa sem estragar o tecido",
        evidencias: [{ id: 2, assunto: "mancha de vinho tinto no sofa", foraDaCurva: 4.2 }],
      }),
    }),
  );

  const script = await chamar(
    "roteiro",
    roteiro.nivel,
    (d) => `"${d.titulo}": ${d.gancho.slice(0, 80)}`,
    gerarEstruturado({
      tarefa: "roteiro",
      nivel: roteiro.nivel,
      effort: roteiro.esforco,
      schema: roteiro.schema,
      sistemaEstavel: roteiro.montarSistemaEstavel({
        perfilCompilado: perfil.resumo,
        modeloNicho: nicho.resumo,
      }),
      entrada: roteiro.montarEntrada({
        tema: "como tirar mancha de vinho tinto do sofa sem estragar o tecido",
        objetivo: "conversao",
        evidencias: [{ id: 2, assunto: extraido.assunto, gancho: extraido.gancho }],
      }),
    }),
  );

  await chamar(
    "verificarTexto",
    verificarTexto.nivel,
    (d) => (d.aprovado ? "aprovado" : `reprovado: ${d.motivo}`),
    gerarEstruturado({
      tarefa: "verificarTexto",
      nivel: verificarTexto.nivel,
      effort: verificarTexto.esforco,
      schema: verificarTexto.schema,
      sistemaEstavel: verificarTexto.montarSistemaEstavel(),
      entrada: verificarTexto.montarEntrada({
        texto: `${script.gancho}\n\n${script.corpo}`,
        proibicoes: ["nunca prometer tirar mancha de vinho tinto"],
      }),
    }),
  );

  console.log(`\ncusto total: US$ ${custoTotalUsd.toFixed(4)}`);
  if (custoTotalUsd > 0.5) {
    console.log("acima da meta de US$ 0,50 (plano de execucao, etapa 4).");
  }
}

main().catch((erro: unknown) => {
  console.error(erro);
  process.exitCode = 1;
});
