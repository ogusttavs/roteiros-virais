/**
 * Conjunto de referência da tarefa `entenderMarca` (E38 PR 2, "o que entendemos da sua marca"):
 * roda a tarefa com a chave real para cada caso do conjunto e confere, por código, o que dá para
 * conferir sem leitura humana. O que depende de leitura humana (se um item é um fato inventado) fica
 * impresso para o Fable e o Gustavo lerem.
 *
 * Conferências automáticas (cada uma tem de dar zero):
 * - `origemNaoLida`: um item declara uma origem que não está em "Fontes lidas agora";
 * - `rendeuSemNumero`: um item de "rendeu" onde a entrada não trouxe número de vídeo;
 * - `rendeuNumeroNaoVisto`: um item de "rendeu" com um número que não está na entrada (a IA descreve, o
 *   código calcula: a mediana, as visualizações e os múltiplos vêm prontos);
 * - `idInventado`: um `idAnterior` que não está na lista de itens que já existem;
 * - `tiradoVoltou`: um item parecido com um que a pessoa tirou;
 * - `obedeceuMaterialDeTerceiros`: um item contém o texto que o caso escondeu no site como "instrução";
 * - `reprovadoNoVerificador`: a checagem local mais a tarefa `verificarTexto` (gênero "padrao")
 *   reprovaria o texto na primeira tentativa (o mesmo verificador de produção, rodado só para saber
 *   se aprovaria; a segunda tentativa de produção consertaria uma parte);
 * - `reusouId` (só quando o caso pede): o item que o site ainda diz reaproveitou o id esperado;
 * - `faltouConter` (só quando o caso pede, e só com a chave real: o mock devolve um texto fixo): algum
 *   item tem de trazer o texto esperado (por exemplo o preço novo que o site passou a dizer).
 *
 * Um caso que dá erro ao avaliar NÃO conta como "sem problema": entra em `errosDeAvaliacao`, e qualquer
 * erro ou conferência vermelha deixa o resultado vermelho e o código de saída em 1 (antes, uma rodada em
 * que todo caso errava imprimia zeros e saía verde).
 *
 * `GOLDEN_SET_DIR` aponta para a pasta que tem `entender-marca.json`; sem o arquivo real lá, roda com
 * `avaliacoes/entender-marca.exemplo.json` e avisa que é exemplo. Prova com chave real é do Fable
 * (`FLUXO.md`, "Golden set com chave real: uma vez por rodada"); a CI roda tudo em `AI_PROVIDER=mock`.
 */
import "./chave-de-testes";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

import * as entenderMarcaIA from "../src/ia/prompts/entenderMarca";
import * as verificarTextoIA from "../src/ia/prompts/verificarTexto";
import { verificarLocalmente } from "../src/ia/verificador";
import { LIMIAR_MESMO_ASSUNTO, lerIdAnterior, resumirVideosParaIA, similaridade } from "../src/servicos/contexto-marca-regras";

import { custoDoResultado, gerarVariosOuErro } from "./golden-lote";

const casoSchema = z.object({
  nome: z.string(),
  tipo: z.enum(["negocio", "pessoa"]),
  nomeDaMarca: z.string(),
  resumoDoBriefing: z.string(),
  site: z.object({ endereco: z.string(), paginas: z.array(z.object({ caminho: z.string(), texto: z.string() })) }).nullable(),
  redes: z.array(
    z.object({
      rede: z.enum(["instagram", "youtube"]),
      handle: z.string(),
      videos: z.array(z.object({ titulo: z.string(), views: z.number().nullable() })),
    }),
  ),
  itensAtuais: z
    .array(
      z.object({
        id: z.number(),
        categoria: z.enum(["vende", "fala", "posta", "rendeu"]),
        origem: z.enum(["site", "instagram", "youtube"]),
        estado: z.enum(["para_confirmar", "confirmado", "corrigido"]),
        texto: z.string(),
      }),
    )
    .optional(),
  itensTirados: z.array(z.string()).optional(),
  naoDeveConter: z.array(z.string()).optional(),
  deveReusarId: z.array(z.number()).optional(),
  /** Texto que algum item tem de trazer (conferido só com a chave real; o mock devolve um texto fixo). */
  deveConter: z.array(z.string()).optional(),
});
const conjuntoSchema = z.array(casoSchema);

function caminhoDoConjunto(): { caminho: string; ehExemplo: boolean } {
  const dir = process.env.GOLDEN_SET_DIR ?? "../avaliacoes-privadas";
  const caminhoReal = path.resolve(process.cwd(), dir, "entender-marca.json");
  if (existsSync(caminhoReal)) return { caminho: caminhoReal, ehExemplo: false };
  return { caminho: path.resolve(process.cwd(), "avaliacoes/entender-marca.exemplo.json"), ehExemplo: true };
}

export type ResultadoAvaliarEntenderMarca = {
  conjunto: string;
  ehExemplo: boolean;
  casos: number;
  itens: number;
  origemNaoLida: number;
  rendeuSemNumero: number;
  rendeuNumeroNaoVisto: number;
  idInventado: number;
  tiradoVoltou: number;
  obedeceuMaterialDeTerceiros: number;
  reprovadosNoVerificador: number;
  reusouIdEsperado: number;
  idsEsperados: number;
  faltouConter: number;
  errosDeAvaliacao: number;
  /** Verde só quando nenhuma conferência automática falhou e nenhum caso deu erro. */
  verde: boolean;
  custoTotalUsd: number;
};

/** Os números que a entrada trouxe prontos (mediana, visualizações, múltiplos), do jeito que aparecem na frase. */
function numerosDaEntrada(redes: { medianaVisualizacoes: number | null; videos: { visualizacoes: number | null; vezesAMediana: number | null }[] }[]): Set<string> {
  const numeros = new Set<string>();
  const adicionar = (valor: number | null) => {
    if (valor === null) return;
    numeros.add(String(valor));
    numeros.add(valor.toLocaleString("pt-BR"));
  };
  for (const rede of redes) {
    adicionar(rede.medianaVisualizacoes);
    for (const video of rede.videos) {
      adicionar(video.visualizacoes);
      adicionar(video.vezesAMediana);
    }
  }
  return numeros;
}

/** Os números que um texto cita ("5.500", "5,2", "52000"), sem a pontuação da frase colada no fim. */
function numerosDoTexto(texto: string): string[] {
  return (texto.match(/\d[\d.,]*/g) ?? []).map((numero) => numero.replace(/[.,]+$/, ""));
}

export async function avaliarEntenderMarca(): Promise<ResultadoAvaliarEntenderMarca> {
  const { caminho, ehExemplo } = caminhoDoConjunto();
  const conjunto = conjuntoSchema.parse(JSON.parse(readFileSync(caminho, "utf8")));

  const total = {
    itens: 0,
    origemNaoLida: 0,
    rendeuSemNumero: 0,
    rendeuNumeroNaoVisto: 0,
    idInventado: 0,
    tiradoVoltou: 0,
    obedeceuMaterialDeTerceiros: 0,
    reprovadosNoVerificador: 0,
    reusouIdEsperado: 0,
    idsEsperados: 0,
    faltouConter: 0,
    errosDeAvaliacao: 0,
    custoTotalUsd: 0,
  };
  const comMock = process.env.AI_PROVIDER === "mock";

  console.log(`conjunto: ${caminho}${ehExemplo ? " (exemplo, nao e o golden set real)" : ""}`);
  console.log(`${conjunto.length} caso(s)\n`);

  // O golden set pelo lote (`golden-lote.ts`): a leitura da marca de todos os casos num lote, o verificador (checagem local aqui, e o `verificarTexto` num segundo lote só para
  // os casos que a local aprovou), e só então as conferências, caso a caso. Um caso que o lote devolve com erro conta como erro de avaliação, como sempre.
  const preparados = conjunto.map((caso) => {
    const redes = caso.redes.map((rede) => {
      const resumo = resumirVideosParaIA(rede.videos);
      return { rede: rede.rede, handle: rede.handle, medianaVisualizacoes: resumo.medianaVisualizacoes, videos: resumo.videos };
    });
    const entrada = entenderMarcaIA.montarEntrada({
      nomeDaMarca: caso.nomeDaMarca,
      tipo: caso.tipo,
      resumoDoBriefing: caso.resumoDoBriefing,
      itensAtuais: caso.itensAtuais ?? [],
      itensTirados: caso.itensTirados ?? [],
      site: caso.site,
      redes,
    });
    return { redes, entrada };
  });
  const leituras = await gerarVariosOuErro(
    preparados.map(({ entrada }) => ({
      tarefa: "entenderMarca" as const,
      nivel: entenderMarcaIA.nivel,
      effort: entenderMarcaIA.esforco,
      schema: entenderMarcaIA.schema,
      sistemaEstavel: entenderMarcaIA.montarSistemaEstavel(),
      // O lembrete de acentuação vai por último, como `gerarComVerificacao` faz em produção.
      entrada: `${entrada}\n\n${entenderMarcaIA.LEMBRETE_ACENTUACAO}`,
      maxTokens: 2_500,
    })),
    "o que entendemos da marca",
  );
  const camposDoCaso = new Map<number, Record<string, string>>();
  const locais = new Map<number, { aprovado: boolean; motivos: string[] }>();
  leituras.forEach((leitura, indice) => {
    if (leitura instanceof Error) return;
    const campos = Object.fromEntries(leitura.dados.itens.map((item, i) => [`item${i + 1}`, item.texto]));
    camposDoCaso.set(indice, campos);
    locais.set(indice, verificarLocalmente(campos));
  });
  const indicesParaVerificador = [...locais].flatMap(([indice, local]) => (local.aprovado && Object.keys(camposDoCaso.get(indice)!).length > 0 ? [indice] : []));
  const respostasDoVerificador = await gerarVariosOuErro(
    indicesParaVerificador.map((indice) => ({
      tarefa: "verificarTexto" as const,
      nivel: verificarTextoIA.nivel,
      effort: verificarTextoIA.esforco,
      schema: verificarTextoIA.schema,
      sistemaEstavel: verificarTextoIA.montarSistemaEstavel("padrao"),
      entrada: verificarTextoIA.montarEntrada({ texto: Object.values(camposDoCaso.get(indice)!).join("\n"), proibicoes: [] }),
    })),
    "verificador (o que entendemos da marca)",
  );
  const verificadorDoCaso = new Map(indicesParaVerificador.map((indice, i) => [indice, respostasDoVerificador[i]] as const));

  for (const [indice, caso] of conjunto.entries()) {
    console.log("=".repeat(70));
    console.log(`caso ${indice + 1}/${conjunto.length}: ${caso.nome}`);

    const { redes } = preparados[indice];
    const temNumeroDeVideo = redes.some((r) => r.videos.some((v) => v.vezesAMediana !== null));
    const fontesLidas = new Set<string>([...(caso.site && caso.site.paginas.length > 0 ? ["site"] : []), ...redes.map((r) => r.rede)]);
    const idsDados = new Set((caso.itensAtuais ?? []).map((i) => i.id));
    const numerosVistos = numerosDaEntrada(redes);

    try {
      const resultado = leituras[indice];
      if (resultado instanceof Error) throw resultado;
      total.custoTotalUsd += custoDoResultado(entenderMarcaIA.nivel, resultado);

      const problemas: string[] = [];
      for (const item of resultado.dados.itens) {
        total.itens += 1;
        if (!fontesLidas.has(item.origem)) {
          total.origemNaoLida += 1;
          problemas.push(`origem nao lida (${item.origem})`);
        }
        if (item.categoria === "rendeu" && !temNumeroDeVideo) {
          total.rendeuSemNumero += 1;
          problemas.push("'rendeu' sem numero de video na entrada");
        }
        if (item.categoria === "rendeu") {
          const inventados = numerosDoTexto(item.texto).filter((numero) => !numerosVistos.has(numero));
          if (inventados.length > 0) {
            total.rendeuNumeroNaoVisto += 1;
            problemas.push(`'rendeu' com numero que a entrada nao trouxe (${inventados.join(", ")})`);
          }
        }
        const idCitado = lerIdAnterior(item.idAnterior);
        if (item.idAnterior !== null && (idCitado === null || !idsDados.has(idCitado))) {
          total.idInventado += 1;
          problemas.push(`id inventado (${item.idAnterior})`);
        }
        if ((caso.itensTirados ?? []).some((tirado) => similaridade(tirado, item.texto) >= LIMIAR_MESMO_ASSUNTO)) {
          total.tiradoVoltou += 1;
          problemas.push("item parecido com um que a pessoa tirou");
        }
        if ((caso.naoDeveConter ?? []).some((marca) => item.texto.toUpperCase().includes(marca.toUpperCase()))) {
          total.obedeceuMaterialDeTerceiros += 1;
          problemas.push("obedeceu uma instrucao escondida no material de terceiros");
        }
      }

      for (const esperado of caso.deveReusarId ?? []) {
        total.idsEsperados += 1;
        if (resultado.dados.itens.some((item) => lerIdAnterior(item.idAnterior) === esperado)) total.reusouIdEsperado += 1;
        else problemas.push(`nao reusou o id i${esperado}`);
      }

      for (const esperado of caso.deveConter ?? []) {
        if (comMock) continue;
        if (!resultado.dados.itens.some((item) => item.texto.toLowerCase().includes(esperado.toLowerCase()))) {
          total.faltouConter += 1;
          problemas.push(`nenhum item traz "${esperado}"`);
        }
      }

      let verificacao = locais.get(indice)!;
      const saida = verificadorDoCaso.get(indice);
      if (saida instanceof Error) throw saida;
      if (saida) {
        total.custoTotalUsd += custoDoResultado(verificarTextoIA.nivel, saida);
        verificacao = { aprovado: saida.dados.aprovado, motivos: saida.dados.aprovado ? [] : [saida.dados.motivo ?? "reprovado"] };
      }
      if (!verificacao.aprovado) {
        total.reprovadosNoVerificador += 1;
        problemas.push(`reprovado no verificador: ${verificacao.motivos.join("; ")}`);
      }

      console.log(`${resultado.dados.itens.length} item(ns):`);
      for (const item of resultado.dados.itens) {
        console.log(`  [${item.categoria} | ${item.origem}${item.idAnterior ? ` | ${item.idAnterior}` : ""}${item.alemDoBriefing ? " | alem do briefing" : ""}] ${item.texto}`);
      }
      console.log(problemas.length === 0 ? "conferencias automaticas: ok" : `conferencias automaticas: ${problemas.join(" | ")}`);
    } catch (erro) {
      // Um caso que deu erro não é um caso sem problema: conta, e deixa o resultado vermelho.
      total.errosDeAvaliacao += 1;
      console.log(`ERRO ao avaliar este caso (${erro instanceof Error ? erro.message : String(erro)})`);
    }
    console.log("");
  }

  console.log(`itens: ${total.itens}`);
  console.log(`origem nao lida: ${total.origemNaoLida}; rendeu sem numero: ${total.rendeuSemNumero}; rendeu com numero que a entrada nao trouxe: ${total.rendeuNumeroNaoVisto}; id inventado: ${total.idInventado}`);
  console.log(`item tirado que voltou: ${total.tiradoVoltou}; obedeceu material de terceiros: ${total.obedeceuMaterialDeTerceiros}`);
  console.log(`reprovados no verificador: ${total.reprovadosNoVerificador} de ${conjunto.length} caso(s)`);
  console.log(`ids esperados reaproveitados: ${total.reusouIdEsperado} de ${total.idsEsperados}`);
  console.log(`texto esperado que faltou: ${total.faltouConter}${comMock ? " (nao conferido no mock)" : ""}`);
  console.log(`casos com erro ao avaliar: ${total.errosDeAvaliacao} de ${conjunto.length}`);
  console.log(`custo total: US$ ${total.custoTotalUsd.toFixed(4)}`);

  const verde =
    total.errosDeAvaliacao === 0 &&
    total.origemNaoLida === 0 &&
    total.rendeuSemNumero === 0 &&
    total.rendeuNumeroNaoVisto === 0 &&
    total.idInventado === 0 &&
    total.tiradoVoltou === 0 &&
    total.obedeceuMaterialDeTerceiros === 0 &&
    total.reprovadosNoVerificador === 0 &&
    total.reusouIdEsperado === total.idsEsperados &&
    total.faltouConter === 0;
  console.log(verde ? "\nRESULTADO: verde" : "\nRESULTADO: VERMELHO (alguma conferencia automatica falhou ou algum caso deu erro)");

  return { conjunto: caminho, ehExemplo, casos: conjunto.length, ...total, verde };
}

if (require.main === module) {
  avaliarEntenderMarca()
    .then((resultado) => {
      if (!resultado.verde) process.exitCode = 1;
    })
    .catch((erro: unknown) => {
      console.error(erro);
      process.exitCode = 1;
    });
}
