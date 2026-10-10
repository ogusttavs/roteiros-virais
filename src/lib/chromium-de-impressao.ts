import { textosMarcasDeFala } from "@/textos/marcas-de-fala";
import { textosRoteiro } from "@/textos/roteiro";

/**
 * O que o PDF (`/api/roteiros/[id]/pdf`) e a imagem para o celular (`/api/roteiros/[id]/imagem`) têm em comum (E26) e não depende de sessão nem de banco: a guarda no Chromium, o tempo limite,
 * a conferência da página de impressão e o pé do PDF. A checagem de sessão e de posse e o endereço com o token estão em `impressao-de-roteiro.ts`.
 *
 * Guarda no Chromium (ajuste da revisão do PR #33, item 4): sem limite, dois cliques seguidos (ou dois clientes ao mesmo tempo) abrem dois navegadores num container que já divide a memória
 * com o Next. `comLimiteDeChromium` deixa no máximo `MAX_CHROMIUM_SIMULTANEO` rodando; o resto espera a vez, no próprio processo (uma instância do servidor, sem fila externa). A fila também tem
 * teto (`MAX_NA_FILA`): quem chega com a fila cheia recebe `ErroFilaCheia` (a rota responde 503), em vez de a fila crescer sem limite com pedidos de uma pessoa só. O tempo limite existe porque o
 * padrão do Playwright (30 s) seguraria a requisição, e quem clicou "baixar" o tempo todo, demais.
 */
const MAX_CHROMIUM_SIMULTANEO = 2;
const MAX_NA_FILA = 6;
export const TEMPO_LIMITE_MS = 15_000;

export class ErroFilaCheia extends Error {}

let chromiumEmUso = 0;
const filaDeEspera: (() => void)[] = [];

export async function comLimiteDeChromium<T>(tarefa: () => Promise<T>): Promise<T> {
  if (chromiumEmUso >= MAX_CHROMIUM_SIMULTANEO) {
    if (filaDeEspera.length >= MAX_NA_FILA) throw new ErroFilaCheia("fila de impressao cheia");
    await new Promise<void>((resolve) => filaDeEspera.push(resolve));
  }
  chromiumEmUso += 1;
  try {
    return await tarefa();
  } finally {
    chromiumEmUso -= 1;
    filaDeEspera.shift()?.();
  }
}

export function comTempoLimite<T>(promessa: Promise<T>, mensagem: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const temporizador = setTimeout(() => reject(new Error(mensagem)), TEMPO_LIMITE_MS);
    promessa.then(
      (valor) => {
        clearTimeout(temporizador);
        resolve(valor);
      },
      (erro) => {
        clearTimeout(temporizador);
        reject(erro);
      },
    );
  });
}

/** Texto de fora indo para dentro de HTML (o pé do PDF é um HTML do Chromium): o que fecha ou abre marcação sai. */
export function escaparHtml(texto: string): string {
  return texto.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * O pé de cada página do PDF (`footerTemplate` do Chromium): "Roteiro de <marca>, <data>" e "página X de Y". O nome da marca é de quem a pessoa digitou, então vai escapado. Com as marcas
 * de fala (E41 2c), uma linha de legenda em cima, em cada página: o papel não abre a folha "Como ler as marcas". O pé do Chromium não recebe o CSS da página, então a legenda é HTML com
 * estilo na própria linha, com as mesmas seis marcas do painel.
 */
export function rodapeDoPdf(marca: string, dataPorExtenso: string, comLegendaDasMarcas = false): string {
  const { peEsquerda, pePagina, peDe } = textosRoteiro.folha;
  const estiloDaLinha = "display:flex;justify-content:space-between;font-family:monospace;font-size:8px;color:#8a8a8a";
  const conteudoDaLinha = `<span>${escaparHtml(peEsquerda(marca, dataPorExtenso))}</span><span>${pePagina} <span class="pageNumber"></span> ${peDe} <span class="totalPages"></span></span>`;
  const quadro = "width:100%;box-sizing:border-box;padding:0 16mm";
  if (!comLegendaDasMarcas) return `<div style="${quadro};${estiloDaLinha}">${conteudoDaLinha}</div>`;
  const l = textosMarcasDeFala.legendaDoPapel;
  const cinza = "#6b6b6b";
  const barra = (longa: boolean) =>
    `<span style="display:inline-block;width:${longa ? "8px" : "2px"};height:8px;margin:0 3px;vertical-align:-1px;border-radius:1px;background:${
      longa ? `linear-gradient(90deg,${cinza} 0 30%,transparent 30% 70%,${cinza} 70% 100%)` : cinza
    }"></span>`;
  const legenda = [
    `<b style="padding:0 3px;border-radius:2px;background:#e3edc2;color:#1c1c1c">${l.peso}</b>`,
    `<span>${l.a}${barra(false)}${l.pausa}</span>`,
    `<span>${l.a}${barra(true)}${l.pausaLonga}</span>`,
    `<span style="text-decoration:underline wavy #5f7a00">${l.devagar}</span>`,
    // A seta é a flecha para a direita (que toda fonte tem) girada: o glifo diagonal pode faltar na fonte do servidor, e viraria um quadrado.
    `<span><span style="display:inline-block;transform:rotate(45deg)">&#8594;</span> ${l.tomDesce}</span>`,
    `<span><span style="display:inline-block;transform:rotate(-45deg)">&#8594;</span> ${l.tomSobe}</span>`,
  ].join('<span style="margin:0 5px"></span>');
  return `<div style="${quadro};font-family:sans-serif;font-size:8px;color:${cinza}"><div style="padding-bottom:3px;margin-bottom:3px;border-bottom:1px solid #dcdcdc;white-space:nowrap">${legenda}</div><div style="${estiloDaLinha}">${conteudoDaLinha}</div></div>`;
}

/** Uma resposta que não é 2xx do Playwright (o token vencido, o roteiro que sumiu) não é a página de impressão: vira erro, nunca um PDF da página de erro. */
export function conferirPaginaDeImpressao(resposta: { ok(): boolean; status(): number } | null): void {
  if (!resposta || !resposta.ok()) throw new Error(`a pagina de impressao respondeu ${resposta ? resposta.status() : "nada"}`);
}
