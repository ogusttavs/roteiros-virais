/**
 * E22 PR 2, item 0a: confere que o portão da cobrança (`src/lib/portao-cobranca.ts`) cobre tudo que gasta em nome de uma marca. O layout do painel só protege a PÁGINA; uma Server Action é um
 * endereço que se chama sem passar por ela, e a rota `/api` também. As regras (a lista é fechada no servidor, como a do `checar-ver-como`):
 *
 *  1. Toda Server Action do painel (`"use server"` em `src/app/`, fora do admin e de `api/`) chama `await exigirAssinaturaValida(...)` ANTES de qualquer outro `await` que não seja a recusa do
 *     "ver como" (`exigirForaDoVerComo`, `recusaDoVerComo`) ou a leitura da sessão (`sessaoDoPainel`), ou entra na lista de livres abaixo, com o motivo (arquivo e função, o nome sozinho não vale).
 *  2. Toda rota `src/app/api/**` chama `recusaDaCobranca(...)` (ou `roteiroDeQuemPediu`, que a chama por dentro), ou entra na lista de rotas livres, com o motivo.
 *  3. As páginas do painel que moram fora do grupo `(completo)` (e por isso fora do portão do layout) chamam `exigirAssinaturaValida`.
 *  4. Os arquivos que guardam o portão para outros (`impressao-de-roteiro.ts`) continuam chamando-o.
 *  5. Uma entrada nas listas que aponta para algo que não existe mais reprova (a licença não apodrece).
 * Sem I/O de escrita nem process.exit, para dar para testar; o ponto de entrada fica em checar-portao-cobranca.ts.
 */
import { globSync, readFileSync } from "node:fs";

import { ehArquivoDeAcoes, funcoesExportadas, semComentarios } from "./checar-ver-como-regras";

export type Problema = { arquivo: string; linha: number; motivo: string };

/** Pastas inteiras de Server Actions que o portão não alcança, com o motivo. */
export const AREAS_LIVRES: Record<string, string> = {
  "src/app/(painel)/_casca/": "a casca do painel não gasta nada (aceitar os termos, trocar de marca, instalar, aviso por push, formatos) e precisa funcionar antes e fora do pagamento",
  "src/app/(painel)/assinar/": "é a própria tela de assinar e o portal: barrá-la trancaria quem precisa pagar do lado de fora",
};

/** Server Actions livres, por `arquivo:função`: só leem, sem gasto nenhum. */
export const ACOES_LIVRES: Record<string, string> = {
  "src/app/(painel)/(completo)/criar/objetivo/acoes.ts:exemplosDaFichaAction": "só lê os exemplos do setor, sem IA",
  "src/app/(painel)/(completo)/criar/objetivo/acoes.ts:sugerirEstiloAction": "só lê a sugestão de estilo pela evidência, sem IA",
  "src/app/(painel)/(completo)/criar/pesquisa/acoes.ts:lerPesquisaAction": "só lê a pesquisa da própria marca (a espera da tela a repete)",
  "src/app/(painel)/(completo)/hoje/acoes.ts:roteiroRecenteDesdeAction": "só lê se há roteiro recente",
  "src/app/(painel)/(completo)/hoje/acoes.ts:grupoRecenteDesdeAction": "só lê se há versões recentes",
  "src/app/(painel)/_briefing/acoes.ts:listarPerfisCitadosAction": "só lê os perfis citados",
  "src/app/trocar-senha/acoes.ts:trocarSenhaDoPrimeiroAcessoAction": "segurança da conta, sem gasto nenhum, e o primeiro acesso vem antes de qualquer pagamento",
  "src/app/(painel)/(completo)/conta/acoes-senha.ts:trocarSenhaAction": "segurança da conta, sem gasto nenhum: a senha é da pessoa, pague ou não",
  "src/app/acoes.ts:queroTestarAction": "formulário público da página de entrada (E57a): não há conta nem assinatura, só grava quem pediu para testar, sem IA e sem gasto",
  "src/app/(painel)/(completo)/conta/instagram-acoes.ts:desligarInstagramAction": "E19: desligar apaga o acesso guardado da pessoa e não gasta nada; é privacidade, e nunca pode ficar trancado atrás do pagamento",
};

/** Rotas `/api` livres, por caminho do arquivo. */
export const ROTAS_LIVRES: Record<string, string> = {
  "src/app/api/auth/[...all]/route.ts": "entrar e sair (better-auth): antes de existir marca ou assinatura",
  "src/app/api/capa/[videoId]/route.ts": "capa de vídeo é dado público da plataforma, igual para todas as marcas, sem gasto (só serve a quem está logado)",
  "src/app/api/imagem-noticia/[id]/route.ts": "foto de matéria guardada do nosso lado, dado público do setor, só serve a quem está logado e é do setor, sem gasto de IA nem de terceiros (mesmo critério da capa)",
  "src/app/api/meta/retorno/route.ts": "E19: a volta do diálogo da Meta termina uma ligação que o /api/meta/conectar (com o portão) começou; a conferência é o state assinado mais o cookie mais a sessão, e o retorno em si só grava o acesso, sem gasto",
  "src/app/api/meta/exclusao/route.ts": "E19: é o aviso de exclusão de dados da Meta (assinatura do signed_request conferida), nunca de um cliente logado; apagar dado a pedido da Meta não pode depender de pagamento",
  "src/app/api/jobs/[nome]/route.ts": "autenticação própria por chave (cron e admin), não é do cliente",
  "src/app/api/momento/transcrever/route.ts": "só reexporta o POST de /api/transcrever, que tem o portão",
  "src/app/api/push/chave/route.ts": "chave pública do aviso, sem gasto",
  "src/app/api/push/inscricao/route.ts": "o aparelho se inscreve no aviso, sem gasto",
  "src/app/api/saude/route.ts": "saúde para o monitor, pública de propósito",
  "src/app/api/saude/viagem/route.ts": "saúde da viagem (admin), sem dado de cliente",
  "src/app/api/ver-como/limpar/route.ts": "apaga o cookie do 'ver como', sem gasto",
  "src/app/api/versao/route.ts": "devolve só o sha, pública de propósito",
  "src/app/api/webhooks/stripe/route.ts": "é o aviso do Stripe (assinatura do corpo conferida), nunca de um cliente logado",
};

/** Páginas do painel fora do grupo `(completo)`: precisam chamar o portão elas mesmas. */
export const PAGINAS_FORA_DO_PORTAO = ["src/app/roteiros/[id]/gravar/page.tsx"];

/** Arquivos que escondem a chamada do portão para as rotas que os usam: se deixarem de chamar, as rotas ficam abertas sem o aviso do script. */
export const GUARDIOES: Record<string, string> = {
  "src/lib/impressao-de-roteiro.ts": "recusaDaCobranca",
};

const ANTES_DO_PORTAO_VALE = new Set(["exigirForaDoVerComo", "recusaDoVerComo", "sessaoDoPainel"]);

export function listarAcoes(): string[] {
  return globSync("src/app/**/*.{ts,tsx}")
    .map((c) => c.replaceAll("\\", "/"))
    .filter((c) => !c.startsWith("src/app/admin/") && !c.startsWith("src/app/api/") && !/\.test\.tsx?$/.test(c));
}

export function listarRotas(): string[] {
  return globSync("src/app/api/**/route.ts").map((c) => c.replaceAll("\\", "/"));
}

/** O corpo da função tem `await exigirAssinaturaValida(` antes de qualquer `await` de outra coisa que não seja a recusa do "ver como" ou a sessão? */
function portaoAntesDeTudo(corpo: string): boolean {
  const awaits = [...corpo.matchAll(/\bawait\s+([\w.]+)\(/g)].map((m) => m[1]);
  for (const nome of awaits) {
    if (nome === "exigirAssinaturaValida") return true;
    if (!ANTES_DO_PORTAO_VALE.has(nome)) return false;
  }
  return false;
}

export function verificarAcoes(caminho: string, conteudo: string): Problema[] {
  if (!ehArquivoDeAcoes(conteudo)) return [];
  if (Object.keys(AREAS_LIVRES).some((area) => caminho.startsWith(area))) return [];
  const problemas: Problema[] = [];
  for (const f of funcoesExportadas(semComentarios(conteudo))) {
    if (`${caminho}:${f.nome}` in ACOES_LIVRES) continue;
    if (portaoAntesDeTudo(f.corpo)) continue;
    problemas.push({
      arquivo: caminho,
      linha: f.linhaDaAssinatura,
      motivo: `${f.nome}: a Server Action do painel precisa chamar exigirAssinaturaValida() antes de qualquer gasto (depois da recusa do "ver como"), ou entrar em ACOES_LIVRES de scripts/checar-portao-cobranca-regras.ts com o motivo`,
    });
  }
  return problemas;
}

export function verificarRota(caminho: string, conteudo: string): Problema[] {
  if (caminho in ROTAS_LIVRES) return [];
  const codigo = semComentarios(conteudo);
  if (/\brecusaDaCobranca\(/.test(codigo) || /\broteiroDeQuemPediu\(/.test(codigo)) return [];
  return [{ arquivo: caminho, linha: 1, motivo: "a rota /api precisa chamar recusaDaCobranca() (ou entrar em ROTAS_LIVRES de scripts/checar-portao-cobranca-regras.ts com o motivo)" }];
}

export function verificarPagina(caminho: string, conteudo: string): Problema[] {
  if (/\bawait\s+exigirAssinaturaValida\(/.test(semComentarios(conteudo))) return [];
  return [{ arquivo: caminho, linha: 1, motivo: "esta página do painel mora fora do grupo (completo) e precisa chamar exigirAssinaturaValida()" }];
}

export function verificarGuardiao(caminho: string, conteudo: string, chamada: string): Problema[] {
  if (new RegExp(`\\b${chamada}\\(`).test(semComentarios(conteudo))) return [];
  return [{ arquivo: caminho, linha: 1, motivo: `este arquivo guarda o portão para outras rotas e deixou de chamar ${chamada}()` }];
}

/** Tudo de uma vez, lendo do disco (a partir da raiz de `plataforma/`). Devolve os problemas, inclusive as entradas das listas que apodreceram. */
export function verificarTudo(): { problemas: Problema[]; acoes: number; rotas: number } {
  const problemas: Problema[] = [];
  const arquivosDeAcoes = listarAcoes();
  const funcoesPorArquivo = new Map<string, Set<string>>();
  for (const a of arquivosDeAcoes) {
    const conteudo = readFileSync(a, "utf8");
    problemas.push(...verificarAcoes(a, conteudo));
    if (ehArquivoDeAcoes(conteudo)) funcoesPorArquivo.set(a, new Set(funcoesExportadas(semComentarios(conteudo)).map((f) => f.nome)));
  }
  const rotas = listarRotas();
  for (const r of rotas) problemas.push(...verificarRota(r, readFileSync(r, "utf8")));
  for (const p of PAGINAS_FORA_DO_PORTAO) {
    try {
      problemas.push(...verificarPagina(p, readFileSync(p, "utf8")));
    } catch {
      problemas.push({ arquivo: p, linha: 1, motivo: "a página da lista PAGINAS_FORA_DO_PORTAO não existe mais" });
    }
  }
  for (const [arquivo, chamada] of Object.entries(GUARDIOES)) {
    try {
      problemas.push(...verificarGuardiao(arquivo, readFileSync(arquivo, "utf8"), chamada));
    } catch {
      problemas.push({ arquivo, linha: 1, motivo: "o arquivo da lista GUARDIOES não existe mais" });
    }
  }
  for (const chave of Object.keys(ACOES_LIVRES)) {
    const [arquivo, nome] = chave.split(":");
    if (!funcoesPorArquivo.get(arquivo)?.has(nome)) problemas.push({ arquivo, linha: 1, motivo: `ACOES_LIVRES aponta para ${nome}, que não existe mais nesse arquivo` });
  }
  for (const rota of Object.keys(ROTAS_LIVRES)) {
    if (!rotas.includes(rota)) problemas.push({ arquivo: rota, linha: 1, motivo: "ROTAS_LIVRES aponta para uma rota que não existe mais" });
  }
  for (const area of Object.keys(AREAS_LIVRES)) {
    if (![...funcoesPorArquivo.keys()].some((a) => a.startsWith(area))) problemas.push({ arquivo: area, linha: 1, motivo: "AREAS_LIVRES aponta para uma pasta sem Server Actions" });
  }
  return { problemas, acoes: arquivosDeAcoes.length, rotas: rotas.length };
}
