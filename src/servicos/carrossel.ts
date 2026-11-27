/**
 * O carrossel (E65 PR 1): gera o texto (de um tema do dia, um tema livre, um roteiro ou uma notícia), guarda os slides e as fotos do cliente, deixa trocar o texto de um slide e entrega os PNG.
 * Usa o MESMO contexto do roteiro (perfil compilado, modelo do ramo, evidência do banco, regras do cliente, desempenho da conta, camada exclusiva, notícias) pelas funções que o roteiro já
 * exporta, e o mesmo `gerarComVerificacao`, com as regras do carrossel (`carrossel/regras.ts`) e a conformidade (R-CONF) em `verificarExtra`. Toda função recebe o `clienteId` da sessão e filtra por ele:
 * um carrossel ou uma foto de outra marca responde como se não existisse.
 */
import { and, asc, desc, eq, sql } from "drizzle-orm";

import { larguraDaImagem } from "@/carrossel/fotos";
import { avisosDoMetodo, verificarCapaVaga, verificarPromessaDaCapa } from "@/carrossel/metodo";
import { corValida, garantirLeitura } from "@/carrossel/modelos";
import { formulasDeMaquinaDosSlides, motivoDoCampo, normalizarHashtags, promessaEmSaude, slidesComFotoDasFotos, slidesComExcessoPequeno, slidesDaSaida, textoDoSlide, verificarLegenda, verificarLimitesDosSlides, verificarOrdemDosSlides } from "@/carrossel/regras";
import {
  CAMPOS_DO_TIPO,
  COR_NEUTRA,
  LISTAS_DO_TIPO,
  SEM_FOTO,
  type ChaveDeCampo,
  ESTADOS_DO_CARROSSEL,
  MAXIMO_DE_FOTOS,
  TAMANHOS_DO_CARROSSEL,
  FRASE_FOTO_DE_PACIENTE_SO_NO_ANTES_E_DEPOIS,
  FRASE_SEM_AUTORIZACAO_DO_PACIENTE,
  FRASE_SO_FOTO_DE_PACIENTE,
  TETO_DA_FOTO_BYTES,
  TIPOS_COM_FOTO_DE_PACIENTE,
  TIPOS_DE_FOTO,
  type OrigemDoCarrossel,
  type SlideDoCarrossel,
  type TamanhoDoCarrossel,
} from "@/config/carrossel";
import { formatoPorChave } from "@/config/formatos";
import { ramoPorSlug } from "@/config/ramos";
import { db } from "@/db";
import { carrosselFotos, carrosseis, clientes, type Carrossel, type CarrosselFoto } from "@/db/schema";
import { montarFontesDaMarca } from "@/ia/fontes-da-marca";
import * as carrosselIA from "@/ia/prompts/carrossel";
import { montarFontesDosFatos } from "@/ia/prompts/roteiro";
import { gerarComVerificacao } from "@/ia/verificador";
import { verificarConformidadeDoLongo } from "@/ia/verificar-copy-roteiro";
import { hojeISO } from "@/lib/config";
import { logger } from "@/lib/log";
import { reservarEnvioPorTrava } from "@/lib/reserva-de-envio";
import { textosCarrossel } from "@/textos/carrossel";

import { regrasAtivasDoCliente } from "./aprendizado";
import { comANoticiaPresa, noticiaDoSetorComoPontoDePartida, noticiasDeHojeDosAssuntos } from "./assuntos";
import { formatarPerfilCompilado, perfilDaMarca, perfilDoCliente } from "./briefing";
import { clientePorId } from "./clientes";
import { desempenhoDaConta } from "./desempenho-da-conta";
import { filtroDeFormatosDaMarca } from "./formatos";
import { noticiaPorId } from "./noticias";
import { leiturasDoCliente } from "./perfis-analisados";
import { evidenciaParaRoteiro, evidenciaPorIds, formatarModeloNicho, modeloNichoAtual, reguaDoSetor } from "./pesquisa";
import { ramoAtualDoCliente } from "./ramos";
import { ramosAlternativosDaMarca } from "./ramos-da-conta";
import { combinarEvidencias, ErroRoteiro, filtrarEvidenciaPelaMarca, formatarCamadaExclusiva, LIMITE_EVIDENCIA, resolverTemaDoPedido, roteiroPorId } from "./roteiro";

/** Saúde vale quando o ramo principal OU qualquer ramo alternativo da marca é de saúde. `ramoPrincipal` é o slug já lido; sem ele, lê da marca. */
export async function marcaEhDeSaude(clienteId: number, ramoPrincipal?: string | null): Promise<boolean> {
  let principal = ramoPrincipal;
  if (principal === undefined) {
    const cliente = await clientePorId(clienteId);
    principal = (await ramoAtualDoCliente(cliente?.nichoId))?.ramoSlug;
  }
  const slugsDosAlternativos = (await ramosAlternativosDaMarca(clienteId)).map((a) => a.ramoSlug);
  return [principal, ...slugsDosAlternativos].some((slug) => ramoPorSlug(slug)?.grupo === "saude");
}

/** Em ramo de saúde, foto de antes e depois ou de resultado é foto de paciente: sem a confirmação da autorização escrita, recusa. */
async function exigirAutorizacaoDoPaciente(clienteId: number, autorizado: boolean | undefined): Promise<void> {
  if (autorizado === true) return;
  if (await marcaEhDeSaude(clienteId)) throw new ErroCarrossel(FRASE_SEM_AUTORIZACAO_DO_PACIENTE, "sem-autorizacao");
}

export const AVISO_DA_COR_CLARA = "A cor da sua marca era clara demais para ler bem nos slides, então a gente escureceu um pouco.";

/** O erro que a tela e a rota podem mostrar: a mensagem já é para a pessoa. */
export class ErroCarrossel extends Error {
  constructor(
    message: string,
    readonly codigo: "pedido-invalido" | "nao-achou" | "sem-briefing" | "limite-de-fotos" | "foto-invalida" | "em-andamento" | "indisponivel" | "sem-autorizacao" = "pedido-invalido",
  ) {
    super(message);
  }
}

export type DeOndeVem =
  | { origem: "tema"; titulo?: string; texto?: string }
  | { origem: "roteiro"; roteiroId: number }
  | { origem: "noticia"; noticiaId: number };

/**
 * `fotos`: quantas fotos o cliente vai mandar para este carrossel (0 a 9); sem foto, o texto não usa capa-foto nem prova-resultado. Em marca de saúde, `fotos` são as comuns (o lugar, a equipe, o trabalho) e
 * `fotosDePaciente` as de paciente, mandadas com a autorização: só estas últimas podem ir em antes e depois e em resultado (E65 PR 5).
 */
export type PedidoDeCarrossel = { quantidade: number; cor?: string; observacao?: string; fotos?: number; fotosDePaciente?: number; de: DeOndeVem };

function tamanhoValido(n: number): TamanhoDoCarrossel {
  if (!(TAMANHOS_DO_CARROSSEL as readonly number[]).includes(n)) throw new ErroCarrossel("Escolha um carrossel de 5, 7 ou 9 slides.");
  return n as TamanhoDoCarrossel;
}

type OrigemResolvida = {
  origem: OrigemDoCarrossel;
  origemRef: Record<string, unknown>;
  tema: string;
  temaDaPessoa: boolean;
  evidenciasPrevistas: number[];
  noticia?: { titulo: string; resumo: string | null; angulo: string | null; veiculo?: string; dia?: string };
  roteiroDeOrigem?: { titulo: string; texto: string };
};

async function resolverOrigem(clienteId: number, nichoId: number, de: DeOndeVem): Promise<OrigemResolvida> {
  if (de.origem === "roteiro") {
    const roteiro = await roteiroPorId(de.roteiroId, clienteId);
    if (!roteiro) throw new ErroCarrossel("Não achei esse roteiro.", "nao-achou");
    const c = roteiro.conteudo;
    const texto = [c.gancho, c.corpo, c.fechamento, c.chamadaFinal, ...(c.cartoes ?? []).map((k) => `${k.oQueFalar} ${k.textoNaTela}`)].filter((t) => t && t.trim()).join(" ");
    return { origem: "roteiro", origemRef: { roteiroId: roteiro.id }, tema: roteiro.tema, temaDaPessoa: roteiro.origem !== "sugerido", evidenciasPrevistas: c.evidencias ?? [], roteiroDeOrigem: { titulo: c.titulo, texto } };
  }
  if (de.origem === "noticia") {
    const linha = await noticiaPorId(de.noticiaId, nichoId);
    if (!linha) throw new ErroCarrossel("Não achei essa notícia.", "nao-achou");
    const ponto = noticiaDoSetorComoPontoDePartida(linha);
    return { origem: "noticia", origemRef: { noticiaId: linha.id }, tema: linha.titulo, temaDaPessoa: true, evidenciasPrevistas: [], noticia: ponto };
  }
  if (de.texto && de.texto.trim()) {
    return { origem: "tema", origemRef: { livre: true }, tema: de.texto.trim().slice(0, 300), temaDaPessoa: true, evidenciasPrevistas: [] };
  }
  if (!de.titulo || !de.titulo.trim()) throw new ErroCarrossel("Escolha um tema do dia ou escreva o seu.");
  try {
    const resolvido = await resolverTemaDoPedido(clienteId, { origem: "sugerido", temaIndice: 0, temaTitulo: de.titulo, objetivo: "conversao" });
    return { origem: "tema", origemRef: { temaTitulo: de.titulo }, tema: resolvido.tema, temaDaPessoa: false, evidenciasPrevistas: resolvido.evidenciasPrevistas };
  } catch (erro) {
    if (erro instanceof ErroRoteiro) throw new ErroCarrossel(erro.message, "nao-achou");
    throw erro;
  }
}

/** A conformidade (R-CONF) sobre o texto dos slides: a capa faz o papel do gancho, os do meio do corpo, a chamada da chamada final. Só elas, nas duas tentativas. */
function conformidadeDoCarrossel(slides: SlideDoCarrossel[], contexto: { fontes: string; ramoSaude: boolean }): string[] {
  const capa = slides[0];
  const chamada = slides[slides.length - 1];
  const meio = slides.slice(1, -1);
  return verificarConformidadeDoLongo(
    {
      gancho: capa ? textoDoSlide(capa).join(". ") : "",
      chamadaFinal: chamada ? textoDoSlide(chamada).join(". ") : "",
      capitulos: meio.map((s) => ({ nome: s.titulo || s.valor || s.citacao || "", pontos: textoDoSlide(s), ganchoParaOProximo: null, naImagem: "" })),
      edicao: { textoNaTela: [] },
    },
    contexto,
  );
}

/**
 * B2 (revisão de 26/11/2026): a legenda do post de um ramo de saúde também não promete resultado, cura, garantia nem prazo e passa pela conformidade de saúde do roteiro (preço, grátis, cura e garantia no corpo);
 * `verificarLegenda` só olha tamanho e hashtags. Fora de saúde, nada muda.
 */
export function conformidadeDaLegenda(legenda: string, contexto: { fontes: string; ramoSaude: boolean }): string[] {
  if (!contexto.ramoSaude || !legenda.trim()) return [];
  const promessa = promessaEmSaude(legenda);
  const motivos = promessa ? [`legenda: em saúde o texto não pode prometer resultado, cura, garantia nem prazo; tire "${promessa}"`] : [];
  const conformidade = verificarConformidadeDoLongo(
    { gancho: "", chamadaFinal: "", capitulos: [{ nome: "", pontos: [legenda], ganchoParaOProximo: null, naImagem: "" }], edicao: { textoNaTela: [] } },
    contexto,
  );
  return [...motivos, ...conformidade];
}

/** O que o reparo aceita consertar além do fato sem apoio: a promessa em saúde (slide ou legenda) e a R-CONF-07. */
export function motivoReparavelDoCarrossel(motivo: string): boolean {
  return /em saúde o (?:slide|texto) não pode prometer/.test(motivo) || motivo.startsWith("R-CONF-07");
}

/**
 * T80: o reparo dirigido troca só os campos que reprovaram por fato sem apoio (ou por promessa em saúde). Os campos têm o nome "slide N campo K" (a ordem de `textoDoSlide`, como em `extrairCampos`);
 * cada troca volta ao campo cru da saída da IA que tem exatamente aquele texto (os textos que o código monta, como o contexto da fala e o número com unidade, nunca casam e ficam como estão).
 */
export function aplicarTrocasNosCampos(d: carrosselIA.SaidaCarrossel, trocas: Record<string, string>, ramoSaude: boolean): carrosselIA.SaidaCarrossel {
  const slides = d.slides.map((s) => ({ ...s, linhas: [...s.linhas], acoes: [...s.acoes] }));
  const campos = ["rotulo", "titulo", "texto", "antes", "depois", "quem", "contexto", "fonte", "valor"] as const;
  slidesDaSaida(d.slides, { ramoSaude }).forEach((feito, i) => {
    textoDoSlide(feito)
      .filter((t) => t !== feito.referencia)
      .forEach((original, k) => {
        const novo = trocas[`slide ${i + 1} campo ${k + 1}`];
        if (novo === undefined) return;
        const cru = slides[i];
        const chave = campos.find((c) => cru[c].trim() === original);
        if (chave) cru[chave] = novo;
        else {
          cru.linhas = cru.linhas.map((l) => (l.trim() === original ? novo : l));
          cru.acoes = cru.acoes.map((l) => (l.trim() === original ? novo : l));
        }
      });
  });
  return { ...d, slides, legenda: trocas.legenda ?? d.legenda };
}

/** A primeira parte do par da trava de aviso do Postgres (cada família de trava tem a sua; ver `lib/reserva-de-envio.ts`). */
export const TRAVA_DA_GERACAO_DO_CARROSSEL = 6500;

/**
 * Uma geração de carrossel por vez por marca: pega a trava do banco (`pg_try_advisory_lock`, sem migração), lê o teto (`conferirTeto`, que devolve a recusa ou nulo) JÁ dentro da trava e só então gera.
 * Duplo clique ou dois pedidos ao mesmo tempo: o segundo recebe "já tem um carrossel sendo escrito" e não gasta a IA. A trava solta ao fim, e sozinha se o processo cair.
 */
export async function gerarCarrosselComTrava<R>(clienteId: number, pedido: PedidoDeCarrossel, conferirTeto: () => Promise<R | null>): Promise<{ recusa: R } | { carrossel: Carrossel }> {
  const reserva = await reservarEnvioPorTrava(TRAVA_DA_GERACAO_DO_CARROSSEL, clienteId, "carrossel");
  if (reserva === "ocupada") throw new ErroCarrossel("Já tem um carrossel sendo escrito para esta marca. Espere ele ficar pronto.", "em-andamento");
  if (reserva === "indisponivel") throw new ErroCarrossel("Estamos escrevendo vários carrosséis agora. Tente de novo em instantes.", "indisponivel");
  try {
    const recusa = await conferirTeto();
    if (recusa !== null) return { recusa };
    return { carrossel: await gerarCarrossel(clienteId, pedido) };
  } finally {
    await reserva.soltar();
  }
}

export async function gerarCarrossel(clienteId: number, pedido: PedidoDeCarrossel): Promise<Carrossel> {
  const quantidade = tamanhoValido(pedido.quantidade);
  if (pedido.cor !== undefined && !corValida(pedido.cor)) throw new ErroCarrossel("A cor precisa ser no formato #rrggbb.");
  const cliente = await clientePorId(clienteId);
  if (!cliente) throw new ErroCarrossel("Não achei a marca.", "nao-achou");
  if (!cliente.nichoId) throw new ErroCarrossel("Falta escolher o ramo da marca antes de criar um carrossel.", "sem-briefing");
  const nichoId = cliente.nichoId;
  const perfil = await perfilDoCliente(clienteId);
  if (!perfil) throw new ErroCarrossel("Falta terminar o briefing antes de criar um carrossel.", "sem-briefing");

  const fotosPrometidas = Math.min(MAXIMO_DE_FOTOS, Math.max(0, Math.floor(pedido.fotos ?? 0)));
  // Foto de paciente só existe em marca de saúde; fora dela, o que vier é ignorado e as fotos valem para qualquer tipo, como sempre.
  const fotosDePacientePrometidas = (await marcaEhDeSaude(clienteId)) ? Math.min(MAXIMO_DE_FOTOS, Math.max(0, Math.floor(pedido.fotosDePaciente ?? 0))) : 0;
  // A cor da marca: a que a pessoa escolheu agora (e fica guardada na marca, trocável depois), a que a marca já tem, ou o neutro escuro do produto. Clara demais, escurece e avisa.
  const corEscolhida = pedido.cor ?? cliente.corMarca ?? COR_NEUTRA;
  const leitura = garantirLeitura(corEscolhida);
  const avisosDoCarrossel = leitura.escureceu ? [AVISO_DA_COR_CLARA] : [];

  const origem = await resolverOrigem(clienteId, nichoId, pedido.de);
  const alternativos = (await ramosAlternativosDaMarca(clienteId)).map((a) => a.nichoId);
  const formatosDaMarca = await filtroDeFormatosDaMarca(clienteId);

  const [daBusca, prevista, modeloNichoLinha, regrasCliente, desempenhoMedido, leituras, regua, ramoDaMarca, recentes] = await Promise.all([
    evidenciaParaRoteiro(nichoId, origem.tema, LIMITE_EVIDENCIA, alternativos, formatosDaMarca),
    evidenciaPorIds(origem.evidenciasPrevistas),
    modeloNichoAtual(nichoId),
    regrasAtivasDoCliente(clienteId),
    desempenhoDaConta(clienteId, new Date()),
    leiturasDoCliente(clienteId),
    reguaDoSetor(nichoId),
    ramoAtualDoCliente(nichoId),
    db().select({ tema: carrosseis.tema }).from(carrosseis).where(eq(carrosseis.clienteId, clienteId)).orderBy(desc(carrosseis.criadoEm)).limit(5),
  ]);
  const perfilCompilado = formatarPerfilCompilado(perfil);
  const combinadas = combinarEvidencias(prevista, daBusca, LIMITE_EVIDENCIA, regua.proporcaoBrasil, cliente.redePrincipal, "falado");
  const evidencias = await filtrarEvidenciaPelaMarca(combinadas, formatarPerfilCompilado(perfil, { semContextoConfirmado: true }), clienteId);
  // Saúde vale quando o ramo principal OU qualquer ramo alternativo da marca é de saúde (o conselho da profissão limita igual).
  const ramoSaude = await marcaEhDeSaude(clienteId, ramoDaMarca?.ramoSlug);
  const camadaExclusiva = formatarCamadaExclusiva(
    cliente,
    leituras.filter((l) => l.existeNaRede && l.leitura).map((l) => ({ handle: l.handle, leitura: l.leitura as string })),
  );

  const casadas = (await noticiasDeHojeDosAssuntos(clienteId, `${origem.tema} ${pedido.observacao ?? ""}`)).map((n) => ({ titulo: n.titulo, veiculo: n.veiculo, dia: n.dia, resumo: n.resumo }));
  const noticiasDoAssunto = comANoticiaPresa(
    origem.noticia?.veiculo ? { titulo: origem.noticia.titulo, veiculo: origem.noticia.veiculo, dia: origem.noticia.dia ?? "", resumo: origem.noticia.resumo } : null,
    casadas,
  );

  // O que o PRÓPRIO cliente disse: as frases, os medos e as crenças do perfil e a camada exclusiva dele. Fala de concorrente, de outro criador, a notícia e o tema nunca entram aqui.
  const falasDoCliente = [
    ...perfil.fatos.frasesDaFala,
    ...perfil.fatos.medos,
    ...(perfil.fatos.posicionamentos ?? []),
    perfil.fatos.historia ?? "",
    formatarCamadaExclusiva(cliente, []),
  ].join(String.fromCharCode(10));

  const fontesDosFatos = [
    montarFontesDosFatos({
      perfilCompilado,
      camadaExclusiva,
      tema: origem.tema,
      observacao: pedido.observacao,
      noticia: origem.noticia,
      noticiasDoAssunto,
      evidencias: evidencias.map((v) => ({ assunto: v.assunto, gancho: v.gancho, estrutura: v.estrutura, fechamento: v.fechamento, chamadaFinal: v.chamadaFinal })),
    }),
    origem.roteiroDeOrigem ? `Roteiro de origem: ${origem.roteiroDeOrigem.titulo}. ${origem.roteiroDeOrigem.texto}` : null,
  ]
    .filter(Boolean)
    .join(String.fromCharCode(10, 10));

  const { dados: saida, geracaoId, avisos: avisosDaIA } = await gerarComVerificacao({
    tarefa: "carrossel",
    nivel: carrosselIA.nivel,
    effort: carrosselIA.esforco,
    versaoPrompt: carrosselIA.versao,
    clienteId,
    schema: carrosselIA.schema,
    sistemaEstavel: carrosselIA.montarSistemaEstavel({
      perfilCompilado,
      modeloNicho: formatarModeloNicho(modeloNichoLinha?.modelo ?? null),
      camadaExclusiva,
      regrasCliente,
      desempenhoDaConta: desempenhoMedido,
      tipo: cliente.tipo,
      persona: cliente.persona,
      quemAparece: cliente.quemGrava ?? undefined,
      ramoSaude,
    }),
    entrada: carrosselIA.montarEntrada({
      tema: origem.tema,
      quantidade,
      anoDeHoje: Number(hojeISO().slice(0, 4)),
      observacao: pedido.observacao,
      evidencias: evidencias.map((v) => ({
        id: v.id,
        assunto: v.assunto,
        gancho: v.gancho,
        estrutura: v.estrutura,
        fechamento: v.fechamento,
        chamadaFinal: v.chamadaFinal,
        foraDaCurva: v.foraDaCurva,
        formato: formatoPorChave(v.formatoCatalogo)?.nome,
      })),
      noticia: origem.noticia,
      noticiasDoAssunto,
      roteiroDeOrigem: origem.roteiroDeOrigem,
      quantidadeDeFotos: fotosPrometidas,
      ...(ramoSaude ? { quantidadeDeFotosDePaciente: fotosDePacientePrometidas } : {}),
      carrosseisRecentes: recentes.map((r) => r.tema),
    }),
    fontesDosFatos,
    // 1.12.0: só o que a pessoa escreveu ou confirmou. Com origem em notícia o tema é o título dela (de terceiros) e fica de fora; o roteiro de origem é texto da IA e também.
    fontesDaMarca: montarFontesDaMarca({ perfilCompilado: perfilDaMarca(perfil), camadaExclusiva: formatarCamadaExclusiva(cliente, []), tema: origem.noticia ? undefined : origem.tema, observacao: pedido.observacao }),
    conferirNumerosNasFontes: true,
    // T80: o que sobra reprovado depois das duas tentativas por fato sem apoio ou promessa em saúde é consertado por um reparo barato, só nos campos apontados.
    repararFato: { aplicarCampos: (d, trocas) => aplicarTrocasNosCampos(d, trocas, ramoSaude), motivoReparavel: motivoReparavelDoCarrossel },
    lembreteFinal: carrosselIA.LEMBRETE_ACENTUACAO,
    proibicoes: perfil.fatos.proibicoes,
    citarProibicaoVale: origem.temaDaPessoa,
    exigeEvidencia: false,
    evidenciasFornecidas: evidencias.map((v) => v.id),
    generoTexto: "roteiro",
    extrairEvidencias: (d) => d.evidencias,
    extrairCampos: (d) => {
      const campos: Record<string, string> = {};
      slidesDaSaida(d.slides, { ramoSaude }).forEach((s, i) => {
        const textos = textoDoSlide(s).filter((t) => t !== s.referencia);
        textos.forEach((t, k) => {
          campos[`slide ${i + 1} campo ${k + 1}`] = t;
        });
      });
      campos.legenda = d.legenda;
      return campos;
    },
    verificarExtra: (d, tentativa) => {
      const slidesDeTexto = slidesDaSaida(d.slides, { ramoSaude });
      // Na 2ª tentativa, passar do tamanho por pouco (até 3 palavras, 20% de caracteres) não derruba o carrossel: sai pronto e o slide fica marcado para encurtar (a conferência do render mede o texto de verdade).
      return [
        ...verificarOrdemDosSlides(slidesDeTexto, quantidade),
        ...verificarLimitesDosSlides(slidesDeTexto, { ramoSaude, fotosPrometidas, fotosDePacientePrometidas, falasDoCliente, tolerarExcessoPequeno: tentativa === 2 }),
        ...verificarLegenda(d.legenda, d.hashtags),
        ...conformidadeDaLegenda(d.legenda, { fontes: fontesDosFatos, ramoSaude }),
        // A promessa da capa, a capa vaga e as fórmulas de máquina (R-COPY-26) reprovam na 1ª tentativa e só avisam na 2ª (como o roteiro): senão brigam com a regra de "nunca três do mesmo tipo seguidos"; o aviso sai em `avisarExtra`.
        ...(tentativa === 1 ? [...verificarPromessaDaCapa(slidesDeTexto), ...verificarCapaVaga(slidesDeTexto), ...formulasDeMaquinaDosSlides(slidesDeTexto, fontesDosFatos)] : []),
        ...conformidadeDoCarrossel(slidesDeTexto, { fontes: fontesDosFatos, ramoSaude }),
      ];
    },
    avisarExtra: (d, tentativa) => {
      if (tentativa !== 2) return [];
      const slidesDeTexto = slidesDaSaida(d.slides, { ramoSaude });
      return [...verificarPromessaDaCapa(slidesDeTexto), ...verificarCapaVaga(slidesDeTexto), ...formulasDeMaquinaDosSlides(slidesDeTexto, fontesDosFatos)];
    },
  });

  // O responsável técnico só entra na chamada de marca de saúde e só se a pessoa preencheu; vazio, o slide não desenha a linha (o app nunca inventa o dado).
  const slides: SlideDoCarrossel[] = slidesDaSaida(saida.slides, { ramoSaude, responsavelTecnico: cliente.responsavelTecnico });
  const slidesParaEncurtar = slidesComExcessoPequeno(slides, { ramoSaude, fotosPrometidas, fotosDePacientePrometidas });
  const [criado] = await db()
    .insert(carrosseis)
    .values({
      clienteId,
      origem: origem.origem,
      origemRef: origem.origemRef,
      tema: origem.tema,
      quantidade,
      cor: leitura.cor,
      avisos: [...avisosDoCarrossel, ...avisosDoMetodo(slides, saida.legenda)],
      slides,
      legenda: saida.legenda.trim(),
      hashtags: normalizarHashtags(saida.hashtags),
      geracaoId,
    })
    .returning();
  if (pedido.cor !== undefined && pedido.cor !== cliente.corMarca) await db().update(clientes).set({ corMarca: pedido.cor }).where(eq(clientes.id, clienteId));
  // Os avisos da IA (o motivo escrito para o modelo, com o código da regra) ficam só no log: `avisos` do carrossel é o que a pessoa lê.
  logger.info({ clienteId, carrosselId: criado.id, quantidade, avisosDaIA, slidesParaEncurtar }, "carrossel gerado");
  return criado;
}

/**
 * Os carrosséis da marca, do mais novo para o mais antigo. A capa de notícia mora na mesma tabela e se reconhece pelo primeiro slide (`tipo: "noticia"`): `so` separa as duas listas
 * ("carrossel" sem as capas, "capa" só com elas); sem `so`, vem tudo.
 */
export async function carrosseisDaMarca(clienteId: number, limite = 30, so?: "carrossel" | "capa"): Promise<Carrossel[]> {
  const doTipo = so === "capa" ? sql`${carrosseis.slides}->0->>'tipo' = 'noticia'` : so === "carrossel" ? sql`${carrosseis.slides}->0->>'tipo' is distinct from 'noticia'` : undefined;
  return db().select().from(carrosseis).where(and(eq(carrosseis.clienteId, clienteId), doTipo)).orderBy(desc(carrosseis.criadoEm)).limit(limite);
}

/** Um carrossel da marca, ou nulo (de outra marca responde igual a um que não existe). */
export async function carrosselDaMarca(clienteId: number, carrosselId: number): Promise<Carrossel | null> {
  const [linha] = await db()
    .select()
    .from(carrosseis)
    .where(and(eq(carrosseis.id, carrosselId), eq(carrosseis.clienteId, clienteId)));
  return linha ?? null;
}

/** O que a pessoa pode mudar num slide: os campos de texto do tipo (os limites são conferidos), as listas, o ponto de foco e as fotos. O tipo nunca muda. */
export type MudancaDoSlide = {
  campos?: Partial<Record<ChaveDeCampo, string>>;
  listas?: { linhas?: string[]; acoes?: string[] };
  foco?: string | null;
  fotoId?: number | null;
  fotoDepoisId?: number | null;
  autorizacaoDoPaciente?: boolean;
};

const FOCO_VALIDO = /^\d{1,3}% \d{1,3}%$/;

/** Os motivos (para a pessoa) de a mudança não caber no slide, campo a campo; vazio quando cabe. A tela usa os mesmos limites para segurar o botão. */
export function motivosDaMudanca(slide: SlideDoCarrossel, mudanca: Pick<MudancaDoSlide, "campos" | "listas">, comFoto: boolean, nomes: Record<string, string>): string[] {
  const motivos: string[] = [];
  for (const [chave, valor] of Object.entries(mudanca.campos ?? {}) as [ChaveDeCampo, string][]) {
    if (!(chave in CAMPOS_DO_TIPO[slide.tipo])) {
      motivos.push(`${nomes[chave] ?? chave}: este slide não tem esse campo.`);
      continue;
    }
    const motivo = motivoDoCampo(slide.tipo, chave, valor, comFoto);
    if (motivo) motivos.push(motivo === "vazio" ? `${nomes[chave] ?? chave}: não pode ficar vazio.` : `${nomes[chave] ?? chave}: ${motivo}.`);
  }
  const lista = LISTAS_DO_TIPO[slide.tipo];
  for (const [chave, itens] of Object.entries(mudanca.listas ?? {})) {
    if (itens === undefined) continue;
    if (!lista || lista.chave !== chave) {
      motivos.push(`${chave}: este slide não tem essa lista.`);
      continue;
    }
    const cheios = (itens ?? []).filter((l) => l.trim());
    if (cheios.length < lista.minimo || cheios.length > lista.maximo) motivos.push(`${chave}: precisa de ${lista.minimo === lista.maximo ? lista.minimo : `${lista.minimo} a ${lista.maximo}`} itens.`);
    cheios.forEach((l, k) => {
      if (l.trim().split(/\s+/).length > lista.palavras || l.trim().length > lista.caracteres) motivos.push(`${chave} ${k + 1}: passa de ${lista.palavras} palavras ou ${lista.caracteres} caracteres.`);
    });
  }
  return motivos;
}

/**
 * Troca o texto ou a foto de um slide. Cada campo passa pelo limite do tipo (o do slide com foto, quando ele leva foto): passou, a troca é recusada com o motivo e nada é gravado. O tipo, o número do passo e as
 * linhas fixas de código nunca mudam.
 */
export async function trocarSlide(clienteId: number, carrosselId: number, indice: number, mudanca: MudancaDoSlide, nomesDosCampos: Record<string, string> = {}): Promise<Carrossel> {
  const atual = await carrosselDaMarca(clienteId, carrosselId);
  if (!atual) throw new ErroCarrossel("Não achei esse carrossel.", "nao-achou");
  if (!Number.isInteger(indice) || indice < 0 || indice >= atual.slides.length) throw new ErroCarrossel("Esse slide não existe.", "nao-achou");
  const fotos = await fotosDoCarrossel(clienteId, carrosselId);
  const porId = new Map(fotos.map((f) => [f.id, f] as const));
  const saude = await marcaEhDeSaude(clienteId);
  const tipoDoSlide = atual.slides[indice].tipo;
  for (const id of [mudanca.fotoId, mudanca.fotoDepoisId]) {
    if (id === undefined || id === null || id === SEM_FOTO) continue;
    const foto = porId.get(id);
    if (!foto) throw new ErroCarrossel("Essa foto não é deste carrossel.", "foto-invalida");
    // Em saúde, os dois tipos de foto nunca se misturam: antes e depois e resultado só com foto de paciente (que já foi mandada com a autorização), e os outros slides só com foto comum.
    if (saude && foto.dePaciente !== TIPOS_COM_FOTO_DE_PACIENTE.has(tipoDoSlide)) throw new ErroCarrossel(TIPOS_COM_FOTO_DE_PACIENTE.has(tipoDoSlide) ? FRASE_SO_FOTO_DE_PACIENTE : FRASE_FOTO_DE_PACIENTE_SO_NO_ANTES_E_DEPOIS, "foto-invalida");
  }
  if (mudanca.foco !== undefined && mudanca.foco !== null && !FOCO_VALIDO.test(mudanca.foco)) throw new ErroCarrossel("O ponto da foto não é válido.");
  const slideAntes = atual.slides[indice];
  const depoisDaFoto = atual.slides.map((s, i) => (i === indice ? { ...s, fotoId: mudanca.fotoId === undefined ? s.fotoId : mudanca.fotoId, fotoDepoisId: mudanca.fotoDepoisId === undefined ? s.fotoDepoisId : mudanca.fotoDepoisId } : s));
  const comFoto = slidesComFotoDasFotos(depoisDaFoto, fotos, saude)[indice];
  const motivos = motivosDaMudanca(slideAntes, mudanca, comFoto, nomesDosCampos);
  // Em ramo de saúde o texto trocado pela pessoa também não pode prometer resultado, cura, garantia nem prazo (R-CONF-07, o mesmo que reprova a geração).
  const textosNovos = [...Object.values(mudanca.campos ?? {}), ...(mudanca.listas?.linhas ?? []), ...(mudanca.listas?.acoes ?? [])];
  if (motivos.length === 0 && textosNovos.length > 0 && (await marcaEhDeSaude(clienteId))) {
    for (const texto of textosNovos) {
      const promessa = promessaEmSaude(texto);
      if (promessa) motivos.push(textosCarrossel.promessaEmSaude(promessa));
    }
  }
  if (motivos.length > 0) throw new ErroCarrossel(motivos.join(" "), "pedido-invalido");
  const slides = atual.slides.map((s, i) => {
    if (i !== indice) return s;
    const novo: SlideDoCarrossel = { ...s };
    for (const [chave, valor] of Object.entries(mudanca.campos ?? {}) as [ChaveDeCampo, string][]) {
      const limpo = valor.trim();
      if (chave === "fonte") novo.fonte = limpo || null;
      else (novo as Record<string, unknown>)[chave] = limpo === "" ? undefined : limpo;
    }
    if (mudanca.listas?.linhas) novo.linhas = mudanca.listas.linhas.map((l) => l.trim()).filter(Boolean);
    if (mudanca.listas?.acoes) novo.acoes = mudanca.listas.acoes.map((l) => l.trim()).filter(Boolean);
    if (mudanca.foco !== undefined) novo.foco = mudanca.foco ?? undefined;
    if (mudanca.fotoId !== undefined) novo.fotoId = mudanca.fotoId;
    if (mudanca.fotoDepoisId !== undefined) novo.fotoDepoisId = mudanca.fotoDepoisId;
    return novo;
  });
  const [linha] = await db()
    .update(carrosseis)
    .set({ slides, estado: ESTADOS_DO_CARROSSEL[1], atualizadoEm: new Date() })
    .where(and(eq(carrosseis.id, carrosselId), eq(carrosseis.clienteId, clienteId)))
    .returning();
  return linha;
}

/** Troca a cor do carrossel (e a da marca, para os próximos): clara demais escurece sozinha e o carrossel guarda o aviso. */
export async function trocarCor(clienteId: number, carrosselId: number, cor: string): Promise<Carrossel> {
  if (!corValida(cor)) throw new ErroCarrossel("A cor precisa ser no formato #rrggbb.");
  const atual = await carrosselDaMarca(clienteId, carrosselId);
  if (!atual) throw new ErroCarrossel("Não achei esse carrossel.", "nao-achou");
  const leitura = garantirLeitura(cor);
  const [linha] = await db()
    .update(carrosseis)
    .set({ cor: leitura.cor, avisos: [...atual.avisos.filter((a) => a !== AVISO_DA_COR_CLARA), ...(leitura.escureceu ? [AVISO_DA_COR_CLARA] : [])], atualizadoEm: new Date() })
    .where(and(eq(carrosseis.id, carrosselId), eq(carrosseis.clienteId, clienteId)))
    .returning();
  await db().update(clientes).set({ corMarca: cor }).where(eq(clientes.id, clienteId));
  return linha;
}

/** O @ da marca para o rodapé dos slides ("@clinica.exemplo"), ou vazio. Aceita o @ solto, com arroba ou o endereço do perfil. */
export function arrobaDaMarca(instagram: string | null | undefined): string {
  const bruto = (instagram ?? "").trim().replace(/^https?:\/\/(www\.)?instagram\.com\//i, "").replace(/[/?#].*$/, "").replace(/^@+/, "");
  return /^[A-Za-z0-9._]{1,30}$/.test(bruto) ? `@${bruto}` : "";
}

/** Só o necessário das fotos, sem os bytes. */
export type FotoSemBytes = Omit<CarrosselFoto, "bytes">;

export async function fotosDoCarrossel(clienteId: number, carrosselId: number): Promise<FotoSemBytes[]> {
  return db()
    .select({ id: carrosselFotos.id, carrosselId: carrosselFotos.carrosselId, clienteId: carrosselFotos.clienteId, ordem: carrosselFotos.ordem, tipo: carrosselFotos.tipo, tamanho: carrosselFotos.tamanho, dePaciente: carrosselFotos.dePaciente, criadoEm: carrosselFotos.criadoEm })
    .from(carrosselFotos)
    .where(and(eq(carrosselFotos.carrosselId, carrosselId), eq(carrosselFotos.clienteId, clienteId)))
    .orderBy(asc(carrosselFotos.ordem));
}

/** As fotos com os bytes, para o render. */
export async function fotosComBytes(clienteId: number, carrosselId: number): Promise<{ id: number; tipo: string; bytes: Buffer; dePaciente: boolean }[]> {
  return db()
    .select({ id: carrosselFotos.id, tipo: carrosselFotos.tipo, bytes: carrosselFotos.bytes, dePaciente: carrosselFotos.dePaciente })
    .from(carrosselFotos)
    .where(and(eq(carrosselFotos.carrosselId, carrosselId), eq(carrosselFotos.clienteId, clienteId)))
    .orderBy(asc(carrosselFotos.ordem));
}

/** Uma foto da marca (para mostrar na tela), ou nula. */
export async function fotoDaMarca(clienteId: number, fotoId: number): Promise<{ tipo: string; bytes: Buffer } | null> {
  const [linha] = await db()
    .select({ tipo: carrosselFotos.tipo, bytes: carrosselFotos.bytes })
    .from(carrosselFotos)
    .where(and(eq(carrosselFotos.id, fotoId), eq(carrosselFotos.clienteId, clienteId)));
  return linha ?? null;
}

/** Os primeiros bytes confirmam o tipo declarado: um arquivo que diz ser imagem e não é nunca entra. */
export function tipoPelosBytes(bytes: Buffer): (typeof TIPOS_DE_FOTO)[number] | null {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.length > 12 && bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

export async function enviarFoto(clienteId: number, carrosselId: number, arquivo: { tipoDeclarado: string; bytes: Buffer; autorizacaoDoPaciente?: boolean; dePaciente?: boolean }): Promise<FotoSemBytes & { largura: number | null }> {
  const carrossel = await carrosselDaMarca(clienteId, carrosselId);
  if (!carrossel) throw new ErroCarrossel("Não achei esse carrossel.", "nao-achou");
  // Em marca de saúde há dois tipos de foto (E65 PR 5): a comum (o lugar, a equipe, o trabalho) entra sem autorização e nunca vai em antes e depois nem em resultado; a de paciente (`dePaciente`) só é aceita com a
  // confirmação da autorização escrita do paciente, é gravada com a marca e só serve a esses dois tipos. Fora da saúde, `dePaciente` é ignorado.
  const dePaciente = arquivo.dePaciente === true && (await marcaEhDeSaude(clienteId));
  if (dePaciente) await exigirAutorizacaoDoPaciente(clienteId, arquivo.autorizacaoDoPaciente);
  if (arquivo.bytes.length === 0) throw new ErroCarrossel("A foto veio vazia.", "foto-invalida");
  if (arquivo.bytes.length > TETO_DA_FOTO_BYTES) throw new ErroCarrossel(`A foto passa de ${Math.round(TETO_DA_FOTO_BYTES / 1024 / 1024)} MB. Mande uma menor.`, "foto-invalida");
  const tipo = tipoPelosBytes(arquivo.bytes);
  if (!tipo || tipo !== arquivo.tipoDeclarado) throw new ErroCarrossel("Mande uma foto em jpg, png ou webp.", "foto-invalida");
  // O carrossel é trancado enquanto se conta e se grava, para dois envios ao mesmo tempo não passarem de 9.
  const linha = await db().transaction(async (tx) => {
    await tx.execute(sql`select id from carrosseis where id = ${carrosselId} and cliente_id = ${clienteId} for update`);
    const [{ total, ultima }] = await tx
      .select({ total: sql<number>`count(*)::int`, ultima: sql<number>`coalesce(max(${carrosselFotos.ordem}), 0)::int` })
      .from(carrosselFotos)
      .where(and(eq(carrosselFotos.carrosselId, carrosselId), eq(carrosselFotos.clienteId, clienteId)));
    if (total >= MAXIMO_DE_FOTOS) return null;
    const [nova] = await tx
      .insert(carrosselFotos)
      .values({ carrosselId, clienteId, ordem: ultima + 1, tipo, bytes: arquivo.bytes, tamanho: arquivo.bytes.length, dePaciente })
      .returning({ id: carrosselFotos.id, carrosselId: carrosselFotos.carrosselId, clienteId: carrosselFotos.clienteId, ordem: carrosselFotos.ordem, tipo: carrosselFotos.tipo, tamanho: carrosselFotos.tamanho, dePaciente: carrosselFotos.dePaciente, criadoEm: carrosselFotos.criadoEm });
    return nova;
  });
  if (!linha) throw new ErroCarrossel(`Cada carrossel leva até ${MAXIMO_DE_FOTOS} fotos.`, "limite-de-fotos");
  return { ...linha, largura: larguraDaImagem(arquivo.bytes) };
}

export async function apagarFoto(clienteId: number, carrosselId: number, fotoId: number): Promise<boolean> {
  const apagadas = await db()
    .delete(carrosselFotos)
    .where(and(eq(carrosselFotos.id, fotoId), eq(carrosselFotos.carrosselId, carrosselId), eq(carrosselFotos.clienteId, clienteId)))
    .returning({ id: carrosselFotos.id });
  if (apagadas.length === 0) return false;
  // Slides que apontavam para ela voltam a receber as fotos na ordem.
  const atual = await carrosselDaMarca(clienteId, carrosselId);
  if (atual) {
    const slides = atual.slides.map((s) => ({ ...s, fotoId: s.fotoId === fotoId ? null : s.fotoId, fotoDepoisId: s.fotoDepoisId === fotoId ? null : s.fotoDepoisId }));
    await db().update(carrosseis).set({ slides }).where(and(eq(carrosseis.id, carrosselId), eq(carrosseis.clienteId, clienteId)));
  }
  return true;
}
