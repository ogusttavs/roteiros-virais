/**
 * E50 parte 2, PR 1: o que o prompt do roteiro faz com as 53 regras da seção 11
 * (`regras-copy-roteiro.ts`, gerado da tabela). Só as de força "forte" e "média" entram no
 * prompt; as de "indício" ficam fora (sugestão nunca é regra dura, mesmo critério da seção 10).
 * As R-CONF vêm primeiro, antes da fila de precedência (11.0 das rubricas).
 */
import { REGRAS_COPY_ROTEIRO, type RegraCopyRoteiro } from "./regras-copy-roteiro";

/** As regras que o prompt recebe: força forte ou média, na ordem do documento (R-COPY, R-ROTEIRO, R-CONF). */
export function regrasQueEntramNoPrompt(): RegraCopyRoteiro[] {
  return REGRAS_COPY_ROTEIRO.filter((r) => r.forca === "forte" || r.forca === "media");
}

/** Os números que existem na tabela inteira: o PR 3 descarta por código qualquer número fora daqui. */
export const NUMEROS_REGRAS_COPY_ROTEIRO = new Set(REGRAS_COPY_ROTEIRO.map((r) => r.numero));

const CODIGO = "`R-[A-Z]+-[A-Z0-9-]+`";
/** Um parêntese que só tem códigos entre crases (e "-07", "e", "ou", vírgulas), por exemplo " (`R-IG-REEL-03`, `R-YT-SHORT-05` e `-07`)". */
const PARENTESE_DE_CODIGOS = new RegExp(`[ ][(](?:${CODIGO}|\`-[0-9]+\`|[,; ]|e|ou)+[)]`, "g");
const CODIGO_SOLTO = new RegExp(CODIGO, "g");

/**
 * O texto da regra como o prompt o recebe. A tabela cita outras regras entre crases ("a seção 9 manda,
 * `R-IG-REEL-03`"); o prompt só mostra as 28 que entram e as listas de plataforma de uma rede, então um
 * código que o modelo não vê tira a citação (o modelo copiaria o número para o `porQueAssim` e o
 * verificador o descartaria). Código que o prompt mostra (R-CONF-02, R-COPY-25) fica. O que sobra de
 * código escondido fora de parêntese tem frase própria; o teste garante que nenhum escapa.
 */
export function textoDaRegraParaOPrompt(texto: string, visiveis: Set<string>): string {
  const semParenteses = texto.replace(PARENTESE_DE_CODIGOS, (trecho) => {
    const codigos = trecho.match(CODIGO_SOLTO) ?? [];
    return codigos.every((c) => !visiveis.has(c.slice(1, -1))) ? "" : trecho;
  });
  return semParenteses
    .replace(new RegExp(`é pedido por ${CODIGO} e ${CODIGO}`, "g"), "é pedido pelas regras da plataforma")
    .replace(new RegExp(`está em ${CODIGO}, ${CODIGO} e ${CODIGO}`, "g"), "está nas regras de fala")
    .replace(/da seção 9/g, "das regras da plataforma");
}

/** Os códigos entre crases que sobraram no texto e que o prompt não mostra (o teste espera nenhum). */
export function codigosEscondidosNoTexto(texto: string, visiveis: Set<string>): string[] {
  return (texto.match(CODIGO_SOLTO) ?? []).map((c) => c.slice(1, -1)).filter((c) => !visiveis.has(c));
}

function linha(r: RegraCopyRoteiro, visiveis: Set<string>): string {
  const onde = r.bloco.trim().toLowerCase() === "todos" ? "todos os blocos" : r.bloco.trim();
  return `${r.numero} (${onde}): ${textoDaRegraParaOPrompt(r.texto, visiveis)}`;
}

/** Os números das regras que o prompt mostra. */
export function numerosVisiveisNoPrompt(): Set<string> {
  return new Set(regrasQueEntramNoPrompt().map((r) => r.numero));
}

/**
 * O bloco do sistema estável (com cache). Texto fixo da precedência e da nota de não advogado
 * (11.0 e 11.3 das rubricas), mais as linhas geradas da tabela. Nada aqui muda de um roteiro
 * para outro, para o cache do prompt continuar valendo.
 */
export function textoRegrasCopyRoteiro(): string {
  const entram = regrasQueEntramNoPrompt();
  const visiveis = numerosVisiveisNoPrompt();
  const conformidade = entram.filter((r) => r.grupo === "CONF");
  const copy = entram.filter((r) => r.grupo === "COPY");
  const roteiro = entram.filter((r) => r.grupo === "ROTEIRO");
  return [
    "Regras de texto e de estrutura do roteiro (valem para a fala e, em roteiro sem fala, para o texto na tela).",
    "Se duas regras se chocarem, vale esta ordem: primeiro o que a evidência do banco mostra para este nicho, depois as regras da plataforma",
    "acima, depois as regras de fala, depois estas. As de conformidade abaixo não entram nessa fila: vêm antes de todas, porque um roteiro",
    "que quebra a lei ou o código de autorregulação da publicidade não vai para o ar, por mais que renda.",
    "",
    "Conformidade (leitura de quem não é advogado: não afirme ao cliente que algo é obrigatório por lei, apenas siga):",
    ...conformidade.map((r) => linha(r, visiveis)),
    "Pendência para ramos de saúde, como dentista: a resolução do conselho da profissão sobre publicidade ainda não foi lida. Até lá,",
    'em roteiro de saúde nunca use "antes e depois" de tratamento e deixe a conferência com o conselho como item de atenção para a pessoa.',
    "",
    "Texto e persuasão (cada regra vale para os blocos entre parênteses):",
    ...copy.map((r) => linha(r, visiveis)),
    "",
    "Estrutura (cada regra vale para os blocos entre parênteses):",
    ...roteiro.map((r) => linha(r, visiveis)),
    "",
    "Estas regras são para você seguir ao escrever. Não as cite no porQueAssim: ele continua citando só as regras de plataforma listadas acima.",
  ].join(String.fromCharCode(10));
}
