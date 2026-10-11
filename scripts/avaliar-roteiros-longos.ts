/**
 * Conjunto de referência do roteiro longo do YouTube (E52, PR 3): seis casos pelo MESMO caminho de produção (`golden-producao.ts`: a 1ª tentativa, a conferência local e a do
 * `verificarTexto` com as fontes, e os reprovados refazem com o motivo). A conferência local é a do servidor (`servicos/roteiro-longo.ts`): os capítulos (três ou mais, 10 segundos ou
 * mais cada, a soma na duração; R-YT-VIDEO-05 a 08), o título, o gancho do vídeo e o formato do capítulo, que é o que este golden set prova:
 *
 * - **o gancho de cada capítulo vem inteiro**: uma frase de 4 a 40 palavras em todo capítulo, menos o último (que fecha com a chamada), nunca um rótulo de assunto;
 * - **o resto do capítulo vem em pontos**: de 2 a 4 pontos curtos, de até 20 palavras cada, nunca a fala escrita palavra por palavra.
 *
 * Mais o que decide se o "Copiar os capítulos" serve: a lista sai com a primeira marcação em 00:00, em ordem crescente, e a leitura que mede os vídeos dos outros devolve os mesmos
 * capítulos. O arquivo real fica fora do repositório público (`avaliacoes/README.md`): `GOLDEN_SET_DIR/roteiros-longos.json`; sem ele, roda com
 * `avaliacoes/roteiros-longos.exemplo.json` e avisa que é exemplo. Sob o simulador (`AI_PROVIDER=mock`) não custa nada e prova o que o CÓDIGO confere; o que o modelo escreve de
 * verdade só a rodada com chave mede.
 */
import "./chave-de-testes";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

import { NUMEROS_REGRAS_ROTEIRO_LONGO } from "../src/ia/prompts/regras-formato";
import { montarFontesDosFatos } from "../src/ia/prompts/roteiro";
import * as roteiroLongoIA from "../src/ia/prompts/roteiroLongo";
import * as verificarTextoIA from "../src/ia/prompts/verificarTexto";
import { palavrasDeConteudo, verificarLocalmente } from "../src/ia/verificador";
import { lerCapitulosDaDescricao } from "../src/lib/capitulos-da-descricao";
import {
  capitulosParaCopiar,
  iniciosDosCapitulos,
  PALAVRAS_MAX_NO_GANCHO_DO_CAPITULO,
  PALAVRAS_MAX_POR_PONTO,
  PALAVRAS_MIN_NO_GANCHO_DO_CAPITULO,
  somaDosCapitulos,
} from "../src/lib/capitulos-do-roteiro";
import { camposDoRoteiroLongo, duracaoAlvoDaMedida, motivosDoRoteiroLongo } from "../src/servicos/roteiro-longo";

import { linhaDoResumo, resumirProducao, rodarComoEmProducao } from "./golden-producao";

const objetivoSchema = z.enum(["alcance", "engajamento", "conversao"]);
const forcaSchema = z.enum(["regra", "indicio"]);

const referenciaSchema = z.object({
  id: z.number(),
  titulo: z.string(),
  duracaoS: z.number(),
  abertura: z.object({ promessa: z.string(), entregaAteS: z.number().nullable() }),
  capitulos: z.array(z.object({ inicioS: z.number(), nome: z.string(), oQueFaz: z.string(), gancho: z.string().nullable() })),
  lacos: z.array(z.object({ oQue: z.string() })),
  fechamento: z.object({ oQueFaz: z.string(), apontaParaProximoVideo: z.boolean() }),
  tempos: z.enum(["exatos", "aproximados"]),
});

const momentoSchema = z.object({ onde: z.string(), oQueEstaAcontecendo: z.string(), oQueDaParaMostrar: z.string() });

const casoSchema = z
  .object({
    nome: z.string(),
    /** Origem "tema": presente sozinho, nunca com `momento`. */
    tema: z.string().optional(),
    /** Origem "momento": presente sozinho, nunca com `tema`. */
    momento: momentoSchema.optional(),
    objetivo: objetivoSchema,
    tipo: z.enum(["negocio", "pessoa"]).default("negocio"),
    perfilCompilado: z.string(),
    camadaExclusiva: z.string(),
    modeloNicho: z.string(),
    duracaoDoRamo: z.object({ p25: z.number(), mediana: z.number(), p75: z.number(), amostra: z.number(), forca: forcaSchema }),
    estruturaDoRamo: z.object({ videosComLista: z.number(), quantidadeMediana: z.number(), tamanhoMedianoS: z.number(), forca: forcaSchema }).nullable(),
    titulosDoRamo: z.array(z.string()).default([]),
    referencias: z.array(referenciaSchema).default([]),
    roteirosRecentes: z.array(z.object({ tema: z.string(), objetivo: objetivoSchema, status: z.string(), gancho: z.string() })).default([]),
    regrasCliente: z.array(z.object({ regra: z.string(), contagem: z.number() })).default([]),
    pontoPrincipal: z.string(),
  })
  .refine((caso) => Boolean(caso.tema) !== Boolean(caso.momento), { message: "cada caso tem tema ou momento, nunca os dois nem nenhum" });
const conjuntoSchema = z.array(casoSchema);

function caminhoDoConjunto(): { caminho: string; ehExemplo: boolean } {
  const dir = process.env.GOLDEN_SET_DIR ?? "../avaliacoes-privadas";
  const caminhoReal = path.resolve(process.cwd(), dir, "roteiros-longos.json");
  if (existsSync(caminhoReal)) return { caminho: caminhoReal, ehExemplo: false };
  return { caminho: path.resolve(process.cwd(), "avaliacoes/roteiros-longos.exemplo.json"), ehExemplo: true };
}

const palavras = (texto: string) => texto.trim().split(/\s+/).filter(Boolean).length;

export type ResultadoAvaliarRoteirosLongos = {
  conjunto: string;
  ehExemplo: boolean;
  casos: number;
  titulos: string[];
  /** Reprovados nas DUAS tentativas (em produção, `ErroIA`): o número que decide o deploy. */
  reprovadosNoVerificador: number;
  /** Reprovados na 1ª tentativa (a 2ª refaz com o motivo). */
  reprovadosNa1aTentativa: number;
  casosFalhos: number;
  /** Capítulos que não são o último, e quantos deles trouxeram o gancho inteiro (de 4 a 40 palavras). */
  capitulosComGancho: number;
  ganchosInteiros: number;
  /** Pontos de capítulo, e quantos passam de 20 palavras. */
  pontos: number;
  pontosAcimaDoLimite: number;
  /** Casos em que o "Copiar os capítulos" lido de volta não devolve os mesmos capítulos. */
  copiaQueNaoVolta: number;
  custoTotalUsd: number;
};

export async function avaliarRoteirosLongos(): Promise<ResultadoAvaliarRoteirosLongos> {
  const { caminho, ehExemplo } = caminhoDoConjunto();
  const conjunto = conjuntoSchema.parse(JSON.parse(readFileSync(caminho, "utf8")));
  const titulos: string[] = [];
  let reprovadosNoVerificador = 0;
  let casosFalhos = 0;
  let custoTotalUsd = 0;
  let capitulosComGancho = 0;
  let ganchosInteiros = 0;
  let pontos = 0;
  let pontosAcimaDoLimite = 0;
  let copiaQueNaoVolta = 0;

  console.log(`conjunto: ${caminho}${ehExemplo ? " (exemplo, nao e o golden set real)" : ""}`);
  console.log(`${conjunto.length} caso(s)\n`);

  /** A duração-alvo do caso, pela mesma regra do servidor (a mediana do ramo, de 30 em 30 segundos). */
  const duracaoAlvoDe = (caso: z.infer<typeof casoSchema>): number => {
    const alvo = duracaoAlvoDaMedida({
      amostra: caso.duracaoDoRamo.amostra,
      brasileiros: caso.duracaoDoRamo.amostra,
      forca: caso.duracaoDoRamo.forca,
      duracaoS: { p25: caso.duracaoDoRamo.p25, mediana: caso.duracaoDoRamo.mediana, p75: caso.duracaoDoRamo.p75 },
      capitulos: null,
      titulos: [],
    });
    if (alvo === null) throw new Error(`caso "${caso.nome}": a medida do ramo nao tem duracao`);
    return alvo;
  };

  const fontesDe = (caso: z.infer<typeof casoSchema>) =>
    montarFontesDosFatos({ perfilCompilado: caso.perfilCompilado, camadaExclusiva: caso.camadaExclusiva, tema: caso.tema, momento: caso.momento });

  const producao = await rodarComoEmProducao<roteiroLongoIA.SaidaRoteiroLongo>({
    rotulo: "roteiros longos",
    lembreteFinal: roteiroLongoIA.LEMBRETE_ACENTUACAO,
    casos: conjunto.map((caso) => {
      const duracaoAlvoS = duracaoAlvoDe(caso);
      const idsDasReferencias = caso.referencias.map((r) => r.id);
      return {
        pedido: () => ({
          tarefa: "roteiroLongo",
          nivel: roteiroLongoIA.nivel,
          effort: roteiroLongoIA.esforco,
          schema: roteiroLongoIA.schema,
          sistemaEstavel: roteiroLongoIA.montarSistemaEstavel({
            perfilCompilado: caso.perfilCompilado,
            modeloNicho: caso.modeloNicho,
            camadaExclusiva: caso.camadaExclusiva,
            regrasCliente: caso.regrasCliente,
            tipo: caso.tipo,
          }),
          entrada: roteiroLongoIA.montarEntrada({
            tema: caso.tema ?? "",
            objetivo: caso.objetivo,
            duracaoAlvoS,
            duracaoDoRamo: caso.duracaoDoRamo,
            estruturaDoRamo: caso.estruturaDoRamo,
            titulosDoRamo: caso.titulosDoRamo,
            referencias: caso.referencias,
            roteirosRecentes: caso.roteirosRecentes,
            momento: caso.momento,
          }),
        }),
        local: (saida, tentativa) => {
          const campos = camposDoRoteiroLongo(saida);
          const local = verificarLocalmente(campos, {
            exigeEvidencia: caso.referencias.length > 0,
            evidencias: saida.evidencias,
            evidenciasFornecidas: idsDasReferencias,
            ganchosRecentes: caso.roteirosRecentes.map((r) => r.gancho),
            ganchosUltimos5: caso.roteirosRecentes.map((r) => r.gancho),
            palavrasDoMomento: caso.momento ? palavrasDeConteudo(`${caso.momento.onde} ${caso.momento.oQueEstaAcontecendo}`) : undefined,
            porQueAssim: saida.porQueAssim.filter((item) => NUMEROS_REGRAS_ROTEIRO_LONGO.has(item.regra)),
            numerosRegrasPlataforma: NUMEROS_REGRAS_ROTEIRO_LONGO,
          });
          const extras = motivosDoRoteiroLongo(saida, duracaoAlvoS, tentativa);
          return extras.length > 0 ? { aprovado: false, motivos: [...local.motivos, ...extras] } : local;
        },
        campos: (saida) => camposDoRoteiroLongo(saida),
        pedidoVerificador: (campos) => ({
          tarefa: "verificarTexto",
          nivel: verificarTextoIA.nivel,
          effort: verificarTextoIA.esforco,
          schema: verificarTextoIA.schema,
          sistemaEstavel: verificarTextoIA.montarSistemaEstavel("roteiro", true),
          entrada: verificarTextoIA.montarEntrada({ texto: Object.values(campos).join("\n"), proibicoes: [], fontes: fontesDe(caso) }),
        }),
      };
    }),
  });
  const resumo = resumirProducao(producao);

  for (const [indice, caso] of conjunto.entries()) {
    console.log(`${"=".repeat(70)}`);
    console.log(`caso ${indice + 1}/${conjunto.length}: ${caso.nome}`);
    console.log(`"${caso.tema ?? caso.momento?.onde}" (${caso.tipo}, duracao ${duracaoAlvoDe(caso)}s, ramo ${caso.duracaoDoRamo.forca})`);
    console.log(`ponto principal: ${caso.pontoPrincipal}`);
    console.log(`${"-".repeat(70)}\n`);

    const prod = producao[indice];
    if (prod.falhou && !prod.gerada) {
      casosFalhos += 1;
      console.log(`[FALHOU: ${prod.falhou.message}]\n`);
      continue;
    }
    const saida = prod.gerada!.dados;
    titulos.push(saida.titulo);

    console.log(`titulo: ${saida.titulo}`);
    console.log(`miniatura: ${saida.miniatura}`);
    console.log(`gancho do video: ${saida.gancho}\n`);

    const capitulos = saida.capitulos.map((c) => ({ ...c, duracaoS: Math.round(c.duracaoS) }));
    const inicios = iniciosDosCapitulos(capitulos);
    capitulos.forEach((c, i) => {
      const ultimo = i === capitulos.length - 1;
      console.log(`CAPITULO ${i + 1}: ${c.nome} (${inicios[i]}s, ${c.duracaoS}s, tom ${c.tom})`);
      c.pontos.forEach((p) => {
        pontos += 1;
        if (palavras(p) > PALAVRAS_MAX_POR_PONTO) pontosAcimaDoLimite += 1;
        console.log(`  - ${p}`);
      });
      console.log(`  na imagem: ${c.naImagem}`);
      console.log(`  como editar: ${c.comoEditar}`);
      if (!ultimo) {
        capitulosComGancho += 1;
        const gancho = (c.ganchoParaOProximo ?? "").trim();
        const inteiro = palavras(gancho) >= PALAVRAS_MIN_NO_GANCHO_DO_CAPITULO && palavras(gancho) <= PALAVRAS_MAX_NO_GANCHO_DO_CAPITULO;
        if (inteiro) ganchosInteiros += 1;
        console.log(`  gancho para o proximo${inteiro ? "" : " (NAO VEIO INTEIRO)"}: ${gancho || "(vazio)"}`);
      }
      console.log("");
    });

    const duracaoS = somaDosCapitulos(capitulos);
    const copiar = capitulosParaCopiar(capitulos);
    const lidos = lerCapitulosDaDescricao(copiar, duracaoS);
    const volta = lidos.length === capitulos.length && lidos.every((l, i) => l.inicioS === inicios[i] && l.titulo === capitulos[i].nome.replace(/\s+/g, " ").trim());
    if (!volta) copiaQueNaoVolta += 1;
    console.log(`COPIAR OS CAPITULOS${volta ? "" : " (A LEITURA NAO DEVOLVE OS MESMOS CAPITULOS)"} [soma ${duracaoS}s]\n${copiar}\n`);
    console.log(`chamada final: ${saida.chamadaFinal}`);
    console.log(`onde gravar: ${saida.ondeGravar}\n`);

    if (prod.falhou) {
      casosFalhos += 1;
      console.log(`[VERIFICADOR FALHOU: ${prod.falhou.message}]`);
    }
    if (prod.reprovouNa1a) console.log(`[1ª TENTATIVA REPROVADA: ${prod.motivosDa1a.join("; ")}]${prod.tentativas === 2 ? " (a 2ª tentativa foi escrita com este motivo)" : ""}`);
    if (!prod.verificacao.aprovado) {
      reprovadosNoVerificador += 1;
      console.log(`[REPROVADO NAS DUAS TENTATIVAS (ErroIA em producao): ${prod.verificacao.motivos.join("; ")}]`);
    }

    custoTotalUsd += prod.custoUsd;
    console.log(`\ncusto deste caso: US$ ${prod.custoUsd.toFixed(4)} (${prod.gerada!.modelo})\n`);
  }

  console.log(linhaDoResumo(conjunto.length, resumo));
  console.log(`reprovados no verificador: ${reprovadosNoVerificador} de ${conjunto.length}`);
  console.log(`ganchos inteiros: ${ganchosInteiros} de ${capitulosComGancho} capitulos com gancho`);
  console.log(`pontos acima de 20 palavras: ${pontosAcimaDoLimite} de ${pontos}`);
  console.log(`copiar os capitulos que nao volta: ${copiaQueNaoVolta} de ${conjunto.length - casosFalhos}`);
  if (casosFalhos > 0) console.log(`casos que falharam no lote: ${casosFalhos} de ${conjunto.length}`);
  console.log(`custo total: US$ ${custoTotalUsd.toFixed(4)}`);

  return {
    conjunto: caminho,
    ehExemplo,
    casos: conjunto.length,
    titulos,
    reprovadosNoVerificador,
    reprovadosNa1aTentativa: resumo.reprovadosNa1a,
    casosFalhos,
    capitulosComGancho,
    ganchosInteiros,
    pontos,
    pontosAcimaDoLimite,
    copiaQueNaoVolta,
    custoTotalUsd,
  };
}

if (require.main === module) {
  avaliarRoteirosLongos().catch((erro: unknown) => {
    console.error(erro);
    process.exitCode = 1;
  });
}
