/**
 * Levar o roteiro para fora do painel (E26, passo 23 do Opus): o PDF e a imagem para o celular. Código do navegador, sem estado: quem chama (a tela do roteiro, o menu do Hoje) cuida do
 * "gerando", do aviso de falha e do toast. As duas rotas (`/api/roteiros/[id]/pdf` e `/imagem`) fazem a checagem de sessão no servidor; aqui só se confere que veio o que foi pedido, porque
 * um login vencido volta como a página de entrada com status 200.
 */
import { ErroDeAcao } from "@/lib/resultado-acao";

/**
 * Quando as marcas pedidas não puderam ser escritas (a IA caiu, ou o teto do dia), a rota diz `{ erro: "marcas", mensagem }`: a frase vai à pessoa (um `ErroDeAcao`, que a tela mostra
 * como está), com o caminho de desligar a chave e baixar sem as marcas.
 */
async function lerFraseDasMarcas(resposta: Response): Promise<void> {
  if (resposta.ok || !resposta.headers.get("content-type")?.includes("application/json")) return;
  const corpo = (await resposta.clone().json().catch(() => null)) as { erro?: string; mensagem?: string } | null;
  if (corpo?.erro === "marcas" && typeof corpo.mensagem === "string") throw new ErroDeAcao(corpo.mensagem);
}

/** O arquivo PDF do roteiro, gerado no servidor (leva alguns segundos). Falha com o erro da rede, que quem chama distingue de "o servidor não conseguiu". */
export async function pedirPdfDoRoteiro(roteiroId: number, opcoes: { comMarcas?: boolean } = {}): Promise<Blob> {
  const resposta = await fetch(`/api/roteiros/${roteiroId}/pdf${opcoes.comMarcas ? "?marcas=1" : ""}`);
  await lerFraseDasMarcas(resposta);
  if (!resposta.ok || !resposta.headers.get("content-type")?.includes("application/pdf")) {
    throw new Error("o pdf nao veio");
  }
  return resposta.blob();
}

/** As imagens 9:16 do roteiro (uma por quadro; um roteiro longo vira duas ou mais), já como arquivos PNG com o nome `roteiro-<data>-1.png`. */
export async function pedirImagensDoRoteiro(roteiroId: number, opcoes: { comMarcas?: boolean } = {}): Promise<File[]> {
  const resposta = await fetch(`/api/roteiros/${roteiroId}/imagem${opcoes.comMarcas ? "?marcas=1" : ""}`);
  await lerFraseDasMarcas(resposta);
  if (!resposta.ok || !resposta.headers.get("content-type")?.includes("application/json")) {
    throw new Error("a imagem nao veio");
  }
  const corpo = (await resposta.json()) as { nome?: string; imagens?: string[] };
  if (!Array.isArray(corpo.imagens) || corpo.imagens.length === 0 || typeof corpo.nome !== "string") {
    throw new Error("a imagem nao veio");
  }
  const nome = corpo.nome;
  return corpo.imagens.map((base64, indice) => {
    const bytes = Uint8Array.from(atob(base64), (letra) => letra.charCodeAt(0));
    const sufixo = corpo.imagens!.length > 1 ? `-${indice + 1}` : "";
    return new File([bytes], `${nome}${sufixo}.png`, { type: "image/png" });
  });
}

/** Baixa um arquivo pelo navegador (o link temporário de sempre). Soltar o endereço logo depois do clique cancela o download em alguns navegadores (o Safari, por exemplo): espera. */
export function baixarArquivo(arquivo: Blob, nome: string): void {
  const endereco = URL.createObjectURL(arquivo);
  const link = document.createElement("a");
  link.href = endereco;
  link.download = nome;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(endereco), 10_000);
}

export type ResultadoDoGuardar = "compartilhado" | "baixado" | "cancelado" | "precisaDeToque";

/**
 * A folha de compartilhar só vale em aparelho de toque (o celular e o tablet, onde ela tem "Salvar imagem"): no computador, o Chrome, o Edge e o Safari também sabem compartilhar arquivos,
 * mas abrem uma folha do sistema sem a opção de salvar o PNG, e a pessoa quer o arquivo baixado.
 */
function podeCompartilhar(arquivos: File[]): boolean {
  if (typeof navigator === "undefined" || typeof window === "undefined") return false;
  if (!window.matchMedia?.("(pointer: coarse)").matches) return false;
  return typeof navigator.canShare === "function" && typeof navigator.share === "function" && navigator.canShare({ files: arquivos });
}

/**
 * "Guardar como imagem no celular": a folha de compartilhar do aparelho (onde está "Salvar imagem" ou "Salvar em Fotos", o único caminho que põe a imagem na galeria no iPhone) quando o
 * navegador deixa compartilhar arquivos; senão, baixa uma a uma. `cancelado` é a pessoa fechando a folha, que não é falha.
 *
 * `precisaDeToque`: o iPhone só abre a folha de compartilhar logo depois de um toque, e a imagem leva alguns segundos para ficar pronta, então o toque em "Guardar como imagem" já passou
 * quando chega a hora de compartilhar (`NotAllowedError`). Em vez de cair no download (que no iPhone não põe nada na galeria), a tela pede um segundo toque ("Guardar"), e este chama de novo
 * com `jaTemToque`: aí a folha abre dentro do próprio toque, e qualquer recusa seguinte cai no download.
 */
export async function guardarImagens(arquivos: File[], jaTemToque = false): Promise<ResultadoDoGuardar> {
  if (podeCompartilhar(arquivos)) {
    try {
      await navigator.share({ files: arquivos });
      return "compartilhado";
    } catch (erro) {
      if (erro instanceof DOMException && erro.name === "AbortError") return "cancelado";
      if (!jaTemToque && erro instanceof DOMException && erro.name === "NotAllowedError") return "precisaDeToque";
      // Qualquer outra falha da folha de compartilhar: cai no download.
    }
  }
  for (const arquivo of arquivos) {
    baixarArquivo(arquivo, arquivo.name);
    // Vários downloads seguidos, sem pausa, fazem alguns navegadores descartar os seguintes.
    if (arquivos.length > 1) await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return "baixado";
}
