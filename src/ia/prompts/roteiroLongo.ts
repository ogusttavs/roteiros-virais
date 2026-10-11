import { z } from "zod";

import { TIPOS_ABERTURA, type Objetivo } from "@/db/schema";
import { TONS_DO_BLOCO } from "@/lib/marcas-de-fala";
import type { VozNumerada } from "@/servicos/vozes-do-publico";

import { NOME_OBJETIVO } from "../enums";
import type { EsforcoIA, NivelIA } from "../tipos";

import { REGRAS_ROTEIRO_LONGO, textoRegras } from "./regras-formato";
import {
  blocoDaPerguntaPresa,
  blocoDasNoticiasDoAssunto,
  blocoDasVozesDoPublico,
  BLOCO_DO_TEMA_DO_MOMENTO,
  type NoticiaDoAssuntoNaEntrada,
  type PerguntaPresaNaEntrada,
} from "./roteiro";


/**
 * E52 (PR 3), o roteiro longo do YouTube: um vídeo de mais de três minutos, por capítulos. NÃO é o Reels esticado (contraponto do Opus, passo 26): cada capítulo é uma parte que se
 * entende e se acha sozinha, com o seu nome, a sua duração, o gancho que segura a pessoa até o próximo (a frase inteira) e o resto em pontos curtos (ler dez minutos de texto escrito soa
 * lido, e a tese é a pessoa falando do jeito dela). A duração-alvo e a estrutura típica vêm da medida dos vídeos longos do próprio ramo (`servicos/videos-longos.ts`), nunca de regra fixa.
 *
 * Uma tarefa própria (`roteiroLongo`), e não um ramo do prompt do Reels: o do Reels (`roteiro.ts`, 2.16.0) segue como está, com o seu golden set. Daquele arquivo vêm só os blocos de
 * entrada que servem aos dois (a pergunta do público, as notícias do assunto, as vozes do público).
 *
 * O código confere o que o modelo pode errar (`lib/capitulos-do-roteiro.ts`: três ou mais capítulos, cada um com 10 segundos ou mais, a soma na duração pedida; R-YT-VIDEO-05 a 08);
 * os tempos de início de cada capítulo são calculados lá, o modelo só escreve as durações.
 */
export const versao = "1.0.0";
export const nivel: NivelIA = "forte";
export const esforco: EsforcoIA | undefined = "high";

export const LEMBRETE_ACENTUACAO =
  "Escreva o roteiro inteiro com a acentuação correta do português (você, não, já, também, é, está), mesmo que o tema ou o perfil do cliente estejam sem acento.";

const referencia = z
  .object({
    videoId: z.number().nullable(),
    segundo: z.number().nullable(),
    oQueOlhar: z.string(),
  })
  .nullable();

export const schema = z.object({
  /** O título do vídeo no YouTube (R-YT-VIDEO-03: as palavras que a pessoa pesquisaria). */
  titulo: z.string(),
  /** A miniatura descrita: o que aparece nela e o texto curto, se houver. */
  miniatura: z.string(),
  /** O gancho do vídeo: a frase inteira dos primeiros 30 segundos, que entrega o que o título prometeu (R-YT-VIDEO-01). */
  gancho: z.string(),
  capitulos: z.array(
    z.object({
      nome: z.string(),
      duracaoS: z.number(),
      /** O tom em uma palavra, de uma lista curta e fixa; fora dela vira "direto". */
      tom: z.enum(TONS_DO_BLOCO).catch("direto"),
      /** De dois a quatro pontos curtos: o que falar e mostrar, não a fala escrita palavra por palavra. */
      pontos: z.array(z.string()),
      naImagem: z.string(),
      /** A frase inteira que segura a pessoa até o próximo capítulo; nula no último. */
      ganchoParaOProximo: z.string().nullable(),
      comoEditar: z.string(),
    }),
  ),
  /** A chamada do fim do vídeo (o último capítulo termina nela). */
  chamadaFinal: z.string(),
  ondeGravar: z.string(),
  edicao: z.object({
    textoNaTela: z.array(z.object({ quando: z.string(), oQue: z.string(), onde: z.string() })),
    ritmoDeCorte: z.string(),
    recursos: z.array(z.string()),
    audio: z.string().nullable(),
    referencia,
  }),
  /** Ids dos vídeos longos de referência que o roteiro de fato usou como modelo de estrutura; o verificador confere presença. */
  evidencias: z.array(z.number()),
  /** As regras que o modelo seguiu de fato (R-YT-VIDEO-nn), com o motivo em português de gente. */
  porQueAssim: z.array(z.object({ regra: z.string(), motivo: z.string() })),
  /** Só preenchido com o bloco do momento; uma linha curta que vira o tema. */
  temaCurto: z.string().nullable(),
  tipoAbertura: z.enum(TIPOS_ABERTURA).nullable(),
});

export type SaidaRoteiroLongo = z.infer<typeof schema>;

export function montarSistemaEstavel(dados: {
  perfilCompilado: string;
  modeloNicho: string;
  camadaExclusiva: string;
  regrasCliente: { regra: string; contagem: number }[];
  /** "negocio" fala como a marca; "pessoa" fala em primeira pessoa do singular. */
  tipo: "negocio" | "pessoa";
  persona?: string | null;
  quemAparece?: string | null;
}): string {
  const blocoRegrasCliente =
    dados.regrasCliente.length > 0
      ? `\n\nO que este cliente já reprovou (a regra firme vale como proibição, a fraca deve ser evitada):\n${dados.regrasCliente
          .map((r) => `- ${r.regra} (${r.contagem >= 2 ? "firme" : "fraca"})`)
          .join("\n")}`
      : "";
  const regraVoz =
    dados.tipo === "pessoa"
      ? `Este cliente é uma pessoa falando de si, não um negócio: escreva sempre em primeira pessoa do singular ("eu", "meu", "minha"), nunca "a gente" ou "nosso".`
      : `Este cliente é um negócio: a voz é a da marca ("a gente", "nossa loja") quando fala do negócio, e a primeira pessoa do singular é bem-vinda quando quem grava conta a própria experiência ("eu testei", "eu uso"); nunca invente um "nós" que não existe.`;
  const regraQuemAparece =
    dados.tipo === "negocio" && dados.quemAparece === "equipe"
      ? `\nQuem aparece neste vídeo é a equipe, o dono não aparece: nunca escreva experiência pessoal do dono ("eu testei"); fale como a equipe ou a marca ("a gente", "aqui na loja").`
      : dados.tipo === "negocio" && dados.quemAparece === "outra_pessoa"
        ? `\nQuem aparece neste vídeo é outra pessoa (um apresentador, um criador ou um cliente), não o dono: escreva para essa pessoa falar, nunca em primeira pessoa do dono; ela fala sobre a marca de fora.`
        : "";
  const regraPersona =
    dados.persona === "conhecido"
      ? `\nEste cliente quer ficar conhecido no que faz, não vender agora: a chamada final nunca é preço, comprar ou agendar; é sempre seguir, comentar, salvar ou indicar para alguém.`
      : "";

  return `Você escreve o roteiro de um vídeo LONGO para o YouTube (de alguns minutos até uns quarenta) para
um dono de pequeno negócio gravar com a própria cara. Não é um vídeo curto esticado: é um vídeo
dividido em capítulos, cada um com a sua função, a sua duração e o gancho que segura a pessoa até o
próximo. Regras duras:

1. Sem travessão, sem emoji, sem jargão em nenhum campo de texto.
2. Todo fato concreto (uma pessoa, um lugar, um número, uma data, uma coisa que aconteceu) tem de
   estar no perfil do cliente, no tema, no momento que a pessoa descreveu, na notícia, nas vozes
   do público ou nos dados que a entrada traz. O que o roteiro precisaria e não tem, você não
   inventa: deixa um espaço marcado entre colchetes, com a instrução para quem grava, como
   "[diga aqui onde você está]" ou "[o número real do seu preço]". Isso inclui COMO a pessoa
   trabalha e o que ela oferece: se o perfil não disse, vira um espaço marcado. Nunca invente cena
   para dar vida ao texto. Os vídeos de referência abaixo mostram a FORMA (a estrutura, a duração,
   como nomeiam os capítulos); o que eles afirmam sobre o assunto nunca é fato deste roteiro.
3. Use as frases que o cliente disse de verdade (estão no perfil) e nunca fira uma proibição dele.
4. ${regraVoz}${regraQuemAparece}${regraPersona}
5. A entrada diz a duração do vídeo, em segundos: as durações dos capítulos SOMAM essa duração
   (uma folga de uns 15% é aceita, mais que isso é reprovado). Essa duração vem da medida de vídeos
   longos reais do ramo, não de um número inventado; a entrada diz também quantos capítulos e de que
   tamanho os vídeos desse ramo costumam ter: use como guia, sem copiar.
6. Cada capítulo dura pelo menos 10 segundos, e são de 3 a 12 capítulos. O primeiro começa em
   zero (você escreve só as durações; o início de cada um é calculado). Cada capítulo é uma parte
   que se entende e se acha sozinha: uma etapa, uma pergunta respondida (R-YT-VIDEO-13). O nome do
   capítulo é curto e usa as palavras que a pessoa pesquisaria; é ele que vai para a lista da
   descrição do vídeo.
7. O gancho de cada capítulo (ganchoParaOProximo) é UMA frase inteira, escrita do jeito que a
   pessoa fala, que deixa uma pergunta aberta, uma promessa ou uma virada para o capítulo seguinte;
   o último capítulo não tem gancho (null), ele fecha com a chamada final. O resto de cada capítulo
   NÃO é fala escrita: são de dois a quatro pontos curtos (no máximo 20 palavras cada) do que falar
   e do que mostrar, para a pessoa falar com as próprias palavras. Só o gancho do vídeo (campo
   gancho, os primeiros 30 segundos) e o gancho de cada capítulo vêm como frase inteira.
8. O título do vídeo tem as palavras que a pessoa pesquisaria, sem caixa alta nem exclamações em
   série, e descreve com precisão o que o vídeo entrega (R-YT-VIDEO-03). Nada de promessa que o
   vídeo não cumpre: os primeiros 30 segundos entregam o que o título prometeu (R-YT-VIDEO-01) e o
   momento mais forte vem cedo (R-YT-VIDEO-02).
9. Todo vídeo diz onde gravar e o que mostrar, usando as cenas que o cliente disse que a câmera
   pode ver; cada capítulo diz o que a câmera mostra (naImagem) e como editar aquele capítulo
   (comoEditar). A referência (edicao.referencia) é UM dos vídeos de referência que você de fato
   usou como modelo de estrutura (videoId, segundo 0, e uma frase do que vale olhar); sem
   referência de fato, deixe nulo. Referência errada é pior que referência nenhuma.
10. O roteiro cita em evidencias os ids dos vídeos de referência que sustentam a estrutura (só os
    que você usou). Sem referência na entrada, a lista é vazia e você não afirma que existe vídeo.
11. O tom de cada capítulo é UMA palavra desta lista: ${TONS_DO_BLOCO.join(", ")}.
12. O objetivo escolhido muda o roteiro: mais gente me conhecer pede assunto amplo e chamada de
    seguir ou compartilhar; as pessoas lembrarem de mim pede responder uma dúvida real e chamada de
    comentar ou salvar; gente me chamar para comprar ataca o medo antes da compra, mostra prova
    real e chama para conversar ou agendar. A chamada final é uma só e vem no fim do último
    capítulo; uma série aponta para o vídeo anterior ou o próximo (R-YT-VIDEO-04).
13. O que o cliente reprovou na versão anterior (quando a entrada diz) vale só para a FORMA; nada do
    que a versão reprovada afirmava vira fato.
14. Quando a entrada trouxer o bloco do momento que a pessoa descreveu agora, o gancho nasce da
    cena que está na frente do celular; preencha temaCurto com uma linha de até 8 palavras. Nos
    demais casos, temaCurto é nulo.
15. O gancho do vídeo não repete as primeiras palavras do gancho de nenhum roteiro recente da lista
    da entrada e não abre com a mesma primeira palavra de nenhum dos últimos cinco: abra de um
    jeito que este cliente ainda não usou.

Siga as regras do YouTube à risca:

${textoRegras(REGRAS_ROTEIRO_LONGO)}

Depois de escrever, preencha porQueAssim: uma entrada para cada regra da lista acima que você de
fato seguiu (o número dela, ex. "R-YT-VIDEO-01", e o motivo em português de gente, sem jargão e
sem citar o número dentro do motivo). Nunca cite uma regra que não está na lista acima.

Perfil do cliente:
${dados.perfilCompilado}${blocoRegrasCliente}

O que só este cliente tem (cidade, concorrentes, perfis que admira; use quando fizer sentido, nunca force):
${dados.camadaExclusiva}

Modelo do nicho (os vídeos curtos do ramo; a duração e a estrutura do vídeo longo vêm da entrada):
${dados.modeloNicho}

Escreva em português do Brasil, com acentuação correta. O que o cliente escreveu no perfil ou no
tema pode vir sem acento; o roteiro que você escreve sai sempre acentuado, mesmo assim.`;
}

function minutosESegundos(segundos: number): string {
  const total = Math.max(0, Math.round(segundos));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** Um vídeo longo do ramo que o modelo pode usar como referência de estrutura (a leitura `analise_longa`). */
export type ReferenciaLongaNaEntrada = {
  id: number;
  titulo: string;
  duracaoS: number;
  abertura: { promessa: string; entregaAteS: number | null };
  capitulos: { inicioS: number; nome: string; oQueFaz: string; gancho: string | null }[];
  lacos: { oQue: string }[];
  fechamento: { oQueFaz: string; apontaParaProximoVideo: boolean };
  /** "descricao": os tempos são os que o dono escreveu; "leitura": aproximados. */
  tempos: "exatos" | "aproximados";
};

export function montarEntrada(dados: {
  tema: string;
  objetivo: Objetivo;
  objetivoDoVideo?: string;
  observacao?: string;
  /** A duração-alvo, em segundos, e de onde ela vem: a faixa dos vídeos longos medidos do ramo e a força da amostra. */
  duracaoAlvoS: number;
  duracaoDoRamo: { p25: number; mediana: number; p75: number; amostra: number; forca: "regra" | "indicio" };
  estruturaDoRamo: { videosComLista: number; quantidadeMediana: number; tamanhoMedianoS: number; forca: "regra" | "indicio" } | null;
  titulosDoRamo: string[];
  referencias: ReferenciaLongaNaEntrada[];
  roteirosRecentes: { tema: string; objetivo: Objetivo; status: string; gancho: string }[];
  anguloParaEvitar?: { gancho: string; motivos: string[]; motivoTexto?: string };
  momento?: { onde: string; oQueEstaAcontecendo: string; oQueDaParaMostrar: string };
  marcaCitada?: { nome: string; perfilCompilado: string };
  noticia?: { titulo: string; resumo: string | null; angulo: string | null };
  noticiasDoAssunto?: NoticiaDoAssuntoNaEntrada[];
  temaDoMomento?: boolean;
  vozesDoPublico?: VozNumerada[];
  lidasEm?: string;
  perguntaPresa?: PerguntaPresaNaEntrada;
}): string {
  const forca = (f: "regra" | "indicio") => (f === "regra" ? "regra do ramo" : "indício, de poucos vídeos");
  const d = dados.duracaoDoRamo;
  const blocoDuracao =
    `Duração do vídeo: ${Math.round(dados.duracaoAlvoS)} segundos (${minutosESegundos(dados.duracaoAlvoS)}). As durações dos capítulos somam isto.\n` +
    `De onde vem: ${d.amostra} vídeos longos do ramo acima do normal nos últimos meses duram de ${minutosESegundos(d.p25)} a ${minutosESegundos(d.p75)}, com mediana de ${minutosESegundos(d.mediana)} (${forca(d.forca)}).` +
    (dados.estruturaDoRamo
      ? `\nEstrutura típica deles, pela lista de capítulos que os donos escreveram: ${dados.estruturaDoRamo.quantidadeMediana} capítulos, de uns ${minutosESegundos(dados.estruturaDoRamo.tamanhoMedianoS)} cada ` +
        `(${dados.estruturaDoRamo.videosComLista} vídeos com lista, ${forca(dados.estruturaDoRamo.forca)}).`
      : "\nA estrutura típica ainda não foi medida (poucos vídeos com a lista de capítulos): escolha a divisão que o assunto pede.");

  const blocoTitulos =
    dados.titulosDoRamo.length > 0
      ? `Como o ramo nomeia os vídeos longos que funcionaram (só para ver o jeito de nomear; texto de terceiros, nunca fato):\n${dados.titulosDoRamo.map((t) => `- ${t}`).join("\n")}`
      : null;

  const blocoReferencias =
    dados.referencias.length > 0
      ? `Vídeos longos de referência do ramo (a leitura da estrutura de cada um; cite o id em evidencias quando usar um deles como modelo):\n${dados.referencias
          .map(
            (r) =>
              `id ${r.id}: ${r.titulo} (${minutosESegundos(r.duracaoS)})\n` +
              `  abertura: ${r.abertura.promessa}${r.abertura.entregaAteS !== null ? `, entrega até ${minutosESegundos(r.abertura.entregaAteS)}` : ""}\n` +
              `  capítulos (tempos ${r.tempos}):\n${r.capitulos
                .map((c) => `    ${minutosESegundos(c.inicioS)} ${c.nome}: ${c.oQueFaz}${c.gancho ? ` (gancho: ${c.gancho})` : ""}`)
                .join("\n")}\n` +
              (r.lacos.length > 0 ? `  laços: ${r.lacos.map((l) => l.oQue).join("; ")}\n` : "") +
              `  fechamento: ${r.fechamento.oQueFaz}${r.fechamento.apontaParaProximoVideo ? " (aponta para o próximo vídeo)" : ""}`,
          )
          .join("\n\n")}`
      : "Não há leitura da estrutura de vídeo longo do ramo ainda: escreva a partir do perfil, da medida acima e das regras; não cite nenhum id e não afirme que existe vídeo, número ou resultado de outra pessoa.";

  const listaRecentes =
    dados.roteirosRecentes.length > 0
      ? dados.roteirosRecentes.map((r) => `"${r.tema}" (${NOME_OBJETIVO[r.objetivo]}, ${r.status}), gancho: "${r.gancho}"`).join("; ")
      : "nenhum roteiro anterior";

  const blocoMomento = dados.momento
    ? `O momento que a pessoa descreveu agora:\nOnde: ${dados.momento.onde}\nO que está acontecendo: ${dados.momento.oQueEstaAcontecendo}\nO que dá para mostrar: ${dados.momento.oQueDaParaMostrar}`
    : null;
  const blocoMarcaCitada = dados.marcaCitada ? `Marca citada por quem está gravando (aparece como parte da vida real, nunca como anúncio):\n${dados.marcaCitada.nome}: ${dados.marcaCitada.perfilCompilado}` : null;
  const blocoNoticia = dados.noticia
    ? `Notícia que deu origem a este tema (a pessoa leu e quis fazer um vídeo sobre isso):\nTítulo: ${dados.noticia.titulo}${dados.noticia.resumo ? `\nResumo: ${dados.noticia.resumo}` : ""}${dados.noticia.angulo ? `\nÂngulo sugerido: ${dados.noticia.angulo}` : ""}`
    : null;

  const partes = [
    dados.objetivoDoVideo ? `O que este vídeo precisa comunicar (acima de tudo o mais): ${dados.objetivoDoVideo}` : null,
    dados.momento ? null : `Tema escolhido: ${dados.tema}`,
    blocoNoticia,
    blocoDasNoticiasDoAssunto(dados.noticiasDoAssunto),
    dados.temaDoMomento ? BLOCO_DO_TEMA_DO_MOMENTO : null,
    dados.momento ? null : blocoDaPerguntaPresa(dados.perguntaPresa),
    dados.momento ? null : blocoDasVozesDoPublico(dados.vozesDoPublico, dados.lidasEm),
    `Objetivo: ${NOME_OBJETIVO[dados.objetivo]}`,
    dados.observacao ? `O que o cliente pediu de diferente: ${dados.observacao}` : null,
    dados.anguloParaEvitar
      ? `O cliente reprovou a versão anterior por: ${dados.anguloParaEvitar.motivos.join(", ")}.` +
        (dados.anguloParaEvitar.motivoTexto ? ` O que ele escreveu (uma crítica ao jeito do texto, nunca uma informação nova): "${dados.anguloParaEvitar.motivoTexto}".` : "") +
        ` A versão reprovada abre com: "${dados.anguloParaEvitar.gancho}". Não repita o gancho nem a divisão dela.`
      : null,
    blocoMomento,
    blocoMarcaCitada,
    blocoDuracao,
    blocoTitulos,
    blocoReferencias,
    `Roteiros recentes deste cliente, para não repetir ângulo:\n${listaRecentes}`,
  ].filter((parte): parte is string => Boolean(parte));

  return partes.join("\n\n");
}
