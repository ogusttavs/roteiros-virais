/**
 * Confere a regra 5 do "ver como" (E46 PR 2): toda Server Action do painel (tudo que é `"use server"` em `src/app/`, fora do admin e de `api/`) ou chama `exigirForaDoVerComo()` /
 * `recusaDoVerComo()` como PRIMEIRO `await` do corpo, ou está na lista de leitura livre abaixo, com o motivo. Uma Server Action nova sem uma coisa nem outra reprova o PR: no modo, ninguém
 * manda algo para fora, gasta ou muda dado em nome de outra pessoa por esquecimento. Vê `export async function`, `export default async function` e `export const x = async ...`, em `.ts` e
 * `.tsx`, com ou sem comentário antes da diretiva, e ignora comentários ao procurar o `await` (um `// await exigirForaDoVerComo()` não vale). `"use server"` dentro de uma função
 * (Server Action inline) reprova: tem de morar num arquivo de ações. Sem I/O de escrita nem process.exit aqui, para dar para testar; o ponto de entrada fica em checar-ver-como.ts.
 */
import { globSync, readFileSync } from "node:fs";

export const PADRAO = "src/app/**/*.{ts,tsx}";

/** As únicas Server Actions que o modo deixa passar, por `arquivo:função` (o nome sozinho não vale: uma ação nova com o mesmo nome em outro arquivo não herda a licença). */
export const LEITURA_LIVRE: Record<string, string> = {
  "src/app/(painel)/(completo)/criar/objetivo/acoes.ts:exemplosDaFichaAction": "só lê os exemplos do setor",
  "src/app/(painel)/(completo)/criar/objetivo/acoes.ts:sugerirEstiloAction": "só lê a sugestão de estilo pela evidência",
  "src/app/(painel)/(completo)/hoje/acoes.ts:roteiroRecenteDesdeAction": "só lê se há roteiro recente",
  "src/app/(painel)/_briefing/acoes.ts:listarPerfisCitadosAction": "só lê os perfis citados",
  "src/app/(painel)/_casca/push-acoes.ts:inscricaoRegistradaAction": "só lê se a pessoa tem aquela inscrição de push",
  "src/app/(painel)/_casca/ver-como-acoes.ts:sairDoVerComoAction": "é a própria saída do modo",
};

export type Problema = { arquivo: string; linha: number; motivo: string };

/** Troca os comentários por espaços (mantendo as quebras de linha, para os números de linha não mudarem) sem mexer em texto entre aspas. */
export function semComentarios(codigo: string): string {
  let saida = "";
  let i = 0;
  let aspa: string | null = null;
  while (i < codigo.length) {
    const c = codigo[i];
    const prox = codigo[i + 1];
    if (aspa) {
      saida += c;
      if (c === "\\") {
        saida += prox ?? "";
        i += 2;
        continue;
      }
      if (c === aspa) aspa = null;
      i += 1;
    } else if (c === "/" && prox === "/") {
      while (i < codigo.length && codigo[i] !== "\n") i += 1;
    } else if (c === "/" && prox === "*") {
      i += 2;
      while (i < codigo.length && !(codigo[i] === "*" && codigo[i + 1] === "/")) {
        if (codigo[i] === "\n") saida += "\n";
        i += 1;
      }
      i += 2;
    } else {
      if (c === '"' || c === "'" || c === "`") aspa = c;
      saida += c;
      i += 1;
    }
  }
  return saida;
}

/** O arquivo começa pela diretiva (depois de comentários e espaços)? */
export function ehArquivoDeAcoes(conteudo: string): boolean {
  return /^["']use server["']/.test(semComentarios(conteudo).trimStart());
}

export function listarArquivos(): string[] {
  return globSync(PADRAO)
    .map((c) => c.replaceAll("\\", "/"))
    .filter((c) => !c.startsWith("src/app/admin/") && !c.startsWith("src/app/api/") && !/\.test\.tsx?$/.test(c));
}

type Funcao = { nome: string; linhaDaAssinatura: number; corpo: string };

/** Acha o fim do bloco `{ ... }` que começa em `inicio` (o índice do `{`). */
function fimDoBloco(codigo: string, inicio: number): number {
  let nivel = 0;
  for (let k = inicio; k < codigo.length; k++) {
    if (codigo[k] === "{") nivel += 1;
    else if (codigo[k] === "}") {
      nivel -= 1;
      if (nivel === 0) return k;
    }
  }
  return codigo.length;
}

/** O índice do `{` do corpo, depois dos parâmetros que abrem em `abre` (o tipo de retorno pode ter `{}` dentro de `<>`). */
function inicioDoCorpo(codigo: string, abre: number): number {
  let profundidade = 0;
  let k = abre;
  for (; k < codigo.length; k++) {
    if (codigo[k] === "(") profundidade += 1;
    else if (codigo[k] === ")") {
      profundidade -= 1;
      if (profundidade === 0) break;
    }
  }
  let angulos = 0;
  let chaves = 0;
  for (let j = k + 1; j < codigo.length; j++) {
    const c = codigo[j];
    if (c === "<") angulos += 1;
    else if (c === ">" && codigo[j - 1] !== "=") angulos -= 1;
    else if (c === "{") {
      if (angulos === 0 && chaves === 0) return j;
      chaves += 1;
    } else if (c === "}") chaves -= 1;
  }
  return codigo.length;
}

/** As Server Actions exportadas do arquivo (já sem comentários), nas três formas, com o corpo. */
export function funcoesExportadas(codigoSemComentarios: string): Funcao[] {
  const codigo = codigoSemComentarios;
  const funcoes: Funcao[] = [];
  const linhaDe = (indice: number) => codigo.slice(0, indice).split("\n").length;

  const reDeclaracao = /^export (?:default )?async function\s*(\w*)\s*(?:<[^(]*>)?\(/gm;
  for (let m = reDeclaracao.exec(codigo); m; m = reDeclaracao.exec(codigo)) {
    const inicio = inicioDoCorpo(codigo, m.index + m[0].length - 1);
    funcoes.push({ nome: m[1] || "default", linhaDaAssinatura: linhaDe(m.index), corpo: codigo.slice(inicio + 1, fimDoBloco(codigo, inicio)) });
  }

  const reFlecha = /^export const\s+(\w+)\s*(?::[^=]+)?=\s*async\b/gm;
  for (let m = reFlecha.exec(codigo); m; m = reFlecha.exec(codigo)) {
    const seta = codigo.indexOf("=>", m.index);
    const aposSeta = seta === -1 ? "" : codigo.slice(seta + 2);
    const corpo = aposSeta.trimStart().startsWith("{") ? codigo.slice(seta + 2 + (aposSeta.length - aposSeta.trimStart().length) + 1, fimDoBloco(codigo, seta + 2 + (aposSeta.length - aposSeta.trimStart().length))) : aposSeta.split(";")[0];
    funcoes.push({ nome: m[1], linhaDaAssinatura: linhaDe(m.index), corpo });
  }

  const reFuncaoDeclarada = /^export const\s+(\w+)\s*=\s*async function/gm;
  for (let m = reFuncaoDeclarada.exec(codigo); m; m = reFuncaoDeclarada.exec(codigo)) {
    const abre = codigo.indexOf("(", m.index);
    const inicio = inicioDoCorpo(codigo, abre);
    funcoes.push({ nome: m[1], linhaDaAssinatura: linhaDe(m.index), corpo: codigo.slice(inicio + 1, fimDoBloco(codigo, inicio)) });
  }
  return funcoes;
}

export function verificarConteudo(caminho: string, conteudo: string): Problema[] {
  const codigo = semComentarios(conteudo);
  const problemas: Problema[] = [];

  if (!ehArquivoDeAcoes(conteudo)) {
    // "use server" que não abre o arquivo é Server Action inline (dentro de uma função): fora do alcance desta conferência, então não é permitido.
    const inline = /["']use server["']/.exec(codigo);
    if (inline) {
      problemas.push({ arquivo: caminho, linha: codigo.slice(0, inline.index).split("\n").length, motivo: 'Server Action inline ("use server" dentro de uma função): mova para um arquivo de ações, onde o checar-ver-como confere a recusa no modo' });
    }
    return problemas;
  }

  for (const f of funcoesExportadas(codigo)) {
    if (`${caminho}:${f.nome}` in LEITURA_LIVRE) continue;
    const primeiroAwait = /\bawait\s+([\w.]+)\(/.exec(f.corpo);
    const chamada = primeiroAwait?.[1];
    if (chamada === "exigirForaDoVerComo") continue;
    // `recusaDoVerComo` só vale se a recusa é devolvida (`if (...) return ...`): chamar e ignorar o resultado não recusa nada.
    if (chamada === "recusaDoVerComo" && /await\s+recusaDoVerComo\(\)(?:\)\s*|\s*;\s*if\s*\([^)]*\)\s*)return\b/.test(f.corpo)) continue;
    problemas.push({
      arquivo: caminho,
      linha: f.linhaDaAssinatura,
      motivo: `${f.nome}: a Server Action do painel precisa chamar exigirForaDoVerComo() ou recusaDoVerComo() como primeiro await (ou entrar na lista de leitura livre de scripts/checar-ver-como-regras.ts, com o motivo)`,
    });
  }
  return problemas;
}

export function verificarArquivo(caminho: string): Problema[] {
  return verificarConteudo(caminho, readFileSync(caminho, "utf8"));
}
