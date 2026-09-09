/**
 * Filtro de Brasil para a Hashtag Search da Meta (E6 parte 3, segunda
 * rodada, item 3): a hashtag e global, nao so do Brasil (achado de
 * 08/09/2026, `acessos/meta-app.md`: o primeiro resultado de "limpeza" no
 * Explorador do Graph era de Portugal). Um video da Hashtag Search so vira
 * evidencia se a legenda parecer portugues E tiver pelo menos um indicio
 * de Brasil (nao so "e portugues", que tambem pega Portugal).
 */

/** Palavras funcionais comuns o bastante em portugues para servir de sinal fraco de idioma. */
const PALAVRAS_PORTUGUES = [
  "de",
  "da",
  "do",
  "das",
  "dos",
  "para",
  "com",
  "que",
  "não",
  "nao",
  "uma",
  "um",
  "hoje",
  "muito",
  "voce",
  "você",
  "esse",
  "essa",
  "aqui",
];

/** As tres letras acentuadas (ã, õ, ç) praticamente so existem em portugues, entre os idiomas mais comuns numa legenda de rede social. */
const ACENTOS_PORTUGUES = /[ãõç]/i;

function pareceTextoEmPortugues(texto: string): boolean {
  if (ACENTOS_PORTUGUES.test(texto)) return true;
  const palavras = texto.toLowerCase().match(/\p{L}+/gu) ?? [];
  return palavras.some((p) => PALAVRAS_PORTUGUES.includes(p));
}

/**
 * Indicios de Brasil especificamente (nao so "e portugues", que tambem
 * pega Portugal e outros paises lusofonos): hashtags e palavras curtas de
 * uso quase exclusivo do Brasil.
 */
const HASHTAGS_BRASIL = ["#brasil", "#brazil", "#sp", "#rj", "#mg", "#brmarketing"];

const PALAVRAS_BRASIL = ["reais", "pix", "cnpj", "cpf", "whatsapp"];

const CAPITAIS_BRASILEIRAS = [
  "são paulo",
  "sao paulo",
  "rio de janeiro",
  "brasília",
  "brasilia",
  "salvador",
  "fortaleza",
  "belo horizonte",
  "manaus",
  "curitiba",
  "recife",
  "porto alegre",
  "belém",
  "belem",
  "goiânia",
  "goiania",
];

/**
 * `termosDoNicho` (o `nichos.termos` do proprio nicho, ja em portugues do
 * Brasil por natureza) entram como indicio extra: "grafia brasileira de
 * termos do nicho" no `PROXIMO.md`.
 */
export function temIndicioDeBrasil(legenda: string, termosDoNicho: string[] = []): boolean {
  if (!pareceTextoEmPortugues(legenda)) return false;

  const texto = legenda.toLowerCase();
  if (HASHTAGS_BRASIL.some((h) => texto.includes(h))) return true;
  if (PALAVRAS_BRASIL.some((p) => texto.includes(p))) return true;
  if (CAPITAIS_BRASILEIRAS.some((c) => texto.includes(c))) return true;
  if (termosDoNicho.some((termo) => termo.trim() !== "" && texto.includes(termo.toLowerCase()))) return true;

  return false;
}
