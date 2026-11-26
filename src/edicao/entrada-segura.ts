/**
 * Achado A2 da auditoria de 26/11/2026: o ffmpeg e o ffprobe adivinham o formato do arquivo, e um texto no formato de lista (`ffconcat`) fazia o ffmpeg abrir o vídeo de outra marca. Toda
 * entrada que veio da pessoa leva estas opções antes do `-i`: o formato é o do MP4 e do MOV (os únicos que o aplicativo aceita), e só o protocolo `file` pode ser aberto (nada de `concat`, `http`,
 * `subfile` nem lista vinda do arquivo).
 */
export const OPCOES_DE_ENTRADA_SEGURA: readonly string[] = ["-protocol_whitelist", "file", "-f", "mov"];

/** Os quatro primeiros e os quatro seguintes bytes de um MP4 ou MOV: o tamanho da primeira caixa e o nome dela. */
const CAIXAS_DE_ABERTURA = new Set(["ftyp", "moov", "mdat", "wide", "free", "skip"]);

/** Confere pelos primeiros bytes (no mínimo 8) que o arquivo começa como MP4 ou MOV. O que o navegador declarou não vale. */
export function comecaComoMp4OuMov(inicio: Uint8Array): boolean {
  if (inicio.byteLength < 8) return false;
  const nome = String.fromCharCode(inicio[4], inicio[5], inicio[6], inicio[7]);
  return CAIXAS_DE_ABERTURA.has(nome);
}
