/**
 * O aplicativo percebe que mudou de versao e se recarrega sozinho (hotfix de 22/10/2026).
 *
 * O problema: depois de uma subida, quem estava com o painel aberto ainda roda o codigo da versao
 * anterior. A primeira acao que chama o servidor (uma Server Action) fala com o servidor novo, a
 * resposta nao bate com o que o codigo velho espera, e o `catch` da tela mostrava "Sem conexao
 * agora", embora a rede estivesse boa e o servidor ate tivesse terminado o trabalho (achado do
 * Gustavo em producao, 22/10/2026, "Avaliar o tema" no Tema livre).
 *
 * O `deploymentId` do Next nao resolve sozinho em servidor proprio: ele so poe `?dpl=` nos arquivos e
 * o cabecalho `x-deployment-id` nos pedidos, e quem faz o resto (recarregar quando o id muda) e a
 * plataforma onde o app roda, que aqui nao existe. O que o Next oferece e o erro certo para o caso
 * "o servidor nao conhece esta acao" (`UnrecognizedActionError`), reconhecido abaixo.
 *
 * Como funciona:
 *   1. O build leva o sha do commit para dentro do JavaScript do navegador (`NEXT_PUBLIC_VERSAO`, vem
 *      de `GIT_SHA` em `next.config.ts`); o servidor em execucao responde o sha dele em `/api/versao`.
 *   2. Sinal CERTO de versao nova (o servidor nao reconhece a acao): recarrega a pagina na hora.
 *   3. Falha que PARECE rede (o mesmo texto de uma queda de verdade): antes de assumir "sem conexao",
 *      pergunta a versao ao servidor. Se o pedido falha, e rede de verdade e nada muda. Se responde
 *      com um sha diferente do do navegador, recarrega.
 *   4. Recarrega no maximo uma vez por minuto (trava contra laco se o servidor responder outra versao
 *      por um instante, por exemplo no meio de uma subida).
 *
 * Recarregar nao perde trabalho: o rascunho e a nota do tema, o roteiro e o briefing ja ficam no
 * servidor. Sem `NEXT_PUBLIC_VERSAO` (build local, e2e) o item 3 fica desligado; o item 2 nao depende dela.
 */

export const ROTA_DA_VERSAO = "/api/versao";
export const CHAVE_ULTIMA_RECARGA = "roteiros-recarga-por-versao";
/** Uma recarga por versao nova e suficiente: dentro desta janela nao recarrega de novo. */
export const JANELA_ENTRE_RECARGAS_MS = 60_000;
const TEMPO_DA_CONSULTA_MS = 4_000;

/** O sha do build que esta rodando neste navegador ("" em build local e no e2e). */
export function versaoDoNavegador(): string {
  return process.env.NEXT_PUBLIC_VERSAO ?? "";
}

/**
 * O servidor disse que nao conhece a acao que o navegador pediu: o navegador e de uma versao anterior.
 * Sinal certo, sem precisar perguntar nada.
 */
export function ehSinalDeVersaoNova(erro: unknown): boolean {
  // Confere o nome da classe que o Next lanca (`UnrecognizedActionError`, o mesmo que
  // `unstable_isUnrecognizedActionError` testa) em vez de importar a funcao de `next/navigation`: os
  // testes de tela trocam esse modulo inteiro por um mock, e um import novo nele os derrubava.
  if (erro instanceof Error && erro.name === "UnrecognizedActionError") return true;
  return erro instanceof Error && /failed to find server action/i.test(erro.message);
}

/**
 * Pura. O sha do servidor e diferente do do navegador? So vale quando os dois existem: sem um deles
 * (build local, resposta torta) nao ha como afirmar que mudou, e o padrao e nao recarregar.
 */
export function versaoMudou(doNavegador: string, doServidor: unknown): boolean {
  return (
    doNavegador !== "" &&
    typeof doServidor === "string" &&
    doServidor !== "" &&
    doServidor !== doNavegador
  );
}

/** Pura. Passou tempo suficiente desde a ultima recarga por versao? */
export function podeRecarregar(agora: number, ultima: number | null): boolean {
  return (
    ultima === null ||
    !Number.isFinite(ultima) ||
    agora - ultima >= JANELA_ENTRE_RECARGAS_MS ||
    agora < ultima
  );
}

type BuscarFn = (entrada: string, init?: RequestInit) => Promise<Pick<Response, "ok" | "json">>;

/**
 * Pergunta ao servidor qual e a versao dele. `false` em qualquer falha (sem rede, tempo esgotado,
 * resposta estranha): falta de resposta nunca e prova de versao nova.
 */
export async function servidorTemVersaoNova(
  doNavegador: string = versaoDoNavegador(),
  buscar: BuscarFn = (entrada, init) => fetch(entrada, init),
): Promise<boolean> {
  if (doNavegador === "") return false;
  try {
    const resposta = await buscar(ROTA_DA_VERSAO, {
      cache: "no-store",
      credentials: "same-origin",
      signal: AbortSignal.timeout(TEMPO_DA_CONSULTA_MS),
    });
    if (!resposta.ok) return false;
    const corpo = (await resposta.json()) as { versao?: unknown } | null;
    return versaoMudou(doNavegador, corpo?.versao);
  } catch {
    return false;
  }
}

type Ambiente = {
  agora: () => number;
  ler: () => string | null;
  gravar: (valor: string) => void;
  recarregar: () => void;
};

function ambienteDoNavegador(): Ambiente | null {
  if (typeof location === "undefined") return null;
  return {
    agora: () => Date.now(),
    ler: () => {
      try {
        return sessionStorage.getItem(CHAVE_ULTIMA_RECARGA);
      } catch {
        return null;
      }
    },
    gravar: (valor) => {
      try {
        sessionStorage.setItem(CHAVE_ULTIMA_RECARGA, valor);
      } catch {
        // Sem armazenamento a trava de laco nao existe; a recarga em si continua valendo.
      }
    },
    recarregar: () => location.reload(),
  };
}

/** Recarrega a pagina por inteiro, no maximo uma vez por minuto. Devolve se recarregou. */
export function recarregarPorVersaoNova(
  ambiente: Ambiente | null = ambienteDoNavegador(),
): boolean {
  if (!ambiente) return false;
  const agora = ambiente.agora();
  const ultimaTexto = ambiente.ler();
  const ultima = ultimaTexto === null ? null : Number(ultimaTexto);
  if (!podeRecarregar(agora, ultima)) return false;
  ambiente.gravar(String(agora));
  ambiente.recarregar();
  return true;
}

let conferindo: Promise<void> | null = null;

/**
 * Para a falha que parece rede: confere a versao em segundo plano e recarrega se mudou. Uma conferencia
 * por vez (varios `catch` da mesma tela chamam a funcao para o mesmo erro). Nunca lanca.
 */
export function conferirVersaoEmSegundoPlano(): Promise<void> {
  if (conferindo) return conferindo;
  conferindo = servidorTemVersaoNova()
    .then((mudou) => {
      if (mudou) recarregarPorVersaoNova();
    })
    .finally(() => {
      conferindo = null;
    });
  return conferindo;
}

/**
 * Para o erro que parou uma tela inteira (`error.tsx`): sinal certo recarrega; qualquer outro erro
 * confere a versao, porque um pedaco de codigo que nao carrega (arquivo da versao anterior que o
 * servidor novo ja nao tem) tambem aparece como erro de tela.
 */
export function reagirAErroDeTela(erro: unknown): void {
  if (ehSinalDeVersaoNova(erro)) {
    recarregarPorVersaoNova();
    return;
  }
  void conferirVersaoEmSegundoPlano();
}
