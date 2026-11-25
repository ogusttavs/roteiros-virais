/**
 * E66, a capa de notícia: de uma notícia do setor, a IA propõe de 3 a 5 títulos e a pessoa escolhe um (ou escreve o dela, dentro do limite do tipo `noticia`); a capa é UM carrossel de um slide só (`carrosseis`
 * com quantidade 1, origem "noticia"), sem tabela nem coluna nova. O veículo e a data saem da notícia, nunca do modelo. Mesma marca da sessão, uma geração por marca de cada vez (a mesma trava do carrossel),
 * e cada capa criada conta no teto do teste como um roteiro (é uma linha de `carrosseis`).
 */
import { and, desc, eq } from "drizzle-orm";

import { dataDaCapa, limparTituloDaCapa, motivoDeNaoServirParaCapa, motivoDoTitulo, titulosParaATela, veiculoDaCapa, verificarTitulosDaCapa } from "@/carrossel/capa-noticia";
import { corValida, garantirLeitura } from "@/carrossel/modelos";
import { promessaEmSaude } from "@/carrossel/regras";
import { COR_NEUTRA, QUANTIDADE_DA_CAPA, type SlideDoCarrossel } from "@/config/carrossel";
import { db } from "@/db";
import { carrosseis, clientes, type Carrossel } from "@/db/schema";
import { acharFormulasDeMaquina, motivosDasFormulas } from "@/ia/formulas-de-maquina";
import * as capaIA from "@/ia/prompts/capaNoticia";
import { montarFontesDosFatos } from "@/ia/prompts/roteiro";
import { gerarComVerificacao } from "@/ia/verificador";
import { verificarConformidadeDoLongo } from "@/ia/verificar-copy-roteiro";
import { logger } from "@/lib/log";
import { reservarEnvioPorTrava } from "@/lib/reserva-de-envio";

import { formatarPerfilCompilado, perfilDoCliente } from "./briefing";
import { AVISO_DA_COR_CLARA, ErroCarrossel, marcaEhDeSaude, TRAVA_DA_GERACAO_DO_CARROSSEL } from "./carrossel";
import { clientePorId } from "./clientes";
import { noticiaPorId } from "./noticias";
import { diaPorExtenso, limparParaPrompt, LIMITE_DO_TITULO } from "./noticias-assuntos";
import { leiturasDoCliente } from "./perfis-analisados";
import { formatarCamadaExclusiva } from "./roteiro";

type NoticiaDaCapa = { id: number; titulo: string; resumo: string | null; angulo: string | null; veiculo: string; publicadoEm: Date };

/** A notícia do setor da marca que vai virar capa, ou a recusa com a frase para a pessoa (de outro setor responde como se não existisse; velha, sem data ou sem veículo, recusa). */
async function noticiaParaCapa(clienteId: number, noticiaId: number, agora: Date): Promise<NoticiaDaCapa> {
  const cliente = await clientePorId(clienteId);
  if (!cliente) throw new ErroCarrossel("Não achei a marca.", "nao-achou");
  if (!cliente.nichoId) throw new ErroCarrossel("Falta escolher o ramo da marca antes de criar uma capa.", "sem-briefing");
  const linha = await noticiaPorId(noticiaId, cliente.nichoId);
  if (!linha || linha.relevante !== true) throw new ErroCarrossel("Não achei essa notícia.", "nao-achou");
  const motivo = motivoDeNaoServirParaCapa(linha, agora);
  if (motivo || !linha.publicadoEm) throw new ErroCarrossel(motivo ?? "Essa notícia não tem data.", "pedido-invalido");
  return {
    id: linha.id,
    titulo: limparParaPrompt(linha.titulo, LIMITE_DO_TITULO),
    resumo: limparParaPrompt(linha.resumo, 300) || null,
    angulo: limparParaPrompt(linha.angulo, 300) || null,
    veiculo: veiculoDaCapa(linha.fonte),
    publicadoEm: linha.publicadoEm,
  };
}

/** As fórmulas de texto de máquina nos títulos (cada um conferido como o título de um roteiro), com o número do título no motivo. */
function formulasDosTitulos(titulos: string[], fontes: string): string[] {
  return titulos.flatMap((t, i) => motivosDasFormulas(acharFormulasDeMaquina({ titulo: t }, { fontes })).map((m) => `título ${i + 1}: ${m}`));
}

export type TitulosDaCapa = { titulos: string[]; veiculo: string; data: string; manchete: string };

/** De 3 a 5 títulos para a capa desta notícia. Gasta IA (modelo forte, uma ou duas tentativas); o chamador passa pela trava (`titulosDaCapaComTrava`). */
export async function titulosDaCapa(clienteId: number, noticiaId: number, agora: Date = new Date()): Promise<TitulosDaCapa> {
  const noticia = await noticiaParaCapa(clienteId, noticiaId, agora);
  const cliente = await clientePorId(clienteId);
  if (!cliente) throw new ErroCarrossel("Não achei a marca.", "nao-achou");
  const perfil = await perfilDoCliente(clienteId);
  if (!perfil) throw new ErroCarrossel("Falta terminar o briefing antes de criar uma capa.", "sem-briefing");
  const ramoSaude = await marcaEhDeSaude(clienteId);
  const [leituras, recentes] = await Promise.all([
    leiturasDoCliente(clienteId),
    db()
      .select({ slides: carrosseis.slides })
      .from(carrosseis)
      .where(and(eq(carrosseis.clienteId, clienteId), eq(carrosseis.origem, "noticia")))
      .orderBy(desc(carrosseis.criadoEm))
      .limit(5),
  ]);
  const perfilCompilado = formatarPerfilCompilado(perfil);
  const camadaExclusiva = formatarCamadaExclusiva(
    cliente,
    leituras.filter((l) => l.existeNaRede && l.leitura).map((l) => ({ handle: l.handle, leitura: l.leitura as string })),
  );
  const fontesDosFatos = montarFontesDosFatos({ perfilCompilado, camadaExclusiva, tema: noticia.titulo, noticia: { titulo: noticia.titulo, resumo: noticia.resumo, angulo: noticia.angulo } });
  const { dados } = await gerarComVerificacao({
    tarefa: "capaNoticia",
    nivel: capaIA.nivel,
    effort: capaIA.esforco,
    versaoPrompt: capaIA.versao,
    clienteId,
    schema: capaIA.schema,
    sistemaEstavel: capaIA.montarSistemaEstavel({ perfilCompilado, camadaExclusiva, tipo: cliente.tipo, persona: cliente.persona, quemAparece: cliente.quemGrava ?? undefined, ramoSaude }),
    entrada: capaIA.montarEntrada({
      noticia: { titulo: noticia.titulo, resumo: noticia.resumo, angulo: noticia.angulo, veiculo: noticia.veiculo, dia: diaPorExtenso(noticia.publicadoEm) },
      capasRecentes: recentes.flatMap((r) => r.slides.map((s) => s.titulo)).filter(Boolean),
    }),
    fontesDosFatos,
    conferirNumerosNasFontes: true,
    lembreteFinal: capaIA.LEMBRETE_ACENTUACAO,
    proibicoes: perfil.fatos.proibicoes,
    citarProibicaoVale: true,
    exigeEvidencia: false,
    evidenciasFornecidas: [],
    generoTexto: "roteiro",
    extrairEvidencias: () => [],
    extrairCampos: (d) => Object.fromEntries(d.titulos.map((t, i) => [`titulo ${i + 1}`, t])),
    // R-COPY-26 (texto com cara de máquina): reprova na 1ª tentativa e só avisa na 2ª, como o roteiro; nunca derruba a geração.
    avisarExtra: (d, tentativa) => (tentativa === 2 ? formulasDosTitulos(d.titulos, fontesDosFatos) : []),
    verificarExtra: (d, tentativa) => [
      ...(tentativa === 1 ? formulasDosTitulos(d.titulos, fontesDosFatos) : []),
      ...verificarTitulosDaCapa(d.titulos, noticia, { ramoSaude }),
      // R-CONF (preço, serviço grátis, promessa, fato inventado): os títulos fazem o papel do gancho.
      ...verificarConformidadeDoLongo({ gancho: d.titulos.join(". "), chamadaFinal: "", capitulos: [], edicao: { textoNaTela: [] } }, { fontes: fontesDosFatos, ramoSaude }),
    ],
  });
  return { titulos: titulosParaATela(dados.titulos).slice(0, 5), veiculo: noticia.veiculo, data: dataDaCapa(noticia.publicadoEm), manchete: noticia.titulo };
}

/** Uma geração por vez por marca (a trava do carrossel); o teto do teste é lido de novo dentro da trava. */
export async function titulosDaCapaComTrava<R>(clienteId: number, noticiaId: number, conferirTeto: () => Promise<R | null>): Promise<{ recusa: R } | { titulos: TitulosDaCapa }> {
  const reserva = await reservarEnvioPorTrava(TRAVA_DA_GERACAO_DO_CARROSSEL, clienteId, "carrossel");
  if (reserva === "ocupada") throw new ErroCarrossel("Já tem um carrossel ou uma capa sendo escrito para esta marca. Espere ficar pronto.", "em-andamento");
  if (reserva === "indisponivel") throw new ErroCarrossel("Estamos escrevendo vários textos agora. Tente de novo em instantes.", "indisponivel");
  try {
    const recusa = await conferirTeto();
    if (recusa !== null) return { recusa };
    return { titulos: await titulosDaCapa(clienteId, noticiaId) };
  } finally {
    await reserva.soltar();
  }
}

export type PedidoDeCapa = { noticiaId: number; titulo: string; cor?: string };

/**
 * Cria a capa: UM slide do tipo `noticia` com o título que a pessoa escolheu (ou escreveu), o veículo e a data da notícia. Sem IA. O título passa pelo limite do tipo e, em ramo de saúde, pela regra de promessa.
 * A foto vem depois, pela rota de fotos do carrossel (em saúde, a foto comum entra sem autorização; a de paciente exige).
 */
export async function criarCapa(clienteId: number, pedido: PedidoDeCapa, agora: Date = new Date()): Promise<Carrossel> {
  if (pedido.cor !== undefined && !corValida(pedido.cor)) throw new ErroCarrossel("A cor precisa ser no formato #rrggbb.");
  const noticia = await noticiaParaCapa(clienteId, pedido.noticiaId, agora);
  const titulo = limparTituloDaCapa(pedido.titulo ?? "");
  const motivo = motivoDoTitulo(titulo);
  if (motivo) throw new ErroCarrossel(motivo);
  if (await marcaEhDeSaude(clienteId)) {
    const promessa = promessaEmSaude(titulo);
    if (promessa) throw new ErroCarrossel(`Em saúde o conselho da profissão não deixa prometer resultado: tire "${promessa}" do título.`);
  }
  const cliente = await clientePorId(clienteId);
  const leitura = garantirLeitura(pedido.cor ?? cliente?.corMarca ?? COR_NEUTRA);
  const data = dataDaCapa(noticia.publicadoEm);
  const slide: SlideDoCarrossel = { tipo: "noticia", titulo, veiculo: noticia.veiculo, data };
  const [criada] = await db()
    .insert(carrosseis)
    .values({
      clienteId,
      origem: "noticia",
      origemRef: { noticiaId: noticia.id, capa: true },
      tema: noticia.titulo,
      quantidade: QUANTIDADE_DA_CAPA,
      cor: leitura.cor,
      avisos: leitura.escureceu ? [AVISO_DA_COR_CLARA] : [],
      slides: [slide],
      legenda: `${titulo}. Fonte: ${noticia.veiculo}, ${data}.`,
      hashtags: [],
    })
    .returning();
  if (pedido.cor !== undefined && pedido.cor !== cliente?.corMarca) await db().update(clientes).set({ corMarca: pedido.cor }).where(eq(clientes.id, clienteId));
  logger.info({ clienteId, carrosselId: criada.id, noticiaId: noticia.id }, "capa de noticia criada");
  return criada;
}

/** Criar a capa também passa pela trava da marca: dois cliques ou dois pedidos juntos não furam o teto do teste por um. */
export async function criarCapaComTrava<R>(clienteId: number, pedido: PedidoDeCapa, conferirTeto: () => Promise<R | null>): Promise<{ recusa: R } | { capa: Carrossel }> {
  const reserva = await reservarEnvioPorTrava(TRAVA_DA_GERACAO_DO_CARROSSEL, clienteId, "carrossel");
  if (reserva === "ocupada") throw new ErroCarrossel("Já tem um carrossel ou uma capa sendo escrito para esta marca. Espere ficar pronto.", "em-andamento");
  if (reserva === "indisponivel") throw new ErroCarrossel("Estamos escrevendo vários textos agora. Tente de novo em instantes.", "indisponivel");
  try {
    const recusa = await conferirTeto();
    if (recusa !== null) return { recusa };
    return { capa: await criarCapa(clienteId, pedido) };
  } finally {
    await reserva.soltar();
  }
}
