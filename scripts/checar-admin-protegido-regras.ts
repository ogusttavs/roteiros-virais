/**
 * Confere que toda `page.tsx` de `src/app/admin/` chama `exigirAdmin()` antes
 * de qualquer outro `await` (achado de seguranca, 20/09/2026: o layout
 * sozinho nao bastava, o App Router roda layout e pagina em paralelo). Sem
 * I/O de escrita nem process.exit aqui, para dar para testar; o ponto de
 * entrada de linha de comando fica em checar-admin-protegido.ts.
 */
import { globSync, readFileSync } from "node:fs";

export const PADRAO = "src/app/admin/**/page.tsx";

export type Problema = { arquivo: string; linha: number; motivo: string };

function ehChamadaExigirAdmin(linha: string): boolean {
  return linha.includes("exigirAdmin(");
}

/** `await params` (e `await searchParams`) nao consultam nada, so leem o proprio pedido. */
function ehAwaitDeParams(linha: string): boolean {
  return /\bawait\s+(search)?[Pp]arams\b/.test(linha);
}

export function verificarConteudo(caminho: string, conteudo: string): Problema[] {
  const linhas = conteudo.split("\n");

  let encontrouExigirAdmin = false;
  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];
    if (ehChamadaExigirAdmin(linha)) {
      encontrouExigirAdmin = true;
      continue;
    }
    if (encontrouExigirAdmin) continue;
    if (/\bawait\s+/.test(linha) && !ehAwaitDeParams(linha)) {
      return [
        {
          arquivo: caminho,
          linha: i + 1,
          motivo: "await antes de exigirAdmin(); toda page.tsx do admin confere a sessao antes de qualquer consulta",
        },
      ];
    }
  }

  if (!encontrouExigirAdmin) {
    return [{ arquivo: caminho, linha: 1, motivo: "nao chama exigirAdmin() em lugar nenhum" }];
  }
  return [];
}

export function verificarArquivo(caminho: string): Problema[] {
  return verificarConteudo(caminho, readFileSync(caminho, "utf8"));
}

export function listarArquivos(padrao: string = PADRAO): string[] {
  return globSync(padrao).sort();
}

// ---------------------------------------------------------------------------
// Server Actions do admin (E46, item 0 da E49 PR 1): `src/app/admin/**/acoes.ts`
// ---------------------------------------------------------------------------

export const PADRAO_ACOES = "src/app/admin/**/acoes.ts";

type Funcao = { nome: string; exportada: boolean; linhaInicial: number; corpo: string[] };

function separarFuncoes(conteudo: string): Funcao[] {
  const linhas = conteudo.split("\n");
  const inicios: { nome: string; exportada: boolean; i: number }[] = [];
  linhas.forEach((linha, i) => {
    const m = /^(export\s+)?async\s+function\s+(\w+)/.exec(linha);
    if (m) inicios.push({ nome: m[2], exportada: Boolean(m[1]), i });
  });
  return inicios.map((f, k) => ({ nome: f.nome, exportada: f.exportada, linhaInicial: f.i + 1, corpo: linhas.slice(f.i, k + 1 < inicios.length ? inicios[k + 1].i : linhas.length) }));
}

/** O corpo confere o admin antes do primeiro `await` que não seja a leitura da sessão (`await sessaoAtual()`) ou dos params. */
function conferePrimeiro(corpo: string[]): boolean {
  for (const linha of corpo) {
    if (linha.includes("garantirSessaoAdmin(")) return true;
    if (/\bawait\s+/.test(linha) && !/\bawait\s+sessaoAtual\(/.test(linha) && !ehAwaitDeParams(linha)) return false;
  }
  return false;
}

/** Toda Server Action exportada de `acoes.ts` confere `garantirSessaoAdmin` antes de consultar ou gravar, direto ou por um ajudante do mesmo arquivo que o faça. */
export function verificarAcoes(caminho: string, conteudo: string): Problema[] {
  const funcoes = separarFuncoes(conteudo);
  const ajudantesQueConferem = new Set(funcoes.filter((f) => !f.exportada && conferePrimeiro(f.corpo)).map((f) => f.nome));
  const problemas: Problema[] = [];
  for (const f of funcoes.filter((x) => x.exportada)) {
    const chamaAjudante = (linha: string) => [...ajudantesQueConferem].some((nome) => linha.includes(`${nome}(`));
    const usaAjudante = f.corpo.some(chamaAjudante);
    const primeiroAwait = f.corpo.findIndex((linha) => /await\s+/.test(linha) && !/await\s+sessaoAtual\(/.test(linha) && !ehAwaitDeParams(linha));
    const ajudanteAntes = usaAjudante && f.corpo.findIndex(chamaAjudante) <= (primeiroAwait === -1 ? Infinity : primeiroAwait);
    if (!conferePrimeiro(f.corpo) && !ajudanteAntes) {
      problemas.push({ arquivo: caminho, linha: f.linhaInicial, motivo: `a Server Action ${f.nome} nao chama garantirSessaoAdmin() antes do primeiro await` });
    }
  }
  return problemas;
}

export function verificarArquivoDeAcoes(caminho: string): Problema[] {
  return verificarAcoes(caminho, readFileSync(caminho, "utf8"));
}
