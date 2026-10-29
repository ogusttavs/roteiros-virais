/**
 * E47 PR 2: o "prompt" de nomes que a Groq recebe junto do áudio (o campo `prompt` da transcrição). Ele não é uma instrução: é um texto de exemplo que ajuda o transcritor a acertar a grafia
 * da marca, do lugar e dos produtos (o que mais erra numa legenda pública). Sai do que a conta já sabe de si (nome da marca, cidade ou região, o que vende, concorrentes citados). A Groq aceita
 * até 224 tokens de prompt, então o texto é curto: o nome da marca vem primeiro e o resto é cortado no fim, nunca no meio de uma palavra.
 */
export const LIMITE_DO_PROMPT_DE_NOMES = 480;

export type DadosDosNomes = {
  nomeDaMarca: string;
  cidade?: string | null;
  regiao?: string | null;
  oQueVende?: string | null;
  concorrentes?: string[] | null;
};

function limpar(texto: string | null | undefined): string {
  return (texto ?? "").replace(/\s+/g, " ").trim();
}

/** Corta em `max` caracteres sem partir uma palavra. */
function cortar(texto: string, max: number): string {
  if (texto.length <= max) return texto;
  const corte = texto.slice(0, max);
  const ultimoEspaco = corte.lastIndexOf(" ");
  return (ultimoEspaco > max / 2 ? corte.slice(0, ultimoEspaco) : corte).replace(/[,;:\s]+$/, "");
}

export function promptDeNomes(dados: DadosDosNomes): string {
  const marca = limpar(dados.nomeDaMarca);
  if (!marca) return "";
  const lugar = limpar(dados.regiao) || limpar(dados.cidade);
  const partes = [`Vídeo de ${marca}${lugar ? `, em ${lugar}` : ""}.`];
  const vende = limpar(dados.oQueVende);
  if (vende) partes.push(`${cortar(vende, 160).replace(/[.\s]+$/, "")}.`);
  const concorrentes = (dados.concorrentes ?? []).map(limpar).filter(Boolean).slice(0, 3);
  if (concorrentes.length > 0) partes.push(`Nomes que podem aparecer: ${concorrentes.join(", ")}.`);
  return cortar(partes.join(" "), LIMITE_DO_PROMPT_DE_NOMES);
}
