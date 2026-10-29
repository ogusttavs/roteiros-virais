/**
 * O que a tela sabe de um arquivo de vídeo escolhido no aparelho, antes de enviar: o tamanho em MB (para mostrar) e a duração (o navegador lê só o cabeçalho). Usado pelas folhas "Publicar no
 * Instagram" (E56) e "Editar o meu vídeo" (E47 PR 4).
 */

export function megasDoArquivo(bytes: number): string {
  return (bytes / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
}

/** A duração do vídeo, lida no próprio aparelho (o navegador só lê o cabeçalho). `null` quando ele não consegue (alguns formatos de celular em computador): a Meta confere do mesmo jeito. */
export function lerDuracao(arquivo: File): Promise<number | null> {
  return new Promise((resolver) => {
    const endereco = URL.createObjectURL(arquivo);
    const video = document.createElement("video");
    const terminar = (valor: number | null) => {
      URL.revokeObjectURL(endereco);
      video.removeAttribute("src");
      resolver(valor);
    };
    const prazo = setTimeout(() => terminar(null), 4000);
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      clearTimeout(prazo);
      terminar(Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null);
    };
    video.onerror = () => {
      clearTimeout(prazo);
      terminar(null);
    };
    video.src = endereco;
  });
}

