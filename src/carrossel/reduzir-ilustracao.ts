/**
 * E69 PR A: a ilustracao que chega do Codex (JPEG ou PNG, ate 6 MB, em qualquer tamanho) vira JPEG de 1080 por 1350 (recorte central, "cover") antes de ser guardada. A conta e feita no mesmo Chromium
 * do render, num canvas, sem biblioteca de imagem nova. Um PNG de 3,5 MB como `background-image` em data-URL o Chromium descarta em silencio (licao da maquete de 25/11/2026): por isso o JPEG de qualidade 84.
 */
import { ALTURA_DO_SLIDE, LARGURA_DO_SLIDE } from "@/config/carrossel";
import { comLimiteDeChromium, comTempoLimite } from "@/lib/chromium-de-impressao";
import { abrirChromiumSemRede, paginaSemRede } from "@/lib/chromium-sem-rede";

export const QUALIDADE_DA_ILUSTRACAO = 0.84;

/** Os bytes reduzidos (JPEG 1080 por 1350), ou lanca se o navegador nao consegue ler a imagem. */
export async function reduzirIlustracao(bytes: Buffer, tipo: string): Promise<Buffer> {
  return comLimiteDeChromium(async () => {
    // M4 (auditoria de 26/11/2026): a mesma página sem rede do render dos slides.
    const navegador = await abrirChromiumSemRede();
    try {
      const pagina = await paginaSemRede(navegador);
      const base64 = (await comTempoLimite(
        pagina.evaluate(
          async ({ b64, mime, largura, altura, qualidade }) => {
            const bruto = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
            const imagem = await createImageBitmap(new Blob([bruto], { type: mime }));
            const escala = Math.max(largura / imagem.width, altura / imagem.height);
            const w = imagem.width * escala;
            const h = imagem.height * escala;
            const tela = document.createElement("canvas");
            tela.width = largura;
            tela.height = altura;
            const contexto = tela.getContext("2d");
            if (!contexto) throw new Error("sem canvas");
            contexto.fillStyle = "#ffffff";
            contexto.fillRect(0, 0, largura, altura);
            contexto.drawImage(imagem, (largura - w) / 2, (altura - h) / 2, w, h);
            const url = tela.toDataURL("image/jpeg", qualidade);
            return url.slice(url.indexOf(",") + 1);
          },
          { b64: bytes.toString("base64"), mime: tipo, largura: LARGURA_DO_SLIDE, altura: ALTURA_DO_SLIDE, qualidade: QUALIDADE_DA_ILUSTRACAO },
        ),
        "tempo esgotado reduzindo a ilustracao",
      )) as string;
      return Buffer.from(base64, "base64");
    } finally {
      await navegador.close();
    }
  });
}
