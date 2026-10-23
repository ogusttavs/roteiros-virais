/**
 * Confere a regra 3 do projeto (nenhuma marca da empresa no que é do produto) dentro de `src/`: o repositório é público e `plataforma/CLAUDE.md` manda
 * `grep -ri orbita src` voltar vazio. Sem exceção nenhuma: nem comentário, nem texto de teste. Vê "orbita" e "órbita", em qualquer caixa, dentro de qualquer palavra
 * ("GetOrbita", "getorbita.com.br"), em todo arquivo de texto de `src/` (binários como imagem e fonte ficam de fora). Sem I/O de escrita nem process.exit aqui, para dar para
 * testar; o ponto de entrada fica em checar-marca.ts.
 */
import { globSync, readFileSync } from "node:fs";

export const PADRAO = "src/**/*";

const BINARIOS = /\.(png|jpe?g|gif|webp|avif|ico|icns|woff2?|ttf|otf|eot|mp3|mp4|webm|mov|pdf|zip|gz)$/i;
const MARCA = /[oó]rbita/i;

export type Problema = { arquivo: string; linha: number; motivo: string };

export function listarArquivos(padrao: string = PADRAO): string[] {
  return globSync(padrao)
    .map((a) => a.replaceAll("\\", "/"))
    .filter((a) => !BINARIOS.test(a))
    .sort();
}

export function verificarConteudo(arquivo: string, conteudo: string): Problema[] {
  const problemas: Problema[] = [];
  conteudo.split(/\r?\n/).forEach((texto, i) => {
    const achou = MARCA.exec(texto);
    if (achou) problemas.push({ arquivo, linha: i + 1, motivo: `a marca da empresa não pode aparecer no produto (regra 3): "${achou[0]}"` });
  });
  return problemas;
}

export function verificarArquivo(arquivo: string): Problema[] {
  let conteudo: string;
  try {
    conteudo = readFileSync(arquivo, "utf-8");
  } catch {
    return []; // pasta que o glob devolveu como entrada
  }
  return verificarConteudo(arquivo, conteudo);
}
