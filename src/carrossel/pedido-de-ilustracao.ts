/**
 * E69 PR A: o pedido de ilustracao de um slide, escrito por codigo a partir do texto dele, para o script que chama o Codex desta maquina (`scripts/carrossel-ilustrar.ts`). Puro e testado. As proibicoes
 * (texto, letra, numero, marca, pessoa real conhecida, objeto que suma sob o veu) vao em TODO pedido. Antes e depois e resultado nunca recebem pedido (so foto real de paciente).
 */
import { aceitaIlustracao } from "./ilustracao";

/** Os tipos cuja ilustracao e generica (o ambiente do ramo), e nao o assunto do slide: o render os desenha no estilo forte. */
const TIPOS_GENERICOS: ReadonlySet<string> = new Set(["resumo", "chamada"]);

export type EntradaDoPedido = {
  tipo: string;
  /** O texto do slide (os campos juntos, um por linha). */
  texto: string;
  tema: string;
  /** O nome do ramo da marca ("Clinica odontologica"), ou nulo. */
  ramo: string | null;
  /** O nome do arquivo que o Codex deve salvar na pasta de trabalho. */
  arquivo: string;
};

export type PedidoDeIlustracao = { prompt: string; generica: boolean; arquivo: string };

const PROIBIDO =
  "PROIBIDO: pessoa real conhecida, rosto inteiro em destaque, qualquer texto, letra, numero, logotipo ou marca visivel em qualquer objeto (embalagens, tubos, telas e agendas sem escrita), objeto transparente, de vidro ou muito escuro que suma sob um veu de cor por cima.";

const ESTILO =
  "Estilo: foto de celular natural e bem iluminada, luz de janela, cores suaves e claras, aparencia real e documental (NAO banco de imagem, NAO 3D brilhante, NAO ilustracao vetorial). Formato retrato 4:5 (1080x1350). Composicao simples, com UM motivo unico bem identificavel em primeiro plano e uma area calma, sem detalhes, onde depois ficara o texto grande por cima. Dente, boca e sorriso podem aparecer, com anatomia correta e natural.";

/** O pedido do slide, ou nulo quando o tipo nunca recebe ilustracao. */
export function pedidoDaIlustracao(e: EntradaDoPedido): PedidoDeIlustracao | null {
  // A capa de noticia costuma ter pessoa real conhecida: imitacao gerada nunca; ali vai foto real licenciada com credito (E66), nao este script.
  if (!aceitaIlustracao(e.tipo) || e.tipo === "noticia") return null;
  const generica = TIPOS_GENERICOS.has(e.tipo);
  const ramo = e.ramo ? ` do ramo "${e.ramo}"` : "";
  const assunto = generica
    ? `Cena GENERICA do ambiente de um negocio${ramo}, sem relacao direta com o texto do slide (por exemplo a recepcao, a bancada ou o balcao, vazios, ninguem na cena).`
    : `O assunto do slide, para o carrossel sobre "${e.tema}"${ramo}: escolha UM objeto ou cena concreta que represente o texto abaixo e mostre so ele em primeiro plano.\nTexto do slide: ${e.texto.replace(/\s*\n\s*/g, " / ")}`;
  const prompt = [
    `Gere UMA imagem de ilustracao para um slide de carrossel de Instagram e salve-a NESTA pasta com o nome ${e.arquivo}.`,
    assunto,
    ESTILO,
    PROIBIDO,
    "Depois de salvar, liste o arquivo com o tamanho. Responda em portugues, curto.",
  ].join("\n");
  return { prompt, generica, arquivo: e.arquivo };
}
