/**
 * Confere a regra 5 do "ver como" (E46 PR 2): toda Server Action do painel (tudo que é `"use server"` em `src/app/`, fora do admin e de `api/`) ou chama `exigirForaDoVerComo()` /
 * `recusaDoVerComo()` como PRIMEIRO `await` do corpo, ou está na lista de leitura livre abaixo, com o motivo. Uma Server Action nova sem uma coisa nem outra reprova o PR: no modo, ninguém
 * manda algo para fora, gasta ou muda dado em nome de outra pessoa por esquecimento. Vê `export async function`, `export default async function` e `export const x = async ...`, em `.ts` e
 * `.tsx`, com ou sem comentário antes da diretiva, e ignora comentários ao procurar o `await` (um `// await exigirForaDoVerComo()` não vale). `"use server"` dentro de uma função
 * (Server Action inline) reprova: tem de morar num arquivo de ações. Sem I/O de escrita nem process.exit aqui, para dar para testar; o ponto de entrada fica em checar-ver-como.ts.
 *
 * Desde o M3 da auditoria de segurança de 26/11/2026, a mesma regra vale para as rotas `/api` que escrevem (a segunda metade deste arquivo, a partir de `PADRAO_ROTAS`).
 */
import { globSync, readFileSync } from "node:fs";
import { posix, sep } from "node:path";

export const PADRAO = "src/app/**/*.{ts,tsx}";

/** As únicas Server Actions que o modo deixa passar, por `arquivo:função` (o nome sozinho não vale: uma ação nova com o mesmo nome em outro arquivo não herda a licença). */
export const LEITURA_LIVRE: Record<string, string> = {
  "src/app/(painel)/(completo)/criar/objetivo/acoes.ts:exemplosDaFichaAction": "só lê os exemplos do setor",
  "src/app/(painel)/(completo)/criar/objetivo/acoes.ts:sugerirEstiloAction": "só lê a sugestão de estilo pela evidência",
  "src/app/(painel)/(completo)/criar/pesquisa/acoes.ts:lerPesquisaAction": "só lê a pesquisa da própria marca (a espera da tela a repete); fechar a que ficou presa é limpeza do sistema, não um ato da pessoa",
  "src/app/(painel)/(completo)/hoje/acoes.ts:roteiroRecenteDesdeAction": "só lê se há roteiro recente",
  "src/app/(painel)/(completo)/hoje/acoes.ts:grupoRecenteDesdeAction": "só lê se há versões recentes",
  "src/app/(painel)/_briefing/acoes.ts:listarPerfisCitadosAction": "só lê os perfis citados",
  "src/app/(painel)/_casca/push-acoes.ts:inscricaoRegistradaAction": "só lê se a pessoa tem aquela inscrição de push",
  "src/app/(painel)/_casca/ver-como-acoes.ts:sairDoVerComoAction": "é a própria saída do modo",
  "src/app/convite/[codigo]/acoes.ts:aceitarConviteAction": "convite de grupo: é o aceite público do link, sem sessão: não há pessoa nem conta para ver como",
  "src/app/cadastro/acoes.ts:criarContaAction": "E63: é o cadastro público, sem sessão: não há pessoa nem conta para ver como",
  "src/app/confirmar-email/acoes.ts:reenviarConfirmacaoAction": "E63: só manda o e-mail de confirmar da pessoa da sessão real; o admin no modo não chega a esta página",
  "src/app/confirmar-email/acoes.ts:trocarEmailAction": "E63: só mexe na conta da pessoa da sessão real que ainda não confirmou o e-mail; o admin no modo não chega a esta página",
  "src/app/acoes.ts:queroTestarAction": "é o formulário público da página de entrada (E57a): não há sessão, logo nem conta para ver como; só grava a pessoa que pediu para testar",
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
    if (Object.hasOwn(LEITURA_LIVRE, `${caminho}:${f.nome}`)) continue;
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

/**
 * As rotas (M3 da auditoria de segurança de 26/11/2026): a regra 5 do "ver como" também para elas. Todo route handler de `src/app/` que o Next aceita (`route.ts`, `route.tsx`, `route.js`,
 * `route.mjs`, dentro ou fora de `api/`; fora de `api/admin/` e `admin/`, que agem como o próprio admin e têm o `checar-admin-protegido`) que exporta POST, PUT, PATCH ou DELETE recusa o modo como PRIMEIRO `await` do método, num destes três jeitos:
 *  1. `if (await modoVerComoLigado()) return ...`;
 *  2. `const x = await <porta>(); if (x instanceof NextResponse) return x;`, com a porta em PORTAS_DE_ROTA E importada pela rota do arquivo da porta (uma função local, ou importada de outro lugar, com o mesmo nome não vale; a porta também é conferida: o primeiro `await` dela é o jeito 1);
 *  3. `const s = await sessaoDoPainel();` e, antes do `await` seguinte, `if (s.verComo !== null) return ...`.
 * Ou o método está em ROTAS_LIVRES, por `arquivo:MÉTODO`, com o motivo. Uma reexportação (`export { POST } from "..."`) vale se aponta para outra rota conferida aqui. Um método que escreve
 * exportado de um jeito que esta conferência não lê (desestruturado, `export function` sem `async`, embrulhado noutra função) só passa pela lista. Uma entrada da lista que aponta para algo
 * que não existe mais reprova. O GET fica de fora: ler no modo é o propósito do modo (as rotas GET que mexem em algo, como `/api/meta/conectar`, recusam à mão).
 */
export const PADRAO_ROTAS = "src/app/**/route.{ts,tsx,js,mjs}";

/** Onde moram as rotas que esta conferência não olha: o admin age como o próprio admin e tem o `checar-admin-protegido`. */
export const PASTAS_DO_ADMIN = ["src/app/api/admin/", "src/app/admin/"] as const;

export const METODOS_QUE_ESCREVEM = ["POST", "PUT", "PATCH", "DELETE"] as const;

/** Os únicos métodos que escrevem e que o modo deixa passar, por `arquivo:MÉTODO`: nenhum deles é a pessoa vista mexendo na própria conta. */
export const ROTAS_LIVRES: Record<string, string> = {
  "src/app/api/auth/[...all]/route.ts:POST": "é o better-auth da sessão REAL (entrar, sair): o modo mora num cookie à parte, que ele não lê, e nada aqui age em nome da pessoa vista",
  "src/app/api/jobs/[nome]/route.ts:POST": "autenticação própria por chave (cron e admin), sem a sessão do painel",
  "src/app/api/meta/exclusao/route.ts:POST": "é a Meta avisando uma exclusão de dados (signed_request conferido), sem a sessão do painel",
  "src/app/api/webhooks/stripe/route.ts:POST": "é o aviso do Stripe (assinatura do corpo conferida), sem a sessão do painel",
};

/** As portas comuns que recusam o modo pelas rotas que as chamam, com o arquivo onde moram (onde esta conferência confere que elas continuam recusando). */
export const PORTAS_DE_ROTA: Record<string, string> = {
  marcaDoCarrossel: "src/lib/porta-do-carrossel.ts",
};

export function listarRotas(): string[] {
  return globSync(PADRAO_ROTAS)
    .map((c) => c.split(sep).join("/"))
    .filter((c) => !PASTAS_DO_ADMIN.some((pasta) => c.startsWith(pasta)))
    .sort();
}

export type MetodoDaRota = { metodo: string; linha: number; corpo: string | null; reexportaDe: string | null };

const ehDeEscrita = (nome: string) => (METODOS_QUE_ESCREVEM as readonly string[]).includes(nome);

/** Os nomes exportados de uma lista `{ A, B as C }` (vale o nome de fora, o depois do `as`; numa desestruturação `{ A: b }`, vale o `b`). */
function nomesDaLista(lista: string): string[] {
  return lista
    .split(",")
    .map((parte) => parte.trim())
    .filter(Boolean)
    .map((parte) => {
      const comAs = /\bas\s+(\w+)$/.exec(parte);
      if (comAs) return comAs[1];
      const comDoisPontos = /:\s*(\w+)$/.exec(parte);
      return comDoisPontos ? comDoisPontos[1] : parte.replace(/=.*$/, "").trim();
    });
}

/** Os métodos que escrevem exportados pela rota (código já sem comentários): com corpo (as formas de `funcoesExportadas`), reexportados de outro arquivo, ou de um jeito sem corpo legível (nulo). */
export function metodosQueEscrevem(codigoSemComentarios: string): MetodoDaRota[] {
  const codigo = codigoSemComentarios;
  const linhaDe = (indice: number) => codigo.slice(0, indice).split("\n").length;
  const metodos: MetodoDaRota[] = funcoesExportadas(codigo)
    .filter((f) => ehDeEscrita(f.nome))
    .map((f) => ({ metodo: f.nome, linha: f.linhaDaAssinatura, corpo: f.corpo, reexportaDe: null }));
  const jaVistos = new Set(metodos.map((m) => m.metodo));
  const semCorpo = (nome: string, indice: number, reexportaDe: string | null = null) => {
    if (!ehDeEscrita(nome) || jaVistos.has(nome)) return;
    jaVistos.add(nome);
    metodos.push({ metodo: nome, linha: linhaDe(indice), corpo: null, reexportaDe });
  };

  const reReexporta = /^export\s*\{([^}]*)\}\s*from\s*["']([^"']+)["']/gm;
  for (let m = reReexporta.exec(codigo); m; m = reReexporta.exec(codigo)) for (const nome of nomesDaLista(m[1])) semCorpo(nome, m.index, m[2]);

  const reDesestruturada = /^export\s+(?:const|let|var)\s*\{([^}]*)\}\s*=/gm;
  for (let m = reDesestruturada.exec(codigo); m; m = reDesestruturada.exec(codigo)) for (const nome of nomesDaLista(m[1])) semCorpo(nome, m.index);

  const reListaLocal = /^export\s*\{([^}]*)\}\s*;?\s*$/gm;
  for (let m = reListaLocal.exec(codigo); m; m = reListaLocal.exec(codigo)) for (const nome of nomesDaLista(m[1])) semCorpo(nome, m.index);

  // `export const POST = algo(...)` (sem `async` logo depois do `=`) e `export function POST(` (sem `async`): a conferência não lê o corpo, só a lista os deixa passar.
  const reOutraForma = /^export\s+(?:(?:const|let|var)\s+(\w+)\s*(?::[^=]+)?=(?!\s*async\b)|function\s+(\w+)\b)/gm;
  for (let m = reOutraForma.exec(codigo); m; m = reOutraForma.exec(codigo)) semCorpo(m[1] ?? m[2], m.index);
  return metodos;
}

/** O primeiro `await` do corpo é a recusa do modo, num dos três jeitos do cabeçalho desta seção? */
export function recusaComoPrimeiroAwait(corpo: string, portasImportadas: ReadonlySet<string> = new Set()): boolean {
  const primeiro = /\bawait\s+([\w.]+)\(/.exec(corpo);
  if (!primeiro) return false;
  const nome = primeiro[1];
  const antes = corpo.slice(0, primeiro.index);
  const depois = corpo.slice(primeiro.index);

  // Jeito 1: `if (await modoVerComoLigado()) return`.
  if (nome === "modoVerComoLigado") return /\bif\s*\(\s*$/.test(antes) && /^await\s+modoVerComoLigado\(\)\s*\)\s*return\b/.test(depois);

  const variavel = /\b(?:const|let)\s+(\w+)\s*=\s*$/.exec(antes)?.[1];
  if (!variavel) return false;

  // Jeito 2: a porta comum, com a resposta dela devolvida.
  if (portasImportadas.has(nome)) {
    const m = /^await\s+\w+\(\)\s*;\s*if\s*\(\s*(\w+)\s+instanceof\s+NextResponse\s*\)\s*return\s+(\w+)\s*;/.exec(depois);
    return m !== null && m[1] === variavel && m[2] === variavel;
  }

  // Jeito 3: a sessão do painel, com a recusa do `verComo` antes do `await` seguinte.
  if (nome === "sessaoDoPainel") {
    const resto = depois.slice(primeiro[0].length);
    const proximoAwait = resto.search(/\bawait\b/);
    const trecho = proximoAwait === -1 ? resto : resto.slice(0, proximoAwait);
    const m = /\bif\s*\(\s*(\w+)\.verComo\s*!==?\s*null\s*\)\s*return\b/.exec(trecho);
    return m !== null && m[1] === variavel;
  }
  return false;
}

/** `@/lib/x` e `./x` (a partir da rota) viram `src/lib/x`, sem a extensão: o jeito de comparar com o arquivo de uma porta. Nulo para pacote (`next/server`). */
function caminhoDoImport(caminhoDaRota: string, alvo: string): string | null {
  let resolvido: string;
  if (alvo.startsWith("@/")) resolvido = posix.join("src", alvo.slice(2));
  else if (alvo.startsWith(".")) resolvido = posix.join(posix.dirname(caminhoDaRota), alvo);
  else return null;
  return posix.normalize(resolvido).replace(/\.(?:tsx?|jsx?|mjs)$/, "");
}

/** Os nomes (como a rota os chama) de PORTAS_DE_ROTA que ela importa do arquivo da porta, pelo `@/` ou por caminho relativo. Importar de outro lugar, ou declarar a função ali mesmo, não conta. */
export function portasImportadasPelaRota(caminhoDaRota: string, codigoSemComentarios: string): Set<string> {
  const portas = new Set<string>();
  const reImport = /^import\s+(?!type\b)\{([^}]*)\}\s*from\s*["']([^"']+)["']/gm;
  for (let m = reImport.exec(codigoSemComentarios); m; m = reImport.exec(codigoSemComentarios)) {
    const origem = caminhoDoImport(caminhoDaRota, m[2]);
    if (origem === null) continue;
    for (const parte of m[1].split(",")) {
      const item = parte.trim();
      if (!item || item.startsWith("type ")) continue;
      const [importado, local = importado] = item.split(/\s+as\s+/).map((x) => x.trim());
      if (!Object.hasOwn(PORTAS_DE_ROTA, importado)) continue;
      if (caminhoDoImport(caminhoDaRota, `@/${PORTAS_DE_ROTA[importado].replace(/^src\//, "")}`) === origem) portas.add(local);
    }
  }
  return portas;
}

/** Resolve o caminho de uma reexportação relativa (`../../transcrever/route`) para o arquivo da rota, como o glob o devolve. */
export function caminhoDaReexportacao(caminhoDaRota: string, alvo: string): string | null {
  if (!alvo.startsWith(".")) return null;
  const resolvido = posix.normalize(posix.join(posix.dirname(caminhoDaRota), alvo));
  return resolvido.endsWith(".ts") ? resolvido : `${resolvido}.ts`;
}

/** Os problemas de uma rota. `rotas` são as rotas conferidas (a reexportação só vale para uma delas). */
export function verificarRota(caminho: string, conteudo: string, rotas: ReadonlySet<string>): Problema[] {
  const problemas: Problema[] = [];
  const codigo = semComentarios(conteudo);
  const portas = portasImportadasPelaRota(caminho, codigo);
  for (const m of metodosQueEscrevem(codigo)) {
    if (Object.hasOwn(ROTAS_LIVRES, `${caminho}:${m.metodo}`)) continue;
    if (m.reexportaDe !== null) {
      const alvo = caminhoDaReexportacao(caminho, m.reexportaDe);
      if (alvo !== null && alvo !== caminho && (rotas.has(alvo) || ["tsx", "js", "mjs"].some((ext) => rotas.has(alvo.replace(/\.ts$/, `.${ext}`))))) continue;
      problemas.push({ arquivo: caminho, linha: m.linha, motivo: `${m.metodo}: reexporta de "${m.reexportaDe}", que não é outra rota /api conferida pelo checar-ver-como (aponte para a rota ou ponha em ROTAS_LIVRES, com o motivo)` });
      continue;
    }
    if (m.corpo === null) {
      problemas.push({ arquivo: caminho, linha: m.linha, motivo: `${m.metodo}: exportado de um jeito que o checar-ver-como não lê; escreva export async function ${m.metodo} com a recusa do modo, ou ponha em ROTAS_LIVRES de scripts/checar-ver-como-regras.ts, com o motivo` });
      continue;
    }
    if (recusaComoPrimeiroAwait(m.corpo, portas)) continue;
    problemas.push({
      arquivo: caminho,
      linha: m.linha,
      motivo: `${m.metodo}: a rota /api que escreve precisa recusar o "ver como" como primeiro await (if (await modoVerComoLigado()) return ..., uma porta de PORTAS_DE_ROTA com a resposta devolvida, ou sessaoDoPainel com o verComo recusado logo depois), ou entrar em ROTAS_LIVRES de scripts/checar-ver-como-regras.ts com o motivo`,
    });
  }
  return problemas;
}

/** A porta continua recusando o modo como primeiro `await` (jeito 1)? Se deixar de recusar, todas as rotas que a usam ficam abertas sem aviso. */
export function verificarPorta(nome: string, caminho: string, conteudo: string): Problema[] {
  const funcao = funcoesExportadas(semComentarios(conteudo)).find((f) => f.nome === nome);
  if (!funcao) return [{ arquivo: caminho, linha: 1, motivo: `a porta ${nome} de PORTAS_DE_ROTA não existe mais neste arquivo` }];
  const primeiro = /\bawait\s+([\w.]+)\(/.exec(funcao.corpo)?.[1];
  if (primeiro === "modoVerComoLigado" && recusaComoPrimeiroAwait(funcao.corpo)) return [];
  return [{ arquivo: caminho, linha: funcao.linhaDaAssinatura, motivo: `${nome}: a porta das rotas precisa chamar if (await modoVerComoLigado()) return ... como primeiro await; as rotas que a usam confiam nela` }];
}

/** As entradas de ROTAS_LIVRES que apontam para uma rota ou um método que não existe mais (a licença não apodrece). */
export function entradasPodres(metodosPorRota: ReadonlyMap<string, ReadonlySet<string>>): Problema[] {
  const problemas: Problema[] = [];
  for (const chave of Object.keys(ROTAS_LIVRES)) {
    const corte = chave.lastIndexOf(":");
    const arquivo = chave.slice(0, corte);
    const metodo = chave.slice(corte + 1);
    if (!metodosPorRota.get(arquivo)?.has(metodo)) problemas.push({ arquivo, linha: 1, motivo: `a entrada ${chave} de ROTAS_LIVRES aponta para uma rota ou um método que não existe mais` });
  }
  return problemas;
}

/** Tudo das rotas de uma vez, lendo do disco (a partir da raiz de `plataforma/`). */
export function verificarRotasDoRepositorio(): { problemas: Problema[]; rotas: number } {
  const rotas = listarRotas();
  const conjunto = new Set(rotas);
  const problemas: Problema[] = [];
  const metodosPorRota = new Map<string, Set<string>>();
  for (const r of rotas) {
    const conteudo = readFileSync(r, "utf8");
    problemas.push(...verificarRota(r, conteudo, conjunto));
    metodosPorRota.set(r, new Set(metodosQueEscrevem(semComentarios(conteudo)).map((m) => m.metodo)));
  }
  for (const [nome, arquivo] of Object.entries(PORTAS_DE_ROTA)) {
    let conteudo: string;
    try {
      conteudo = readFileSync(arquivo, "utf8");
    } catch {
      problemas.push({ arquivo, linha: 1, motivo: `o arquivo da porta ${nome} de PORTAS_DE_ROTA não existe mais` });
      continue;
    }
    problemas.push(...verificarPorta(nome, arquivo, conteudo));
  }
  problemas.push(...entradasPodres(metodosPorRota));
  return { problemas, rotas: rotas.length };
}
